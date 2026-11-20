"""JARVIS backend — FastAPI + WebSocket bridge.

Run:  backend\\.venv\\Scripts\\python.exe -m uvicorn main:app --port 8420
(or `python main.py` which self-hosts uvicorn on the configured port).

IMPORTANT: HERMES_HOME is set FIRST so the hermes runtime lives in
backend/hermes-home and never touches the user's personal Hermes install.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import webbrowser
from pathlib import Path
from typing import Any

# ---- must happen before any hermes import ----
os.environ.setdefault("HERMES_HOME", str(Path(__file__).resolve().parent / "hermes-home"))

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import FileResponse, HTMLResponse  # noqa: E402

from config import get_settings, persist_settings  # noqa: E402
from errors import explain_provider_error, explain_runtime_failure, is_error_reply  # noqa: E402
from hermes_bridge import BRIDGE  # noqa: E402
import hermes_control as HC  # noqa: E402
import actions  # noqa: E402
import app_index  # noqa: E402
import file_ops  # noqa: E402
import permissions as PERM  # noqa: E402
import spotify as SPOTIFY  # noqa: E402
import vision  # noqa: E402
import workspace as WORKSPACE  # noqa: E402
from voice import get_voice  # noqa: E402
from model_router import provider_label, provider_endpoint  # noqa: E402
from model_router import list_openrouter_models, stream_openrouter  # noqa: E402
from secret_store import (  # noqa: E402
    bootstrap_secrets,
    delete_openrouter_key,
    get_openrouter_key,
    key_env_status,
    mask,
    save_openrouter_key,
)

bootstrap_secrets()  # migrate legacy .env key → Credential Manager, purge env-file key lines
try:
    HC.publish_all_keys()  # every stored provider/gateway key → process env
    HC.ensure_tool_paths()  # Git Bash + cua-driver installed mid-session
    HC.start_background_refresh()
except Exception as _exc:  # noqa: BLE001
    logging.getLogger("jarvis.main").warning("hermes control warmup failed: %s", _exc)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger("jarvis.main")

# Phase 4: global kill-switch hotkey (degrades silently if the hook is blocked).
try:
    PERM.start_hotkey_listener()
except Exception as _exc:  # noqa: BLE001
    logger.warning("kill-switch hotkey unavailable: %s", _exc)

# Phase 5: local voice (wake word + STT) and the push-to-talk hotkey.
VOICE = get_voice()
try:
    VOICE.start()
    logger.info("voice service ready (wake=%s, ptt=%s)", get_settings().wake_word_enabled, get_settings().ptt_hotkey)
except Exception as _exc:  # noqa: BLE001
    logger.warning("voice service failed to start: %s", _exc)

app = FastAPI(title="JARVIS Backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:1420",
        "http://127.0.0.1:1420",
        "http://tauri.localhost",
        "https://tauri.localhost",
        "tauri://localhost",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

HERMES_HOME = Path(os.environ["HERMES_HOME"])


# ---------------------------------------------------------------- health/status


@app.get("/health")
async def health() -> dict[str, Any]:
    settings = get_settings()
    return {
        "status": "ok",
        "brain": BRIDGE.mode,
        "model": BRIDGE.current_model,
        "hasKey": bool(get_openrouter_key()),
        "confirmDangerousTools": settings.confirm_dangerous_tools,
        "version": app.version,
    }


@app.get("/agent/status")
async def agent_status() -> dict[str, Any]:
    settings = get_settings()
    return {
        "brain": BRIDGE.mode,
        "initError": BRIDGE.init_error,
        "model": BRIDGE.current_model,
        "models": {
            "default": settings.default_model,
            "fast": settings.fast_model,
            "heavy": settings.heavy_model,
        },
        "tts": {"enabled": settings.tts_enabled, "rate": settings.tts_rate, "pitch": settings.tts_pitch},
        "confirmDangerousTools": settings.confirm_dangerous_tools,
        "hasKey": bool(get_openrouter_key()),
    }


# ---------------------------------------------------------------- memory / skills


def _scan_markdown_dir(base: Path, kind: str) -> list[dict[str, Any]]:
    """Return markdown entries from a directory as {id, title, updatedAt}."""
    entries: list[dict[str, Any]] = []
    if not base.exists():
        return entries
    for path in sorted(base.rglob("*.md")):
        stat = path.stat()
        rel = path.relative_to(base)
        entries.append(
            {
                "id": f"{kind}:{rel.as_posix()}",
                "kind": kind,
                "title": path.stem.replace("_", " ").replace("-", " ").title(),
                "path": str(path),
                "updatedAt": int(stat.st_mtime * 1000),
                "size": stat.st_size,
            }
        )
    return entries


def _memory_roots() -> list[Path]:
    roots = [HERMES_HOME / "memories", HERMES_HOME]
    return roots


@app.get("/agent/memory")
async def get_memory() -> dict[str, Any]:
    seen: set[str] = set()
    items: list[dict[str, Any]] = []
    for root in _memory_roots():
        for entry in _scan_markdown_dir(root, "memory"):
            if entry["id"] in seen:
                continue
            seen.add(entry["id"])
            items.append(entry)
    return {"items": items}


@app.get("/agent/memory/content")
async def get_memory_content(path: str) -> dict[str, Any]:
    file_path = Path(path)
    if not file_path.exists() or file_path.suffix != ".md":
        raise HTTPException(status_code=404, detail="memory file not found")
    return {"path": path, "content": file_path.read_text(encoding="utf-8", errors="replace")}


@app.delete("/agent/memory")
async def delete_memory(path: str) -> dict[str, Any]:
    file_path = Path(path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="memory file not found")
    file_path.unlink()
    return {"ok": True, "deleted": path}


@app.get("/agent/skills")
async def get_skills() -> dict[str, Any]:
    skills_dir = HERMES_HOME / "skills"
    items: list[dict[str, Any]] = []
    if skills_dir.exists():
        for child in sorted(skills_dir.iterdir()):
            if child.is_dir():
                stat = child.stat()
                items.append(
                    {
                        "id": f"skill:{child.name}",
                        "name": child.name.replace("_", " ").replace("-", " ").title(),
                        "path": str(child),
                        "updatedAt": int(stat.st_mtime * 1000),
                    }
                )
            elif child.suffix in {".md", ".yaml", ".yml", ".json"}:
                stat = child.stat()
                items.append(
                    {
                        "id": f"skill:{child.name}",
                        "name": child.stem.replace("_", " ").replace("-", " ").title(),
                        "path": str(child),
                        "updatedAt": int(stat.st_mtime * 1000),
                    }
                )
    return {"items": items}


@app.get("/agent/skills/content")
async def get_skill_content(path: str) -> dict[str, Any]:
    """Return readable content for a skill (dir → SKILL.md/README, or the file)."""
    target = Path(path)
    if not target.exists():
        raise HTTPException(status_code=404, detail="skill not found")
    if target.is_dir():
        for candidate in ("SKILL.md", "README.md", "skill.md", "readme.md"):
            candidate_path = target / candidate
            if candidate_path.exists():
                target = candidate_path
                break
        else:
            md_files = sorted(target.glob("*.md"))
            if not md_files:
                return {"path": path, "content": "", "files": [f.name for f in target.iterdir()]}
            target = md_files[0]
    return {
        "path": str(target),
        "content": target.read_text(encoding="utf-8", errors="replace"),
    }


@app.delete("/agent/skills")
async def delete_skill(path: str) -> dict[str, Any]:
    target = Path(path)
    if not target.exists():
        raise HTTPException(status_code=404, detail="skill not found")
    if target.is_dir():
        import shutil

        shutil.rmtree(target)
    else:
        target.unlink()
    return {"ok": True, "deleted": path}


# ---------------------------------------------------------------- models / settings


@app.get("/agent/providers")
async def get_providers() -> dict[str, Any]:
    """Full Hermes provider catalog (single source of truth)."""
    return {"providers": HC.provider_catalog()}


@app.get("/agent/models")
async def get_models() -> dict[str, Any]:
    free = await list_openrouter_models()
    return {"free": free}


@app.post("/agent/brain")
async def set_brain(payload: dict[str, Any]) -> dict[str, Any]:
    brain = (payload.get("brain") or "").strip().lower()
    if brain not in {"hermes", "openrouter", "auto"}:
        raise HTTPException(status_code=400, detail="brain must be hermes|openrouter|auto")
    persist_settings({"jarvis_brain": brain})
    BRIDGE.rebuild()
    return {"ok": True, "brain": brain}


@app.get("/agent/settings")
async def get_settings_endpoint() -> dict[str, Any]:
    settings = get_settings()
    masked = mask(get_openrouter_key())
    return {
        "brain": settings.brain,
        "provider": settings.provider,
        "openrouterApiKeyMasked": masked,
        "hasKey": bool(masked),
        "models": {
            "default": settings.default_model,
            "fast": settings.fast_model,
            "heavy": settings.heavy_model,
        },
        "confirmDangerousTools": settings.confirm_dangerous_tools,
        "allowedApps": settings.allowed_apps_list,
        "tts": {"enabled": settings.tts_enabled, "rate": settings.tts_rate, "pitch": settings.tts_pitch},
        "voice": {
            **VOICE.status(),
            "tts": {"enabled": settings.tts_enabled, "rate": settings.tts_rate, "pitch": settings.tts_pitch},
        },
        "spotify": SPOTIFY.status(),
        "toolsets": settings.toolsets_list,
        "customProviders": settings.custom_providers_dict,
        "permissions": PERM.tool_modes(),
        "killSwitch": {
            "engaged": PERM.kill_engaged(),
            "hotkey": settings.kill_switch_hotkey,
            "active": PERM.hotkey_active(),
        },
        "protectedFolders": file_ops.protected_folders(),
        "visionModel": settings.vision_model,
    }


@app.post("/agent/test-connection")
async def test_connection() -> dict[str, Any]:
    """Tiny real request against the ACTIVE provider with the stored key.
    Returns a plain-language result — never raw HTTP dumps."""
    import httpx

    settings = get_settings()
    endpoint = provider_endpoint()
    if endpoint is None:
        return {
            "ok": False,
            "message": (
                f"JARVIS has no API profile for provider '{settings.provider}'. "
                "Pick one in the Providers tab."
            ),
        }
    label = str(endpoint["label"])
    slug = str(endpoint["slug"])
    if not endpoint["base_url"]:
        return {"ok": False, "message": f"No endpoint URL is configured for {label}."}
    key = endpoint["api_key"]
    if not key:
        return {
            "ok": False,
            "message": f"No {label} API key saved yet. Add it in the Providers tab, then test again.",
        }

    headers = {"Authorization": f"Bearer {key}", **endpoint["headers"]}
    base = str(endpoint["base_url"]).rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0)) as client:
            if slug == "openrouter":
                response = await client.get(f"{base}/key", headers=headers)
            else:
                # Other providers don't all expose /key; a 1-token completion
                # proves the key AND that the selected model actually runs.
                response = await client.post(
                    f"{base}/chat/completions",
                    headers={**headers, "Content-Type": "application/json"},
                    json={
                        "model": settings.default_model,
                        "messages": [{"role": "user", "content": "ping"}],
                        "max_tokens": 1,
                    },
                )
    except Exception as exc:  # noqa: BLE001 - network failures are an expected result
        logger.warning("test-connection network failure: %s", exc)
        return {
            "ok": False,
            "message": f"Couldn't reach {label} — check your internet connection and try again.",
        }

    if response.status_code < 400:
        if slug == "openrouter":
            info = {}
            try:
                info = response.json().get("data", {}) or {}
            except Exception:  # noqa: BLE001
                pass
            detail = []
            if info.get("is_free_tier"):
                detail.append("free tier")
            limit = info.get("limit")
            usage = info.get("usage")
            if isinstance(limit, (int, float)):
                detail.append(
                    f"used {usage}/{limit}" if isinstance(usage, (int, float)) else f"limit {limit}"
                )
            elif isinstance(usage, (int, float)):
                detail.append(f"used ${usage:.2f}")
            suffix = f" ({', '.join(detail)})" if detail else ""
            return {"ok": True, "message": f"Connection works — your key is valid{suffix}."}
        return {
            "ok": True,
            "message": f"Connection works — {label} answered with {settings.default_model}.",
        }
    return {
        "ok": False,
        "message": explain_provider_error(response.status_code, response.text[:400], label, slug),
    }


@app.post("/agent/settings")
async def save_settings(payload: dict[str, Any]) -> dict[str, Any]:
    updates: dict[str, str] = {}

    mapping = {
        "defaultModel": ("jarvis_default_model", str),
        "fastModel": ("jarvis_fast_model", str),
        "heavyModel": ("jarvis_heavy_model", str),
        "brain": ("jarvis_brain", str),
        "provider": ("jarvis_provider", str),
        "confirmDangerousTools": ("jarvis_confirm_dangerous_tools", bool),
        "allowedApps": ("jarvis_allowed_apps", str),
        "ttsEnabled": ("jarvis_tts_enabled", bool),
        "ttsRate": ("jarvis_tts_rate", float),
        "ttsPitch": ("jarvis_tts_pitch", float),
        "killSwitchHotkey": ("jarvis_kill_switch_hotkey", str),
        "visionModel": ("jarvis_vision_model", str),
        # Phase 5 — voice
        "wakeWordEnabled": ("jarvis_wake_word_enabled", bool),
        "wakeWord": ("jarvis_wake_word", str),
        "wakeThreshold": ("jarvis_wake_threshold", float),
        "sttModel": ("jarvis_stt_model", str),
        "voiceLanguage": ("jarvis_voice_language", str),
        "micDevice": ("jarvis_mic_device", str),
        "pttHotkey": ("jarvis_ptt_hotkey", str),
        # Phase 5 — music (client ID is not secret; tokens stay in Credential Manager)
        "spotifyClientId": ("jarvis_spotify_client_id", str),
    }
    for field_name, (env_key, cast) in mapping.items():
        if field_name not in payload:
            continue
        value = payload[field_name]
        if cast is bool:
            updates[env_key] = "true" if value else "false"
        elif cast is float:
            updates[env_key] = str(float(value))
        elif field_name == "allowedApps" and isinstance(value, list):
            updates[env_key] = ",".join(str(v).strip() for v in value if str(v).strip())
        else:
            updates[env_key] = str(value).strip()

    if "toolsets" in payload:
        toolsets = payload["toolsets"]
        if isinstance(toolsets, list):
            updates["jarvis_toolsets"] = ",".join(str(t).strip() for t in toolsets if str(t).strip())
        else:
            updates["jarvis_toolsets"] = str(toolsets).strip()
    if "customProviders" in payload:
        updates["jarvis_custom_providers"] = json.dumps(payload["customProviders"])
    if "permissions" in payload:
        updates["jarvis_permissions"] = json.dumps(payload["permissions"])
    if "protectedFolders" in payload:
        folders = payload["protectedFolders"]
        if isinstance(folders, list):
            updates["jarvis_protected_folders"] = ";".join(
                str(f).strip() for f in folders if str(f).strip()
            )
        else:
            updates["jarvis_protected_folders"] = str(folders).strip()

    key_touched = False
    if payload.get("removeKey"):
        delete_openrouter_key()
        key_touched = True
    api_key = payload.get("openrouterApiKey")
    if api_key is not None:
        api_key = str(api_key).strip()
        if not api_key:
            raise HTTPException(status_code=400, detail="api key cannot be empty")
        save_openrouter_key(api_key)
        key_touched = True

    if not updates and not key_touched:
        raise HTTPException(status_code=400, detail="no recognized settings fields")

    # Switching provider must not keep a model id from the previous provider
    # (the classic "OpenRouter :free slug sent to NVIDIA NIM" 404). Every tier
    # left out of the payload is re-pointed at the new provider's model, so
    # fast/heavy routing can never send a foreign id.
    auto_model = ""
    new_provider = str(payload.get("provider") or "").strip()
    if new_provider and new_provider != get_settings().provider:
        auto_model = str(payload.get("defaultModel") or "").strip()
        if not auto_model:
            auto_model = await asyncio.to_thread(HC.default_chat_model, new_provider)
        if auto_model:
            for field_name, payload_key in (
                ("jarvis_default_model", "defaultModel"),
                ("jarvis_fast_model", "fastModel"),
                ("jarvis_heavy_model", "heavyModel"),
            ):
                if payload_key not in payload:
                    updates[field_name] = auto_model

    if updates:
        persist_settings(updates)
    if "killSwitchHotkey" in payload:
        PERM.stop_hotkey_listener()
        PERM.start_hotkey_listener()
    if any(
        key in payload
        for key in ("wakeWordEnabled", "wakeWord", "wakeThreshold", "micDevice", "sttModel", "voiceLanguage")
    ):
        voice_settings = get_settings()
        VOICE.stop_wake()
        if voice_settings.wake_word_enabled:
            VOICE.start_wake()
    if "pttHotkey" in payload:
        VOICE.restart_ptt()
    BRIDGE.rebuild()  # pick up key/model/brain changes
    return {"ok": True, "applied": sorted(updates.keys()), "model": auto_model or None}


# ---------------------------------------------------------------- hermes control (Phase 3)


@app.get("/hermes/providers")
async def hermes_providers() -> dict[str, Any]:
    return {"providers": HC.provider_catalog()}


@app.post("/hermes/providers/key")
async def hermes_save_provider_key(payload: dict[str, Any]) -> dict[str, Any]:
    slug = str(payload.get("slug", "")).strip()
    key = str(payload.get("key", "")).strip()
    if not slug or not key:
        raise HTTPException(status_code=400, detail="slug and key are required")
    try:
        result = HC.save_key_for_provider(slug, payload.get("envVar"), key)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    BRIDGE.rebuild()
    return result


@app.post("/hermes/providers/remove-key")
async def hermes_remove_provider_key(payload: dict[str, Any]) -> dict[str, Any]:
    slug = str(payload.get("slug", "")).strip()
    if not slug:
        raise HTTPException(status_code=400, detail="slug is required")
    try:
        result = HC.remove_key_for_provider(slug, payload.get("envVar"))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    BRIDGE.rebuild()
    return result


@app.get("/hermes/providers/{slug}/models")
async def hermes_provider_models(slug: str, chat_only: bool = False) -> dict[str, Any]:
    try:
        data = await asyncio.to_thread(HC.provider_models, slug)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if chat_only:
        # The chat picker must not offer embed/rerank/image/TTS ids: selecting
        # one is an instant provider error ("model doesn't exist"/400).
        models = [m for m in data.get("models", []) if not HC.is_non_chat_model(str(m.get("id") or ""))]
        data = {**data, "models": models}
    return data


@app.post("/hermes/custom-providers")
async def hermes_add_custom_provider(payload: dict[str, Any]) -> dict[str, Any]:
    try:
        return await asyncio.to_thread(
            HC.add_custom_provider,
            str(payload.get("name", "")),
            str(payload.get("baseUrl", "")),
            str(payload.get("keyEnv", "") or ""),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/hermes/custom-providers/remove")
async def hermes_remove_custom_provider(payload: dict[str, Any]) -> dict[str, Any]:
    return await asyncio.to_thread(HC.remove_custom_provider, str(payload.get("name", "")))


@app.get("/hermes/toolsets")
async def hermes_toolsets() -> dict[str, Any]:
    return {"toolsets": await asyncio.to_thread(HC.list_toolsets)}


@app.post("/hermes/toolsets/toggle")
async def hermes_toggle_toolset(payload: dict[str, Any]) -> dict[str, Any]:
    name = str(payload.get("name", "")).strip()
    enabled = bool(payload.get("enabled"))
    try:
        result = await asyncio.to_thread(HC.set_toolset, name, enabled)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    BRIDGE.rebuild()
    return result


@app.get("/hermes/mcp")
async def hermes_mcp_list() -> dict[str, Any]:
    return {"servers": await asyncio.to_thread(HC.mcp_servers)}


@app.get("/hermes/mcp/catalog")
async def hermes_mcp_catalog() -> dict[str, Any]:
    return {"catalog": await asyncio.to_thread(HC.mcp_catalog)}


@app.post("/hermes/mcp/add")
async def hermes_mcp_add(payload: dict[str, Any]) -> dict[str, Any]:
    try:
        return await asyncio.to_thread(
            HC.mcp_add,
            str(payload.get("name", "")).strip(),
            payload.get("url"),
            payload.get("command"),
            payload.get("args") or [],
        )
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/hermes/mcp/remove")
async def hermes_mcp_remove(payload: dict[str, Any]) -> dict[str, Any]:
    try:
        return await asyncio.to_thread(HC.mcp_remove, str(payload.get("name", "")).strip())
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/hermes/mcp/test")
async def hermes_mcp_test(payload: dict[str, Any]) -> dict[str, Any]:
    return await asyncio.to_thread(HC.mcp_test, str(payload.get("name", "")).strip())


@app.get("/hermes/cron")
async def hermes_cron_list() -> dict[str, Any]:
    return {"jobs": await asyncio.to_thread(HC.cron_jobs)}


@app.post("/hermes/cron/create")
async def hermes_cron_create(payload: dict[str, Any]) -> dict[str, Any]:
    try:
        return await asyncio.to_thread(
            HC.cron_create,
            str(payload.get("schedule", "")).strip(),
            str(payload.get("prompt", "") or ""),
            payload.get("name"),
            payload.get("deliver"),
            payload.get("repeat"),
            bool(payload.get("noAgent")),
        )
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/hermes/cron/action")
async def hermes_cron_action(payload: dict[str, Any]) -> dict[str, Any]:
    try:
        return await asyncio.to_thread(
            HC.cron_action, str(payload.get("action", "")), str(payload.get("jobId", ""))
        )
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/hermes/gateway")
async def hermes_gateway_status() -> dict[str, Any]:
    return await asyncio.to_thread(HC.gateway_status)


@app.post("/hermes/gateway/start")
async def hermes_gateway_start() -> dict[str, Any]:
    return await asyncio.to_thread(HC.gateway_start)


@app.post("/hermes/gateway/stop")
async def hermes_gateway_stop() -> dict[str, Any]:
    return await asyncio.to_thread(HC.gateway_stop)


@app.get("/hermes/gateway/logs")
async def hermes_gateway_logs(lines: int = 80) -> dict[str, Any]:
    return {"logs": await asyncio.to_thread(HC.gateway_logs, lines)}


@app.post("/hermes/gateway/platform")
async def hermes_gateway_platform(payload: dict[str, Any]) -> dict[str, Any]:
    try:
        return await asyncio.to_thread(
            HC.gateway_set_platform,
            str(payload.get("platform", "")).strip(),
            str(payload.get("token", "")).strip(),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/hermes/gateway/platform/remove")
async def hermes_gateway_platform_remove(payload: dict[str, Any]) -> dict[str, Any]:
    try:
        return await asyncio.to_thread(
            HC.gateway_remove_platform, str(payload.get("platform", "")).strip()
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/hermes/doctor")
async def hermes_doctor() -> dict[str, Any]:
    return {"report": await asyncio.to_thread(HC.doctor)}


@app.get("/hermes/computer-use/status")
async def hermes_computer_use_status() -> dict[str, Any]:
    return await asyncio.to_thread(HC.computer_use_status)


@app.get("/hermes/skills/hub")
async def hermes_skills_hub(q: str = "") -> dict[str, Any]:
    output = await asyncio.to_thread(HC.skills_search, q) if q.strip() else await asyncio.to_thread(HC.skills_installed)
    return {"output": output}


@app.post("/hermes/skills/install")
async def hermes_skills_install(payload: dict[str, Any]) -> dict[str, Any]:
    return await asyncio.to_thread(HC.skills_install, str(payload.get("name", "")).strip())


@app.post("/hermes/skills/uninstall")
async def hermes_skills_uninstall(payload: dict[str, Any]) -> dict[str, Any]:
    return await asyncio.to_thread(HC.skills_uninstall, str(payload.get("name", "")).strip())


# ---------------------------------------------------------------- PC control, files, vision (Phase 4)


@app.get("/permissions")
async def permissions_state() -> dict[str, Any]:
    settings = get_settings()
    return {
        "modes": PERM.tool_modes(),
        "modesAvailable": list(PERM.MODES),
        "defaultPosture": settings.confirm_dangerous_tools,
        "killSwitch": {
            "engaged": PERM.kill_engaged(),
            "hotkey": settings.kill_switch_hotkey,
            "active": PERM.hotkey_active(),
        },
        "riskyPrefixes": list(PERM.RISKY_TOOL_PREFIXES),
    }


@app.post("/permissions/mode")
async def permissions_set_mode(payload: dict[str, Any]) -> dict[str, Any]:
    tool = str(payload.get("tool", "")).strip()
    mode = str(payload.get("mode", "")).strip()
    if not tool:
        raise HTTPException(status_code=400, detail="tool is required")
    if mode not in PERM.MODES:
        raise HTTPException(status_code=400, detail=f"mode must be one of {list(PERM.MODES)}")
    modes = PERM.tool_modes()
    modes[tool] = mode
    persist_settings({"jarvis_permissions": json.dumps(modes)})
    PERM.audit(tool, "permission_changed", source="user", detail=f"mode → {mode}")
    return {"ok": True, "modes": modes}


@app.post("/permissions/kill")
async def permissions_kill(payload: dict[str, Any]) -> dict[str, Any]:
    engaged = bool(payload.get("engaged"))
    return PERM.set_kill(engaged, reason="from Control tab")


@app.get("/permissions/audit")
async def permissions_audit(limit: int = 60) -> dict[str, Any]:
    return {"entries": PERM.recent_audit(limit)}


@app.get("/desktop/apps")
async def desktop_apps(q: str = "") -> dict[str, Any]:
    try:
        if q.strip():
            apps = await asyncio.to_thread(app_index.search_apps, q)
            meta = {"count": None, "indexedAt": None}
        else:
            indexed = await asyncio.to_thread(app_index.index_apps)
            apps = indexed[:80]
            meta = await asyncio.to_thread(app_index.index_meta)
        return {"apps": apps, **meta}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"app index failed: {exc}") from exc


@app.post("/desktop/apps/refresh")
async def desktop_apps_refresh() -> dict[str, Any]:
    apps = await asyncio.to_thread(app_index.index_apps, True)
    return {"ok": True, "count": len(apps)}


@app.post("/desktop/launch")
async def desktop_launch(payload: dict[str, Any]) -> dict[str, Any]:
    if PERM.kill_engaged():
        raise HTTPException(status_code=403, detail="Kill switch is ON — actions are paused.")
    name = str(payload.get("name", "")).strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    result = await asyncio.to_thread(app_index.launch_app, name)
    PERM.audit("app.launch", "allowed" if result.get("ok") else "failed", {"name": name}, source="user",
               detail=str(result.get("app") or result.get("error") or ""))
    return result


@app.get("/desktop/windows")
async def desktop_windows() -> dict[str, Any]:
    return {"windows": await asyncio.to_thread(app_index.list_windows)}


@app.post("/desktop/window")
async def desktop_window(payload: dict[str, Any]) -> dict[str, Any]:
    if PERM.kill_engaged():
        raise HTTPException(status_code=403, detail="Kill switch is ON — actions are paused.")
    name = str(payload.get("name", "")).strip()
    action = str(payload.get("action", "")).strip()
    result = await asyncio.to_thread(app_index.window_action, name, action)
    PERM.audit(f"window.{action}", "allowed" if result.get("ok") else "failed", {"name": name}, source="user",
               detail=str(result.get("window") or result.get("error") or ""))
    return result


@app.post("/desktop/type")
async def desktop_type(payload: dict[str, Any]) -> dict[str, Any]:
    if PERM.kill_engaged():
        raise HTTPException(status_code=403, detail="Kill switch is ON — actions are paused.")
    text = str(payload.get("text", ""))
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    result = await asyncio.to_thread(app_index.type_text, text)
    PERM.audit("keyboard.type", "allowed" if result.get("ok") else "failed", {"chars": len(text)}, source="user")
    return result


@app.post("/desktop/keys")
async def desktop_keys(payload: dict[str, Any]) -> dict[str, Any]:
    if PERM.kill_engaged():
        raise HTTPException(status_code=403, detail="Kill switch is ON — actions are paused.")
    keys = str(payload.get("keys", "")).strip()
    if not keys:
        raise HTTPException(status_code=400, detail="keys is required")
    result = await asyncio.to_thread(app_index.press_keys, keys)
    PERM.audit("keyboard.keys", "allowed" if result.get("ok") else "failed", {"keys": keys}, source="user")
    return result


@app.post("/files/plan")
async def files_plan(payload: dict[str, Any]) -> dict[str, Any]:
    directory = str(payload.get("directory", "")).strip()
    if not directory:
        raise HTTPException(status_code=400, detail="directory is required")
    result = await asyncio.to_thread(file_ops.plan_organization, directory)
    PERM.audit("files.plan", "planned" if result.get("ok") else "failed", {"directory": directory},
               source="user", detail=f"{len(result.get('moves', []))} move(s)")
    return result


@app.post("/files/apply")
async def files_apply(payload: dict[str, Any]) -> dict[str, Any]:
    if PERM.kill_engaged():
        raise HTTPException(status_code=403, detail="Kill switch is ON — actions are paused.")
    plan_id = str(payload.get("planId", "")).strip()
    result = await asyncio.to_thread(file_ops.apply_plan, plan_id)
    PERM.audit("files.apply", "allowed" if result.get("ok") else "failed", {"planId": plan_id},
               source="user", detail=f"moved {result.get('moved', 0)}")
    return result


@app.post("/files/undo")
async def files_undo() -> dict[str, Any]:
    if PERM.kill_engaged():
        raise HTTPException(status_code=403, detail="Kill switch is ON — actions are paused.")
    result = await asyncio.to_thread(file_ops.undo_last)
    PERM.audit("files.undo", "allowed" if result.get("ok") else "failed", source="user",
               detail=f"restored {result.get('restored', 0)}")
    return result


@app.get("/files/journal")
async def files_journal() -> dict[str, Any]:
    return {"entries": await asyncio.to_thread(file_ops.journal)}


@app.get("/files/protected")
async def files_protected() -> dict[str, Any]:
    return {"folders": file_ops.protected_folders()}


@app.post("/files/protected")
async def files_protected_save(payload: dict[str, Any]) -> dict[str, Any]:
    folders = payload.get("folders")
    if not isinstance(folders, list):
        raise HTTPException(status_code=400, detail="folders must be a list")
    persist_settings(
        {"jarvis_protected_folders": ";".join(str(f).strip() for f in folders if str(f).strip())}
    )
    return {"ok": True, "folders": file_ops.protected_folders()}


@app.post("/vision/see")
async def vision_see(payload: dict[str, Any]) -> dict[str, Any]:
    if PERM.kill_engaged():
        raise HTTPException(status_code=403, detail="Kill switch is ON — actions are paused.")
    result = await asyncio.to_thread(
        vision.see_screen,
        str(payload.get("question", "") or ""),
        payload.get("window"),
        payload.get("region"),
        payload.get("model"),
    )
    PERM.audit("vision.see", "allowed" if result.get("ok") else "failed",
               {"window": payload.get("window"), "model": payload.get("model")}, source="user",
               detail=str(result.get("error") or result.get("model") or ""))
    return result


@app.get("/vision/image")
async def vision_image(path: str) -> FileResponse:
    try:
        file_path = vision.screenshot_file(path)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return FileResponse(file_path, media_type="image/png")


# ---------------------------------------------------------------- voice, actions, music (Phase 5)


@app.get("/voice/status")
async def voice_status() -> dict[str, Any]:
    return VOICE.status()


@app.get("/voice/mics")
async def voice_mics() -> dict[str, Any]:
    return {"mics": await asyncio.to_thread(VOICE.mics)}


@app.post("/voice/listen")
async def voice_listen(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    source = str((payload or {}).get("source") or "manual")
    if not bool((payload or {}).get("enabled", True)):
        return await asyncio.to_thread(VOICE.cancel)
    return await asyncio.to_thread(VOICE.listen, source)


@app.post("/voice/cancel")
async def voice_cancel() -> dict[str, Any]:
    return await asyncio.to_thread(VOICE.cancel)


@app.post("/voice/test-wav")
async def voice_test_wav(payload: dict[str, Any]) -> dict[str, Any]:
    path = str(payload.get("path") or "").strip()
    if not path:
        raise HTTPException(status_code=400, detail="path is required")
    if not Path(path).exists():
        raise HTTPException(status_code=404, detail="wav not found")
    if Path(path).suffix.lower() not in {".wav", ".flac", ".mp3", ".m4a", ".ogg"}:
        raise HTTPException(status_code=400, detail="unsupported audio file")
    return await asyncio.to_thread(VOICE.inject_wav, path, bool(payload.get("simulateWake")), "test")


@app.post("/actions/run")
async def actions_run(payload: dict[str, Any]) -> dict[str, Any]:
    text = str(payload.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    return await asyncio.to_thread(actions.run, text)


@app.get("/music/spotify/status")
async def spotify_status() -> dict[str, Any]:
    return await asyncio.to_thread(SPOTIFY.status)


@app.post("/music/spotify/client")
async def spotify_client(payload: dict[str, Any]) -> dict[str, Any]:
    client_id = str(payload.get("clientId") or "").strip()
    persist_settings({"jarvis_spotify_client_id": client_id})
    SPOTIFY.set_client_id(client_id)
    return {"ok": True, "clientId": client_id}


@app.get("/music/spotify/auth-url")
async def spotify_auth_url(open: bool = False) -> dict[str, Any]:
    result = await asyncio.to_thread(SPOTIFY.auth_url)
    if open and result.get("ok") and result.get("url"):
        await asyncio.to_thread(webbrowser.open, str(result["url"]))
    return result


@app.get("/music/spotify/callback")
async def spotify_callback(code: str = "", state: str = "", error: str = "") -> HTMLResponse:
    if error:
        return HTMLResponse(
            f"<html><body style='font-family:Segoe UI;background:#000;color:#eee;padding:40px'>"
            f"<h2>Spotify login cancelled</h2><p>{error}</p><p>You can close this tab.</p></body></html>"
        )
    result = await asyncio.to_thread(SPOTIFY.complete_auth, code, state)
    if result.get("ok"):
        product = result.get("product") or "unknown"
        note = (
            "Playback control is available."
            if result.get("premium")
            else "Playback control through the API needs Spotify Premium; open/search still works."
        )
        body = f"<h2>Spotify connected</h2><p>Account: {result.get('displayName') or 'connected'} ({product}).</p><p>{note}</p>"
    else:
        body = f"<h2>Spotify connection failed</h2><p>{result.get('error', 'unknown error')}</p>"
    return HTMLResponse(
        "<html><body style='font-family:Segoe UI;background:#000;color:#eee;padding:40px'>"
        f"{body}<p>You can close this tab and return to JARVIS.</p></body></html>"
    )


@app.post("/music/spotify/play")
async def spotify_play(payload: dict[str, Any]) -> dict[str, Any]:
    query = str(payload.get("query") or "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="query is required")
    return await asyncio.to_thread(SPOTIFY.play_query, query)


@app.get("/music/spotify/search")
async def spotify_search(q: str) -> dict[str, Any]:
    return await asyncio.to_thread(SPOTIFY.search_tracks, q)


@app.post("/music/spotify/control")
async def spotify_control(payload: dict[str, Any]) -> dict[str, Any]:
    action = str(payload.get("action") or "").strip()
    return await asyncio.to_thread(SPOTIFY.control, action)


@app.post("/music/spotify/disconnect")
async def spotify_disconnect() -> dict[str, Any]:
    return await asyncio.to_thread(SPOTIFY.disconnect)


# ---------------------------------------------------------------- workspace


@app.get("/workspace/artifacts")
async def workspace_artifacts() -> dict[str, Any]:
    artifacts = await asyncio.to_thread(WORKSPACE.list_artifacts)
    latest = await asyncio.to_thread(WORKSPACE.current)
    return {"artifacts": artifacts, "current": latest}


@app.post("/workspace/clear")
async def workspace_clear() -> dict[str, Any]:
    await asyncio.to_thread(WORKSPACE.clear)
    return {"ok": True}


def _pick_folder() -> dict[str, Any]:
    """Native Windows folder picker (PowerShell has no extra dependency)."""
    import subprocess

    script = (
        "Add-Type -AssemblyName System.Windows.Forms; "
        "$d = New-Object System.Windows.Forms.FolderBrowserDialog; "
        "$d.Description = 'Choose where JARVIS should save this artifact'; "
        "$d.ShowNewFolderButton = $true; "
        "if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) "
        "{ Write-Output $d.SelectedPath }"
    )
    try:
        completed = subprocess.run(
            ["powershell", "-NoProfile", "-STA", "-Command", script],
            capture_output=True,
            text=True,
            timeout=300,
            creationflags=0x08000000,
        )
    except Exception as exc:  # noqa: BLE001 - report instead of failing the request
        return {"ok": False, "folder": "", "error": str(exc)}
    folder = (completed.stdout or "").strip().splitlines()
    path = folder[-1].strip() if folder else ""
    error = "" if path else (completed.stderr or "").strip()[:300]
    return {"ok": bool(path), "folder": path, "error": error}


@app.post("/workspace/pick-folder")
async def workspace_pick_folder() -> dict[str, Any]:
    return await asyncio.to_thread(_pick_folder)


@app.post("/workspace/undo")
async def workspace_undo(payload: dict[str, Any]) -> dict[str, Any]:
    artifact_id = str(payload.get("artifactId") or "").strip()
    if not artifact_id:
        raise HTTPException(status_code=400, detail="artifactId is required")
    artifact = await asyncio.to_thread(WORKSPACE.undo, artifact_id)
    if artifact is None:
        raise HTTPException(status_code=404, detail="artifact not found")
    return {"ok": True, "artifact": artifact}


@app.post("/workspace/version")
async def workspace_version(payload: dict[str, Any]) -> dict[str, Any]:
    artifact_id = str(payload.get("artifactId") or "").strip()
    try:
        number = int(payload.get("version") or 0)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="version must be a number") from None
    if not artifact_id or number < 1:
        raise HTTPException(status_code=400, detail="artifactId and version are required")
    artifact = await asyncio.to_thread(WORKSPACE.activate_version, artifact_id, number)
    if artifact is None:
        raise HTTPException(status_code=404, detail="artifact not found")
    return {"ok": True, "artifact": artifact}


@app.post("/workspace/save-to-folder")
async def workspace_save_to_folder(payload: dict[str, Any]) -> dict[str, Any]:
    artifact_id = str(payload.get("artifactId") or "").strip()
    folder = str(payload.get("folder") or "").strip()
    if not artifact_id:
        raise HTTPException(status_code=400, detail="artifactId is required")
    try:
        return await asyncio.to_thread(WORKSPACE.save_to_folder, artifact_id, folder)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/workspace/run-code")
async def workspace_run_code(payload: dict[str, Any]) -> dict[str, Any]:
    """Execute a code artifact in a temp file. The frontend must show an
    Approve/Deny dialog before calling this."""
    language = str(payload.get("language", "")).lower()
    code = str(payload.get("code", ""))
    if not code.strip():
        raise HTTPException(status_code=400, detail="code is empty")

    runners: dict[str, list[str]] = {
        "python": ["python"],
        "javascript": ["node"],
        "typescript": ["node"],  # plain node; ts must be self-runnable JS
    }
    exts = {"python": ".py", "javascript": ".js", "typescript": ".js"}
    runner = runners.get(language)
    if runner is None:
        return {"ok": False, "error": f"running '{language}' is not supported yet"}

    import tempfile
    import time

    suffix = exts[language]
    with tempfile.NamedTemporaryFile("w", suffix=suffix, delete=False, encoding="utf-8") as tmp:
        tmp.write(code)
        tmp_path = tmp.name

    settings = get_settings()
    started = time.time()
    result = run_command(f'{runner[0]} "{tmp_path}"', timeout=settings.desktop_action_timeout_seconds)
    result["durationMs"] = int((time.time() - started) * 1000)
    try:
        os.unlink(tmp_path)
    except OSError:
        pass
    return result


# ---------------------------------------------------------------- websocket chat


class ChatSession:
    """One WebSocket connection = one conversation (history kept server-side)."""

    def __init__(self) -> None:
        self.history: list[dict[str, Any]] = []
        self.loop = asyncio.get_running_loop()
        self._turn_task: asyncio.Task | None = None

    async def _run_turn(
        self,
        content: str,
        model_override: str | None,
        event_q: asyncio.Queue,
        repair: dict[str, Any] | None = None,
    ) -> None:
        """Run one agent turn off the receive loop so confirmation clicks are
        still processed while a turn is waiting for approval."""
        final_text = ""
        # Some Hermes turns (translated error replies, tool-only answers) put
        # their whole answer in final_text without streaming a single token.
        # The renderer builds bubbles from token events, so those replies were
        # invisible. Count streamed tokens and fall back to emitting final_text.
        streamed = [0]
        # Phase 6: workspace turns buffer tokens. The code block goes to the
        # Workspace as an artifact; the chat bubble shows only the prose.
        workspace_request: dict[str, Any] | None = None
        buffered = False

        def emit(event: dict[str, Any]) -> None:
            # Called from the agent worker thread.
            if event.get("type") == "token":
                if buffered:
                    return
                streamed[0] += 1
            self.loop.call_soon_threadsafe(event_q.put_nowait, event)

        try:
            # Phase 5: deterministic music/video/browser/volume commands run
            # instantly; everything else is a normal Hermes turn.
            action = await asyncio.to_thread(actions.run, content)
            if action.get("handled"):
                reply = str(action.get("reply") or "")
                if action.get("stopSpeaking"):
                    await event_q.put({"type": "stop_speaking"})
                if action.get("data"):
                    await event_q.put({"type": "action", "data": action["data"]})
                if reply:
                    await event_q.put({"type": "token", "content": reply})
                    streamed[0] += 1
                final_text = reply
            else:
                settings_now = get_settings()
                label = provider_label(settings_now.provider)
                prompt = content

                # Phase 6: decide whether this is a Workspace build/edit before
                # talking to the model, so it gets the helper API and, for
                # edits, the current code. Repair turns reuse the same path.
                if repair is not None:
                    artifact = await asyncio.to_thread(
                        WORKSPACE.get, str(repair.get("artifactId") or "")
                    )
                    prompt = WORKSPACE.repair_prompt(artifact, str(repair.get("error") or ""))
                    workspace_request = {
                        "kind": (artifact or {}).get("kind") or "three",
                        "edit": True,
                        "artifact": artifact,
                        "repair": True,
                    }
                    buffered = True
                    if artifact:
                        await asyncio.to_thread(
                            WORKSPACE.mark_repaired,
                            str(artifact.get("id") or ""),
                            int(artifact.get("version") or 0),
                        )
                else:
                    workspace_request = await asyncio.to_thread(WORKSPACE.request_kind, content)
                    if workspace_request:
                        prompt = WORKSPACE.build_prompt(
                            content,
                            workspace_request.get("artifact"),
                            str(workspace_request.get("kind") or "three"),
                        )
                        buffered = True

                # Guard against a model id that belongs to another provider
                # (e.g. an OpenRouter `:free` slug left over after switching to
                # NVIDIA NIM). A stale per-message override is simply dropped;
                # only an invalid persistent default is replaced.
                if model_override:
                    try:
                        available = await asyncio.to_thread(
                            HC.model_available, settings_now.provider, model_override
                        )
                    except Exception:  # noqa: BLE001 - never block a turn on this
                        available = True
                    if not available:
                        await event_q.put(
                            {
                                "type": "notice",
                                "message": (
                                    f"{label} doesn't offer '{model_override}'. "
                                    f"Using {settings_now.default_model} instead."
                                ),
                            }
                        )
                        model_override = None
                else:
                    requested = settings_now.default_model
                    available = True
                    if requested:
                        try:
                            available = await asyncio.to_thread(
                                HC.model_available, settings_now.provider, requested
                            )
                        except Exception:  # noqa: BLE001
                            available = True
                    if requested and not available:
                        replacement = await asyncio.to_thread(
                            HC.default_chat_model, settings_now.provider
                        )
                        if replacement:
                            await event_q.put(
                                {
                                    "type": "notice",
                                    "message": (
                                        f"{label} doesn't offer '{requested}'. "
                                        f"Switched to {replacement}."
                                    ),
                                }
                            )
                            persist_settings(
                                {
                                    "jarvis_default_model": replacement,
                                    "jarvis_fast_model": replacement,
                                    "jarvis_heavy_model": replacement,
                                }
                            )
                            settings_now = get_settings()
                            model_override = None
                            BRIDGE.rebuild()

                # Workspace turns are pure text generation: skip the Hermes
                # tool loop so the model returns one fenced artifact instead of
                # trying write_file/terminal and waiting for approval.
                use_hermes = (
                    BRIDGE.mode == "hermes"
                    and get_settings().brain in {"hermes", "auto"}
                    and workspace_request is None
                )
                if use_hermes:
                    try:
                        # The Hermes runtime builds its agent per model, so the
                        # per-message picker is applied as a session override
                        # (never persisted — Settings owns the defaults).
                        await asyncio.to_thread(BRIDGE.switch_model, model_override)
                        final_text = await asyncio.to_thread(
                            BRIDGE.run_turn, prompt, emit, self.history
                        )
                        if final_text and is_error_reply(final_text):
                            # Hermes "succeeded" with a failure report as the
                            # reply — translate it instead of showing raw text.
                            final_text = explain_runtime_failure(final_text, label, settings_now.provider)
                    except Exception as exc:  # noqa: BLE001
                        logger.warning("hermes turn failed (%s); trying direct provider fallback", exc)
                        await event_q.put(
                            {
                                "type": "notice",
                                "message": f"Hermes runtime unavailable — using {label} directly. ({explain_runtime_failure(str(exc), label, settings_now.provider)})",
                            }
                        )
                        final_text = ""
                if not final_text:
                    async for event in stream_openrouter(prompt, self.history, model_override):
                        if event.get("type") == "done":
                            final_text = event.get("fullResponse", "")
                        elif event.get("type") == "token":
                            if not buffered:
                                streamed[0] += 1
                                await event_q.put(event)
                        else:
                            await event_q.put(event)

                if workspace_request:
                    if final_text and is_error_reply(final_text):
                        # Provider failure text, not an artifact: explain it and
                        # leave the Workspace untouched.
                        final_text = explain_runtime_failure(
                            final_text, label, settings_now.provider
                        )
                        await event_q.put({"type": "notice", "message": final_text})
                        final_text = ""
                    else:
                        committed = await self._commit_artifact(
                            content, final_text, workspace_request, event_q
                        )
                        # Only claim success when an artifact was really saved;
                        # otherwise show the notice alone (no "Done — it's
                        # rendering" lie next to a failure).
                        final_text = self._workspace_prose(final_text) if committed else ""
        except Exception as exc:  # noqa: BLE001
            logger.exception("turn failed")
            await event_q.put({"type": "error", "message": f"{type(exc).__name__}: {exc}"})
        finally:
            if final_text and not streamed[0]:
                # No streaming happened (error translated after the fact, or a
                # tool-only turn) — show the answer instead of a blank bubble.
                await event_q.put({"type": "token", "content": final_text})
                streamed[0] += 1
            await event_q.put({"type": "thinking", "status": False})
            if final_text:
                if content:
                    self.history.append({"role": "user", "content": content})
                self.history.append({"role": "assistant", "content": final_text})
                # Keep the server-side window bounded.
                if len(self.history) > 60:
                    self.history = self.history[-60:]
            await event_q.put({"type": "done", "fullResponse": final_text, "brain": BRIDGE.mode})

    async def _commit_artifact(
        self,
        message: str,
        final_text: str,
        request: dict[str, Any],
        event_q: asyncio.Queue,
    ) -> bool:
        """Parse the model's code block, save a version, and tell the UI.

        Returns True only when an artifact was saved, so the caller knows
        whether it may report success.
        """
        parsed = await asyncio.to_thread(WORKSPACE.parse_reply, final_text)
        if not parsed:
            logger.warning(
                "artifact parse failed (%d chars): %s",
                len(final_text or ""),
                (final_text or "")[:600].replace("\n", " "),
            )
            await event_q.put(
                {
                    "type": "notice",
                    "message": (
                        "I couldn't turn that into a live artifact. Ask again with a "
                        "little more detail and I'll retry."
                    ),
                }
            )
            return False
        artifact = request.get("artifact") or {}
        edit_id = artifact.get("id") if artifact.get("kind") == parsed["kind"] else None
        try:
            saved = await asyncio.to_thread(
                WORKSPACE.save,
                str(parsed["kind"]),
                str(artifact.get("title") or WORKSPACE.title_from(message)),
                str(parsed["content"]),
                edit_id,
                "",
            )
        except Exception as exc:  # noqa: BLE001 - never fail the turn on a save
            logger.warning("artifact save failed: %s", exc)
            await event_q.put(
                {"type": "notice", "message": f"I built it but couldn't save the artifact ({exc})."}
            )
            return False
        await event_q.put({"type": "artifact", "artifact": saved})
        return True

    @staticmethod
    def _workspace_prose(text: str) -> str:
        prose = WORKSPACE.strip_fences(text or "").strip()
        if len(prose) > 900:
            prose = prose[:900].rstrip() + "…"
        return prose or "Done — it's rendering in the Workspace."

    async def run(self, ws: WebSocket) -> None:
        await ws.accept()
        settings = get_settings()
        await ws.send_json(
            {
                "type": "status",
                "brain": BRIDGE.mode,
                "model": BRIDGE.current_model,
                "confirmDangerousTools": settings.confirm_dangerous_tools,
            }
        )

        async def drain_events(event_q: asyncio.Queue) -> None:
            while True:
                event = await event_q.get()
                if event is None:
                    return
                await ws.send_json(event)

        event_q: asyncio.Queue = asyncio.Queue()
        drain_task = asyncio.create_task(drain_events(event_q))

        # Phase 5: every voice event (wake, level, transcript, state) is
        # forwarded to this session. The UI shows states and sends the
        # transcript as a normal turn (same path as typing).
        def voice_push(event: dict[str, Any]) -> None:
            try:
                self.loop.call_soon_threadsafe(event_q.put_nowait, event)
            except RuntimeError:
                pass

        VOICE.subscribe(voice_push)

        def emit(event: dict[str, Any]) -> None:
            # Called from the agent worker thread.
            self.loop.call_soon_threadsafe(event_q.put_nowait, event)

        try:
            while True:
                raw = await ws.receive_text()
                try:
                    data = json.loads(raw)
                except json.JSONDecodeError:
                    await ws.send_json({"type": "error", "message": "invalid JSON"})
                    continue

                kind = data.get("type")

                if kind == "confirmation":
                    ok = BRIDGE.resolve_confirmation(str(data.get("requestId")), bool(data.get("approved")))
                    if not ok:
                        await ws.send_json({"type": "error", "message": "unknown confirmation id"})
                    continue

                if kind == "workspace_repair":
                    # The iframe reports a render/runtime error once per version;
                    # ask the model for one corrected version.
                    artifact_id = str(data.get("artifactId") or "")
                    error = str(data.get("error") or "")[:4000]
                    if not artifact_id or not error:
                        continue
                    if self._turn_task is not None and not self._turn_task.done():
                        continue
                    artifact = await asyncio.to_thread(WORKSPACE.get, artifact_id)
                    if not artifact or artifact.get("id") != (await asyncio.to_thread(WORKSPACE.current) or {}).get("id"):
                        continue
                    if not WORKSPACE.can_repair(artifact_id, int(artifact.get("version") or 0)):
                        await ws.send_json(
                            {
                                "type": "notice",
                                "message": "That scene still isn't rendering after a repair — ask me to rebuild it.",
                            }
                        )
                        continue
                    await event_q.put(
                        {
                            "type": "notice",
                            "message": "The scene hit an error — asking JARVIS to repair it…",
                        }
                    )
                    await event_q.put({"type": "thinking", "status": True})
                    self._turn_task = asyncio.create_task(
                        self._run_turn(
                            "",
                            None,
                            event_q,
                            repair={"artifactId": artifact_id, "error": error},
                        )
                    )
                    continue

                if kind == "tts_state":
                    VOICE.set_tts_speaking(bool(data.get("speaking")))
                    continue

                if kind != "message":
                    continue

                content = (data.get("content") or "").strip()
                if not content:
                    continue
                if self._turn_task is not None and not self._turn_task.done():
                    await ws.send_json(
                        {"type": "notice", "message": "Still working on the previous request — one moment."}
                    )
                    continue

                # Optional per-message model override (chat model picker).
                model_override = (data.get("model") or "").strip() or None

                await event_q.put({"type": "thinking", "status": True})
                self._turn_task = asyncio.create_task(
                    self._run_turn(content, model_override, event_q)
                )
        except WebSocketDisconnect:
            pass
        except Exception as exc:  # noqa: BLE001
            logger.exception("ws session crashed")
            try:
                await ws.send_json({"type": "error", "message": str(exc)})
            except Exception:  # noqa: BLE001
                pass
        finally:
            VOICE.unsubscribe(voice_push)
            if self._turn_task is not None and not self._turn_task.done():
                self._turn_task.cancel()
            drain_task.cancel()


@app.websocket("/ws/chat")
async def ws_chat(ws: WebSocket) -> None:
    session = ChatSession()
    await session.run(ws)


if __name__ == "__main__":
    import uvicorn

    settings = get_settings()
    uvicorn.run(app, host=settings.host, port=settings.port, log_level="info")
