"""Deterministic action router for search, video, music and volume.

The agent is great at open-ended work, but "play lo-fi on Spotify" and "pause"
must be instant and reliable. This tiny router handles those exact intents
before the LLM turn and reports what it did. Everything else falls through to
Hermes unchanged.

Search note (spec): "search for X" is intentionally NOT intercepted — the
Hermes web-search toolset does the search and the model summarizes it. Only
*"open X in the browser"* is a direct browser action, plus explicit YouTube
requests.
"""

from __future__ import annotations

import ctypes
import logging
import os
import re
import time
import webbrowser
from pathlib import Path
from typing import Any
from urllib.parse import quote

import spotify

logger = logging.getLogger("jarvis.actions")

_YOUTUBE_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}

_STOP_RE = re.compile(r"^(?:stop|be quiet|quiet|silence|shut up|never mind|nevermind)[.!]?$", re.I)
_NAV_RE = re.compile(
    r"^(?:open|show|go\s+to|switch\s+to)\s+(?:the\s+)?(?P<tab>workspace|workshop|memory|settings|tools|doctor|control|gateway|tasks|providers|skills|home|hud)[.!]?$",
    re.I,
)
_STAGE_RE = re.compile(
    r"^(?P<cmd>pull\s+it\s+apart|pull\s+apart|explode\s+it|explode|put\s+it\s+back\s+together|put\s+it\s+back|reassemble|from\s+the\s+top|top\s+view|camera\s+from\s+the\s+top|from\s+the\s+front|front\s+view|3d\s+print\s+it|export\s+3d\s+print|export\s+glb|photograph\s+it|take\s+a\s+photo|render\s+it)[.!]?$",
    re.I,
)
_SPOTIFY_PLAY_RE = re.compile(r"^(?:play|put on)\s+(?P<q>.+?)\s+(?:on|in)\s+spotify[.!]?$", re.I)
_SPOTIFY_SEARCH_RE = re.compile(r"^(?:search|find)\s+(?P<q>.+?)\s+(?:on|in)\s+spotify[.!]?$", re.I)
_OPEN_SPOTIFY_RE = re.compile(r"^(?:open|launch|start)\s+spotify[.!]?$", re.I)
_SPOTIFY_NEXT_RE = re.compile(r"^spotify\s+(?P<action>pause|play|resume|next|previous|skip)[.!]?$", re.I)

_YOUTUBE_ABOUT_RE = re.compile(
    r"^(?:play|open|show|find)\s+(?:me\s+)?(?:a\s+|an\s+)?(?:youtube\s+)?(?:video\s+)?"
    r"(?:about|on|of)\s+(?P<q>.+?)[.!]?$",
    re.I,
)
_YOUTUBE_ON_RE = re.compile(r"^(?:play|open|show)\s+(?P<q>.+?)\s+on\s+youtube[.!]?$", re.I)
_YOUTUBE_SEARCH_RE = re.compile(r"^search\s+youtube\s+(?:for\s+)?(?P<q>.+?)[.!]?$", re.I)
_OPEN_YOUTUBE_RE = re.compile(r"^(?:open|launch)\s+youtube[.!]?$", re.I)

_VIDEO_FILE_RE = re.compile(
    r"^(?:play|open)\s+(?:video\s+)?(?P<path>(?:[A-Za-z]:\\|\\\\)[^\r\n]+\.(?:mp4|mkv|avi|mov|webm|wmv|m4v|flv))[.!]?$",
    re.I,
)

_BROWSER_URL_RE = re.compile(
    r"^(?:open|go to|visit)\s+(?P<target>https?://\S+)(?:\s+in\s+(?:the\s+)?browser)?[.!]?$", re.I
)
_BROWSER_DOMAIN_RE = re.compile(
    r"^(?:open|go to|visit)\s+(?P<target>(?:www\.)?[\w-]+(?:\.[\w-]+)+(?:/\S*)?)"
    r"(?:\s+in\s+(?:the\s+)?browser)?[.!]?$",
    re.I,
)
_BROWSER_OPEN_RE = re.compile(r"^open\s+(?P<q>.+?)\s+in\s+(?:the\s+)?browser[.!]?$", re.I)

_VOLUME_SET_RE = re.compile(r"^(?:set\s+)?(?:the\s+)?volume\s+(?:to\s+)?(?P<pct>\d{1,3})\s*%?[.!]?$", re.I)
_VOLUME_DIR_RE = re.compile(
    r"^(?:turn\s+(?:it|the\s+volume)\s+)?(?:volume\s+)?(?P<dir>up|down|louder|quieter|softer)"
    r"(?:\s+(?P<step>\d{1,2}))?[.!]?$",
    re.I,
)
_MUTE_RE = re.compile(r"^(?P<state>mute|unmute|silence)(?:\s+(?:the\s+)?(?:system|volume|audio|sound))?[.!]?$", re.I)

_MEDIA_RE = re.compile(
    r"^(?:(?P<verb>play|pause|resume|unpause|next|previous|skip|go\s+back)"
    r"(?:\s+(?:the\s+)?(?:music|song|track|audio|playback))?)[.!]?$",
    re.I,
)


def _clean(text: str) -> str:
    return " ".join((text or "").strip().split())


def _open_url(url: str) -> bool:
    try:
        os.startfile(url)  # type: ignore[attr-defined]
        return True
    except Exception:  # noqa: BLE001
        try:
            return bool(webbrowser.open(url))
        except Exception:  # noqa: BLE001
            return False


def _search_url(query: str) -> str:
    return "https://www.bing.com/search?q=" + quote(query)


def _youtube(query: str) -> dict[str, Any]:
    query = _clean(query)
    cached = _YOUTUBE_CACHE.get(query.lower())
    if cached and time.time() - cached[0] < 600:
        return cached[1]

    search_page = "https://www.youtube.com/results?search_query=" + quote(query)
    result: dict[str, Any] = {
        "ok": True,
        "action": "youtube_search",
        "query": query,
        "url": search_page,
        "detail": f"Opened YouTube search for “{query}”.",
    }
    try:
        import yt_dlp

        options = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "noplaylist": True,
            "extract_flat": True,
            "cachedir": False,
        }
        with yt_dlp.YoutubeDL(options) as ydl:
            info = ydl.extract_info(f"ytsearch1:{query}", download=False)
        entries = (info or {}).get("entries") or []
        entry = entries[0] if entries else None
        if entry and entry.get("id"):
            url = f"https://www.youtube.com/watch?v={entry['id']}"
            title = entry.get("title") or query
            result = {
                "ok": True,
                "action": "youtube_play",
                "query": query,
                "url": url,
                "title": title,
                "detail": f"Opening “{title}” on YouTube.",
            }
    except Exception as exc:  # noqa: BLE001
        logger.info("YouTube resolve fell back to search page: %s", exc)

    if not _open_url(result["url"]):
        return {"ok": False, "error": "Could not open the default browser."}
    _YOUTUBE_CACHE[query.lower()] = (time.time(), result)
    return result


# ---------------------------------------------------------------- volume


def _volume_interface() -> Any:
    """Default output device's IAudioEndpointVolume.

    pycaw's modern ``AudioDevice`` exposes ``EndpointVolume`` directly; calling
    ``Activate`` on it fails with "'AudioDevice' object has no attribute
    'Activate'" (the old pycaw API). Keep a fallback for older installs.
    """
    from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume

    speakers = AudioUtilities.GetSpeakers()
    endpoint = getattr(speakers, "EndpointVolume", None)
    if endpoint is not None:
        return endpoint
    from comtypes import CLSCTX_ALL

    interface = speakers.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
    return interface.QueryInterface(IAudioEndpointVolume)


def set_volume(percent: int) -> dict[str, Any]:
    value = max(0, min(100, int(percent)))
    try:
        volume = _volume_interface()
        volume.SetMute(0, None)
        volume.SetMasterVolumeLevelScalar(value / 100.0, None)
        return {"ok": True, "action": "volume", "volume": value, "detail": f"Volume set to {value}%."}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Volume control failed: {exc}"}


def change_volume(direction: str, step: int = 10) -> dict[str, Any]:
    try:
        volume = _volume_interface()
        current = int(round(volume.GetMasterVolumeLevelScalar() * 100))
        delta = abs(step) if direction in {"up", "louder"} else -abs(step)
        return set_volume(current + delta)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Volume control failed: {exc}"}


def set_mute(muted: bool) -> dict[str, Any]:
    try:
        volume = _volume_interface()
        volume.SetMute(1 if muted else 0, None)
        return {"ok": True, "action": "mute" if muted else "unmute", "detail": "Muted." if muted else "Unmuted."}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Mute failed: {exc}"}


# ---------------------------------------------------------------- media keys


_MEDIA_KEYS = {"playpause": 0xB3, "next": 0xB0, "previous": 0xB1, "stop": 0xB2}


def media_key(action: str) -> dict[str, Any]:
    action = (action or "").strip().lower()
    if action in {"resume", "unpause"}:
        action = "play"
    if action == "go back":
        action = "previous"
    key = _MEDIA_KEYS.get("playpause" if action in {"play", "pause"} else action)
    if key is None:
        return {"ok": False, "error": f"Unknown media key '{action}'."}
    try:
        user32 = ctypes.windll.user32  # type: ignore[attr-defined]
        user32.keybd_event(key, 0, 0, 0)
        user32.keybd_event(key, 0, 2, 0)
        label = {"play": "Playing.", "pause": "Paused.", "next": "Next track.", "previous": "Previous track."}.get(
            action, "Done."
        )
        return {"ok": True, "action": f"media.{action}", "detail": label, "level": 2}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Media key failed: {exc}"}


# ---------------------------------------------------------------- router


def _handled(reply: str, data: dict[str, Any] | None = None, stop: bool = False) -> dict[str, Any]:
    return {"handled": True, "reply": reply, "data": data or {}, "stopSpeaking": stop}


def run(text: str) -> dict[str, Any]:
    """Route one user line. Returns {handled, reply, data, stopSpeaking}."""
    original = _clean(text)
    if not original:
        return {"handled": False}
    line = original.rstrip(" .!?")

    # Stop speaking / cancel — barge-in by voice.
    if _STOP_RE.match(original):
        return _handled("", {"action": "stop_speaking"}, stop=True)

    # ---- voice UI navigation (Tony Stark HUD)
    nav_match = _NAV_RE.match(original)
    if nav_match:
        target = nav_match.group("tab").lower()
        tab_map = {
            "workspace": "workspace",
            "workshop": "workspace",
            "home": "home",
            "hud": "home",
            "memory": "memory",
            "settings": "settings",
            "tools": "tools",
            "doctor": "tools",
            "control": "control",
            "gateway": "gateway",
            "tasks": "tasks",
            "providers": "providers",
            "skills": "skills",
        }
        tab_id = tab_map.get(target, "home")
        return _handled(f"Opening {target}, sir.", {"action": "navigate", "tab": tab_id})

    # ---- 3D workshop stage voice control (exploded view, camera, print)
    stage_match = _STAGE_RE.match(original)
    if stage_match:
        cmd_raw = stage_match.group("cmd").lower()
        cmd_type = "unknown"
        spoken = "Right away, sir."
        if any(w in cmd_raw for w in ("pull", "explode")):
            cmd_type = "explode"
            spoken = "Pulling the assembly apart, sir."
        elif any(w in cmd_raw for w in ("back", "reassemble")):
            cmd_type = "assemble"
            spoken = "Reassembling the model, sir."
        elif "top" in cmd_raw:
            cmd_type = "camera_top"
            spoken = "Viewing from the top."
        elif "front" in cmd_raw:
            cmd_type = "camera_front"
            spoken = "Viewing from the front."
        elif any(w in cmd_raw for w in ("print", "glb")):
            cmd_type = "export_glb"
            spoken = "Exporting 3D print file, sir."
        elif any(w in cmd_raw for w in ("photograph", "photo", "render")):
            cmd_type = "export_png"
            spoken = "Capturing studio photograph, sir."
        return _handled(spoken, {"action": "stage_control", "command": cmd_type})

    # ---- music (before generic "play")
    match = _SPOTIFY_PLAY_RE.match(original)
    if match:
        query = _clean(match.group("q"))
        result = spotify.play_query(query)
        if not result.get("ok"):
            return _handled(str(result.get("error") or "Spotify could not play that."), result)
        return _handled(str(result.get("detail") or f"Playing {query} on Spotify."), result)

    match = _SPOTIFY_SEARCH_RE.match(original)
    if match:
        result = spotify.open_search(_clean(match.group("q")))
        return _handled(str(result.get("detail") or "Opened Spotify."), result)

    match = _SPOTIFY_NEXT_RE.match(original)
    if match:
        action = match.group("action").lower()
        if spotify.status().get("authorized"):
            result = spotify.control("play" if action == "resume" else "next" if action == "skip" else action)
            if result.get("ok"):
                return _handled(str(result.get("detail") or "Done."), result)
        result = media_key("previous" if action == "go back" else "play" if action == "resume" else action)
        return _handled(str(result.get("detail") or result.get("error") or "Done."), result)

    if _OPEN_SPOTIFY_RE.match(original):
        result = spotify.open_app()
        return _handled(str(result.get("detail") or "Opening Spotify."), result)

    # ---- video
    match = _VIDEO_FILE_RE.match(original)
    if match:
        path = Path(match.group("path").strip().strip('"'))
        if path.exists():
            _open_url(str(path))
            return _handled(f"Opening {path.name}.", {"action": "local_video", "path": str(path)})
        return _handled(f"I couldn't find {path}.", {"action": "local_video", "error": "missing"})

    match = _YOUTUBE_ON_RE.match(original) or _YOUTUBE_ABOUT_RE.match(original)
    if match:
        result = _youtube(match.group("q"))
        return _handled(str(result.get("detail") or result.get("error") or "Opened YouTube."), result)

    match = _YOUTUBE_SEARCH_RE.match(original)
    if match:
        query = _clean(match.group("q"))
        url = "https://www.youtube.com/results?search_query=" + quote(query)
        _open_url(url)
        return _handled(f"Opened YouTube search for “{query}”.", {"action": "youtube_search", "url": url})

    if _OPEN_YOUTUBE_RE.match(original):
        _open_url("https://www.youtube.com")
        return _handled("Opening YouTube.", {"action": "open_youtube"})

    # ---- browser
    for pattern in (_BROWSER_URL_RE, _BROWSER_DOMAIN_RE):
        match = pattern.match(original)
        if match:
            target = match.group("target")
            url = target if target.startswith(("http://", "https://")) else f"https://{target}"
            if _open_url(url):
                return _handled(f"Opening {target} in your browser.", {"action": "open_url", "url": url})
            return _handled("I couldn't open the browser.", {"action": "open_url", "url": url})

    match = _BROWSER_OPEN_RE.match(original)
    if match:
        query = _clean(match.group("q"))
        if re.match(r"^(?:https?://|(?:www\.)?[\w-]+(?:\.[\w-]+)+)", query, re.I):
            url = query if query.startswith(("http://", "https://")) else f"https://{query}"
        else:
            url = _search_url(query)
        if _open_url(url):
            return _handled(f"Opening the browser for “{query}”.", {"action": "open_browser", "url": url})
        return _handled("I couldn't open the browser.", {"action": "open_browser", "url": url})

    # ---- media keys (Spotify Web API first when connected, otherwise keys)
    match = _MEDIA_RE.match(original)
    if match:
        verb = _clean(match.group("verb")).lower()
        if verb == "go back":
            verb = "previous"
        if verb == "skip":
            verb = "next"
        if verb == "unpause":
            verb = "resume"
        if spotify.status().get("authorized"):
            action = "play" if verb == "resume" else verb
            result = spotify.control(action)
            if result.get("ok"):
                return _handled(str(result.get("detail") or "Done."), result)
            # Fall through to media keys if the API could not act.
        result = media_key(verb)
        return _handled(str(result.get("detail") or result.get("error") or "Done."), result)

    # ---- system volume
    match = _VOLUME_SET_RE.match(original)
    if match:
        result = set_volume(int(match.group("pct")))
        return _handled(str(result.get("detail") or result.get("error")), result)

    match = _VOLUME_DIR_RE.match(original)
    if match:
        direction = match.group("dir").lower()
        step = int(match.group("step") or 10)
        result = change_volume(direction, step)
        return _handled(str(result.get("detail") or result.get("error")), result)

    match = _MUTE_RE.match(original)
    if match:
        state = match.group("state").lower()
        result = set_mute(state != "unmute")
        return _handled(str(result.get("detail") or result.get("error")), result)

    return {"handled": False}
