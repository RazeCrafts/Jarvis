"""Probe the direct provider path with the real artifact prompt (no UI)."""

import asyncio
import os
import sys
from pathlib import Path

BACKEND = Path(r"C:\Users\ramch\Jarvis\backend")
os.environ.setdefault("HERMES_HOME", str(BACKEND / "hermes-home"))
sys.path.insert(0, str(BACKEND))

import workspace as W  # noqa: E402
from model_router import stream_openrouter  # noqa: E402


async def main() -> None:
    message = "build me a 3D car with glossy red paint and chrome wheels"
    request = W.request_kind(message)
    print("request:", request)
    prompt = W.build_prompt(message, None, "three")
    full = ""
    async for event in stream_openrouter(prompt, [], None):
        kind = event.get("type")
        if kind == "done":
            full = str(event.get("fullResponse") or "")
        elif kind == "error":
            print("ERROR EVENT:", event)
    print("reply chars:", len(full))
    print("---- raw (first 1600) ----")
    print(full[:1600])
    print("---- parse ----")
    print(W.parse_reply(full))


asyncio.run(main())
