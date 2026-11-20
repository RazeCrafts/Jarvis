/**
 * Microphone control for the backend voice service (Phase 5).
 *
 * Why this file exists: WebView2's Web Speech recognition is unusable inside
 * Tauri (the session ends instantly) and its microphone permission prompt is
 * never answered, so ``getUserMedia`` hangs. The backend owns the mic
 * (sounddevice + openWakeWord + faster-whisper) and streams events over the
 * WebSocket. This module turns those events into chat/orb state.
 *
 * Every window receives voice events, but only the main window starts a turn
 * from a transcript — otherwise the mini player would send each command twice.
 */

import { agentApi } from "@/lib/agentApi";
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

let started = false;
let state: VoiceState = "stopped";
let sendTurn: ((text: string) => void) | null = null;

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

/** Soft two-tone chime via WebAudio (no assets needed). */
function playChime(): void {
  try {
    const Ctx = (window as any).AudioContext ?? (window as any).webkitAudioContext;
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
      gain.gain.exponentialRampToValueAtTime(0.08, now + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + 0.25);
    }
    window.setTimeout(() => void ctx.close(), 600);
  } catch {
    /* audio may be blocked; non-critical */
  }
}

async function showMainWindow(): Promise<void> {
  try {
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      await win.show();
      await win.unminimize();
      await win.setFocus();
    }
  } catch {
    /* plain browser dev: nothing to show */
  }
}

/**
 * Call once per window at startup. `send` starts a chat turn (agentService.send
 * in the main window; unused in the mini player).
 */
export function initVoiceBridge(send: (text: string) => void): void {
  sendTurn = send;
  if (started) return;
  started = true;

  // While JARVIS speaks, tell the backend to ignore the mic so it does not
  // transcribe its own voice (there is no echo cancellation yet).
  setTtsStateListener((speaking) => {
    try {
      websocketService.send({ type: "tts_state", speaking });
    } catch {
      /* offline: backend will simply not know */
    }
  });

  // Esc = barge-in: stop speech, cancel listening.
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (useChatStore.getState().isSpeaking) stopSpeaking();
    if (isListening()) void cancelMic();
  });
}

/* ---------------- events from the backend ---------------- */

export function applyVoiceState(next: string): void {
  const value = (["idle", "listening", "transcribing", "stopped"] as const).includes(
    next as VoiceState,
  )
    ? (next as VoiceState)
    : "stopped";
  setListeningFlag(value);
}

export function handleWake(source?: string): void {
  playChime();
  if (isMiniWindow()) return;
  void showMainWindow();
  useChatStore
    .getState()
    .addMessage("system", source === "ptt" ? "🎙 Listening…" : "🎙 Wake word detected — listening…");
}

export function handleVoiceLevel(level: number): void {
  if (!isListening()) return;
  setAudioLevel(Number.isFinite(level) ? level : 0);
}

export function handleTranscript(text: string): void {
  const trimmed = (text || "").trim();
  if (!trimmed) return;
  if (isMiniWindow()) return; // the main window owns the turn
  sendTurn?.(trimmed);
}

export function handleBargeIn(): void {
  if (useChatStore.getState().isSpeaking) stopSpeaking();
}

export function handleVoiceError(message: string): void {
  if (isMiniWindow()) return;
  useChatStore.getState().addMessage("system", `⚠ ${message}`);
}

/* ---------------- actions ---------------- */

export async function toggleMic(source: "ptt" | "manual" = "manual"): Promise<void> {
  if (isListening()) {
    await cancelMic();
    return;
  }
  // Mic press while JARVIS talks is a barge-in.
  if (useChatStore.getState().isSpeaking) stopSpeaking();
  try {
    const result = await agentApi.listenVoice(source);
    if (!result.ok) {
      handleVoiceError(result.error || "The microphone could not be opened.");
    }
  } catch (exc) {
    handleVoiceError(
      `Voice backend unreachable (${exc instanceof Error ? exc.message : exc}).`,
    );
  }
}

export async function cancelMic(): Promise<void> {
  try {
    await agentApi.cancelVoice();
  } catch {
    /* backend offline — clear local state anyway */
  }
  setListeningFlag("stopped");
}

export async function setWakeWordEnabled(enabled: boolean): Promise<boolean> {
  try {
    await agentApi.saveSettings({ wakeWordEnabled: enabled });
    return true;
  } catch (exc) {
    handleVoiceError(
      `Could not change the wake word (${exc instanceof Error ? exc.message : exc}).`,
    );
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
