/**
 * Agent service — WebSocket + Store orchestration for chat, live visuals,
 * citations, artifacts, voice, and server-side personal data sync.
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
import { useAgentStore, useChatStore, useHudStore, useLifeStore, useUiStore, useVideoStore, useWorkspaceStore } from "@/store";
import { websocketService, type ConnectionStatus, type WsEvent } from "@/lib/websocketService";
import type { LiveVisualSpec, TabId, WebCitation } from "@/types";
import type { VideoEditDirective } from "@/lib/autoNavigator";

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
  private streamingSessionId: string | null = null;
  private gotTokens = false;
  private sawArtifact = false;
  private pendingVisuals: LiveVisualSpec[] = [];
  private pendingCitations: WebCitation[] = [];
  private repaired = new Set<string>();
  private unsubscribe: (() => void) | null = null;

  init(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = websocketService.onMessage((event) => this.handleEvent(event));
    websocketService.onStatus((status) => this.handleStatus(status));
    websocketService.connect();
    agentApi
      .status()
      .then((status) => {
        useAgentStore.getState().setCurrentModel(status.model ?? null);
      })
      .catch(() => {
        /* offline tolerance */
      });
  }

  private ensureAssistantBubble(targetSessionId?: string): string {
    const chat = useChatStore.getState();
    const sid = targetSessionId || this.streamingSessionId || chat.activeSessionId;
    if (!this.streamingId) {
      this.streamingId = chat.addMessage("assistant", "", true, sid);
      this.streamingSessionId = sid;
    }
    return this.streamingId;
  }

  private handleStatus(status: ConnectionStatus): void {
    useAgentStore.getState().setConnected(status === "connected");
  }

  private handleEvent(event: WsEvent): void {
    const chat = useChatStore.getState();
    const agent = useAgentStore.getState();
    const ui = useUiStore.getState();
    const eventSessionId =
      typeof event.sessionId === "string" && event.sessionId
        ? event.sessionId
        : this.streamingSessionId || chat.activeSessionId;

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

      case "visual": {
        const visual = event.visual as LiveVisualSpec | undefined;
        if (visual && visual.id) {
          if (this.streamingId) {
            chat.attachVisualToMessage(this.streamingId, visual, eventSessionId);
          } else {
            this.pendingVisuals.push(visual);
          }
        }
        break;
      }

      case "citations": {
        const citations = Array.isArray(event.citations) ? (event.citations as WebCitation[]) : [];
        if (citations.length > 0) {
          if (this.streamingId) {
            chat.attachCitationsToMessage(this.streamingId, citations, eventSessionId);
          } else {
            this.pendingCitations = citations;
          }
        }
        break;
      }

      case "data_sync": {
        const domain = String(event.domain || "");
        if (
          domain === "memories" ||
          domain === "notes" ||
          domain === "calendar" ||
          domain === "smarthome" ||
          domain === "media"
        ) {
          void useLifeStore.getState().refreshDomain(domain);
        }
        break;
      }

      case "token": {
        if (!this.gotTokens) {
          this.gotTokens = true;
          agent.setThinking(false);
        }
        const id = this.ensureAssistantBubble(eventSessionId);
        if (this.pendingVisuals.length > 0) {
          for (const v of this.pendingVisuals) chat.attachVisualToMessage(id, v, eventSessionId);
          this.pendingVisuals = [];
        }
        if (this.pendingCitations.length > 0) {
          chat.attachCitationsToMessage(id, this.pendingCitations, eventSessionId);
          this.pendingCitations = [];
        }
        chat.appendToMessage(id, String(event.content ?? ""), eventSessionId);
        break;
      }

      case "tool_call": {
        const tool = String(event.tool ?? "tool");
        chat.addMessage("system", `Running ${tool.replace(/_/g, " ")}`, false, eventSessionId);
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
        chat.addMessage("system", String(event.message ?? ""), false, eventSessionId);
        break;
      }

      case "artifact": {
        const artifact = event.artifact as Artifact | undefined;
        if (artifact && artifact.id) {
          useWorkspaceStore.getState().upsertArtifact({ ...artifact, remote: true });
          this.sawArtifact = true;
        }
        break;
      }

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
        if (chat.isSpeaking) chat.addMessage("system", "Speech paused.", false, eventSessionId);
        stopSpeaking();
        break;
      }

      case "action": {
        const data = (event.data as Record<string, unknown>) ?? {};
        if (data.ok === false && data.error) {
          chat.addMessage("system", `⚠ ${String(data.error)}`, false, eventSessionId);
        }
        if (data.action === "navigate" && typeof data.tab === "string") {
          if (useHudStore.getState().autoSwitchTabs) {
            ui.setActiveTab(data.tab as TabId);
          }
          if (data.videoEdit && typeof data.videoEdit === "object") {
            useVideoStore.getState().applyAutoEditDirective(data.videoEdit as VideoEditDirective);
          }
        }
        if (data.action === "stage_control" && typeof data.command === "string") {
          window.dispatchEvent(new CustomEvent("jarvis-stage-command", { detail: data.command }));
        }
        break;
      }

      case "error": {
        if (this.streamingId && !this.gotTokens) {
          chat.removeMessage(this.streamingId, eventSessionId);
        }
        chat.addMessage("system", `⚠ ${String(event.message ?? "Unknown error")}`, false, eventSessionId);
        this.resetTurn();
        break;
      }

      case "done": {
        if (this.streamingId) {
          if (!this.gotTokens && this.pendingVisuals.length === 0) {
            chat.removeMessage(this.streamingId, eventSessionId);
          } else {
            if (this.pendingVisuals.length > 0) {
              for (const v of this.pendingVisuals) chat.attachVisualToMessage(this.streamingId, v, eventSessionId);
              this.pendingVisuals = [];
            }
            if (this.pendingCitations.length > 0) {
              chat.attachCitationsToMessage(this.streamingId, this.pendingCitations, eventSessionId);
              this.pendingCitations = [];
            }
            chat.finishMessage(this.streamingId, eventSessionId);
          }
        } else if (this.pendingVisuals.length > 0) {
          const id = chat.addMessage("assistant", "", false, eventSessionId);
          for (const v of this.pendingVisuals) chat.attachVisualToMessage(id, v, eventSessionId);
          this.pendingVisuals = [];
        }

        const full = String(event.fullResponse ?? "");
        this.resetTurn();

        if (!this.sawArtifact && full) {
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
    this.streamingSessionId = null;
    this.gotTokens = false;
    this.pendingVisuals = [];
    this.pendingCitations = [];
    useAgentStore.getState().setThinking(false);
  }

  send(text: string, model?: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    stopSpeaking();
    const chat = useChatStore.getState();
    const sessionId = chat.activeSessionId;
    const recentHistory = chat.messages
      .filter((m) => (m.role === "user" || m.role === "assistant") && m.content.trim())
      .slice(-20)
      .map((m) => ({ role: m.role, content: m.content }));

    chat.addMessage("user", trimmed, false, sessionId);
    this.streamingId = null;
    this.streamingSessionId = sessionId;
    this.gotTokens = false;
    this.sawArtifact = false;
    this.pendingVisuals = [];
    this.pendingCitations = [];
    websocketService.send({
      type: "message",
      sessionId,
      history: recentHistory,
      content: trimmed,
      ...(model ? { model } : {}),
    });
  }

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
