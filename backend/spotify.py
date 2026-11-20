"""Spotify control (Phase 5), three levels.

1. Open Spotify and run a search through its URI scheme (no auth, works with
   the desktop app; falls back to the web player).
2. Media keys for play/pause/next/previous (works with any player).
3. Precise playback through the Spotify Web API using OAuth PKCE with the
   owner's own developer client ID. Playback control requires Spotify Premium;
   the API says so plainly when it is not.

The client ID is non-secret and lives in backend/.env (JARVIS_SPOTIFY_CLIENT_ID).
Tokens live in Windows Credential Manager, never in files. Refresh tokens are
used automatically; a revoked token simply asks the owner to reconnect.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import secrets
import time
import webbrowser
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlencode

import httpx

from config import BACKEND_DIR, get_settings, persist_settings
from secret_store import get_provider_key, save_provider_key

logger = logging.getLogger("jarvis.spotify")

AUTH_BASE = "https://accounts.spotify.com"
API_BASE = "https://api.spotify.com/v1"
SCOPES = "user-modify-playback-state user-read-playback-state user-read-currently-playing"
PENDING_FILE = (BACKEND_DIR / "hermes-home" / "spotify-pending.json").resolve()
CLIENT_ID_ENV = "SPOTIFY_CLIENT_ID"


# ---------------------------------------------------------------- helpers


def _client_id() -> str:
    return (get_settings().spotify_client_id or "").strip()


def _redirect_uri() -> str:
    return (get_settings().spotify_redirect_uri or "http://127.0.0.1:8420/music/spotify/callback").strip()


def _tokens() -> dict[str, Any]:
    return {
        "access": get_provider_key("SPOTIFY_ACCESS_TOKEN"),
        "refresh": get_provider_key("SPOTIFY_REFRESH_TOKEN"),
        "expires": float(get_provider_key("SPOTIFY_TOKEN_EXPIRES") or 0),
    }


def _store_tokens(access: str, refresh: str, expires_in: int) -> None:
    save_provider_key("SPOTIFY_ACCESS_TOKEN", access)
    if refresh:
        save_provider_key("SPOTIFY_REFRESH_TOKEN", refresh)
    save_provider_key("SPOTIFY_TOKEN_EXPIRES", str(time.time() + max(30, expires_in) - 60))


def disconnect() -> dict[str, Any]:
    from secret_store import delete_provider_key

    for name in ("SPOTIFY_ACCESS_TOKEN", "SPOTIFY_REFRESH_TOKEN", "SPOTIFY_TOKEN_EXPIRES"):
        delete_provider_key(name)
    return {"ok": True}


def set_client_id(client_id: str) -> dict[str, Any]:
    value = (client_id or "").strip()
    persist_settings({"jarvis_spotify_client_id": value})
    os.environ[CLIENT_ID_ENV] = value
    return {"ok": True, "clientId": value}


# ---------------------------------------------------------------- PKCE auth


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def auth_url() -> dict[str, Any]:
    client_id = _client_id()
    if not client_id:
        return {
            "ok": False,
            "error": "Add your Spotify developer client ID first (Settings → Music).",
        }
    verifier = _b64url(secrets.token_bytes(48))
    challenge = _b64url(hashlib.sha256(verifier.encode("ascii")).digest())
    state = _b64url(secrets.token_bytes(16))
    PENDING_FILE.parent.mkdir(parents=True, exist_ok=True)
    PENDING_FILE.write_text(
        json.dumps({"verifier": verifier, "state": state, "created": time.time()}),
        encoding="utf-8",
    )
    params = {
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": _redirect_uri(),
        "code_challenge_method": "S256",
        "code_challenge": challenge,
        "state": state,
        "scope": SCOPES,
    }
    url = f"{AUTH_BASE}/authorize?{urlencode(params)}"
    return {"ok": True, "url": url}


def complete_auth(code: str, state: str) -> dict[str, Any]:
    if not PENDING_FILE.exists():
        return {"ok": False, "error": "No pending Spotify login. Start again from Settings."}
    try:
        pending = json.loads(PENDING_FILE.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Unreadable login state: {exc}"}
    if not state or state != pending.get("state"):
        return {"ok": False, "error": "Spotify login state did not match. Start again from Settings."}
    client_id = _client_id()
    if not client_id:
        return {"ok": False, "error": "Spotify client ID is missing."}
    try:
        response = httpx.post(
            f"{AUTH_BASE}/api/token",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": _redirect_uri(),
                "client_id": client_id,
                "code_verifier": pending.get("verifier", ""),
            },
            timeout=30,
        )
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Token exchange failed: {exc}"}
    if response.status_code != 200:
        return {"ok": False, "error": f"Token exchange failed ({response.status_code}): {response.text[:300]}"}
    data = response.json()
    _store_tokens(data.get("access_token", ""), data.get("refresh_token", ""), int(data.get("expires_in", 3600)))
    try:
        PENDING_FILE.unlink()
    except OSError:
        pass
    return {"ok": True, **status()}


def _access_token(force_refresh: bool = False) -> str:
    tokens = _tokens()
    if tokens["access"] and not force_refresh and time.time() < tokens["expires"]:
        return tokens["access"]
    if not tokens["refresh"]:
        return tokens["access"] if not force_refresh else ""
    client_id = _client_id()
    if not client_id:
        return ""
    try:
        response = httpx.post(
            f"{AUTH_BASE}/api/token",
            data={
                "grant_type": "refresh_token",
                "refresh_token": tokens["refresh"],
                "client_id": client_id,
            },
            timeout=30,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Spotify refresh failed: %s", exc)
        return ""
    if response.status_code != 200:
        logger.warning("Spotify refresh rejected (%s): %s", response.status_code, response.text[:200])
        return ""
    data = response.json()
    _store_tokens(data.get("access_token", ""), data.get("refresh_token", "") or tokens["refresh"], int(data.get("expires_in", 3600)))
    return data.get("access_token", "")


def _api(method: str, path: str, **kwargs: Any) -> tuple[int, Any]:
    token = _access_token()
    if not token:
        return 401, {"error": {"message": "Spotify is not connected yet."}}
    headers = {"Authorization": f"Bearer {token}"}
    try:
        response = httpx.request(method, f"{API_BASE}{path}", headers=headers, timeout=30, **kwargs)
    except Exception as exc:  # noqa: BLE001
        return 0, {"error": {"message": f"Spotify request failed: {exc}"}}
    if response.status_code == 401 and _tokens()["refresh"]:
        token = _access_token(force_refresh=True)
        if token:
            try:
                response = httpx.request(
                    method, f"{API_BASE}{path}", headers={"Authorization": f"Bearer {token}"}, timeout=30, **kwargs
                )
            except Exception as exc:  # noqa: BLE001
                return 0, {"error": {"message": str(exc)}}
    if response.status_code == 204 or not response.content:
        return response.status_code, {}
    try:
        return response.status_code, response.json()
    except Exception:  # noqa: BLE001
        return response.status_code, {"raw": response.text[:300]}


# ---------------------------------------------------------------- public


def status() -> dict[str, Any]:
    client_id = _client_id()
    tokens = _tokens()
    authorized = bool(tokens["access"] or tokens["refresh"])
    out: dict[str, Any] = {
        "configured": bool(client_id),
        "authorized": authorized,
        "clientIdMasked": (client_id[:4] + "…" + client_id[-4:]) if len(client_id) > 8 else ("•" * len(client_id)),
        "redirectUri": _redirect_uri(),
        "premium": None,
        "displayName": None,
        "product": None,
    }
    if authorized:
        code, me = _api("GET", "/me")
        if code == 200 and isinstance(me, dict):
            out["displayName"] = me.get("display_name")
            out["product"] = me.get("product")
            out["premium"] = me.get("product") == "premium"
        elif code == 401:
            out["authorized"] = False
            out["error"] = "Spotify login expired — reconnect in Settings."
    return out


def _open_uri(uri: str) -> bool:
    try:
        os.startfile(uri)  # type: ignore[attr-defined]
        return True
    except Exception:  # noqa: BLE001
        if uri.startswith("spotify:"):
            webbrowser.open("https://open.spotify.com/search/" + quote(uri.split(":", 2)[-1]))
            return True
    return False


def open_search(query: str) -> dict[str, Any]:
    query = (query or "").strip()
    if not query:
        return {"ok": False, "error": "What should I search for on Spotify?"}
    uri = f"spotify:search:{quote(query)}"
    opened = _open_uri(uri)
    return {
        "ok": opened,
        "action": "spotify_search",
        "query": query,
        "detail": f"Opened Spotify search for “{query}”." if opened else "Spotify could not be opened.",
    }


def open_app() -> dict[str, Any]:
    opened = _open_uri("spotify:")
    return {"ok": opened, "action": "spotify_open", "detail": "Opening Spotify." if opened else "Spotify could not be opened."}


def _devices() -> list[dict[str, Any]]:
    code, data = _api("GET", "/me/player/devices")
    if code == 200 and isinstance(data, dict):
        return data.get("devices", []) or []
    return []


def _ensure_device() -> dict[str, Any] | None:
    devices = [d for d in _devices() if not d.get("is_restricted")]
    active = next((d for d in devices if d.get("is_active")), None)
    if active:
        return active
    if not devices:
        return None
    target = devices[0]
    code, _ = _api("PUT", "/me/player", json={"device_ids": [target["id"]], "play": False})
    if code in (200, 204):
        time.sleep(0.5)
        return target
    return target


def _plain_error(code: int, body: Any) -> str:
    message = ""
    if isinstance(body, dict):
        err = body.get("error", body)
        if isinstance(err, dict):
            message = str(err.get("message") or err.get("reason") or "")
        else:
            message = str(err)
    lowered = message.lower()
    if code == 403 and ("premium" in lowered or "restriction" in lowered):
        return "Spotify Premium is required for playback control through the Web API."
    if code == 404 and ("no active device" in lowered or "device" in lowered):
        return "Spotify has no active device. Open Spotify and start a track once, then try again."
    if code == 401:
        return "Spotify is not connected — reconnect in Settings → Music."
    return f"Spotify said: {message[:220]}" if message else f"Spotify request failed ({code})."


def search_tracks(query: str, limit: int = 1) -> dict[str, Any]:
    code, data = _api("GET", "/search", params={"q": query, "type": "track", "limit": limit})
    if code != 200 or not isinstance(data, dict):
        return {"ok": False, "error": _plain_error(code, data)}
    items = (data.get("tracks") or {}).get("items") or []
    tracks = [
        {
            "name": item.get("name"),
            "artist": ", ".join(a.get("name", "") for a in (item.get("artists") or [])),
            "uri": item.get("uri"),
            "url": (item.get("external_urls") or {}).get("spotify"),
            "album": ((item.get("album") or {}).get("name")),
        }
        for item in items
    ]
    return {"ok": True, "tracks": tracks}


def play_query(query: str) -> dict[str, Any]:
    query = (query or "").strip()
    if not query:
        return {"ok": False, "error": "What should I play on Spotify?"}
    if not _client_id() or not _tokens()["refresh"]:
        # Level 1 only: open search, then the caller can use a media key.
        opened = open_search(query)
        return {
            **opened,
            "level": 1,
            "detail": f"Opened Spotify search for “{query}”. Press play, or connect Spotify in Settings for exact playback.",
        }
    result = search_tracks(query, limit=1)
    if not result.get("ok"):
        return result
    tracks = result.get("tracks") or []
    if not tracks:
        opened = open_search(query)
        return {**opened, "level": 1, "detail": f"No track matched “{query}”. Opened the search instead."}
    track = tracks[0]
    device = _ensure_device()
    if not device:
        open_app()
        time.sleep(2.0)
        device = _ensure_device()
    code, body = _api("PUT", "/me/player/play", json={"uris": [track["uri"]]})
    if code in (200, 204):
        label = f"{track['name']} by {track['artist']}"
        return {"ok": True, "action": "spotify_play", "level": 3, "track": track, "detail": f"Playing {label} on Spotify."}
    if code == 404:
        # No active device even after opening Spotify: fall back to search.
        open_search(query)
        return {
            "ok": True,
            "action": "spotify_search",
            "level": 1,
            "detail": f"Opened Spotify search for “{query}” — start a track once so I can control playback.",
        }
    return {"ok": False, "error": _plain_error(code, body)}


def control(action: str) -> dict[str, Any]:
    action = (action or "").strip().lower()
    if action == "play":
        code, body = _api("PUT", "/me/player/play")
    elif action == "pause":
        code, body = _api("PUT", "/me/player/pause")
    elif action == "next":
        code, body = _api("POST", "/me/player/next")
    elif action == "previous":
        code, body = _api("POST", "/me/player/previous")
    else:
        return {"ok": False, "error": f"Unknown Spotify action '{action}'."}
    if code in (200, 204):
        return {"ok": True, "action": action, "detail": f"{action.capitalize()}."}
    return {"ok": False, "error": _plain_error(code, body)}