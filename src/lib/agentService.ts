/**
 * Agent service — the glue between the WebSocket bridge and the stores.
 * Owns the lifecycle: connect, dispatch events into chat/agent/ui stores,
 * expose send().
 */

import { agentApi } from "@/lib/agentApi";
import { parseArtifacts, type Artifact } from "@/lib/artifacts";
import {
  applyVoiceState,
  handleBargeIn,
  handleTranscript,
  handleVoiceError,
  handleVoiceLevel,
  handleWake,
} from "@/lib/voiceController";
import { speak, stopSpeaking } from "@/lib/voiceEngine";
import { useAgentStore, useChatStore, useUiStore, useWorkspaceStore } from "@/store";
import { websocketService, type ConnectionStatus, type WsEvent } from "@/lib/websocketService";
import type { TabId } from "@/types";

export interface TtsPrefs {
  enabled: boolean;
  rate: number;
  pitch: number;
}

const TTS_KEY = "jarvis-tts";

export function getTtsPrefs(): TtsPrefs {
  try {
    const raw = localStorage.getItem(TTS_KEY);
    if (raw) return JSON.parse(raw) as TtsPrefs;
  } catch {
    /* ignore */
  }
  return { enabled: true, rate: 0.98, pitch: 0.85 };
}

export function setTtsPrefs(prefs: TtsPrefs): void {
  localStorage.setItem(TTS_KEY, JSON.stringify(prefs));
}

class AgentService {
  private streamingId: string | null = null;
  private gotTokens = false;
  private sawArtifact = false;
  private repaired = new Set<string>();
  private unsubscribe: (() => void) | null = null;

  init(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = websocketService.onMessage((event) => this.handleEvent(event));
    websocketService.onStatus((status) => this.handleStatus(status));
    websocketService.connect();
    // Warm REST status (also validates the base URL early).
    agentApi.status().then((status) => {
      useAgentStore.getState().setCurrentModel(status.model ?? null);
    }).catch(() => {
      /* WS status events will drive the dot; offline is fine. */
    });
  }

  private handleStatus(status: ConnectionStatus): void {
    useAgentStore.getState().setConnected(status === "connected");
  }

  private handleEvent(event: WsEvent): void {
    const chat = useChatStore.getState();
    const agent = useAgentStore.getState();
    const ui = useUiStore.getState();

    switch (event.type) {
      case "status": {
        agent.setConnected(true);
        if (typeof event.model === "string") agent.setCurrentModel(event.model);
        break;
      }

      case "thinking": {
        agent.setThinking(Boolean(event.status));
        break;
      }

      case "token": {
        if (!this.gotTokens) {
          this.gotTokens = true;
          // First token arrives: thinking is over even if the flag lags.
          agent.setThinking(false);
        }
        if (!this.streamingId) {
          this.streamingId = chat.addMessage("assistant", "", true);
        }
        chat.appendToMessage(this.streamingId, String(event.content ?? ""));
        break;
      }

      case "tool_call": {
        const tool = String(event.tool ?? "tool");
        chat.addMessage("system", `⚙ ${tool}`);
        break;
      }

      case "confirm_request": {
        ui.setPendingConfirmation({
          requestId: String(event.requestId ?? ""),
          tool: String(event.tool ?? ""),
          args: (event.args as Record<string, unknown>) ?? {},
        });
        break;
      }

      case "notice": {
        chat.addMessage("system", String(event.message ?? ""));
        break;
      }

      // ---- Workspace artifacts (Phase 6) ----
      case "artifact": {
        const artifact = event.artifact as Artifact | undefined;
        if (artifact && artifact.id) {
          useWorkspaceStore.getState().upsertArtifact({ ...artifact, remote: true });
          this.sawArtifact = true;
        }
        break;
      }

      // ---- Backend voice service (Phase 5) ----
      case "voice_state": {
        applyVoiceState(String(event.state ?? "stopped"));
        break;
      }

      case "voice_wake": {
        handleWake(String(event.source ?? "wake"));
        break;
      }

      case "voice_level": {
        handleVoiceLevel(Number(event.level ?? 0));
        break;
      }

      case "voice_transcript": {
        handleTranscript(String(event.text ?? ""));
        break;
      }

      case "voice_barge_in": {
        handleBargeIn();
        break;
      }

      case "voice_error": {
        handleVoiceError(String(event.message ?? "Voice error"));
        break;
      }

      case "stop_speaking": {
        if (chat.isSpeaking) chat.addMessage("system", "🛑 Stopped.");
        stopSpeaking();
        break;
      }

      case "action": {
        const data = (event.data as Record<string, unknown>) ?? {};
        if (data.ok === false && data.error) {
          chat.addMessage("system", `⚠ ${String(data.error)}`);
        }
        if (data.action === "navigate" && typeof data.tab === "string") {
          ui.setActiveTab(data.tab as TabId);
        }
        if (data.action === "stage_control" && typeof data.command === "string") {
          window.dispatchEvent(new CustomEvent("jarvis-stage-command", { detail: data.command }));
        }
        break;
      }

      case "error": {
        if (this.streamingId && !this.gotTokens) {
          chat.removeMessage(this.streamingId);
        }
        chat.addMessage("system", `⚠ ${String(event.message ?? "Unknown error")}`);
        this.resetTurn();
        break;
      }

      case "done": {
        if (this.streamingId) {
          if (!this.gotTokens) {
            // Stream ended without any tokens: drop the empty bubble.
            chat.removeMessage(this.streamingId);
          } else {
            chat.finishMessage(this.streamingId);
          }
        }
        const full = String(event.fullResponse ?? "");
        this.resetTurn();

        // Anything JARVIS coded in this reply becomes a Workspace artifact.
        // Backend workspace turns already sent an `artifact` event — don't
        // duplicate them as local (non-editable) artifacts.
        if (!this.sawArtifact) {
          const artifacts = parseArtifacts(full);
          if (artifacts.length > 0) {
            useWorkspaceStore.getState().addArtifacts(artifacts);
          }
        }
        this.sawArtifact = false;

        const prefs = getTtsPrefs();
        if (full && prefs.enabled) {
          void speak(full, { rate: prefs.rate, pitch: prefs.pitch });
        }
        break;
      }
    }
  }

  private resetTurn(): void {
    this.streamingId = null;
    this.gotTokens = false;
    useAgentStore.getState().setThinking(false);
  }

  /** Send a user message through the bridge. `model` is an optional per-message
   * override from the chat model picker ("" / undefined = backend default). */
  send(text: string, model?: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    stopSpeaking(); // barge-in
    useChatStore.getState().addMessage("user", trimmed);
    this.streamingId = null;
    this.gotTokens = false;
    this.sawArtifact = false;
    websocketService.send({
      type: "message",
      content: trimmed,
      ...(model ? { model } : {}),
    });
  }

  /**
   * A rendered artifact crashed inside the iframe. Ask the backend for one
   * repair turn per artifact version (the backend also rate-limits this).
   */
  reportWorkspaceError(artifactId: string, version: number, error: string): void {
    const key = `${artifactId}:${version}`;
    if (this.repaired.has(key)) return;
    this.repaired.add(key);
    websocketService.send({ type: "workspace_repair", artifactId, error });
  }

  resolveConfirmation(requestId: string, approved: boolean): void {
    websocketService.send({ type: "confirmation", requestId, approved });
    useUiStore.getState().setPendingConfirmation(null);
    useChatStore
      .getState()
      .addMessage("system", approved ? "✓ Action approved" : "✗ Action denied");
  }

  async refreshStatus(): Promise<void> {
    try {
      const status = await agentApi.status();
      useAgentStore.getState().setCurrentModel(status.model ?? null);
      useAgentStore.getState().setConnected(true);
    } catch {
      useAgentStore.getState().setConnected(false);
    }
  }
}

export const agentService = new AgentService();
