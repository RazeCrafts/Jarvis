import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  clampClipTrim,
  createDefaultClip,
  moveClip,
  splitClipAtSourceTime,
  type MotionPreset,
  type TimedCaptionCue,
  type TransitionPreset,
  type VideoClip,
} from "@/lib/videoTimeline";
import { alignClipsToBeats } from "@/lib/audioBeatAnalyzer";
import type { VideoEditDirective } from "@/lib/autoNavigator";

export type AspectRatio = "16:9" | "9:16" | "1:1";

export interface AiEditPlanClipOp {
  clipIndex?: number;
  trimStart?: number;
  trimEnd?: number;
  speed?: number;
  filterPreset?: VideoClip["filterPreset"];
  motionPreset?: MotionPreset;
  transition?: TransitionPreset;
  overlayText?: string;
}

export interface AiEditPlanPayload {
  summary?: string;
  aspectRatio?: AspectRatio;
  beatSync?: boolean;
  overlayTitle?: string;
  clipOps?: AiEditPlanClipOp[];
  captions?: Array<{ start: number; end: number; text: string }>;
  removeClipIndices?: number[];
  reorderIndices?: number[];
}

interface VideoStoreState {
  clips: VideoClip[];
  selectedId: string | null;
  historyPast: VideoClip[][];
  historyFuture: VideoClip[][];
  aspectRatio: AspectRatio;
  timelineZoom: number;
  musicUrl: string;
  musicName: string;
  bpm: number;
  beats: number[];
  waveform: number[];
  captions: TimedCaptionCue[];
  lastAutoEditSummary: string;

  addClips: (newClips: VideoClip[]) => void;
  setClips: (clips: VideoClip[], pushHistory?: boolean) => void;
  updateClip: (id: string, patch: Partial<VideoClip>, pushHistory?: boolean) => void;
  splitClip: (id: string, sourceTime: number) => string | null;
  moveClipStep: (id: string, dir: -1 | 1) => void;
  deleteClip: (id: string) => void;
  undo: () => boolean;
  redo: () => boolean;
  setSelectedId: (id: string | null) => void;
  setAspectRatio: (ratio: AspectRatio) => void;
  setTimelineZoom: (zoom: number) => void;
  setMusicTrack: (track: {
    url: string;
    name: string;
    bpm?: number;
    beats?: number[];
    waveform?: number[];
  }) => void;
  clearMusicTrack: () => void;
  setCaptions: (captions: TimedCaptionCue[]) => void;
  syncClipsToBeats: () => string;
  loadSampleClipsFromAgent: (count?: number) => void;
  applyAutoEditDirective: (directive: VideoEditDirective) => string;
  applyAiEditPlan: (plan: AiEditPlanPayload) => string;
  clearAutoEditSummary: () => void;
}

function pushUndoSnapshot(past: VideoClip[][], current: VideoClip[]): VideoClip[][] {
  return [...past.slice(-19), current.map((c) => ({ ...c }))];
}

export const useVideoStore = create<VideoStoreState>()(
  persist(
    (set, get) => ({
      clips: [],
      selectedId: null,
      historyPast: [],
      historyFuture: [],
      aspectRatio: "16:9",
      timelineZoom: 1,
      musicUrl: "",
      musicName: "",
      bpm: 120,
      beats: [],
      waveform: [],
      captions: [],
      lastAutoEditSummary: "",

      addClips: (newClips) => {
        if (newClips.length === 0) return;
        set((state) => ({
          historyPast: pushUndoSnapshot(state.historyPast, state.clips),
          historyFuture: [],
          clips: [...state.clips, ...newClips],
          selectedId: state.selectedId ?? newClips[0].id,
        }));
      },

      setClips: (clips, pushHistory = true) =>
        set((state) => ({
          historyPast: pushHistory ? pushUndoSnapshot(state.historyPast, state.clips) : state.historyPast,
          historyFuture: pushHistory ? [] : state.historyFuture,
          clips,
        })),

      updateClip: (id, patch, pushHistory = true) =>
        set((state) => {
          const next = state.clips.map((c) => {
            if (c.id !== id) return c;
            const merged = { ...c, ...patch };
            return clampClipTrim(merged, merged.trimStart, merged.trimEnd);
          });
          return {
            historyPast: pushHistory ? pushUndoSnapshot(state.historyPast, state.clips) : state.historyPast,
            historyFuture: pushHistory ? [] : state.historyFuture,
            clips: next,
          };
        }),

      splitClip: (id, sourceTime) => {
        const state = get();
        const nextClips = splitClipAtSourceTime(state.clips, id, sourceTime);
        if (nextClips.length === state.clips.length) return null;
        const idx = state.clips.findIndex((c) => c.id === id);
        const newSelected = idx >= 0 && nextClips[idx + 1] ? nextClips[idx + 1].id : id;
        set({
          historyPast: pushUndoSnapshot(state.historyPast, state.clips),
          historyFuture: [],
          clips: nextClips,
          selectedId: newSelected,
        });
        return newSelected;
      },

      moveClipStep: (id, dir) =>
        set((state) => ({
          historyPast: pushUndoSnapshot(state.historyPast, state.clips),
          historyFuture: [],
          clips: moveClip(state.clips, id, dir),
        })),

      deleteClip: (id) =>
        set((state) => {
          const remaining = state.clips.filter((c) => c.id !== id);
          return {
            historyPast: pushUndoSnapshot(state.historyPast, state.clips),
            historyFuture: [],
            clips: remaining,
            selectedId: state.selectedId === id ? remaining[0]?.id ?? null : state.selectedId,
          };
        }),

      undo: () => {
        const { historyPast, clips, historyFuture } = get();
        if (historyPast.length === 0) return false;
        const prev = historyPast[historyPast.length - 1];
        set({
          clips: prev,
          historyPast: historyPast.slice(0, -1),
          historyFuture: [clips, ...historyFuture].slice(0, 20),
          selectedId: prev[0]?.id ?? null,
          lastAutoEditSummary: "Undid last timeline edit.",
        });
        return true;
      },

      redo: () => {
        const { historyPast, clips, historyFuture } = get();
        if (historyFuture.length === 0) return false;
        const next = historyFuture[0];
        set({
          clips: next,
          historyPast: pushUndoSnapshot(historyPast, clips),
          historyFuture: historyFuture.slice(1),
          selectedId: next[0]?.id ?? null,
          lastAutoEditSummary: "Redid timeline edit.",
        });
        return true;
      },

      setSelectedId: (selectedId) => set({ selectedId }),
      setAspectRatio: (aspectRatio) => set({ aspectRatio }),
      setTimelineZoom: (timelineZoom) =>
        set({ timelineZoom: Math.max(0.6, Math.min(2.5, timelineZoom)) }),

      setMusicTrack: (track) =>
        set({
          musicUrl: track.url,
          musicName: track.name,
          bpm: track.bpm ?? 120,
          beats: track.beats ?? [],
          waveform: track.waveform ?? [],
        }),

      clearMusicTrack: () =>
        set({ musicUrl: "", musicName: "", bpm: 120, beats: [], waveform: [] }),

      setCaptions: (captions) => set({ captions }),

      syncClipsToBeats: () => {
        const state = get();
        if (state.clips.length === 0) return "Add clips to sync cuts to music beats.";
        const aligned = alignClipsToBeats(state.clips, state.beats, state.bpm);
        const summary = `Synced ${aligned.length} clip cut(s) & flash transitions to ${state.bpm} BPM (${state.beats.length} detected beats).`;
        set({
          historyPast: pushUndoSnapshot(state.historyPast, state.clips),
          historyFuture: [],
          clips: aligned,
          lastAutoEditSummary: summary,
        });
        return summary;
      },

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
          historyPast: pushUndoSnapshot(state.historyPast, state.clips),
          historyFuture: [],
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
          if (directive.filterPreset) next.filterPreset = directive.filterPreset;
          if (directive.motionPreset) next.motionPreset = directive.motionPreset;
          if (typeof directive.speed === "number") next.speed = directive.speed;
          if (directive.overlayText && idx === 0) next.overlayText = directive.overlayText;
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
        set((state) => ({
          historyPast: pushUndoSnapshot(state.historyPast, state.clips),
          historyFuture: [],
          clips: updated,
          selectedId: state.selectedId ?? updated[0]?.id ?? null,
          lastAutoEditSummary: summary,
        }));
        return summary;
      },

      applyAiEditPlan: (plan) => {
        const state = get();
        let next = state.clips.map((c) => ({ ...c }));
        if (next.length === 0) {
          return plan.summary || "No clips on timeline to edit yet.";
        }

        if (Array.isArray(plan.removeClipIndices) && plan.removeClipIndices.length > 0 && plan.removeClipIndices.length < next.length) {
          const removeSet = new Set(plan.removeClipIndices);
          next = next.filter((_, i) => !removeSet.has(i));
        }

        if (Array.isArray(plan.reorderIndices) && plan.reorderIndices.length === next.length) {
          const valid = plan.reorderIndices.every((i) => Number.isInteger(i) && i >= 0 && i < next.length);
          if (valid) {
            next = plan.reorderIndices.map((i) => next[i]);
          }
        }

        if (Array.isArray(plan.clipOps)) {
          for (const op of plan.clipOps) {
            const targetIdx = typeof op.clipIndex === "number" ? op.clipIndex : -1;
            const targets = targetIdx >= 0 && targetIdx < next.length ? [targetIdx] : next.map((_, i) => i);
            for (const i of targets) {
              let clip = { ...next[i] };
              if (op.filterPreset) clip.filterPreset = op.filterPreset;
              if (op.motionPreset) clip.motionPreset = op.motionPreset;
              if (op.transition) clip.transition = op.transition;
              if (typeof op.speed === "number") clip.speed = Math.max(0.25, Math.min(4, op.speed));
              if (typeof op.overlayText === "string") clip.overlayText = op.overlayText;
              const trimStart = typeof op.trimStart === "number" ? op.trimStart : clip.trimStart;
              const trimEnd = typeof op.trimEnd === "number" ? op.trimEnd : clip.trimEnd;
              clip = clampClipTrim(clip, trimStart, trimEnd);
              next[i] = clip;
            }
          }
        }

        if (plan.overlayTitle && next[0]) {
          next[0] = { ...next[0], overlayText: plan.overlayTitle };
        }

        if (plan.beatSync) {
          next = alignClipsToBeats(next, state.beats, state.bpm);
        }

        const nextCaptions: TimedCaptionCue[] | undefined = Array.isArray(plan.captions)
          ? plan.captions.map((c, idx) => ({
              id: `ai-cap-${idx + 1}`,
              start: Number(c.start || 0),
              end: Number(c.end || 2),
              text: String(c.text || ""),
            })).filter((c) => c.text)
          : undefined;

        const summary =
          plan.summary ||
          `AI Director updated ${next.length} clip(s)${plan.beatSync ? ` synced at ${state.bpm} BPM` : ""}.`;

        set({
          historyPast: pushUndoSnapshot(state.historyPast, state.clips),
          historyFuture: [],
          clips: next,
          selectedId: next[0]?.id ?? null,
          ...(plan.aspectRatio ? { aspectRatio: plan.aspectRatio } : {}),
          ...(nextCaptions ? { captions: nextCaptions } : {}),
          lastAutoEditSummary: summary,
        });

        return summary;
      },

      clearAutoEditSummary: () => set({ lastAutoEditSummary: "" }),
    }),
    {
      name: "jarvis-video-timeline",
      version: 2,
      migrate: (persisted) => {
        const p = (persisted ?? {}) as Partial<VideoStoreState>;
        const cleanClips = Array.isArray(p.clips)
          ? p.clips.map((c) => (c.src?.startsWith("blob:") ? { ...c, src: "" } : c))
          : [];
        const aspectRatio: AspectRatio =
          p.aspectRatio === "9:16" || p.aspectRatio === "1:1" ? p.aspectRatio : "16:9";
        return {
          clips: cleanClips,
          selectedId: typeof p.selectedId === "string" ? p.selectedId : null,
          aspectRatio,
          timelineZoom: typeof p.timelineZoom === "number" ? p.timelineZoom : 1,
          captions: Array.isArray(p.captions) ? p.captions : [],
        };
      },
      partialize: (s) => ({
        clips: s.clips.map((c) => (c.src?.startsWith("blob:") ? { ...c, src: "" } : c)),
        selectedId: s.selectedId,
        aspectRatio: s.aspectRatio,
        timelineZoom: s.timelineZoom,
        captions: s.captions,
      }),
    },
  ),
);
