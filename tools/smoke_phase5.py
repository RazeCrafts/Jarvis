"""Phase 5 backend smoke tests (no microphone required).

Verifies the REST contracts the UI depends on:
  /voice/status, /voice/mics, /agent/settings (voice + spotify), /music/spotify/status,
  /actions/run for volume/media, and the wake-word model lifecycle.
"""

from __future__ import annotations

import json

import httpx

BASE = "http://127.0.0.1:8420"
client = httpx.Client(base_url=BASE, timeout=120)


def show(label: str, data: object) -> None:
    print(f"\n== {label} ==")
    print(json.dumps(data, indent=1, ensure_ascii=False)[:1500])


def main() -> None:
    show("voice/status", client.get("/voice/status").json())

    mics = client.get("/voice/mics").json()
    show("voice/mics", [{"id": m["id"], "name": m["name"], "default": m["default"]} for m in mics["mics"]])

    settings = client.get("/agent/settings").json()
    show(
        "agent/settings voice+spotify",
        {"voice": settings.get("voice"), "spotify": settings.get("spotify")},
    )

    show("spotify/status", client.get("/music/spotify/status").json())

    for text in ("mute", "unmute", "turn the volume down", "turn the volume up", "pause", "next"):
        result = client.post("/actions/run", json={"text": text}).json()
        show(f"actions.run({text!r})", result)

    # Wake word lifecycle: enable -> model loads and the mic opens; disable -> closes.
    client.post("/agent/settings", json={"wakeWordEnabled": True})
    show("wake enabled", client.get("/voice/status").json())
    client.post("/agent/settings", json={"wakeWordEnabled": False})
    show("wake disabled", client.get("/voice/status").json())


if __name__ == "__main__":
    main()
