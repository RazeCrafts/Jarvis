"""API secret storage — Windows Credential Manager (keyring).

Phase 2 decision (one source of truth): provider API keys live in Windows
Credential Manager under the service name "JARVIS". They are never written to
.env files and never returned to the UI (only a masked preview). Non-secret
settings stay in backend/.env (see config.py).

NOTE: this module is deliberately NOT named "secrets.py" — that would shadow
Python's stdlib secrets module, which the Hermes agent imports.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

import keyring
import keyring.errors

from config import BACKEND_DIR

logger = logging.getLogger("jarvis.secrets")

SERVICE = "JARVIS"
ENTRY = "openrouter_api_key"

HERMES_HOME_DIR = BACKEND_DIR / "hermes-home"


def get_openrouter_key() -> str:
    """The OpenRouter key, or '' when unset. Never logged, never returned to UI."""
    try:
        value = keyring.get_password(SERVICE, ENTRY)
    except Exception as exc:  # noqa: BLE001 - keyring backend issues shouldn't 500
        logger.error("keyring read failed: %s", exc)
        return ""
    return value or ""


def save_openrouter_key(key: str) -> None:
    keyring.set_password(SERVICE, ENTRY, key)
    # Keep the process env in sync so the Hermes runtime (which reads env vars)
    # sees the current key without touching any .env file.
    os.environ["OPENROUTER_API_KEY"] = key


def delete_openrouter_key() -> None:
    try:
        keyring.delete_password(SERVICE, ENTRY)
    except keyring.errors.PasswordDeleteError:
        pass  # already absent
    os.environ.pop("OPENROUTER_API_KEY", None)


def mask(key: str) -> str:
    if not key:
        return ""
    if len(key) <= 12:
        return "•" * len(key)
    return f"{key[:6]}…{key[-4:]}"


# ---------------------------------------------------------------- multi-provider keys
# Phase 3: every provider key lives in Credential Manager under its canonical
# env-var name (e.g. ANTHROPIC_API_KEY), so the Hermes runtime and any child
# process (gateway, cron) pick them up from the environment. OpenRouter keeps
# its legacy entry name for backwards compatibility.


def get_provider_key(env_var: str) -> str:
    """Stored key for a provider env var, or '' when unset."""
    env_var = (env_var or "").strip().upper()
    if not env_var:
        return ""
    if env_var == "OPENROUTER_API_KEY":
        legacy = get_openrouter_key()
        if legacy:
            return legacy
    try:
        return keyring.get_password(SERVICE, env_var) or ""
    except Exception as exc:  # noqa: BLE001
        logger.error("keyring read failed for %s: %s", env_var, exc)
        return ""


def save_provider_key(env_var: str, key: str) -> None:
    env_var = (env_var or "").strip().upper()
    if not env_var:
        raise ValueError("env var name required")
    keyring.set_password(SERVICE, env_var, key)
    os.environ[env_var] = key
    if env_var == "OPENROUTER_API_KEY":
        # Keep the legacy entry in sync too.
        save_openrouter_key(key)


def delete_provider_key(env_var: str) -> None:
    env_var = (env_var or "").strip().upper()
    try:
        keyring.delete_password(SERVICE, env_var)
    except keyring.errors.PasswordDeleteError:
        pass
    os.environ.pop(env_var, None)
    if env_var == "OPENROUTER_API_KEY":
        delete_openrouter_key()


def key_env_status(env_vars: list[str]) -> dict[str, dict[str, str]]:
    """{env_var: {masked, present}} for a provider's key env vars."""
    out: dict[str, dict[str, str]] = {}
    for env_var in env_vars:
        value = get_provider_key(env_var)
        out[env_var] = {"masked": mask(value), "present": bool(value)}
    return out


def publish_keys(env_vars: list[str]) -> int:
    """Load stored keys into this process's environment (inherited by children).
    Returns how many were published."""
    count = 0
    for env_var in env_vars:
        value = get_provider_key(env_var)
        if value:
            os.environ[env_var] = value
            count += 1
    return count


def _strip_key_lines(path: Path) -> None:
    """Remove any OPENROUTER_API_KEY line from an env file (secrets never
    belong in env files; a stale empty line here even *overrides* the real
    key via Hermes's env loader with override=True). Reads with utf-8-sig so
    a leading BOM (this file had one) can't hide the first line."""
    if not path.exists():
        return
    lines = path.read_text(encoding="utf-8-sig").splitlines()
    kept = [ln for ln in lines if not ln.strip().startswith("OPENROUTER_API_KEY")]
    if len(kept) != len(lines):
        path.write_text("\n".join(kept).rstrip() + "\n", encoding="utf-8")
        logger.info("removed stale OPENROUTER_API_KEY line(s) from %s", path)


def bootstrap_secrets() -> None:
    """One-time work at backend startup:
    1. migrate a legacy key from backend/.env into Credential Manager,
    2. purge key lines from env files (backend/.env + hermes-home/.env),
    3. publish the key into the process environment for the Hermes runtime.
    """
    legacy = ""
    env_path = BACKEND_DIR / ".env"
    if env_path.exists():
        lines = env_path.read_text(encoding="utf-8-sig").splitlines()
        for line in lines:
            if line.strip().startswith("OPENROUTER_API_KEY="):
                legacy = line.split("=", 1)[1].strip()
                break

    if legacy and not get_openrouter_key():
        save_openrouter_key(legacy)
        logger.info("migrated legacy OPENROUTER_API_KEY from backend/.env to Windows Credential Manager")
    elif legacy:
        logger.info("legacy key found in backend/.env but a key already exists in Credential Manager")

    _strip_key_lines(env_path)
    _strip_key_lines(HERMES_HOME_DIR / ".env")

    current = get_openrouter_key()
    if current:
        os.environ["OPENROUTER_API_KEY"] = current
