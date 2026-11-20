"""Permissions, kill switch and audit log (Phase 4).

Three levels per tool (JARVIS_PERMISSIONS, JSON map):
  ask   - always ask the owner before the tool runs
  risky - ask only if the tool is classified risky (writes/input/shell/…)
  allow - never ask

Tools with no override use the default posture: risky tools follow
JARVIS_CONFIRM_DANGEROUS_TOOLS, read-only tools are allowed.

The kill switch is a process-wide flag checked before EVERY tool call and
every direct desktop/file action. It is toggled from the Control tab and by a
configurable global hotkey (JARVIS_KILL_SWITCH_HOTKEY, default ctrl+shift+x).

Audit entries are append-only JSONL in HERMES_HOME/logs/audit.jsonl, rotated
at 4000 lines. This is the same feed the Control tab's activity panel reads.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from datetime import datetime
from pathlib import Path
from typing import Any

from config import BACKEND_DIR, get_settings

logger = logging.getLogger("jarvis.permissions")

HERMES_HOME_DIR = (BACKEND_DIR / "hermes-home").resolve()
AUDIT_FILE = HERMES_HOME_DIR / "logs" / "audit.jsonl"
MAX_AUDIT_LINES = 4000

MODES = ("ask", "risky", "allow")

# Safety classifier only (never a claim about Hermes internals): names or
# prefixes of tools that can change the machine or leak the screen.
RISKY_TOOL_PREFIXES: tuple[str, ...] = (
    "shell",
    "terminal",
    "bash",
    "powershell",
    "cmd_",
    "run_",
    "execute",
    "computer",
    "desktop",
    "mouse",
    "keyboard",
    "key_",
    "type",
    "press",
    "click",
    "drag",
    "scroll",
    "screen",
    "screenshot",
    "window",
    "window_",
    "app_",
    "open_app",
    "launch_",
    "file_write",
    "write_file",
    "edit_file",
    "patch",
    "delete",
    "move_",
    "rename",
    "organize",
    "browser_click",
    "browser_type",
    "browser_press",
    "browser_fill",
    "browser_upload",
    "browser_download",
    "image_gen",
    "video_gen",
    "cron_",
    "gateway_",
    "discord_",
    "email_",
    "homeassistant",
    "ha_",
    "mcp_",
    "install",
    "uninstall",
)

_kill_engaged = False
_kill_lock = threading.Lock()
_hotkey_thread: threading.Thread | None = None
_hotkey_handle: Any = None
_hotkey_registered = False


# ---------------------------------------------------------------- audit


def _audit_path() -> Path:
    AUDIT_FILE.parent.mkdir(parents=True, exist_ok=True)
    return AUDIT_FILE


def _summarize_args(args: Any, limit: int = 240) -> str:
    if not args:
        return ""
    try:
        text = json.dumps(args, ensure_ascii=False, default=str)
    except Exception:  # noqa: BLE001
        text = str(args)
    return text[:limit]


def audit(
    tool: str,
    decision: str,
    args: Any = None,
    source: str = "agent",
    detail: str = "",
) -> dict[str, Any]:
    """Append one audit entry. Never raises."""
    entry = {
        "ts": datetime.now().isoformat(timespec="seconds"),
        "tool": tool,
        "decision": decision,
        "source": source,
        "detail": (detail or "")[:400],
        "args": _summarize_args(args),
    }
    try:
        path = _audit_path()
        # Cheap rotation: trim the oldest half when the file gets long.
        if path.exists() and path.stat().st_size > 1_500_000:
            lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
            path.write_text("\n".join(lines[-MAX_AUDIT_LINES // 2 :]) + "\n", encoding="utf-8")
        with path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception as exc:  # noqa: BLE001
        logger.warning("audit write failed: %s", exc)
    return entry


def recent_audit(limit: int = 60) -> list[dict[str, Any]]:
    try:
        path = _audit_path()
        if not path.exists():
            return []
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        out: list[dict[str, Any]] = []
        for line in lines[-max(1, min(limit, 500)) :]:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except Exception:  # noqa: BLE001
                continue
        out.reverse()  # newest first for the UI
        return out
    except Exception:  # noqa: BLE001
        return []


# ---------------------------------------------------------------- permissions


def tool_modes() -> dict[str, str]:
    settings = get_settings()
    try:
        data = json.loads(settings.permissions or "{}")
        if isinstance(data, dict):
            return {str(k): v for k, v in data.items() if v in MODES}
    except Exception:  # noqa: BLE001
        pass
    return {}


def is_risky_tool(name: str) -> bool:
    lowered = (name or "").lower().strip()
    if not lowered:
        return False
    return lowered.startswith(RISKY_TOOL_PREFIXES)


def default_mode(tool_name: str) -> str:
    if is_risky_tool(tool_name) and get_settings().confirm_dangerous_tools:
        return "ask"
    return "allow"


def decide(tool_name: str, args: Any = None, source: str = "agent") -> dict[str, Any]:
    """Return {"action": "allow"|"ask"|"block", "reason": str}."""
    if kill_engaged():
        return {"action": "block", "reason": "The kill switch is ON — every action is paused."}
    mode = tool_modes().get(tool_name) or default_mode(tool_name)
    risky = is_risky_tool(tool_name)
    if mode == "ask":
        return {"action": "ask", "reason": "This tool is set to ask every time."}
    if mode == "risky" and risky:
        return {"action": "ask", "reason": "This tool is set to ask for risky actions."}
    return {"action": "allow", "reason": "Allowed by your permission settings."}


# ---------------------------------------------------------------- kill switch


def kill_engaged() -> bool:
    with _kill_lock:
        return _kill_engaged


def set_kill(engaged: bool, reason: str = "") -> dict[str, Any]:
    global _kill_engaged
    with _kill_lock:
        _kill_engaged = bool(engaged)
    audit(
        "kill_switch",
        "engaged" if engaged else "released",
        source="user",
        detail=reason or ("global kill switch on" if engaged else "global kill switch off"),
    )
    logger.warning("kill switch %s", "ENGAGED" if engaged else "released")
    return {"engaged": _kill_engaged}


def _toggle_kill() -> None:
    set_kill(not kill_engaged(), reason="global hotkey")


def _parse_hotkey(value: str) -> str:
    # keyboard accepts "ctrl+shift+x"; normalize aliases like control/shift.
    parts = [p.strip().lower() for p in (value or "").split("+") if p.strip()]
    parts = ["ctrl" if p in {"control", "ctl"} else p for p in parts]
    return "+".join(parts)


def start_hotkey_listener() -> None:
    """Register the kill-switch hotkey once. Degrades silently if unavailable."""
    global _hotkey_thread, _hotkey_handle
    if _hotkey_thread is not None:
        return

    def _run() -> None:
        global _hotkey_handle, _hotkey_registered
        try:
            import keyboard

            hotkey = _parse_hotkey(get_settings().kill_switch_hotkey) or "ctrl+shift+x"
            _hotkey_handle = keyboard.add_hotkey(hotkey, _toggle_kill, suppress=False)
            _hotkey_registered = True
            logger.info("kill-switch hotkey registered: %s", hotkey)
            threading.Event().wait()  # keep the listener thread alive
        except Exception as exc:  # noqa: BLE001
            logger.warning("kill-switch hotkey unavailable: %s", exc)

    _hotkey_thread = threading.Thread(target=_run, daemon=True, name="jarvis-killswitch-hotkey")
    _hotkey_thread.start()


def stop_hotkey_listener() -> None:
    global _hotkey_thread, _hotkey_handle, _hotkey_registered
    try:
        import keyboard

        if _hotkey_handle is not None:
            keyboard.remove_hotkey(_hotkey_handle)
    except Exception:  # noqa: BLE001
        pass
    _hotkey_handle = None
    _hotkey_registered = False
    _hotkey_thread = None


def hotkey_active() -> bool:
    return _hotkey_registered


def reset_for_tests() -> None:
    global _kill_engaged
    with _kill_lock:
        _kill_engaged = False


__all__ = [
    "MODES",
    "audit",
    "decide",
    "default_mode",
    "is_risky_tool",
    "kill_engaged",
    "recent_audit",
    "set_kill",
    "start_hotkey_listener",
    "tool_modes",
]
