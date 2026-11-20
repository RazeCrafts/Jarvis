import { create } from "zustand";
import { persist } from "zustand/middleware";
import { clampClipTrim, createDefaultClip, type VideoClip } from "@/lib/videoTimeline";
import type { VideoEditDirective } from "@/lib/autoNavigator";

interface VideoStoreState {
  clips: VideoClip[];
  selectedId: string | null;
  lastAutoEditSummary: string;
  addClips: (newClips: VideoClip[]) => void;
  setClips: (clips: VideoClip[]) => void;
  setSelectedId: (id: string | null) => void;
  loadSampleClipsFromAgent: (count?: number) => void;
  applyAutoEditDirective: (directive: VideoEditDirective) => string;
  clearAutoEditSummary: () => void;
}

export const useVideoStore = create<VideoStoreState>()(
  persist(
    (set, get) => ({
      clips: [],
      selectedId: null,
      lastAutoEditSummary: "",

      addClips: (newClips) => {
        if (newClips.length === 0) return;
        set((state) => ({
          clips: [...state.clips, ...newClips],
          selectedId: state.selectedId ?? newClips[0].id,
        }));
      },

      setClips: (clips) => set({ clips }),

      setSelectedId: (selectedId) => set({ selectedId }),

      loadSampleClipsFromAgent: (count = 1) => {
        const added: VideoClip[] = [];
        for (let i = 0; i < count; i += 1) {
          added.push(
            createDefaultClip({
              name: `JARVIS Auto-Clip ${get().clips.length + i + 1}.webm`,
              src: "",
              duration: 5,
            }),
          );
        }
        set((state) => ({
          clips: [...state.clips, ...added],
          selectedId: state.selectedId ?? added[0].id,
        }));
      },

      applyAutoEditDirective: (directive) => {
        const current = get().clips;
        if (current.length === 0) {
          return "Opened Video Studio ready for your clips.";
        }
        const notes: string[] = [];
        const updated = current.map((clip, idx) => {
          let next = { ...clip };
          if (directive.filterPreset) {
            next.filterPreset = directive.filterPreset;
          }
          if (directive.motionPreset) {
            next.motionPreset = directive.motionPreset;
          }
          if (typeof directive.speed === "number") {
            next.speed = directive.speed;
          }
          if (directive.overlayText && idx === 0) {
            next.overlayText = directive.overlayText;
          }
          if (typeof directive.trimStartDelta === "number" && next.duration > 1.5) {
            next = clampClipTrim(
              next,
              Math.min(next.trimEnd - 0.5, next.trimStart + directive.trimStartDelta),
              next.trimEnd,
            );
          }
          return next;
        });

        if (directive.filterPreset) notes.push(`${directive.filterPreset} grade`);
        if (directive.motionPreset) notes.push(`${directive.motionPreset} motion`);
        if (directive.speed) notes.push(`${directive.speed}x pacing`);
        if (directive.overlayText) notes.push(`title "${directive.overlayText}"`);
        if (directive.trimStartDelta) notes.push("tightened cut points");

        const summary = `JARVIS applied ${notes.join(", ") || "studio edit"} across ${updated.length} clip(s).`;
        set({
          clips: updated,
          selectedId: get().selectedId ?? updated[0]?.id ?? null,
          lastAutoEditSummary: summary,
        });
        return summary;
      },

      clearAutoEditSummary: () => set({ lastAutoEditSummary: "" }),
    }),
    {
      name: "jarvis-video-timeline",
      version: 1,
      migrate: (persisted) => {
        const p = (persisted ?? {}) as Partial<VideoStoreState>;
        // Filter out ephemeral blob: URLs from previous reloads so broken video refs don't linger
        const cleanClips = Array.isArray(p.clips)
          ? p.clips.map((c) => (c.src?.startsWith("blob:") ? { ...c, src: "" } : c))
          : [];
        return {
          clips: cleanClips,
          selectedId: typeof p.selectedId === "string" ? p.selectedId : null,
          lastAutoEditSummary: "",
        };
      },
      partialize: (s) => ({
        clips: s.clips.map((c) => (c.src?.startsWith("blob:") ? { ...c, src: "" } : c)),
        selectedId: s.selectedId,
      }),
    },
  ),
);
