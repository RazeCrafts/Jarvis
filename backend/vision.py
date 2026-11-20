"""See-my-screen vision (Phase 4).

Screenshot the desktop, a single window, or a region, then ask the vision model
chosen in Settings. Only OpenAI-compatible endpoints are supported for now
(OpenRouter, or a custom endpoint such as LM Studio); the UI says so in plain
words instead of failing silently.

The screenshot file stays local (backend/hermes-home/screenshots) and is only
sent to the configured provider when the owner presses the button.
"""

from __future__ import annotations

import base64
import logging
import time
from io import BytesIO
from pathlib import Path
from typing import Any

import httpx
import yaml

from config import BACKEND_DIR, get_settings
from secret_store import get_openrouter_key, get_provider_key

logger = logging.getLogger("jarvis.vision")

SHOT_DIR = (BACKEND_DIR / "hermes-home" / "screenshots").resolve()
CONFIG_FILE = (BACKEND_DIR / "hermes-home" / "config.yaml").resolve()


def _provider_target() -> tuple[str, str, str]:
    """(base_url, api_key, provider_label) for an OpenAI-compatible endpoint."""
    settings = get_settings()
    provider = (settings.provider or "openrouter").strip()
    if provider == "openrouter":
        key = get_openrouter_key()
        if not key:
            raise RuntimeError("No OpenRouter key is saved — add one in Providers.")
        return settings.openrouter_base_url.rstrip("/"), key, "openrouter"
    if provider.startswith("custom:"):
        name = provider.split(":", 1)[1]
        data: dict[str, Any] = {}
        if CONFIG_FILE.exists():
            try:
                loaded = yaml.safe_load(CONFIG_FILE.read_text(encoding="utf-8-sig"))
                if isinstance(loaded, dict):
                    data = (loaded.get("providers") or {}).get(name) or {}
            except Exception:  # noqa: BLE001
                data = {}
        base = (data.get("api") or data.get("base_url") or "").strip().rstrip("/")
        if not base:
            raise RuntimeError(f"Custom provider '{name}' has no base URL in config.yaml.")
        key = get_provider_key(str(data.get("key_env") or "")) or "not-needed"
        return base, key, f"custom:{name}"
    raise RuntimeError(
        "See-my-screen needs an OpenAI-compatible provider. "
        f"'{provider}' is active — switch to OpenRouter or add a custom endpoint (LM Studio/Ollama) in Providers."
    )


def _capture(window: str | None, region: list[int] | None) -> Path:
    import pyautogui

    SHOT_DIR.mkdir(parents=True, exist_ok=True)
    path = SHOT_DIR / f"shot_{int(time.time() * 1000)}.png"
    if window and window.strip():
        from app_index import _find_window  # same title matching as window control

        win = _find_window(window.strip())
        if win is None:
            raise RuntimeError(f"No open window matching '{window}'.")
        rect = win.rectangle()
        image = pyautogui.screenshot(
            region=(rect.left, rect.top, max(1, rect.right - rect.left), max(1, rect.bottom - rect.top))
        )
    elif region and len(region) == 4:
        image = pyautogui.screenshot(region=tuple(int(v) for v in region))  # type: ignore[arg-type]
    else:
        image = pyautogui.screenshot()
    image.save(path)
    return path


def _data_url(path: Path) -> str:
    raw = path.read_bytes()
    # Downscale huge screenshots so vision requests stay fast and cheap.
    try:
        from PIL import Image

        img = Image.open(BytesIO(raw))
        if max(img.size) > 1600:
            scale = 1600 / max(img.size)
            img = img.resize((int(img.width * scale), int(img.height * scale)))
            buffer = BytesIO()
            img.save(buffer, format="PNG")
            raw = buffer.getvalue()
    except Exception:  # noqa: BLE001
        pass
    return "data:image/png;base64," + base64.b64encode(raw).decode("ascii")


def _plain_error(status: int, body: str, model: str, provider: str) -> str:
    lowered = body.lower()
    if status == 429 or "rate limit" in lowered or "quota" in lowered:
        return (
            "The provider's free quota is used up right now, so I couldn't describe the screen. "
            "Add credits or switch provider, then try again."
        )
    if "vision" in lowered or "image" in lowered or "multimodal" in lowered or "modality" in lowered:
        return (
            f"The model '{model}' can't see images. Pick a vision-capable model in Control → Vision "
            f"(the current provider is {provider})."
        )
    return f"The vision request failed ({status}): {body.strip()[:300]}"


def see_screen(
    question: str = "",
    window: str | None = None,
    region: list[int] | None = None,
    model: str | None = None,
) -> dict[str, Any]:
    settings = get_settings()
    chosen = (model or settings.vision_model or settings.default_model or "").strip()
    try:
        base, key, provider = _provider_target()
    except RuntimeError as exc:
        return {"ok": False, "error": str(exc)}
    if not chosen:
        return {"ok": False, "error": "No vision model is selected in Settings."}

    try:
        path = _capture(window, region)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Screenshot failed: {exc}"}

    prompt = question.strip() or (
        "Describe what is on this screen in plain language. Mention the active app, "
        "the visible content, and anything that needs attention."
    )
    payload = {
        "model": chosen,
        "max_tokens": 600,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": _data_url(path)}},
                ],
            }
        ],
    }
    try:
        resp = httpx.post(
            f"{base}/chat/completions",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json=payload,
            timeout=120,
        )
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Vision request failed: {exc}", "imagePath": str(path)}

    if resp.status_code != 200:
        return {
            "ok": False,
            "error": _plain_error(resp.status_code, resp.text, chosen, provider),
            "imagePath": str(path),
            "model": chosen,
        }

    try:
        content = resp.json()["choices"][0]["message"]["content"]
        if isinstance(content, list):
            content = "\n".join(
                part.get("text", "") for part in content if isinstance(part, dict)
            ).strip()
        text = str(content).strip()
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Unexpected vision response: {exc}", "imagePath": str(path)}

    return {
        "ok": True,
        "description": text,
        "model": chosen,
        "provider": provider,
        "imagePath": str(path),
    }


def screenshot_file(path: str) -> Path:
    """Validated screenshot path for GET /vision/image (never arbitrary files)."""
    candidate = Path(path).resolve()
    if SHOT_DIR not in candidate.parents and candidate != SHOT_DIR:
        raise ValueError("not a JARVIS screenshot")
    if not candidate.exists() or candidate.suffix.lower() != ".png":
        raise ValueError("screenshot not found")
    return candidate
