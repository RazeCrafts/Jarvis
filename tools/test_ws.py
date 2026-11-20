"""Quick WS smoke test for the JARVIS bridge."""
import asyncio
import json
import sys

import websockets


async def main() -> None:
    uri = "ws://127.0.0.1:8420/ws/chat"
    async with websockets.connect(uri) as ws:
        await ws.send(json.dumps({"type": "message", "content": "hello jarvis, are you there?"}))
        events = []
        try:
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=30)
                event = json.loads(raw)
                events.append(event)
                if event.get("type") in {"done", "error"} and event.get("type") == "done":
                    break
                if event.get("type") == "done":
                    break
        except asyncio.TimeoutError:
            pass
        for e in events:
            t = e.get("type")
            if t == "token":
                print(f"token: {e.get('content', '')[:60]!r}")
            elif t == "error":
                print(f"ERROR: {e.get('message', '')[:160]}")
            elif t == "notice":
                print(f"NOTICE: {e.get('message', '')[:120]}")
            elif t == "confirm_request":
                print(f"CONFIRM: {e.get('tool')}")
            else:
                print(f"{t}: {json.dumps({k: v for k, v in e.items() if k != 'type'})[:120]}")
        print("---")
        print(f"total events: {len(events)}")


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
