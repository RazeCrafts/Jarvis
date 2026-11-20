import { create } from "zustand";
import {
  agentApi,
  type CalendarEventItem,
  type MediaHistoryItem,
  type PersonalMemoryItem,
  type PersonalNoteItem,
  type SmartHomeState,
} from "@/lib/agentApi";

interface LifeState {
  memories: PersonalMemoryItem[];
  notes: PersonalNoteItem[];
  calendar: CalendarEventItem[];
  smartHome: SmartHomeState;
  mediaHistory: MediaHistoryItem[];
  loading: boolean;
  refreshAll: () => Promise<void>;
  refreshDomain: (domain: "memories" | "notes" | "calendar" | "smarthome" | "media") => Promise<void>;
}

const EMPTY_SMARTHOME: SmartHomeState = {
  homeAssistantUrl: "",
  homeAssistantConnected: false,
  devices: [],
  scenes: [],
};

export const useLifeStore = create<LifeState>((set, get) => ({
  memories: [],
  notes: [],
  calendar: [],
  smartHome: EMPTY_SMARTHOME,
  mediaHistory: [],
  loading: false,

  refreshAll: async () => {
    set({ loading: true });
    try {
      const [memRes, noteRes, calRes, homeRes, mediaRes] = await Promise.all([
        agentApi.getMemories(),
        agentApi.getNotes(),
        agentApi.getCalendar(),
        agentApi.getSmartHome(),
        agentApi.getMediaHistory(),
      ]);
      set({
        memories: memRes.items,
        notes: noteRes.items,
        calendar: calRes.items,
        smartHome: homeRes,
        mediaHistory: mediaRes.items,
      });
    } catch {
      /* offline tolerance */
    } finally {
      set({ loading: false });
    }
  },

  refreshDomain: async (domain) => {
    try {
      if (domain === "memories") {
        const res = await agentApi.getMemories();
        set({ memories: res.items });
      } else if (domain === "notes") {
        const res = await agentApi.getNotes();
        set({ notes: res.items });
      } else if (domain === "calendar") {
        const res = await agentApi.getCalendar();
        set({ calendar: res.items });
      } else if (domain === "smarthome") {
        const res = await agentApi.getSmartHome();
        set({ smartHome: res });
      } else if (domain === "media") {
        const res = await agentApi.getMediaHistory();
        set({ mediaHistory: res.items });
      }
    } catch {
      /* ignore transient fetch error */
    }
    void get();
  },
}));
