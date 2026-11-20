import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ChatMessage, ChatRole, ChatSession, LiveVisualSpec, WebCitation } from "@/types";
import {
  createChatSession,
  DEFAULT_SESSION_TITLE,
  deriveSessionTitle,
  isDefaultSessionTitle,
  MAX_PERSISTED_SESSIONS,
  MAX_SESSION_MESSAGES,
  sanitizeSessions,
} from "@/lib/chatSessions";

interface ChatState {
  sessions: ChatSession[];
  activeSessionId: string;
  messages: ChatMessage[];
  isListening: boolean;
  isSpeaking: boolean;
  createSession: (title?: string) => string;
  switchSession: (sessionId: string) => void;
  renameSession: (sessionId: string, title: string) => void;
  deleteSession: (sessionId: string) => void;
  addMessage: (role: ChatRole, content: string, streaming?: boolean, sessionId?: string) => string;
  removeMessage: (id: string, sessionId?: string) => void;
  appendToMessage: (id: string, chunk: string, sessionId?: string) => void;
  attachVisualToMessage: (id: string, visual: LiveVisualSpec, sessionId?: string) => void;
  attachCitationsToMessage: (id: string, citations: WebCitation[], sessionId?: string) => void;
  finishMessage: (id: string, sessionId?: string) => void;
  clearMessages: (sessionId?: string) => void;
  setListening: (listening: boolean) => void;
  setSpeaking: (speaking: boolean) => void;
}

const initialSession = createChatSession(`${DEFAULT_SESSION_TITLE} 1`, "session-1");

function updateSessionMessages(
  state: ChatState,
  targetSessionId: string | undefined,
  updater: (msgs: ChatMessage[], sess: ChatSession) => { messages: ChatMessage[]; title?: string },
): Partial<ChatState> {
  const sid = targetSessionId || state.activeSessionId;
  let activeMsgs = state.messages;
  const now = Date.now();

  const nextSessions = state.sessions.map((sess) => {
    if (sess.id !== sid) return sess;
    const res = updater(sess.messages, sess);
    const updated: ChatSession = {
      ...sess,
      title: res.title ?? sess.title,
      updatedAt: now,
      messages: res.messages,
    };
    if (sid === state.activeSessionId) {
      activeMsgs = res.messages;
    }
    return updated;
  });

  return {
    sessions: nextSessions,
    messages: activeMsgs,
  };
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      sessions: [initialSession],
      activeSessionId: initialSession.id,
      messages: [],
      isListening: false,
      isSpeaking: false,

      createSession: (title) => {
        const count = get().sessions.length + 1;
        const next = createChatSession(title || `${DEFAULT_SESSION_TITLE} ${count}`);
        set((s) => ({
          sessions: [next, ...s.sessions].slice(0, MAX_PERSISTED_SESSIONS),
          activeSessionId: next.id,
          messages: [],
        }));
        return next.id;
      },

      switchSession: (sessionId) => {
        const found = get().sessions.find((s) => s.id === sessionId);
        if (!found) return;
        set({
          activeSessionId: found.id,
          messages: found.messages,
        });
      },

      renameSession: (sessionId, title) => {
        const clean = title.trim();
        if (!clean) return;
        set((s) => ({
          sessions: s.sessions.map((sess) =>
            sess.id === sessionId ? { ...sess, title: clean, updatedAt: Date.now() } : sess,
          ),
        }));
      },

      deleteSession: (sessionId) => {
        set((s) => {
          const remaining = s.sessions.filter((sess) => sess.id !== sessionId);
          if (remaining.length === 0) {
            const fresh = createChatSession(`${DEFAULT_SESSION_TITLE} 1`);
            return {
              sessions: [fresh],
              activeSessionId: fresh.id,
              messages: [],
            };
          }
          const nextActive =
            s.activeSessionId === sessionId
              ? remaining[0]
              : remaining.find((sess) => sess.id === s.activeSessionId) || remaining[0];
          return {
            sessions: remaining,
            activeSessionId: nextActive.id,
            messages: nextActive.messages,
          };
        });
      },

      addMessage: (role, content, streaming = false, sessionId) => {
        const id = crypto.randomUUID();
        set((s) =>
          updateSessionMessages(s, sessionId, (msgs, sess) => {
            const nextMsgs = [...msgs, { id, role, content, createdAt: Date.now(), streaming }];
            const shouldAutoTitle =
              role === "user" &&
              msgs.every((m) => m.role !== "user") &&
              isDefaultSessionTitle(sess.title);
            return {
              messages: nextMsgs,
              title: shouldAutoTitle ? deriveSessionTitle(content) : sess.title,
            };
          }),
        );
        return id;
      },

      removeMessage: (id, sessionId) =>
        set((s) =>
          updateSessionMessages(s, sessionId, (msgs) => ({
            messages: msgs.filter((m) => m.id !== id),
          })),
        ),

      appendToMessage: (id, chunk, sessionId) =>
        set((s) =>
          updateSessionMessages(s, sessionId, (msgs) => ({
            messages: msgs.map((m) => (m.id === id ? { ...m, content: m.content + chunk } : m)),
          })),
        ),

      attachVisualToMessage: (id, visual, sessionId) =>
        set((s) =>
          updateSessionMessages(s, sessionId, (msgs) => ({
            messages: msgs.map((m) =>
              m.id === id
                ? {
                    ...m,
                    visuals: [...(m.visuals || []).filter((v) => v.id !== visual.id), visual],
                  }
                : m,
            ),
          })),
        ),

      attachCitationsToMessage: (id, citations, sessionId) =>
        set((s) =>
          updateSessionMessages(s, sessionId, (msgs) => ({
            messages: msgs.map((m) => (m.id === id ? { ...m, citations } : m)),
          })),
        ),

      finishMessage: (id, sessionId) =>
        set((s) =>
          updateSessionMessages(s, sessionId, (msgs) => ({
            messages: msgs.map((m) => (m.id === id ? { ...m, streaming: false } : m)),
          })),
        ),

      clearMessages: (sessionId) =>
        set((s) =>
          updateSessionMessages(s, sessionId, () => ({
            messages: [],
          })),
        ),

      setListening: (isListening) => set({ isListening }),
      setSpeaking: (isSpeaking) => set({ isSpeaking }),
    }),
    {
      name: "jarvis-chat",
      partialize: (s) => ({
        activeSessionId: s.activeSessionId,
        sessions: s.sessions.slice(0, MAX_PERSISTED_SESSIONS).map((sess) => ({
          ...sess,
          messages: sess.messages.filter((m) => !m.streaming).slice(-MAX_SESSION_MESSAGES),
        })),
      }),
      version: 3,
      migrate: (persistedState) => {
        const raw = (persistedState ?? {}) as {
          sessions?: unknown;
          activeSessionId?: unknown;
          messages?: unknown;
        };
        const sanitized = sanitizeSessions(raw.sessions, raw.messages);
        const active =
          typeof raw.activeSessionId === "string" &&
          sanitized.sessions.some((s) => s.id === raw.activeSessionId)
            ? raw.activeSessionId
            : sanitized.activeSessionId;
        const activeSess = sanitized.sessions.find((s) => s.id === active) || sanitized.sessions[0];
        return {
          sessions: sanitized.sessions,
          activeSessionId: activeSess.id,
          messages: activeSess.messages,
        };
      },
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const active =
          state.sessions.find((s) => s.id === state.activeSessionId) || state.sessions[0];
        if (active) {
          state.activeSessionId = active.id;
          state.messages = active.messages;
        }
      },
    },
  ),
);
