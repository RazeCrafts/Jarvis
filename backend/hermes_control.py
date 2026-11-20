"""Hermes control plane — drives the installed hermes-agent runtime.

Phase 3: JARVIS integrates Hermes through its own surfaces instead of
re-implementing them. Verified against hermes-agent 0.19.0 (installed in
backend/.venv):

- Provider catalog:  hermes_cli.provider_catalog.provider_catalog()  (41 providers)
- Toolsets:         hermes_cli.tools_config.CONFIGURABLE_TOOLSETS   (25 groups)
- Toolset state:    `hermes tools enable|disable <name>` (writes HERMES_HOME config)
- Cron jobs:        {HERMES_HOME}/cron/jobs.json, managed by `hermes cron ...`
- MCP servers:      HERMES_HOME/config.yaml `mcp_servers`, managed by `hermes mcp ...`
- Gateway:          `hermes gateway run|status|stop` (messaging platforms)
- Doctor:           `hermes doctor`
- Skills hub:       `hermes skills browse|search|install|list`

All CLI calls run the SAME hermes.exe that ships in our venv with
HERMES_HOME=backend/hermes-home — fully sandboxed from the owner's personal
Hermes install. Secrets are published to the child environment from Windows
Credential Manager (never from env files).
"""

from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import sys
import threading
from pathlib import Path
from typing import Any

import yaml

from config import BACKEND_DIR, get_settings
from secret_store import (
    delete_provider_key,
    get_provider_key,
    key_env_status,
    save_provider_key,
)

logger = logging.getLogger("jarvis.hermes.control")

HERMES_HOME_DIR = (BACKEND_DIR / "hermes-home").resolve()
HERMES_EXE = BACKEND_DIR / ".venv" / "Scripts" / "hermes.exe"
CRON_JOBS_FILE = HERMES_HOME_DIR / "cron" / "jobs.json"
CONFIG_FILE = HERMES_HOME_DIR / "config.yaml"

# Gateway platforms we can configure with a plain bot token. Matched to the
# env vars hermes_cli.gateway reads (verified: TELEGRAM_BOT_TOKEN etc.).
GATEWAY_PLATFORMS: list[dict[str, str]] = [
    {"id": "telegram", "label": "Telegram", "env": "TELEGRAM_BOT_TOKEN"},
    {"id": "discord", "label": "Discord", "env": "DISCORD_BOT_TOKEN"},
    {"id": "slack", "label": "Slack", "env": "SLACK_BOT_TOKEN"},
    {"id": "email", "label": "Email", "env": "EMAIL_PASSWORD"},
]

_gateway_proc: subprocess.Popen | None = None
_gateway_log_path = BACKEND_DIR / "hermes-home" / "logs" / "jarvis-gateway.log"

_catalog_cache: list[dict[str, Any]] | None = None
_toolsets_cache: list[tuple[str, str, str]] | None = None


def ensure_tool_paths() -> list[str]:
    """Make sure Hermes child processes can find Git Bash and cua-driver even
    before the user's next logon refreshes PATH (installs happen mid-session)."""
    candidates = [
        Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Git" / "cmd",
        Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Git" / "bin",
        Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Cua" / "cua-driver" / "bin",
    ]
    path = os.environ.get("PATH", "")
    parts = [p for p in path.split(os.pathsep) if p]
    added: list[str] = []
    for candidate in candidates:
        try:
            if candidate.exists() and str(candidate) not in parts:
                path = str(candidate) + os.pathsep + path
                parts.insert(0, str(candidate))
                added.append(str(candidate))
        except Exception:  # noqa: BLE001
            continue
    os.environ["PATH"] = path
    return added


# ---------------------------------------------------------------- internals


def _child_env() -> dict[str, str]:
    ensure_tool_paths()
    env = os.environ.copy()
    env["HERMES_HOME"] = str(HERMES_HOME_DIR)
    return env


def _hermes(args: list[str], timeout: int = 60) -> tuple[int, str]:
    """Run hermes.exe with the sandboxed HERMES_HOME. Returns (code, output)."""
    try:
        proc = subprocess.run(
            [str(HERMES_EXE), *args],
            cwd=str(BACKEND_DIR),
            env=_child_env(),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
        return proc.returncode, (proc.stdout or "") + (proc.stderr or "")
    except subprocess.TimeoutExpired:
        return 124, f"hermes {' '.join(args)} timed out after {timeout}s"
    except FileNotFoundError:
        return 127, f"hermes CLI not found at {HERMES_EXE}"
    except Exception as exc:  # noqa: BLE001
        return 1, f"hermes {' '.join(args)} failed: {exc}"


def _load_yaml() -> dict[str, Any]:
    if not CONFIG_FILE.exists():
        return {}
    try:
        data = yaml.safe_load(CONFIG_FILE.read_text(encoding="utf-8-sig"))
        return data if isinstance(data, dict) else {}
    except Exception as exc:  # noqa: BLE001
        logger.warning("config.yaml unreadable: %s", exc)
        return {}


def _save_yaml(data: dict[str, Any]) -> None:
    CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")


# ---------------------------------------------------------------- providers


def provider_catalog() -> list[dict[str, Any]]:
    """41-provider catalog from Hermes itself (single source of truth)."""
    global _catalog_cache
    if _catalog_cache is not None:
        return _catalog_cache
    site = str(BACKEND_DIR / ".venv" / "Lib" / "site-packages")
    if site not in sys.path:
        sys.path.insert(0, site)
    from hermes_cli.provider_catalog import provider_catalog as _catalog

    out: list[dict[str, Any]] = []
    for index, desc in enumerate(_catalog()):
        env_vars = list(desc.api_key_env_vars)
        status = key_env_status(env_vars) if env_vars else {}
        out.append(
            {
                "slug": desc.slug,
                "label": desc.label,
                "description": desc.description,
                "authType": desc.auth_type,
                "tab": desc.tab,
                "envVars": env_vars,
                "baseUrlEnvVar": desc.base_url_env_var,
                "signupUrl": desc.signup_url,
                "order": index,
                "keys": status,
                "configured": any(v["present"] for v in status.values()) if status else False,
            }
        )
    _catalog_cache = out
    return out


def invalidate_provider_cache() -> None:
    global _catalog_cache
    _catalog_cache = None


def provider_entry(slug: str) -> dict[str, Any] | None:
    slug = (slug or "").strip()
    for entry in provider_catalog():
        if entry["slug"] == slug:
            return entry
    return None


def save_key_for_provider(slug: str, env_var: str | None, key: str) -> dict[str, Any]:
    entry = provider_entry(slug)
    if entry is None:
        raise ValueError(f"unknown provider '{slug}'")
    allowed = entry["envVars"]
    if not allowed:
        raise ValueError(f"provider '{slug}' has no API-key env var")
    target = (env_var or allowed[0]).strip().upper()
    if target not in allowed:
        raise ValueError(f"{target} is not a key env var for {slug} (expected one of {allowed})")
    save_provider_key(target, key.strip())
    invalidate_provider_cache()
    return {"ok": True, "envVar": target}


def remove_key_for_provider(slug: str, env_var: str | None) -> dict[str, Any]:
    entry = provider_entry(slug)
    if entry is None:
        raise ValueError(f"unknown provider '{slug}'")
    target = (env_var or (entry["envVars"][0] if entry["envVars"] else "")).strip().upper()
    if not target:
        raise ValueError("no key env var to remove")
    delete_provider_key(target)
    invalidate_provider_cache()
    return {"ok": True, "envVar": target}


def provider_models(slug: str) -> dict[str, Any]:
    """Live model list for a provider.

    Order of sources (never hardcoded):
      1. OpenRouter → our existing live free-model endpoint data source.
      2. models.dev catalog (Hermes's own cached registry, 1h TTL) — covers
         the 100+ providers it tracks.
      3. For custom/LM Studio endpoints → probe {base_url}/models directly.
    """
    entry = provider_entry(slug)
    if entry is None:
        raise ValueError(f"unknown provider '{slug}'")

    if slug == "openrouter":
        try:
            import asyncio
            from model_router import list_openrouter_models

            free = asyncio.run(list_openrouter_models())
            return {"provider": slug, "source": "openrouter", "models": free}
        except Exception as exc:  # noqa: BLE001
            logger.warning("openrouter model list failed: %s", exc)

    # models.dev registry shipped with Hermes (cached, no key needed).
    try:
        site = str(BACKEND_DIR / ".venv" / "Lib" / "site-packages")
        if site not in sys.path:
            sys.path.insert(0, site)
        from agent import models_dev

        models = models_dev.list_provider_models(slug) or []
        normalized = []
        for m in models:
            if isinstance(m, str):
                normalized.append({"id": m, "name": None, "context": None})
            elif isinstance(m, dict):
                normalized.append(
                    {
                        "id": m.get("id") or m.get("model") or "",
                        "name": m.get("name"),
                        "context": m.get("context") or m.get("context_window"),
                    }
                )
        normalized = [m for m in normalized if m["id"]]
        if normalized:
            return {"provider": slug, "source": "models.dev", "models": normalized}
    except Exception as exc:  # noqa: BLE001
        logger.info("models.dev list failed for %s: %s", slug, exc)

    # Custom OpenAI-compatible endpoint probe (user-defined base URL).
    try:
        import httpx

        base = ""
        if entry["baseUrlEnvVar"]:
            base = os.environ.get(entry["baseUrlEnvVar"], "")
        if not base:
            custom = get_settings().custom_providers_dict.get(slug) or {}
            base = custom.get("api_url") or custom.get("base_url") or ""
        if base:
            key = get_provider_key(entry["envVars"][0]) if entry["envVars"] else ""
            headers = {"Authorization": f"Bearer {key}"} if key else {}
            resp = httpx.get(f"{base.rstrip('/')}/models", headers=headers, timeout=10)
            if resp.status_code == 200:
                data = resp.json().get("data") or []
                models = [
                    {"id": m.get("id", ""), "name": m.get("name"), "context": m.get("context_length")}
                    for m in data
                    if isinstance(m, dict) and m.get("id")
                ]
                if models:
                    return {"provider": slug, "source": "endpoint", "models": models}
            return {"provider": slug, "source": "endpoint", "models": [], "error": f"HTTP {resp.status_code}"}
    except Exception as exc:  # noqa: BLE001
        return {"provider": slug, "source": "endpoint", "models": [], "error": str(exc)[:200]}

    return {"provider": slug, "source": "none", "models": []}


# Model ids are cached briefly so per-message validation doesn't hit the
# network on every turn.
_MODEL_IDS_CACHE: dict[str, tuple[float, list[str]]] = {}
_MODEL_IDS_TTL = 600.0
_NON_CHAT_MODEL = re.compile(
    r"(embed|rerank|guard|safety|moderation|image|video|tts|asr|whisper|ocr|audio|"
    r"detector|translate|voicechat|studiovoice|magpie|paligemma|cosmos|bevformer|"
    r"sparsedrive|usdcode|usdvalidate|streampetr|speaker)",
    re.IGNORECASE,
)


def is_non_chat_model(model_id: str) -> bool:
    """True for ids that are embeddings/rerankers/image/TTS, not chat models."""
    return bool(_NON_CHAT_MODEL.search(model_id or ""))


def provider_model_ids(slug: str) -> list[str]:
    """Model ids for a provider (cached), used for picker validation."""
    import time

    now = time.time()
    cached = _MODEL_IDS_CACHE.get(slug)
    if cached and now - cached[0] < _MODEL_IDS_TTL:
        return cached[1]
    try:
        data = provider_models(slug)
        ids = [str(m.get("id") or "") for m in data.get("models", [])]
        ids = [m for m in ids if m]
    except Exception as exc:  # noqa: BLE001
        logger.info("model id list failed for %s: %s", slug, exc)
        ids = []
    if ids:
        _MODEL_IDS_CACHE[slug] = (now, ids)
    return ids


def default_chat_model(slug: str) -> str:
    """A sane chat model for a provider.

    Hermes's provider profile carries curated fallback models; prefer those
    (they are current, unlike arbitrary entries in a models.dev snapshot).
    OpenRouter is special-cased to its live free list.
    """
    ids = provider_model_ids(slug)
    if slug != "openrouter":
        try:
            from providers import list_providers

            for profile in list_providers():
                aliases = tuple(getattr(profile, "aliases", ()) or ())
                if getattr(profile, "name", "") != slug and slug not in aliases:
                    continue
                for candidate in tuple(getattr(profile, "fallback_models", ()) or ()):
                    if _NON_CHAT_MODEL.search(candidate):
                        continue
                    if not ids or candidate in ids:
                        return candidate
                break
        except Exception as exc:  # noqa: BLE001
            logger.debug("provider profile fallback failed for %s: %s", slug, exc)
    for model_id in ids:
        if _NON_CHAT_MODEL.search(model_id):
            continue
        return model_id
    return ""


def model_available(slug: str, model: str) -> bool:
    """True when `model` belongs to the provider, or when the list is unknown.

    Deliberately permissive: a failed model-list fetch must not block the user's
    explicit choice. It only rejects ids that clearly belong to another
    provider (the OpenRouter `:free` slug sent to NVIDIA NIM case).
    """
    ids = provider_model_ids(slug)
    if not ids:
        return True
    return model in ids


def custom_providers() -> dict[str, Any]:
    return get_settings().custom_providers_dict


def add_custom_provider(name: str, base_url: str, key_env: str = "", transport: str = "openai_chat") -> dict[str, Any]:
    """Write a user-defined provider into HERMES_HOME/config.yaml `providers:`.

    Schema verified in hermes_cli/providers.py::resolve_user_provider:
    { name: {name, api|base_url, key_env, transport} }. The provider is then
    addressable as provider="custom:<name>" by the Hermes runtime.
    """
    name = re.sub(r"[^a-zA-Z0-9_-]+", "-", (name or "").strip()).strip("-").lower()
    if not name:
        raise ValueError("provider name required")
    if not (base_url or "").strip():
        raise ValueError("base URL required")
    cfg = _load_yaml()
    providers = cfg.get("providers") or {}
    if not isinstance(providers, dict):
        providers = {}
    providers[name] = {
        "name": name,
        "api": base_url.strip(),
        "key_env": (key_env or "").strip().upper(),
        "transport": transport or "openai_chat",
    }
    cfg["providers"] = providers
    _save_yaml(cfg)
    return {"ok": True, "name": name}


def remove_custom_provider(name: str) -> dict[str, Any]:
    cfg = _load_yaml()
    providers = cfg.get("providers") or {}
    if isinstance(providers, dict) and name in providers:
        providers.pop(name)
        cfg["providers"] = providers
        _save_yaml(cfg)
    return {"ok": True, "name": name}


# ---------------------------------------------------------------- toolsets


def _configurable_toolsets() -> list[tuple[str, str, str]]:
    global _toolsets_cache
    if _toolsets_cache is not None:
        return _toolsets_cache
    site = str(BACKEND_DIR / ".venv" / "Lib" / "site-packages")
    if site not in sys.path:
        sys.path.insert(0, site)
    from hermes_cli.tools_config import CONFIGURABLE_TOOLSETS

    _toolsets_cache = list(CONFIGURABLE_TOOLSETS)
    return _toolsets_cache


def list_toolsets() -> list[dict[str, Any]]:
    """All configurable toolsets + enabled state.

    Enabled state comes from the app setting JARVIS_TOOLSETS when set;
    otherwise Hermes's platform default (`hermes-cli` bundle) applies.
    """
    enabled = set(get_settings().toolsets_list)
    default_all = not enabled  # empty setting = Hermes default posture
    out: list[dict[str, Any]] = []
    for name, label, desc in _configurable_toolsets():
        out.append(
            {
                "name": name,
                "label": label,
                "description": desc,
                "enabled": True if default_all else name in enabled,
            }
        )
    return out


def set_toolset(name: str, enabled: bool) -> dict[str, Any]:
    valid = {n for n, _, _ in _configurable_toolsets()}
    if name not in valid:
        raise ValueError(f"unknown toolset '{name}'")
    settings = get_settings()
    current = settings.toolsets_list
    if not current:
        # Empty setting meant "everything on" — materialize the full list so
        # this change is exact.
        current = sorted(valid)
    current = [n for n in current if n != name]
    if enabled:
        current.append(name)
    current = sorted(set(current))
    from config import persist_settings

    persist_settings({"jarvis_toolsets": ",".join(current)})
    # Mirror into Hermes's own config so gateway/cron runs see it too.
    action = "enable" if enabled else "disable"
    _hermes(["tools", action, name], timeout=60)
    return {"ok": True, "enabled": sorted(current)}


# ---------------------------------------------------------------- MCP


def mcp_servers() -> list[dict[str, Any]]:
    cfg = _load_yaml()
    servers = cfg.get("mcp_servers") or {}
    out: list[dict[str, Any]] = []
    if isinstance(servers, dict):
        for name, entry in servers.items():
            if not isinstance(entry, dict):
                continue
            out.append(
                {
                    "name": name,
                    "type": "remote" if entry.get("url") else "stdio",
                    "url": entry.get("url"),
                    "command": entry.get("command"),
                    "args": entry.get("args") or [],
                    "enabled": entry.get("enabled", True),
                }
            )
    return out


def mcp_add(name: str, url: str | None, command: str | None, args: list[str] | None) -> dict[str, Any]:
    args = [a for a in (args or []) if isinstance(a, str)]
    cmd = ["mcp", "add", name]
    if url:
        cmd += ["--url", url]
    elif command:
        cmd += ["--command", command]
        if args:
            cmd += ["--args", *args]
    else:
        raise ValueError("provide a URL or a command")
    code, out = _hermes(cmd, timeout=90)
    if code != 0:
        raise RuntimeError(out.strip()[:500] or "mcp add failed")
    return {"ok": True, "name": name, "output": out.strip()[:500]}


def mcp_remove(name: str) -> dict[str, Any]:
    code, out = _hermes(["mcp", "remove", name], timeout=60)
    if code != 0:
        raise RuntimeError(out.strip()[:500] or "mcp remove failed")
    return {"ok": True, "name": name}


def mcp_test(name: str) -> dict[str, Any]:
    code, out = _hermes(["mcp", "test", name], timeout=120)
    return {"ok": code == 0, "name": name, "output": out.strip()[-2000:]}


def mcp_catalog() -> str:
    code, out = _hermes(["mcp", "catalog"], timeout=60)
    return out.strip()


# ---------------------------------------------------------------- cron


def cron_jobs() -> list[dict[str, Any]]:
    if not CRON_JOBS_FILE.exists():
        return []
    try:
        data = json.loads(CRON_JOBS_FILE.read_text(encoding="utf-8-sig"))
    except Exception as exc:  # noqa: BLE001
        logger.warning("cron jobs unreadable: %s", exc)
        return []
    jobs = data.get("jobs") if isinstance(data, dict) else data
    if isinstance(jobs, dict):
        jobs = list(jobs.values())
    out: list[dict[str, Any]] = []
    for job in jobs or []:
        if not isinstance(job, dict):
            continue
        schedule = job.get("schedule_display") or job.get("schedule") or "?"
        if isinstance(schedule, dict):
            schedule = schedule.get("value", "?")
        out.append(
            {
                "id": job.get("id") or job.get("job_id") or "",
                "name": job.get("name") or "(unnamed)",
                "schedule": schedule,
                "prompt": job.get("prompt") or "",
                "deliver": job.get("deliver") or ["local"],
                "state": job.get("state") or ("scheduled" if job.get("enabled", True) else "paused"),
                "enabled": bool(job.get("enabled", True)),
                "skills": job.get("skills") or [],
                "script": job.get("script"),
                "lastRun": job.get("last_run"),
                "nextRun": job.get("next_run"),
            }
        )
    return out


def cron_create(
    schedule: str,
    prompt: str,
    name: str | None = None,
    deliver: str | None = None,
    repeat: int | None = None,
    no_agent: bool = False,
) -> dict[str, Any]:
    if not (schedule or "").strip():
        raise ValueError("schedule required (e.g. '30m', 'every 2h', '0 9 * * *')")
    cmd = ["cron", "create", schedule]
    if prompt:
        cmd.append(prompt)
    if name:
        cmd += ["--name", name]
    if deliver:
        cmd += ["--deliver", deliver]
    if repeat:
        cmd += ["--repeat", str(repeat)]
    if no_agent:
        cmd.append("--no-agent")
    code, out = _hermes(cmd, timeout=90)
    if code != 0:
        raise RuntimeError(out.strip()[:500] or "cron create failed")
    return {"ok": True, "output": out.strip()[:500], "jobs": cron_jobs()}


def cron_action(action: str, job_id: str) -> dict[str, Any]:
    valid = {"pause", "resume", "run", "remove"}
    if action not in valid:
        raise ValueError(f"action must be one of {sorted(valid)}")
    code, out = _hermes(["cron", action, job_id], timeout=180 if action == "run" else 60)
    if code != 0:
        raise RuntimeError(out.strip()[:500] or f"cron {action} failed")
    return {"ok": True, "output": out.strip()[:500], "jobs": cron_jobs()}


# ---------------------------------------------------------------- gateway


def gateway_platforms() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for platform in GATEWAY_PLATFORMS:
        token = get_provider_key(platform["env"])
        out.append(
            {
                "id": platform["id"],
                "label": platform["label"],
                "envVar": platform["env"],
                "configured": bool(token),
                "masked": (token[:6] + "…" + token[-4:]) if len(token) > 12 else ("•" * len(token)),
            }
        )
    return out


def gateway_set_platform(platform_id: str, token: str) -> dict[str, Any]:
    match = next((p for p in GATEWAY_PLATFORMS if p["id"] == platform_id), None)
    if match is None:
        raise ValueError(f"unknown platform '{platform_id}'")
    save_provider_key(match["env"], token.strip())
    return {"ok": True, "platform": platform_id}


def gateway_remove_platform(platform_id: str) -> dict[str, Any]:
    match = next((p for p in GATEWAY_PLATFORMS if p["id"] == platform_id), None)
    if match is None:
        raise ValueError(f"unknown platform '{platform_id}'")
    delete_provider_key(match["env"])
    return {"ok": True, "platform": platform_id}


def gateway_start() -> dict[str, Any]:
    """Start `hermes gateway run` as a managed child process (foreground

    mode is what `run` does; systemd-style `start` is for installed services).
    Logs stream to backend/hermes-home/logs/jarvis-gateway.log.
    """
    global _gateway_proc
    if _gateway_proc is not None and _gateway_proc.poll() is None:
        return {"ok": True, "running": True, "pid": _gateway_proc.pid, "alreadyRunning": True}
    _gateway_log_path.parent.mkdir(parents=True, exist_ok=True)
    log = open(_gateway_log_path, "a", encoding="utf-8", buffering=1)  # noqa: SIM115
    log.write(f"\n=== gateway start {__import__('datetime').datetime.now().isoformat()} ===\n")
    try:
        _gateway_proc = subprocess.Popen(
            [str(HERMES_EXE), "gateway", "run"],
            cwd=str(BACKEND_DIR),
            env=_child_env(),
            stdout=log,
            stderr=subprocess.STDOUT,
        )
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "running": False, "error": str(exc)}
    return {"ok": True, "running": True, "pid": _gateway_proc.pid}


def gateway_stop() -> dict[str, Any]:
    global _gateway_proc
    if _gateway_proc is None or _gateway_proc.poll() is not None:
        _gateway_proc = None
        # Fallback: stop any service-managed gateway for OUR HERMES_HOME only.
        return {"ok": True, "running": False}
    pid = _gateway_proc.pid
    try:
        _gateway_proc.terminate()
        _gateway_proc.wait(timeout=15)
    except Exception:  # noqa: BLE001
        try:
            _gateway_proc.kill()
        except Exception:  # noqa: BLE001
            pass
    _gateway_proc = None
    return {"ok": True, "running": False, "stoppedPid": pid}


def gateway_status() -> dict[str, Any]:
    global _gateway_proc
    running = _gateway_proc is not None and _gateway_proc.poll() is None
    platforms = gateway_platforms()
    return {
        "running": running,
        "pid": _gateway_proc.pid if running and _gateway_proc else None,
        "platforms": platforms,
        "configuredPlatforms": [p["id"] for p in platforms if p["configured"]],
        "cronActive": running,  # cron ticks are driven by the gateway
        "jobCount": len(cron_jobs()),
    }


def gateway_logs(lines: int = 80) -> str:
    if not _gateway_log_path.exists():
        return ""
    try:
        content = _gateway_log_path.read_text(encoding="utf-8", errors="replace").splitlines()
        return "\n".join(content[-max(1, min(lines, 500)):])
    except Exception:  # noqa: BLE001
        return ""


# ---------------------------------------------------------------- doctor / skills


def doctor() -> str:
    code, out = _hermes(["doctor"], timeout=180)
    return out.strip()


def computer_use_status() -> dict[str, Any]:
    code, out = _hermes(["computer-use", "status"], timeout=120)
    return {"installed": "installed at" in out, "output": out.strip()}


def skills_installed() -> list[dict[str, Any]]:
    code, out = _hermes(["skills", "list"], timeout=60)
    return [{"output": out.strip()}] if out.strip() else []


def skills_search(query: str) -> str:
    code, out = _hermes(["skills", "search", query], timeout=90)
    return out.strip()


def skills_install(name: str) -> dict[str, Any]:
    code, out = _hermes(["skills", "install", name], timeout=240)
    return {"ok": code == 0, "output": out.strip()[-3000:]}


def skills_uninstall(name: str) -> dict[str, Any]:
    code, out = _hermes(["skills", "uninstall", name], timeout=90)
    return {"ok": code == 0, "output": out.strip()[-2000:]}


# ---------------------------------------------------------------- env publishing


def all_known_env_vars() -> list[str]:
    """Every provider key env var in the catalog + gateway token vars."""
    vars_: list[str] = []
    for entry in provider_catalog():
        vars_.extend(entry["envVars"])
    vars_.extend(p["env"] for p in GATEWAY_PLATFORMS)
    return sorted(set(v for v in vars_ if v))


def publish_all_keys() -> int:
    """Load all stored keys into this process env (children inherit them)."""
    from secret_store import publish_keys

    return publish_keys(all_known_env_vars())


def start_background_refresh() -> None:
    """Warm the catalog cache off the request path."""

    def _warm() -> None:
        try:
            provider_catalog()
        except Exception:  # noqa: BLE001
            pass

    threading.Thread(target=_warm, daemon=True, name="jarvis-catalog-warm").start()
