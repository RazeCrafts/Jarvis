/**
 * Microphone & browser Web Speech Recognition bridge for JARVIS.
 * Uses native browser SpeechRecognition when available, and gracefully falls
 * back to backend/Desktop Bridge voice events when running in Tauri.
 */

import { agentApi } from "@/lib/agentApi";
import { FINISH_MS, isImmediateBargeIn, VoiceUtteranceBuffer } from "@/lib/voiceBuffer";
import { setAudioLevel, setTtsStateListener, stopSpeaking } from "@/lib/voiceEngine";
import { websocketService } from "@/lib/websocketService";
import { useChatStore } from "@/store";

export type VoiceState = "idle" | "listening" | "transcribing" | "stopped";

export interface VoiceStatus {
  state: VoiceState;
  wakeEnabled: boolean;
  wakeWord: string;
  wakeThreshold: number;
  pttHotkey: string;
  micDevice: string;
  sttModel: string;
  streamOpen: boolean;
  wakeModelReady: boolean;
  wakeError: string;
  sttReady: boolean;
  sttError: string;
  ttsSpeaking: boolean;
}

export interface MicInfo {
  id: string;
  name: string;
  channels: number;
  default: boolean;
}

interface SpeechRecLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onresult: ((e: {
    resultIndex?: number;
    results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
  }) => void) | null;
  start: () => void;
  stop: () => void;
}

let started = false;
let state: VoiceState = "stopped";
let sendTurn: ((text: string) => void) | null = null;
let activeRecognition: SpeechRecLike | null = null;

const utteranceBuffer = new VoiceUtteranceBuffer({
  finishMs: FINISH_MS,
  onDispatch: (utterance) => {
    if (!utterance || isMiniWindow()) return;
    sendTurn?.(utterance);
  },
  onBargeIn: () => {
    handleBargeIn();
  },
});

export function isMiniWindow(): boolean {
  return typeof window !== "undefined" && window.location.hash === "#mini";
}

function isListening(): boolean {
  return state === "listening";
}

function setListeningFlag(next: VoiceState): void {
  state = next;
  useChatStore.getState().setListening(next === "listening");
  if (next !== "listening") setAudioLevel(0);
}

function playChime(): void {
  try {
    const Ctx = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
      .AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    for (const [freq, start] of [
      [880, 0],
      [1320, 0.09],
    ] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(0.06, now + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + 0.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + 0.24);
    }
    window.setTimeout(() => void ctx.close(), 500);
  } catch {
    /* audio may be blocked */
  }
}

export function initVoiceBridge(send: (text: string) => void): void {
  sendTurn = send;
  if (started) return;
  started = true;

  setTtsStateListener((speaking) => {
    try {
      websocketService.send({ type: "tts_state", speaking });
    } catch {
      /* offline */
    }
  });

  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (useChatStore.getState().isSpeaking) stopSpeaking();
    utteranceBuffer.clear();
    if (isListening()) void cancelMic();
  });
}

export function applyVoiceState(next: string): void {
  const value = (["idle", "listening", "transcribing", "stopped"] as const).includes(next as VoiceState)
    ? (next as VoiceState)
    : "stopped";
  setListeningFlag(value);
}

export function handleWake(source?: string): void {
  playChime();
  if (isMiniWindow()) return;
  useChatStore
    .getState()
    .addMessage("system", source === "ptt" ? "Listening…" : "Wake word detected — listening…");
}

export function handleVoiceLevel(level: number): void {
  if (!isListening()) return;
  setAudioLevel(Number.isFinite(level) ? level : 0);
}

export function handleTranscript(text: string): void {
  const trimmed = (text || "").trim();
  if (!trimmed || isMiniWindow()) return;
  if (isImmediateBargeIn(trimmed)) {
    utteranceBuffer.clear();
    handleBargeIn();
    return;
  }
  utteranceBuffer.push(trimmed, true);
}

export function handleBargeIn(): void {
  utteranceBuffer.clear();
  if (useChatStore.getState().isSpeaking) stopSpeaking();
}

export function handleVoiceError(message: string): void {
  if (isMiniWindow()) return;
  useChatStore.getState().addMessage("system", `⚠ ${message}`);
}

export async function toggleMic(source: "ptt" | "manual" = "manual"): Promise<void> {
  if (isListening()) {
    utteranceBuffer.flush();
    await cancelMic();
    return;
  }
  if (useChatStore.getState().isSpeaking) stopSpeaking();
  utteranceBuffer.clear();

  const Rec =
    typeof window !== "undefined"
      ? ((window as unknown as { SpeechRecognition?: new () => SpeechRecLike; webkitSpeechRecognition?: new () => SpeechRecLike })
          .SpeechRecognition ??
        (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecLike }).webkitSpeechRecognition)
      : undefined;

  if (Rec) {
    try {
      const rec = new Rec();
      activeRecognition = rec;
      rec.lang = "en-US";
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.continuous = true;
      rec.onstart = () => {
        playChime();
        setListeningFlag("listening");
      };
      rec.onresult = (evt) => {
        const startIdx = evt.resultIndex ?? 0;
        for (let i = startIdx; i < evt.results.length; i += 1) {
          const item = evt.results[i];
          const transcript = item?.[0]?.transcript;
          if (!transcript) continue;
          utteranceBuffer.push(transcript, Boolean(item.isFinal));
        }
      };
      rec.onerror = (evt) => {
        if (evt.error && evt.error !== "no-speech" && evt.error !== "aborted") {
          handleVoiceError(`Browser speech error: ${evt.error}`);
        }
        utteranceBuffer.flush();
        setListeningFlag("stopped");
      };
      rec.onend = () => {
        activeRecognition = null;
        utteranceBuffer.flush();
        setListeningFlag("stopped");
      };
      rec.start();
      return;
    } catch {
      activeRecognition = null;
    }
  }

  try {
    const result = await agentApi.listenVoice(source);
    if (!result.ok) {
      handleVoiceError(result.error || "Voice recognition is unavailable in this browser.");
    } else {
      setListeningFlag("listening");
    }
  } catch {
    handleVoiceError("Browser voice recognition requires Chrome/Edge or a paired Desktop Bridge.");
  }
}

export async function cancelMic(): Promise<void> {
  utteranceBuffer.clear();
  if (activeRecognition) {
    try {
      activeRecognition.stop();
    } catch {
      /* ignore */
    }
    activeRecognition = null;
  }
  try {
    await agentApi.cancelVoice();
  } catch {
    /* ignore */
  }
  setListeningFlag("stopped");
}

export async function setWakeWordEnabled(enabled: boolean): Promise<boolean> {
  try {
    await agentApi.saveSettings({ wakeWordEnabled: enabled });
    return true;
  } catch {
    return false;
  }
}

export async function getVoiceStatus(): Promise<VoiceStatus | null> {
  try {
    return await agentApi.voiceStatus();
  } catch {
    return null;
  }
}

export function currentVoiceState(): VoiceState {
  return state;
}
