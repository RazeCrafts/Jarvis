import { create } from "zustand";
import type { DedicatedAppTarget } from "@/lib/mediaIntent";

export interface MediaDeckItem {
  id: string;
  title: string;
  kind: "movie" | "song" | "video" | "audio";
  source: "online" | "local" | "galaxy";
  watchUrl?: string;
  embedUrl?: string;
  localSrc?: string;
  mimeType?: string;
  channel?: string;
  targets?: DedicatedAppTarget[];
}

interface PlayerState {
  queue: MediaDeckItem[];
  activeId: string | null;
  dockOpen: boolean;
  minimized: boolean;

  openItem: (item: MediaDeckItem) => void;
  addItems: (items: MediaDeckItem[], playFirst?: boolean) => void;
  setActiveId: (id: string | null) => void;
  removeItem: (id: string) => void;
  setDockOpen: (open: boolean) => void;
  setMinimized: (minimized: boolean) => void;
}

export const usePlayerStore = create<PlayerState>((set) => ({
  queue: [],
  activeId: null,
  dockOpen: false,
  minimized: false,

  openItem: (item) =>
    set((s) => {
      const exists = s.queue.some((x) => x.id === item.id);
      const next = exists
        ? s.queue.map((x) => (x.id === item.id ? { ...x, ...item } : x))
        : [item, ...s.queue].slice(0, 24);
      return {
        queue: next,
        activeId: item.id,
        dockOpen: true,
        minimized: false,
      };
    }),

  addItems: (items, playFirst = true) =>
    set((s) => {
      const next = [...s.queue];
      for (const item of items) {
        if (!next.some((x) => x.id === item.id)) next.push(item);
      }
      return {
        queue: next.slice(0, 24),
        activeId: playFirst && items[0] ? items[0].id : s.activeId ?? items[0]?.id ?? null,
        dockOpen: playFirst ? true : s.dockOpen,
        minimized: playFirst ? false : s.minimized,
      };
    }),

  setActiveId: (activeId) => set({ activeId }),

  removeItem: (id) =>
    set((s) => {
      const next = s.queue.filter((x) => x.id !== id);
      const nextActive = s.activeId === id ? (next[0]?.id ?? null) : s.activeId;
      return {
        queue: next,
        activeId: nextActive,
        dockOpen: next.length > 0 ? s.dockOpen : false,
      };
    }),

  setDockOpen: (dockOpen) => set({ dockOpen }),
  setMinimized: (minimized) => set({ minimized }),
}));
