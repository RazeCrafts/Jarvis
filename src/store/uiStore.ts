import { create } from "zustand";
import type { TabId } from "@/types";

export interface PendingConfirmation {
  requestId: string;
  tool: string;
  args: Record<string, unknown>;
}

interface UiState {
  activeTab: TabId;
  sidebarHovered: boolean;
  /** Tool call awaiting user approval (Layer 4 guardrail). */
  pendingConfirmation: PendingConfirmation | null;
  setActiveTab: (tab: TabId) => void;
  setSidebarHovered: (hovered: boolean) => void;
  setPendingConfirmation: (pending: PendingConfirmation | null) => void;
}

export const useUiStore = create<UiState>((set) => ({
  activeTab: "home",
  sidebarHovered: false,
  pendingConfirmation: null,
  setActiveTab: (activeTab) => set({ activeTab }),
  setSidebarHovered: (sidebarHovered) => set({ sidebarHovered }),
  setPendingConfirmation: (pendingConfirmation) => set({ pendingConfirmation }),
}));
