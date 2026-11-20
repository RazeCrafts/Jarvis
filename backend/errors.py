"""Plain-language provider error mapping.

Providers return raw HTTP errors that used to surface verbatim in the chat
("HTTP 404: This model is unavailable for free…"). This module translates the
common cases into sentences a person can act on, without leaking raw JSON into
the conversation.

The provider name is passed in so the message names the API that was actually
called — a 404 from NVIDIA NIM must not say "doesn't exist on OpenRouter".
"""

from __future__ import annotations

import re


def explain_provider_error(
    status: int,
    body: str,
    provider: str = "OpenRouter",
    slug: str = "openrouter",
) -> str:
    """Map an HTTP status + response body to a plain sentence."""
    lowered = (body or "").lower()
    name = provider or "the provider"

    if status == 401:
        return (
            f"Your {name} API key was rejected (invalid or revoked). "
            f"Open Providers, paste the {name} key again, then press Test connection."
        )
    if status == 429 or "rate limit" in lowered:
        if "free-models-per-day" in lowered or "free-models" in lowered:
            return (
                f"{name}'s daily free-model limit is used up (it resets every day). "
                "Add a few credits or try again tomorrow."
            )
        return "Rate limited — too many requests right now. Wait a minute and try again."
    if status == 402 or "insufficient" in lowered or "no credit" in lowered:
        return (
            f"{name} says this key has no credit for that model. "
            "Pick a model included with this provider, or add credits with them."
        )
    if status == 404:
        if "unavailable for free" in lowered or "use this slug instead" in lowered or "paid version" in lowered:
            return (
                f"{name} no longer offers that model for free. "
                "Pick a different model from the picker next to the message box."
            )
        if slug and slug != "openrouter":
            return (
                f"{name} doesn't recognize that model id. "
                f"Pick one of {name}'s models: Providers → Choose model "
                "(or the picker next to the message box)."
            )
        return "That model id doesn't exist on OpenRouter. Pick a different model."
    if status == 410 or "end of life" in lowered or "end-of-life" in lowered:
        return (
            f"{name} retired that model (end of life). "
            "Pick a current model from the picker next to the message box."
        )
    if status == 408 or status == 504:
        return "The model took too long to respond. Try again."
    if 500 <= status < 600:
        return f"The model provider had a temporary problem ({status}). Try again in a moment."
    return f"The request was rejected by {name} ({status}). Check the model and key in Settings."


# Status codes looked for inside Hermes runtime failure text (it retries and
# finally raises "HTTP <code>: <message>" through httpx/openai exceptions).
_STATUS_PATTERN = re.compile(r"HTTP (\d{3})")


def explain_runtime_failure(
    text: str,
    provider: str = "OpenRouter",
    slug: str = "openrouter",
) -> str:
    """Translate a Hermes/agent exception string into plain language.
    Falls back to a short generic message instead of dumping raw text."""
    body = text or ""
    match = _STATUS_PATTERN.search(body)
    if match:
        return explain_provider_error(int(match.group(1)), body, provider, slug)
    lowered = body.lower()
    if "connection" in lowered or "timeout" in lowered or "timed out" in lowered:
        return (
            f"Couldn't reach {provider} — check your internet connection "
            "and try again."
        )
    if "api key" in lowered or "authentication" in lowered or "missing authentication" in lowered:
        return (
            f"{provider} rejected the credentials. "
            "Open Providers and check the API key for this provider."
        )
    return "JARVIS's model runtime hit an unexpected error. Try again; if it keeps failing, check Settings."


# Hermes sometimes "succeeds" with an error string as the reply (its internal
# loop gives up and puts the failure text into final_response). Detect those
# replies by their characteristic openings so they can be translated.
_ERROR_REPLY_PREFIXES = ("API call failed", "Error:", "❌", "HTTP ")


def is_error_reply(text: str) -> bool:
    """True when a 'successful' reply is really a provider failure report."""
    stripped = (text or "").lstrip()
    return stripped.startswith(_ERROR_REPLY_PREFIXES)
