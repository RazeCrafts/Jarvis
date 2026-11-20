"""Local voice service: wake word, speech-to-text and push-to-talk.

Why the backend owns the microphone (Phase 5 finding):
  * WebView2 exposes ``webkitSpeechRecognition`` but the session ends instantly
    inside Tauri's WebView2 host (no ``start``/audio events, no error), and the
    host never answers WebView2's microphone permission prompt — ``getUserMedia``
    hangs. So browser STT is unusable here.
  * Text-to-speech does work in WebView2 (``speechSynthesis`` with system
    voices), so replies stay in the renderer; only *listening* moved here.

Pipeline:
  sounddevice 16 kHz mono int16 (80 ms frames)
    -> openWakeWord ("hey_jarvis")          -> voice_wake event
    -> energy VAD records until silence     -> voice_state(listening)
    -> faster-whisper (tiny.en by default)  -> voice_transcript event

The service only opens the microphone when the wake word is enabled or the
owner starts a listen (mic button / global push-to-talk). It never runs
silently in the background.

Events are pushed to every registered WebSocket session (see main.ChatSession)
as plain dicts:
  {"type": "voice_state", "state": "idle"|"listening"|"transcribing"|"stopped"}
  {"type": "voice_wake", "source": "wake"}
  {"type": "voice_level", "level": 0.0..1.0}
  {"type": "voice_transcript", "text": "...", "source": "wake"|"ptt"|"manual"}
  {"type": "voice_error", "message": "..."}
"""

from __future__ import annotations

import logging
import queue
import threading
import time
from pathlib import Path
from typing import Any, Callable

import numpy as np

from config import get_settings

logger = logging.getLogger("jarvis.voice")

SAMPLE_RATE = 16000
FRAME_SAMPLES = 1280  # 80 ms — what openWakeWord expects
FRAME_MS = FRAME_SAMPLES * 1000 // SAMPLE_RATE

Subscriber = Callable[[dict[str, Any]], None]

_voice: "VoiceService | None" = None


class VoiceService:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._subscribers: set[Subscriber] = set()

        self._stream: Any = None
        self._stream_device: Any = None
        self._worker: threading.Thread | None = None
        self._frames: "queue.Queue[np.ndarray]" = queue.Queue(maxsize=200)
        self._stop_worker = threading.Event()

        self._wake_enabled = False
        self._state = "stopped"
        self._recording = False
        self._record_frames: list[np.ndarray] = []
        self._record_started = 0.0
        self._last_voice_at = 0.0
        self._heard_speech = False
        self._record_source = "manual"
        self._last_emit = 0.0
        self._cooldown_until = 0.0
        self._noise_floor = 180.0
        self._calibration_frames: list[float] = []

        self._oww: Any = None
        self._oww_error: str = ""
        self._whisper: Any = None
        self._whisper_model = ""
        self._whisper_error = ""

        # While the renderer is speaking we ignore the microphone so JARVIS does
        # not transcribe its own voice (no echo cancellation yet). Mic / PTT /
        # Esc still barge in; a PTT listen emits voice_barge_in first.
        self._tts_speaking = False

        self._ptt_thread: threading.Thread | None = None
        self._ptt_handle: Any = None

    # ------------------------------------------------------------ events

    def subscribe(self, callback: Subscriber) -> None:
        with self._lock:
            self._subscribers.add(callback)

    def unsubscribe(self, callback: Subscriber) -> None:
        with self._lock:
            self._subscribers.discard(callback)

    def _emit(self, event: dict[str, Any]) -> None:
        with self._lock:
            subscribers = list(self._subscribers)
        for callback in subscribers:
            try:
                callback(event)
            except Exception as exc:  # noqa: BLE001
                logger.debug("voice subscriber failed: %s", exc)

    def _set_state(self, state: str) -> None:
        with self._lock:
            if self._state == state:
                return
            self._state = state
        self._emit({"type": "voice_state", "state": state})

    # ------------------------------------------------------------ lifecycle

    def start(self) -> None:
        """Called once at backend startup. Registers push-to-talk only; the
        microphone stays closed until the wake word is enabled or the owner
        asks to listen."""
        settings = get_settings()
        if settings.wake_word_enabled:
            self.start_wake()
        self._start_ptt_listener()

    def shutdown(self) -> None:
        self.stop_wake()
        self._stop_ptt_listener()

    def start_wake(self) -> dict[str, Any]:
        with self._lock:
            self._wake_enabled = True
        try:
            self._ensure_stream()
            self._set_state("idle")
            return {"ok": True, "state": self._state}
        except Exception as exc:  # noqa: BLE001
            with self._lock:
                self._wake_enabled = False
            self._emit({"type": "voice_error", "message": f"Microphone unavailable: {exc}"})
            return {"ok": False, "error": str(exc)}

    def stop_wake(self) -> dict[str, Any]:
        with self._lock:
            self._wake_enabled = False
            self._recording = False
            self._record_frames = []
        self._close_stream_if_idle()
        self._set_state("stopped")
        return {"ok": True, "state": self._state}

    # ------------------------------------------------------------ devices

    def mics(self) -> list[dict[str, Any]]:
        try:
            import sounddevice as sd

            default_in = None
            try:
                default_in = sd.default.device[0]
            except Exception:  # noqa: BLE001
                pass
            out: list[dict[str, Any]] = []
            for index, info in enumerate(sd.query_devices()):
                if int(info.get("max_input_channels", 0)) <= 0:
                    continue
                out.append(
                    {
                        "id": str(index),
                        "name": info.get("name", f"Input {index}"),
                        "channels": int(info.get("max_input_channels", 0)),
                        "default": index == default_in,
                        "hostApi": info.get("hostapi"),
                    }
                )
            return out
        except Exception as exc:  # noqa: BLE001
            logger.warning("microphone enumeration failed: %s", exc)
            return []

    def _resolve_device(self) -> Any:
        settings = get_settings()
        wanted = (settings.mic_device or "").strip()
        if not wanted:
            return None  # system default
        try:
            import sounddevice as sd

            devices = sd.query_devices()
            if wanted.isdigit():
                index = int(wanted)
                if 0 <= index < len(devices) and int(devices[index].get("max_input_channels", 0)) > 0:
                    return index
            needle = wanted.lower()
            for index, info in enumerate(devices):
                if int(info.get("max_input_channels", 0)) <= 0:
                    continue
                if needle in str(info.get("name", "")).lower():
                    return index
        except Exception as exc:  # noqa: BLE001
            logger.warning("microphone lookup failed: %s", exc)
        return None

    # ------------------------------------------------------------ audio stream

    def _ensure_stream(self) -> None:
        with self._lock:
            if self._stream is not None:
                return
        try:
            import sounddevice as sd
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(f"sounddevice is not installed ({exc})") from exc

        device = self._resolve_device()
        stream = sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=1,
            dtype="int16",
            blocksize=FRAME_SAMPLES,
            device=device,
            callback=self._audio_callback,
        )
        stream.start()
        with self._lock:
            self._stream = stream
            self._stream_device = device
            self._stop_worker.clear()
            self._calibration_frames = []
        self._worker = threading.Thread(target=self._process_loop, daemon=True, name="jarvis-voice")
        self._worker.start()
        logger.info("microphone open (device=%s)", device)

    def _close_stream_if_idle(self) -> None:
        with self._lock:
            if self._wake_enabled or self._recording:
                return
            stream = self._stream
            worker = self._worker
            self._stream = None
            self._worker = None
        if stream is not None:
            self._stop_worker.set()
            try:
                stream.stop()
                stream.close()
            except Exception:  # noqa: BLE001
                pass
            logger.info("microphone closed")
        if worker is not None and worker.is_alive():
            worker.join(timeout=1.0)

    def _audio_callback(self, indata, frames, time_info, status) -> None:  # noqa: ANN001, ARG002
        if status:
            logger.debug("audio status: %s", status)
        try:
            self._frames.put_nowait(indata[:, 0].copy())
        except queue.Full:
            pass

    def _process_loop(self) -> None:
        while not self._stop_worker.is_set():
            try:
                frame = self._frames.get(timeout=0.25)
            except queue.Empty:
                continue
            try:
                self._handle_frame(frame)
            except Exception as exc:  # noqa: BLE001
                logger.warning("voice frame failed: %s", exc)
        # Drain so a restart starts clean.
        while not self._frames.empty():
            try:
                self._frames.get_nowait()
            except queue.Empty:
                break

    # ------------------------------------------------------------ frame logic

    @staticmethod
    def _rms(frame: np.ndarray) -> float:
        if frame.size == 0:
            return 0.0
        data = frame.astype(np.float32)
        return float(np.sqrt(np.mean(data * data)))

    def _speech_threshold(self) -> float:
        return max(self._noise_floor * 2.6, 230.0)

    def _handle_frame(self, frame: np.ndarray) -> None:
        now = time.time()
        level = self._rms(frame)

        # Calibrate the noise floor over the first ~0.8 s of a fresh stream.
        with self._lock:
            calibrating = len(self._calibration_frames) < 10
            if calibrating:
                self._calibration_frames.append(level)
                if len(self._calibration_frames) == 10:
                    self._noise_floor = max(60.0, float(np.median(self._calibration_frames)))

        if self._recording:
            self._record_frame(frame, level, now)
            if now - self._last_emit >= 0.08:
                self._last_emit = now
                self._emit({"type": "voice_level", "level": min(1.0, level / 2500.0)})
            return

        if not self._wake_enabled or self._tts_speaking:
            return

        # Wake word detection (cheap ONNX model, 80 ms frame).
        if now < self._cooldown_until:
            return
        score = self._wake_score(frame)
        if score is not None and score >= float(get_settings().wake_threshold):
            logger.info("wake word detected (score %.2f)", score)
            self._cooldown_until = now + 2.0
            self._emit({"type": "voice_wake", "source": "wake", "score": round(float(score), 3)})
            self._begin_recording("wake", pre_roll=True)

    def _wake_score(self, frame: np.ndarray) -> float | None:
        model = self._ensure_oww()
        if model is None:
            return None
        try:
            prediction = model.predict(frame)
            if not isinstance(prediction, dict):
                return None
            return float(max(prediction.values())) if prediction else None
        except Exception as exc:  # noqa: BLE001
            logger.debug("wake prediction failed: %s", exc)
            return None

    def _ensure_oww(self) -> Any:
        with self._lock:
            if self._oww is not None:
                return self._oww
            if self._oww_error:
                return None
        try:
            from openwakeword.model import Model
            from openwakeword.utils import download_models

            name = (get_settings().wake_word or "hey_jarvis_v0.1").strip()
            candidates = [name, f"{name}.onnx", name.replace("_v0.1", "")]
            last_error: Exception | None = None
            model = None
            for candidate in candidates:
                try:
                    model = Model(wakeword_models=[candidate], inference_framework="onnx")
                    break
                except Exception as exc:  # noqa: BLE001
                    last_error = exc
            if model is None:
                # Download the model bundle once, then retry the canonical name.
                try:
                    download_models()
                except Exception as exc:  # noqa: BLE001
                    logger.warning("openWakeWord model download failed: %s", exc)
                for candidate in ("hey_jarvis_v0.1", "hey_jarvis"):
                    try:
                        model = Model(wakeword_models=[candidate], inference_framework="onnx")
                        break
                    except Exception as exc:  # noqa: BLE001
                        last_error = exc
            if model is None:
                raise RuntimeError(str(last_error) if last_error else "no wake model")
            with self._lock:
                self._oww = model
            logger.info("openWakeWord ready (%s)", name)
            return model
        except Exception as exc:  # noqa: BLE001
            message = f"Wake word unavailable: {exc}"
            with self._lock:
                self._oww_error = message
            logger.warning(message)
            self._emit({"type": "voice_error", "message": message})
            return None

    def _begin_recording(self, source: str, pre_roll: bool = False) -> None:
        with self._lock:
            if self._recording:
                return
            self._recording = True
            self._record_frames = []
            self._record_started = time.time()
            self._last_voice_at = 0.0
            self._heard_speech = False
            self._record_source = source
        if pre_roll:
            # Keep the frames already in the queue so the first syllable is not clipped.
            pass
        self._set_state("listening")
        self._emit({"type": "voice_level", "level": 0.0})

    def _record_frame(self, frame: np.ndarray, level: float, now: float) -> None:
        with self._lock:
            self._record_frames.append(frame.copy())
            elapsed = now - self._record_started
            if level >= self._speech_threshold():
                self._heard_speech = True
                self._last_voice_at = now

        if self._heard_speech and now - self._last_voice_at >= get_settings().voice_silence_ms / 1000.0:
            self._finish_recording()
            return
        if not self._heard_speech and elapsed >= 5.0:
            # Nothing said after waking / pressing the key.
            self._cancel_recording(notify=True)
            return
        if elapsed >= float(get_settings().voice_max_seconds):
            self._finish_recording()

    def _finish_recording(self) -> None:
        with self._lock:
            if not self._recording:
                return
            frames = self._record_frames
            source = self._record_source
            heard = self._heard_speech
            self._recording = False
            self._record_frames = []
        self._set_state("transcribing")
        if not heard or not frames:
            self._set_state("idle" if self._wake_enabled else "stopped")
            self._close_stream_if_idle()
            return
        audio = np.concatenate(frames).astype(np.float32) / 32768.0
        text = self._transcribe(audio)
        if text:
            self._emit({"type": "voice_transcript", "text": text, "source": source})
        self._set_state("idle" if self._wake_enabled else "stopped")
        self._close_stream_if_idle()

    def _cancel_recording(self, notify: bool = False) -> None:
        with self._lock:
            was_recording = self._recording
            self._recording = False
            self._record_frames = []
        if was_recording and notify:
            self._emit({"type": "voice_error", "message": "I didn't hear anything."})
        self._set_state("idle" if self._wake_enabled else "stopped")
        self._close_stream_if_idle()

    # ------------------------------------------------------------ whisper

    def _transcribe(self, audio: np.ndarray) -> str:
        model = self._ensure_whisper()
        if model is None:
            return ""
        try:
            segments, _info = model.transcribe(
                audio,
                language=(get_settings().voice_language or "en"),
                beam_size=1,
                vad_filter=True,
                condition_on_previous_text=False,
            )
            text = " ".join(segment.text.strip() for segment in segments).strip()
            return " ".join(text.split())
        except Exception as exc:  # noqa: BLE001
            message = f"Transcription failed: {exc}"
            logger.warning(message)
            self._emit({"type": "voice_error", "message": message})
            return ""

    def _ensure_whisper(self) -> Any:
        wanted = (get_settings().stt_model or "tiny.en").strip()
        with self._lock:
            if self._whisper is not None and self._whisper_model == wanted:
                return self._whisper
            if self._whisper_error and self._whisper_model == wanted:
                return None
        try:
            from faster_whisper import WhisperModel

            model = WhisperModel(wanted, device="cpu", compute_type="int8")
            with self._lock:
                self._whisper = model
                self._whisper_model = wanted
                self._whisper_error = ""
            logger.info("faster-whisper ready (%s)", wanted)
            return model
        except Exception as exc:  # noqa: BLE001
            message = f"Speech-to-text unavailable: {exc}"
            with self._lock:
                self._whisper_error = message
                self._whisper_model = wanted
            logger.warning(message)
            self._emit({"type": "voice_error", "message": message})
            return None

    # ------------------------------------------------------------ public actions

    def listen(self, source: str = "manual") -> dict[str, Any]:
        with self._lock:
            if self._recording:
                return {"ok": True, "already": True, "state": self._state}
            speaking = self._tts_speaking
            self._tts_speaking = False
        if speaking:
            self._emit({"type": "voice_barge_in", "source": source})
        try:
            self._ensure_stream()
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": str(exc)}
        self._begin_recording(source, pre_roll=False)
        return {"ok": True, "state": self._state}

    def set_tts_speaking(self, speaking: bool) -> None:
        """Renderer TTS state: ignore the mic while JARVIS is talking."""
        with self._lock:
            self._tts_speaking = bool(speaking)
            if speaking:
                self._recording = False
                self._record_frames = []
        if speaking:
            self._set_state("idle" if self._wake_enabled else "stopped")

    def cancel(self) -> dict[str, Any]:
        self._cancel_recording(notify=False)
        return {"ok": True, "state": self._state}

    def toggle_ptt(self) -> None:
        with self._lock:
            recording = self._recording
        if recording:
            self._finish_recording()
        else:
            result = self.listen("ptt")
            if not result.get("ok"):
                self._emit({"type": "voice_error", "message": f"Push-to-talk failed: {result.get('error')}"})

    # ------------------------------------------------------------ push-to-talk

    def _start_ptt_listener(self) -> None:
        hotkey = (get_settings().ptt_hotkey or "").strip()
        if not hotkey or self._ptt_thread is not None:
            return

        def _run() -> None:
            try:
                import keyboard

                self._ptt_handle = keyboard.add_hotkey(
                    hotkey, lambda: threading.Thread(target=self.toggle_ptt, daemon=True).start()
                )
                logger.info("push-to-talk hotkey registered: %s", hotkey)
                threading.Event().wait()
            except Exception as exc:  # noqa: BLE001
                logger.warning("push-to-talk hotkey unavailable: %s", exc)

        self._ptt_thread = threading.Thread(target=_run, daemon=True, name="jarvis-ptt-hotkey")
        self._ptt_thread.start()

    def _stop_ptt_listener(self) -> None:
        try:
            import keyboard

            if self._ptt_handle is not None:
                keyboard.remove_hotkey(self._ptt_handle)
        except Exception:  # noqa: BLE001
            pass
        self._ptt_handle = None
        self._ptt_thread = None

    def restart_ptt(self) -> None:
        self._stop_ptt_listener()
        self._start_ptt_listener()

    # ------------------------------------------------------------ diagnostics / tests

    def inject_wav(self, path: str, simulate_wake: bool = False, source: str = "test") -> dict[str, Any]:
        """Run a WAV through the same wake/STT path as live audio.

        Used by tools/test_phase5.py so the full event pipeline (wake -> UI
        states -> transcript -> agent turn -> TTS) can be verified without a
        physical microphone. ``simulate_wake`` emits the wake event first.
        """
        try:
            import soundfile as sf

            audio, rate = sf.read(path, dtype="float32", always_2d=False)
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": f"cannot read wav: {exc}"}
        if getattr(audio, "ndim", 1) > 1:
            audio = audio.mean(axis=1)
        if rate != SAMPLE_RATE:
            # Linear resample is adequate for a test fixture.
            duration = len(audio) / float(rate)
            target_len = int(duration * SAMPLE_RATE)
            audio = np.interp(
                np.linspace(0, len(audio) - 1, target_len, dtype=np.float32),
                np.arange(len(audio)),
                audio,
            ).astype(np.float32)

        wake_score = None
        if simulate_wake:
            self._emit({"type": "voice_wake", "source": source, "score": 1.0})
        else:
            # Score the first 2 seconds in 80 ms frames, mirroring live audio.
            model = self._ensure_oww()
            if model is not None:
                pcm = (audio * 32768.0).astype(np.int16)
                peak = 0.0
                for start in range(0, min(len(pcm) - FRAME_SAMPLES, SAMPLE_RATE * 2), FRAME_SAMPLES):
                    try:
                        pred = model.predict(pcm[start : start + FRAME_SAMPLES])
                        peak = max(peak, max(pred.values()) if pred else 0.0)
                    except Exception:  # noqa: BLE001
                        break
                wake_score = round(float(peak), 3)

        self._set_state("listening")
        self._emit({"type": "voice_level", "level": 0.5})
        text = self._transcribe(audio)
        self._set_state("idle" if self._wake_enabled else "stopped")
        if text:
            self._emit({"type": "voice_transcript", "text": text, "source": source})
        return {"ok": bool(text), "text": text, "wakeScore": wake_score, "duration": round(len(audio) / SAMPLE_RATE, 2)}

    def status(self) -> dict[str, Any]:
        settings = get_settings()
        with self._lock:
            return {
                "state": self._state,
                "wakeEnabled": self._wake_enabled,
                "wakeWord": settings.wake_word,
                "wakeThreshold": settings.wake_threshold,
                "pttHotkey": settings.ptt_hotkey,
                "micDevice": settings.mic_device,
                "sttModel": settings.stt_model,
                "streamOpen": self._stream is not None,
                "wakeModelReady": self._oww is not None,
                "wakeError": self._oww_error,
                "sttReady": self._whisper is not None,
                "sttError": self._whisper_error,
                "ttsSpeaking": self._tts_speaking,
            }


def get_voice() -> VoiceService:
    global _voice
    if _voice is None:
        _voice = VoiceService()
    return _voice
