"""WS test: chat with a per-message model override (the chat model picker path)."""

import asyncio
import json
import sys

import websockets

MODEL = sys.argv[1] if len(sys.argv) > 1 else "nvidia/nemotron-3.5-lightning:free"


async def main() -> None:
    uri = "ws://127.0.0.1:8420/ws/chat"
    async with websockets.connect(uri) as ws:
        await ws.send(
            json.dumps(
                {
                    "type": "message",
                    "content": "Reply with exactly one short sentence: which model are you?",
                    "model": MODEL,
                }
            )
        )
        tokens = 0
        final_text = ""
        while True:
            raw = await asyncio.wait_for(ws.recv(), timeout=180)
            event = json.loads(raw)
            t = event.get("type")
            if t == "token":
                tokens += 1
            elif t == "status":
                print(f"status: model={event.get('model')} brain={event.get('brain')}")
            elif t == "error":
                print(f"ERROR: {event.get('message', '')[:200]}")
                return
            elif t == "notice":
                print(f"NOTICE: {event.get('message', '')[:160]}")
            elif t == "done":
                final_text = event.get("fullResponse", "")
                break
        print(f"tokens received: {tokens}")
        print(f"reply: {final_text[:220]}")
        print("MODEL OVERRIDE TEST:", "PASS" if tokens > 0 and final_text else "FAIL")


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
