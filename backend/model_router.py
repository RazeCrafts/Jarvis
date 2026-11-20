"""OpenRouter direct client + task routing.

Two jobs:
1. Fallback brain — streams chat completions straight from OpenRouter when
   the Hermes runtime isn't available (no key yet, import failure, or
   BRAIN=openrouter).
2. Task-based model routing — picks the fast model for quick replies and the
   heavy model for reasoning-heavy asks. Routing is keyword-based and fully
   configurable via settings (no hardcoded ids beyond defaults in .env).
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, AsyncIterator

import httpx

from config import get_settings
from errors import explain_provider_error
from secret_store import get_openrouter_key, get_provider_key

logger = logging.getLogger("jarvis.router")

HEAVY_HINTS = re.compile(
    r"\b(analyz\w*|reason\w*|proof|prove|derive|solve|complex|refactor|"
    r"architect\w*|research|deep|compare|strategy|debug|why)\b",
    re.IGNORECASE,
)

SYSTEM_PROMPT = (
    "You are JARVIS, a personal AI assistant running locally on the user's "
    "Windows PC. You are calm, precise, mildly formal, and address the user "
    "as 'sir' occasionally without overdoing it. Keep answers tight and "
    "useful. When you produce code, use fenced markdown blocks with a "
    "language tag."
)


def pick_model(message: str, override: str | None = None) -> str:
    """Route a message to a model tier. Explicit override always wins."""
    settings = get_settings()
    if override:
        return override
    if HEAVY_HINTS.search(message or ""):
        return settings.heavy_model
    return settings.default_model


# ------------------------------------------------------------------ providers


def provider_profile(slug: str) -> Any:
    """The Hermes provider profile (base URL, env vars, headers) for a slug."""
    try:
        from providers import list_providers

        for profile in list_providers():
            aliases = tuple(getattr(profile, "aliases", ()) or ())
            if getattr(profile, "name", "") == slug or slug in aliases:
                return profile
    except Exception as exc:  # noqa: BLE001 - catalog is optional
        logger.debug("provider profile lookup failed for %s: %s", slug, exc)
    return None


def provider_label(slug: str | None = None) -> str:
    """Human name for the active provider (used in error messages)."""
    slug = (slug or get_settings().provider or "openrouter").strip()
    if slug.startswith("custom:"):
        return slug.split(":", 1)[1] or "custom endpoint"
    profile = provider_profile(slug)
    return str(getattr(profile, "display_name", "") or slug)


def provider_endpoint(slug: str | None = None) -> dict[str, Any] | None:
    """Resolve base URL, key, headers and API mode for the active provider.

    Custom endpoints are addressed as ``custom:<name>`` and read from
    ``JARVIS_CUSTOM_PROVIDERS``; everything else comes from Hermes's own
    provider profiles (never a hand-maintained list).
    """
    settings = get_settings()
    slug = (slug or settings.provider or "openrouter").strip() or "openrouter"

    if slug == "openrouter":
        return {
            "slug": slug,
            "label": "OpenRouter",
            "base_url": settings.openrouter_base_url.rstrip("/"),
            "api_key": get_openrouter_key(),
            "headers": {
                "HTTP-Referer": "http://localhost:1420",
                "X-Title": "JARVIS",
            },
            "api_mode": "chat_completions",
        }

    if slug.startswith("custom:"):
        name = slug.split(":", 1)[1]
        config = settings.custom_providers_dict.get(name) or {}
        base = str(config.get("api") or config.get("base_url") or config.get("api_url") or "").rstrip("/")
        key_env = str(config.get("key_env") or "")
        key = get_provider_key(key_env) if key_env else ""
        return {
            "slug": slug,
            "label": name or slug,
            "base_url": base,
            "api_key": key or "not-needed",
            "headers": {},
            "api_mode": str(config.get("transport") or "openai_chat"),
        }

    profile = provider_profile(slug)
    if profile is None:
        return None
    env_name = f"{slug.upper().replace('-', '_')}_BASE_URL"
    base = os.environ.get(env_name) or str(getattr(profile, "base_url", "") or "")
    env_vars = tuple(getattr(profile, "env_vars", ()) or ())
    key = get_provider_key(env_vars[0]) if env_vars else ""
    return {
        "slug": slug,
        "label": provider_label(slug),
        "base_url": base.rstrip("/"),
        "api_key": key,
        "headers": dict(getattr(profile, "default_headers", {}) or {}),
        "api_mode": str(getattr(profile, "api_mode", "chat_completions") or "chat_completions"),
    }


async def stream_openrouter(
    message: str,
    history: list[dict[str, Any]] | None = None,
    model: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Yield bridge-style events: token*, tool_call*, done, error.

    Despite the historical name this streams from the ACTIVE provider, so the
    fallback works with any Hermes provider (OpenRouter, NVIDIA NIM, custom
    OpenAI-compatible endpoints) instead of always hitting OpenRouter.
    """
    settings = get_settings()
    endpoint = provider_endpoint()
    if endpoint is None:
        yield {
            "type": "error",
            "message": (
                f"JARVIS doesn't have an API profile for provider "
                f"'{settings.provider}'. Pick another provider in the Providers tab."
            ),
        }
        return

    label = str(endpoint["label"])
    provider_slug = str(endpoint["slug"])
    if not endpoint["base_url"]:
        yield {"type": "error", "message": f"No endpoint URL is configured for {label}."}
        return
    if not endpoint["api_key"]:
        yield {
            "type": "error",
            "message": (
                f"No API key configured for {label}. Open Providers, save the key, "
                "then try again."
            ),
        }
        return
    if endpoint["api_mode"] not in {"chat_completions", "openai_chat", "openai"}:
        yield {
            "type": "error",
            "message": (
                f"{label} uses the '{endpoint['api_mode']}' API, which JARVIS only "
                "reaches through the Hermes runtime. Start Hermes (check the doctor) "
                "or pick an OpenAI-compatible provider."
            ),
        }
        return

    history = history or []
    messages: list[dict[str, Any]] = [{"role": "system", "content": SYSTEM_PROMPT}]
    for entry in history:
        role = entry.get("role")
        content = entry.get("content")
        if role in {"user", "assistant"} and content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": message})

    chosen = pick_model(message, model)
    yield {"type": "status", "brain": provider_slug, "model": chosen}

    headers = {
        "Authorization": f"Bearer {endpoint['api_key']}",
        "Content-Type": "application/json",
        **endpoint["headers"],
    }
    payload = {"model": chosen, "messages": messages, "stream": True}

    collected: list[str] = []
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(90.0)) as client:
            async with client.stream(
                "POST",
                f"{endpoint['base_url']}/chat/completions",
                headers=headers,
                json=payload,
            ) as response:
                if response.status_code >= 400:
                    body = (await response.aread()).decode("utf-8", "replace")[:400]
                    yield {
                        "type": "error",
                        "message": explain_provider_error(
                            response.status_code, body, label, provider_slug
                        ),
                    }
                    return
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[len("data:"):].strip()
                    if data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    if chunk.get("error"):
                        detail = chunk["error"]
                        message = (
                            detail.get("message") if isinstance(detail, dict) else str(detail)
                        ) or str(detail)
                        yield {"type": "error", "message": str(message)[:400]}
                        return
                    # Usage-only / keep-alive frames carry no choices.
                    choices = chunk.get("choices") or []
                    if not choices:
                        continue
                    delta = (choices[0] or {}).get("delta", {}).get("content")
                    if delta:
                        collected.append(delta)
                        yield {"type": "token", "content": delta}
        yield {"type": "done", "fullResponse": "".join(collected)}
    except Exception as exc:  # noqa: BLE001 - surface any network failure
        logger.exception("provider stream failed")
        yield {"type": "error", "message": f"{type(exc).__name__}: {exc}"}


async def list_openrouter_models() -> list[dict[str, Any]]:
    """Fetch free-tier model list from OpenRouter (for Settings + chat picker)."""
    settings = get_settings()
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0)) as client:
            response = await client.get(
                f"{settings.openrouter_base_url}/models",
                headers={"Authorization": f"Bearer {get_openrouter_key()}"}
                if get_openrouter_key()
                else {},
            )
            response.raise_for_status()
            data = response.json().get("data", [])
            free = [
                {
                    "id": m.get("id"),
                    "name": m.get("name"),
                    "context": m.get("context_length"),
                }
                for m in data
                if (m.get("id") or "").endswith(":free")
            ]
            return sorted(free, key=lambda m: m.get("id") or "")
    except Exception as exc:  # noqa: BLE001
        logger.warning("model list fetch failed: %s", exc)
        return []
