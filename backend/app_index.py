"""Start Menu app index + window control (Phase 4).

Apps are indexed from Windows itself (`Get-StartApps`), never hardcoded. That
covers Win32 shortcuts and UWP/packaged apps. Launch uses the AppsFolder shell
path, which is what Start Menu tiles use. Focus/minimize/close go through UI
Automation (pywinauto) with a title match against the indexed app name.

The allowlist (JARVIS_ALLOWED_APPS) is the user-editable part; the index is
just discovery. "open X" from the agent still passes the permission guardrail.
"""

from __future__ import annotations

import json
import logging
import re
import subprocess
import time
from datetime import datetime
from difflib import SequenceMatcher
from typing import Any

logger = logging.getLogger("jarvis.apps")

_CACHE_TTL_SECONDS = 300
_cache: dict[str, Any] = {"at": 0.0, "apps": []}

_NO_WINDOW = 0x08000000 if hasattr(subprocess, "CREATE_NO_WINDOW") else 0


def _powershell(script: str, timeout: int = 90) -> str:
    proc = subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
        creationflags=_NO_WINDOW,
    )
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout or "powershell failed")[:300])
    return proc.stdout or ""


def index_apps(force: bool = False) -> list[dict[str, Any]]:
    """All Start Menu apps: [{name, appId}]. Cached for 5 minutes."""
    now = time.time()
    if not force and _cache["apps"] and now - _cache["at"] < _CACHE_TTL_SECONDS:
        return _cache["apps"]

    raw = _powershell("Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress")
    data = json.loads(raw) if raw.strip() else []
    if isinstance(data, dict):
        data = [data]
    apps: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in data:
        name = str(item.get("Name") or "").strip()
        app_id = str(item.get("AppID") or "").strip()
        if not name or not app_id:
            continue
        key = app_id.lower()
        if key in seen:
            continue
        seen.add(key)
        apps.append({"name": name, "appId": app_id})
    apps.sort(key=lambda a: a["name"].lower())
    _cache.update(at=now, apps=apps, indexedAt=datetime.now().isoformat(timespec="seconds"))
    logger.info("Start Menu index: %d apps", len(apps))
    return apps


def _normalize(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()


def _score(query: str, name: str) -> float:
    q, n = _normalize(query), _normalize(name)
    if not q:
        return 0.0
    if q == n:
        return 1.0
    if n.startswith(q):
        return 0.9
    if q in n:
        return 0.75
    ratio = SequenceMatcher(None, q, n).ratio()
    # Reward prefix overlap ("vs code" vs "Visual Studio Code").
    words = set(q.split())
    overlap = len(words & set(n.split())) / max(1, len(words))
    return max(ratio * 0.6, overlap * 0.5)


def search_apps(query: str, limit: int = 15) -> list[dict[str, Any]]:
    apps = index_apps()
    scored = [(_score(query, a["name"]), a) for a in apps]
    scored = [(s, a) for s, a in scored if s > 0.25]
    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [{**a, "score": round(s, 3)} for s, a in scored[:limit]]


def resolve_app(name: str) -> dict[str, Any] | None:
    matches = search_apps(name, limit=1)
    return matches[0] if matches else None


def launch_app(name: str) -> dict[str, Any]:
    match = resolve_app(name)
    if match is None:
        return {"ok": False, "error": f"No Start Menu app matching '{name}' was found."}
    try:
        subprocess.Popen(
            ["explorer.exe", f"shell:AppsFolder\\{match['appId']}"],
            close_fds=True,
            creationflags=_NO_WINDOW,
        )
        return {"ok": True, "action": "launch_app", "app": match["name"], "appId": match["appId"]}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}


def launch_path(path: str) -> dict[str, Any]:
    """Open a file/folder/URL with the shell default handler."""
    try:
        subprocess.Popen(["cmd", "/c", "start", "", path])
        return {"ok": True, "action": "launch_path", "path": path}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}


# ---------------------------------------------------------------- windows


def list_windows(limit: int = 60) -> list[dict[str, Any]]:
    """Visible top-level windows: title + process name (for picking a target)."""
    try:
        from pywinauto import Desktop
    except Exception as exc:  # noqa: BLE001
        logger.warning("pywinauto unavailable: %s", exc)
        return []
    out: list[dict[str, Any]] = []
    try:
        for win in Desktop(backend="uia").windows():
            try:
                title = (win.window_text() or "").strip()
                if not title:
                    continue
                pid = win.process_id()
                out.append({"title": title, "pid": pid})
            except Exception:  # noqa: BLE001
                continue
    except Exception as exc:  # noqa: BLE001
        logger.warning("window enumeration failed: %s", exc)
    # De-dup by title (dialogs often repeat), keep first.
    seen: set[str] = set()
    unique: list[dict[str, Any]] = []
    for item in out:
        key = item["title"].lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    return unique[:limit]


def _find_window(name: str) -> Any:
    from pywinauto import Desktop

    desktop = Desktop(backend="uia")
    best = None
    best_score = 0.0
    for win in desktop.windows():
        try:
            title = (win.window_text() or "").strip()
            if not title:
                continue
            score = _score(name, title)
            if score > best_score:
                best, best_score = win, score
        except Exception:  # noqa: BLE001
            continue
    if best is None or best_score < 0.35:
        return None
    return best


def window_action(name: str, action: str) -> dict[str, Any]:
    action = (action or "").strip().lower()
    if action not in {"focus", "minimize", "maximize", "restore", "close"}:
        return {"ok": False, "error": f"unknown window action '{action}'"}
    try:
        win = _find_window(name)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"window lookup failed: {exc}"}
    if win is None:
        return {"ok": False, "error": f"No open window matching '{name}'."}
    try:
        title = win.window_text()
        if action == "focus":
            win.set_focus()
        elif action == "minimize":
            win.minimize()
        elif action == "maximize":
            win.maximize()
        elif action == "restore":
            win.restore()
        else:
            win.close()
        return {"ok": True, "action": action, "window": title}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}


# ---------------------------------------------------------------- input (fallback)

def type_text(text: str, interval: float = 0.01) -> dict[str, Any]:
    """Type into the focused window. Prefer Hermes computer_use; this is the
    audited fallback used by the Control tab's macro test."""
    try:
        import pyautogui

        pyautogui.typewrite(text, interval=interval)
        return {"ok": True, "action": "type_text", "chars": len(text)}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}


def press_keys(keys: str) -> dict[str, Any]:
    try:
        import pyautogui

        parts = [p.strip() for p in keys.split("+") if p.strip()]
        if len(parts) == 1:
            pyautogui.press(parts[0])
        else:
            pyautogui.hotkey(*parts)
        return {"ok": True, "action": "press_keys", "keys": keys}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}


def index_meta() -> dict[str, Any]:
    apps = index_apps()
    return {"count": len(apps), "indexedAt": _cache.get("indexedAt"), "sample": apps[:5]}
