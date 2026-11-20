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
  minimizedToBlob: boolean;
  circleToSearchOpen: boolean;
  /** Tool call awaiting user approval (Layer 4 guardrail). */
  pendingConfirmation: PendingConfirmation | null;
  setActiveTab: (tab: TabId) => void;
  setSidebarHovered: (hovered: boolean) => void;
  setMinimizedToBlob: (minimized: boolean) => void;
  setCircleToSearchOpen: (open: boolean) => void;
  setPendingConfirmation: (pending: PendingConfirmation | null) => void;
}

export const useUiStore = create<UiState>((set) => ({
  activeTab: "home",
  sidebarHovered: false,
  minimizedToBlob: false,
  circleToSearchOpen: false,
  pendingConfirmation: null,
  setActiveTab: (activeTab) => set({ activeTab }),
  setSidebarHovered: (sidebarHovered) => set({ sidebarHovered }),
  setMinimizedToBlob: (minimizedToBlob) => set({ minimizedToBlob }),
  setCircleToSearchOpen: (circleToSearchOpen) => set({ circleToSearchOpen }),
  setPendingConfirmation: (pendingConfirmation) => set({ pendingConfirmation }),
}));
