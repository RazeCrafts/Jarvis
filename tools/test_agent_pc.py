"""Live agent PC-control test through the real /ws/chat socket.

Sends a prompt, auto-approves confirmation dialogs (exactly like clicking
Approve in the UI), and prints the event stream. Then asks vision whether the
target app is actually on screen.
"""

import asyncio
import json
import time

import httpx
import websockets

BASE = "http://127.0.0.1:8420"
WS = "ws://127.0.0.1:8420/ws/chat"


async def run(prompt: str, approve: bool = True, timeout: float = 240.0) -> dict:
    events = []
    async with websockets.connect(WS, max_size=16 * 1024 * 1024, ping_interval=None) as ws:
        await ws.send(json.dumps({"type": "message", "content": prompt}))
        deadline = time.time() + timeout
        while time.time() < deadline:
            raw = await asyncio.wait_for(ws.recv(), timeout=timeout)
            msg = json.loads(raw)
            events.append(msg)
            kind = msg.get("type")
            if kind == "confirm_request":
                print("  CONFIRM:", msg.get("tool"), str(msg.get("args"))[:140], "-> approved" if approve else "-> denied")
                await ws.send(
                    json.dumps({"type": "confirmation", "requestId": msg["requestId"], "approved": approve})
                )
            elif kind == "tool_call":
                print("  TOOL:", msg.get("tool"), str(msg.get("args"))[:140])
            elif kind == "error":
                print("  ERROR:", msg.get("message"))
            elif kind == "done":
                break
    return {"events": events, "last": events[-1] if events else {}}


async def main() -> None:
    print("=== prompt: open Calculator ===")
    result = await run("Open the Calculator app.")
    kinds = [e.get("type") for e in result["events"]]
    print("event kinds:", kinds)
    done = result["last"]
    print("final:", str(done.get("fullResponse") or done)[:600])

    print("=== vision: is Calculator on screen? ===")
    r = httpx.post(
        f"{BASE}/vision/see",
        json={"question": "Is the Windows Calculator app visible on this screen? Answer yes or no, then one sentence."},
        timeout=180,
    )
    data = r.json()
    print("vision:", r.status_code, str(data.get("description") or data.get("error"))[:300])


asyncio.run(main())
