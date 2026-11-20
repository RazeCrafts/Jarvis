import { create } from "zustand";

interface AgentState {
  isConnected: boolean;
  isThinking: boolean;
  /** Model id currently used by the backend, or null until connected. */
  currentModel: string | null;
  setConnected: (connected: boolean) => void;
  setThinking: (thinking: boolean) => void;
  setCurrentModel: (model: string | null) => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  isConnected: false,
  isThinking: false,
  currentModel: null,
  setConnected: (isConnected) => set({ isConnected }),
  setThinking: (isThinking) => set({ isThinking }),
  setCurrentModel: (currentModel) => set({ currentModel }),
}));
