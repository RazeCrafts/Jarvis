/**
 * Voice output (TTS) in the renderer.
 *
 * Phase 5 finding: WebView2's ``webkitSpeechRecognition`` is present but the
 * session dies immediately inside Tauri (no audio, no error), and the host
 * never answers the microphone permission prompt so ``getUserMedia`` hangs.
 * All *listening* therefore lives in the Python backend (see voice.py and
 * lib/voiceController.ts). Text-to-speech does work here and stays local.
 *
 * The orb's level feed is shared: the backend sends real mic amplitude while
 * listening; while speaking we synthesize an envelope because
 * ``speechSynthesis`` exposes no amplitude data.
 */

import { useAudioControlStore, useChatStore } from "@/store";
import { isMuteFlagActive } from "@/lib/voiceBuffer";

export const ttsSupported = typeof window !== "undefined" && "speechSynthesis" in window;

/* ---------------- amplitude ---------------- */

/** Latest amplitude, 0..1. Polled by the Home page for the orb. */
export let audioLevel = 0;

export function setAudioLevel(level: number): void {
  const clamped = Math.max(0, Math.min(1, level));
  audioLevel = clamped;
}

/* ---------------- TTS state bridge ---------------- */

type SpeakStateListener = (speaking: boolean) => void;
let speakStateListener: SpeakStateListener | null = null;

/** Registered once by voiceController to forward TTS state to the backend so
 * the microphone ignores JARVIS's own voice. */
export function setTtsStateListener(listener: SpeakStateListener | null): void {
  speakStateListener = listener;
}

function notifySpeaking(speaking: boolean): void {
  useChatStore.getState().setSpeaking(speaking);
  try {
    speakStateListener?.(speaking);
  } catch {
    /* listener is best-effort */
  }
}

/* ---------------- TTS ---------------- */

let currentUtterance: SpeechSynthesisUtterance | null = null;
let levelTimer: number | null = null;

/** Best available "calm male assistant" voice, else the default. */
function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;
  const preferred = [
    "Google UK English Male",
    "Microsoft George",
    "Microsoft Ryan",
    "Daniel",
    "Google US English",
  ];
  for (const name of preferred) {
    const hit = voices.find((v) => v.name.includes(name));
    if (hit) return hit;
  }
  return voices.find((v) => v.lang.startsWith("en")) ?? voices[0] ?? null;
}

/**
 * Speak `text` aloud. Resolves when speech finishes (or immediately errors).
 * Honors `?mute=1` URL flag and Master/Voice volume mixer.
 */
export function speak(
  text: string,
  opts: { rate?: number; pitch?: number; volume?: number } = {},
): Promise<void> {
  if (!ttsSupported || !text.trim() || isMuteFlagActive()) return Promise.resolve();
  const effectiveVol = useAudioControlStore.getState().effectiveVoiceVolume();
  if (effectiveVol <= 0) return Promise.resolve();
  stopSpeaking();

  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = pickVoice();
    if (voice) utterance.voice = voice;
    utterance.rate = opts.rate ?? 0.98;
    utterance.pitch = opts.pitch ?? 0.85;
    utterance.volume = Math.max(0, Math.min(1, (opts.volume ?? 1) * effectiveVol));

    const finish = () => {
      if (levelTimer !== null) {
        window.clearInterval(levelTimer);
        levelTimer = null;
      }
      currentUtterance = null;
      setAudioLevel(0);
      notifySpeaking(false);
      resolve();
    };

    utterance.onend = finish;
    utterance.onerror = finish;

    currentUtterance = utterance;
    notifySpeaking(true);

    // Synthetic amplitude envelope: layered sines feel speech-like enough for
    // the orb (SpeechSynthesis has no FFT data to read).
    const t0 = performance.now();
    levelTimer = window.setInterval(() => {
      const t = (performance.now() - t0) / 1000;
      setAudioLevel(
        Math.abs(Math.sin(t * 9.2) * (0.55 + 0.45 * Math.sin(t * 2.1))) *
          (0.65 + 0.35 * Math.abs(Math.sin(t * 0.7))),
      );
    }, 50);

    synth.speak(utterance);
  });
}

export function stopSpeaking(): void {
  if (!ttsSupported) return;
  if (levelTimer !== null) {
    window.clearInterval(levelTimer);
    levelTimer = null;
  }
  currentUtterance = null;
  window.speechSynthesis.cancel();
  setAudioLevel(0);
  if (useChatStore.getState().isSpeaking) notifySpeaking(false);
}

export function isSpeaking(): boolean {
  return currentUtterance !== null;
}

/** Warm up the voice list (Chrome loads voices asynchronously). */
export function warmUpVoices(): void {
  if (!ttsSupported) return;
  window.speechSynthesis.getVoices();
}
