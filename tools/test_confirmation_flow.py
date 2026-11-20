"""WS test: dangerous-tool confirmation flow (HermesBridge._emit fix).
Sends a message that triggers a shell tool call; when the backend asks for
confirmation, the test APPROVES it and expects the tool to actually run."""

import asyncio
import json
import sys

import websockets

PROMPT = "Use the shell tool to run this exact command: echo jarvis-confirmation-test-ok"


async def main() -> None:
    uri = "ws://127.0.0.1:8420/ws/chat"
    async with websockets.connect(uri) as ws:
        await ws.send(json.dumps({"type": "message", "content": PROMPT}))
        confirmed = False
        tokens = []
        final_text = ""
        error = None
        while True:
            raw = await asyncio.wait_for(ws.recv(), timeout=240)
            event = json.loads(raw)
            t = event.get("type")
            if t == "confirm_request":
                print(f"CONFIRM_REQUEST arrived: tool={event.get('tool')} (UI would show the dialog)")
                print(f"  args: {json.dumps(event.get('args', {}))[:160]}")
                await ws.send(
                    json.dumps(
                        {"type": "confirmation", "requestId": event.get("requestId"), "approved": True}
                    )
                )
                confirmed = True
            elif t == "token":
                tokens.append(str(event.get("content", "")))
            elif t == "error":
                error = str(event.get("message", ""))[:200]
            elif t == "done":
                final_text = event.get("fullResponse", "")
                break
        reply = final_text or "".join(tokens)
        print(f"confirmation asked: {confirmed}")
        print(f"reply: {reply[:260]}")
        ok = confirmed and ("jarvis-confirmation-test-ok" in reply or "jarvis-confirmation-test-ok" in final_text)
        print("CONFIRMATION FLOW TEST:", "PASS" if ok else "FAIL")


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
