"""Phase 5/provider regression test: stale model override + real NVIDIA turn.

Sends two WebSocket turns:
  1. a model override that belongs to OpenRouter while provider=nvidia
     (must produce a notice and fall back to the provider's own model, not 404)
  2. a normal message with no override (must get a real reply from Hermes)
"""

from __future__ import annotations

import asyncio
import json

import httpx
import websockets

WS = "ws://127.0.0.1:8420/ws/chat"


async def turn(ws, payload: dict, label: str, timeout: float = 180.0) -> str:
    print(f"\n===== {label} =====")
    await ws.send(json.dumps(payload))
    reply = ""
    while True:
        raw = await asyncio.wait_for(ws.recv(), timeout=timeout)
        event = json.loads(raw)
        kind = event.get("type")
        if kind == "token":
            reply += str(event.get("content") or "")
        elif kind == "notice":
            print("NOTICE:", event.get("message"))
        elif kind == "tool_call":
            print("TOOL:", event.get("tool"))
        elif kind in {"error", "voice_error"}:
            print("ERROR:", event.get("message"))
        elif kind == "done":
            break
    print("REPLY:", reply[:600])
    return reply


async def main() -> None:
    status = httpx.get("http://127.0.0.1:8420/agent/status", timeout=30).json()
    print("status:", json.dumps(status, indent=1))

    async with websockets.connect(WS, max_size=8 * 1024 * 1024, ping_interval=None) as ws:
        await asyncio.wait_for(ws.recv(), timeout=30)  # initial status event
        await turn(
            ws,
            {"type": "message", "content": "Say only: stale override handled", "model": "nvidia/nemotron-3.5-super-vl:free"},
            "stale OpenRouter override on NVIDIA",
        )
        await turn(ws, {"type": "message", "content": "Reply with exactly: backend ok"}, "plain turn")


if __name__ == "__main__":
    asyncio.run(main())
