import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ChatMessage, ChatRole } from "@/types";

interface ChatState {
  messages: ChatMessage[];
  isListening: boolean;
  isSpeaking: boolean;
  /** Adds a message and returns its id. */
  addMessage: (role: ChatRole, content: string, streaming?: boolean) => string;
  /** Removes a message by id. */
  removeMessage: (id: string) => void;
  /** Appends streamed text to an existing message. */
  appendToMessage: (id: string, chunk: string) => void;
  finishMessage: (id: string) => void;
  clearMessages: () => void;
  setListening: (listening: boolean) => void;
  setSpeaking: (speaking: boolean) => void;
}

const MAX_PERSISTED_MESSAGES = 100;

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      messages: [],
      isListening: false,
      isSpeaking: false,
      addMessage: (role, content, streaming = false) => {
        const id = crypto.randomUUID();
        set((s) => ({
          messages: [...s.messages, { id, role, content, createdAt: Date.now(), streaming }],
        }));
        return id;
      },
      removeMessage: (id) =>
        set((s) => ({ messages: s.messages.filter((m) => m.id !== id) })),
      appendToMessage: (id, chunk) =>
        set((s) => ({
          messages: s.messages.map((m) => (m.id === id ? { ...m, content: m.content + chunk } : m)),
        })),
      finishMessage: (id) =>
        set((s) => ({
          messages: s.messages.map((m) => (m.id === id ? { ...m, streaming: false } : m)),
        })),
      clearMessages: () => set({ messages: [] }),
      setListening: (isListening) => set({ isListening }),
      setSpeaking: (isSpeaking) => set({ isSpeaking }),
    }),
    {
      name: "jarvis-chat",
      partialize: (s) => ({
        // Persist history only; live flags and streaming markers stay local.
        messages: s.messages
          .filter((m) => !m.streaming)
          .slice(-MAX_PERSISTED_MESSAGES),
      }),
      // Persisted history is read by the mini player window via storage events,
      // so bump a version marker if the shape ever changes.
      version: 1,
    },
  ),
);
