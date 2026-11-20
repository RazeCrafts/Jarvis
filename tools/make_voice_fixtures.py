"""Generate WAV fixtures with Windows SAPI (pyttsx3) for Phase 5 tests.

These stand in for the owner's voice so the backend STT pipeline (faster-whisper)
and the action router can be verified without a physical microphone.
"""

from __future__ import annotations

from pathlib import Path

import pyttsx3

OUT = Path(__file__).resolve().parent / "fixtures"
OUT.mkdir(exist_ok=True)

PHRASES = {
    "wake.wav": "Hey JARVIS",
    "spotify.wav": "Play lo-fi on Spotify",
    "youtube.wav": "Open a YouTube video about volcanoes",
    "pause.wav": "Pause",
    "question.wav": "What is the capital of France?",
    "volume.wav": "Turn the volume down",
}


def main() -> None:
    engine = pyttsx3.init()
    engine.setProperty("rate", 160)
    engine.setProperty("volume", 1.0)
    for name, text in PHRASES.items():
        path = OUT / name
        engine.save_to_file(text, str(path))
        engine.runAndWait()
        print(f"{name}: {path.exists()} {path.stat().st_size if path.exists() else 0} bytes")


if __name__ == "__main__":
    main()
