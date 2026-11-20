"""Attach to the real Tauri WebView2 window over CDP.

The app must be started with:
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222

Usage:
  python tools/webview_cdp.py eval "1+1"
  python tools/webview_cdp.py eval-file script.js
  python tools/webview_cdp.py targets
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import httpx
import websockets

CDP = "http://127.0.0.1:9222"


def pick_target() -> dict:
    targets = httpx.get(f"{CDP}/json", timeout=10).json()
    pages = [t for t in targets if t.get("type") == "page"]
    # Prefer the main window over the mini player.
    main = [p for p in pages if "#mini" not in p.get("url", "")]
    for page in main or pages:
        if "tauri.localhost" in page.get("url", "") or "localhost" in page.get("url", ""):
            return page
    if not pages:
        raise SystemExit(f"no page targets: {json.dumps(targets)[:400]}")
    return pages[0]


async def evaluate(expression: str, timeout: float = 120.0, await_promise: bool = True):
    target = pick_target()
    async with websockets.connect(target["webSocketDebuggerUrl"], max_size=64 * 1024 * 1024) as ws:
        await ws.send(
            json.dumps(
                {
                    "id": 1,
                    "method": "Runtime.evaluate",
                    "params": {
                        "expression": expression,
                        "awaitPromise": await_promise,
                        "returnByValue": True,
                        "userGesture": True,
                    },
                }
            )
        )
        while True:
            raw = await asyncio.wait_for(ws.recv(), timeout=timeout)
            msg = json.loads(raw)
            if msg.get("id") == 1:
                result = msg.get("result", {})
                if "exceptionDetails" in result:
                    return {
                        "ok": False,
                        "error": result["exceptionDetails"].get("text"),
                        "detail": str(result["exceptionDetails"].get("exception", {}))[:800],
                    }
                return {"ok": True, "value": result.get("result", {}).get("value")}


async def screenshot(path: str, timeout: float = 60.0) -> dict:
    import base64

    target = pick_target()
    async with websockets.connect(target["webSocketDebuggerUrl"], max_size=64 * 1024 * 1024) as ws:
        await ws.send(
            json.dumps(
                {
                    "id": 1,
                    "method": "Page.captureScreenshot",
                    "params": {"format": "png", "captureBeyondViewport": False},
                }
            )
        )
        while True:
            raw = await asyncio.wait_for(ws.recv(), timeout=timeout)
            msg = json.loads(raw)
            if msg.get("id") == 1:
                data = msg.get("result", {}).get("data")
                if not data:
                    return {"ok": False, "error": str(msg)[:400]}
                Path(path).write_bytes(base64.b64decode(data))
                return {"ok": True, "path": str(Path(path).resolve())}


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    cmd = sys.argv[1]
    if cmd == "targets":
        print(json.dumps(httpx.get(f"{CDP}/json", timeout=10).json(), indent=1)[:4000])
        return
    if cmd == "screenshot":
        path = sys.argv[2] if len(sys.argv) > 2 else r"C:\Users\ramch\AppData\Local\Temp\opencode\jarvis.png"
        print(json.dumps(asyncio.run(screenshot(path)), ensure_ascii=False))
        return
    if cmd == "eval":
        expression = sys.argv[2]
    elif cmd == "eval-file":
        expression = Path(sys.argv[2]).read_text(encoding="utf-8")
    else:
        raise SystemExit(__doc__)
    print(json.dumps(asyncio.run(evaluate(expression)), ensure_ascii=False))


if __name__ == "__main__":
    main()
