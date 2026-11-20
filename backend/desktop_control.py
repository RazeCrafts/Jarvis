"""Desktop control helpers.

The primary desktop-control path is Hermes' built-in `computer_use` toolset,
gated by the confirmation guardrail in hermes_bridge. This module adds small
direct REST-callable actions (screenshot, open app, etc.) used by the
Workspace tab and future features, with the same safety rules:

- allowlist of app names (configurable via JARVIS_ALLOWED_APPS)
- confirmation enforced by the CALLER for anything not allowlisted
- hard timeout on every action
"""

from __future__ import annotations

import logging
import subprocess
import time
import webbrowser
from pathlib import Path
from typing import Any

from config import get_settings

logger = logging.getLogger("jarvis.desktop")

# Map friendly app names to launch commands. Windows-first, extensible.
APP_COMMANDS: dict[str, list[str]] = {
    "notepad": ["notepad"],
    "calculator": ["calc"],
    "explorer": ["explorer"],
    "paint": ["mspaint"],
    "cmd": ["cmd", "/c", "start", "cmd"],
    "task manager": ["taskmgr"],
    "chrome": ["cmd", "/c", "start", "chrome"],
    "edge": ["cmd", "/c", "start", "msedge"],
    "spotify": ["cmd", "/c", "start", "spotify:"],
    "code": ["cmd", "/c", "start", "code"],
}


def open_app(name: str) -> dict[str, Any]:
    """Open an app by friendly name if it is on the allowlist."""
    settings = get_settings()
    key = (name or "").strip().lower()
    if key not in settings.allowed_apps_list:
        return {"ok": False, "error": f"'{name}' is not on the allowed apps list"}
    cmd = APP_COMMANDS.get(key)
    if cmd is None:
        # Allowlist entry that isn't a known alias: treat it as an executable name.
        if any(ch in key for ch in "\\/") or key.endswith(".exe"):
            cmd = [key]
        else:
            cmd = ["cmd", "/c", "start", "", key]
    try:
        subprocess.Popen(cmd, shell=False)
        return {"ok": True, "action": "open_app", "app": key}
    except Exception as exc:  # noqa: BLE001
        logger.warning("open_app(%s) failed: %s", name, exc)
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}


def open_url(url: str) -> dict[str, Any]:
    if not url.startswith(("http://", "https://")):
        return {"ok": False, "error": "only http(s) URLs are allowed"}
    webbrowser.open(url)
    return {"ok": True, "action": "open_url", "url": url}


def take_screenshot(path: Path | None = None) -> dict[str, Any]:
    try:
        import pyautogui  # imported lazily; desktop-only dependency

        target = path or Path.home() / "Jarvis" / "screenshots"
        target.mkdir(parents=True, exist_ok=True)
        file_path = target / f"shot_{int(time.time() * 1000)}.png"
        image = pyautogui.screenshot()
        image.save(file_path)
        return {"ok": True, "action": "screenshot", "path": str(file_path)}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}


def run_command(cmd: str, timeout: int | None = None) -> dict[str, Any]:
    """Run a shell command. REST callers must confirm with the user first;
    the agent path goes through the confirmation guardrail instead."""
    settings = get_settings()
    limit = timeout or settings.desktop_action_timeout_seconds
    try:
        completed = subprocess.run(
            cmd,
            shell=True,
            capture_output=True,
            text=True,
            timeout=limit,
        )
        return {
            "ok": completed.returncode == 0,
            "action": "run_command",
            "exitCode": completed.returncode,
            "stdout": (completed.stdout or "")[-4000:],
            "stderr": (completed.stderr or "")[-2000:],
        }
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": f"command timed out after {limit}s"}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
