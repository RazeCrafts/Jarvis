import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AudioControlState {
  masterVolume: number; // 0..1
  voiceVolume: number;  // 0..1
  mediaVolume: number;  // 0..2 (VLC preamp boost)
  muted: boolean;
  setMasterVolume: (v: number) => void;
  setVoiceVolume: (v: number) => void;
  setMediaVolume: (v: number) => void;
  setMuted: (muted: boolean) => void;
  toggleMute: () => void;
  effectiveVoiceVolume: () => number;
  effectiveMediaVolume: () => number;
}

export const useAudioControlStore = create<AudioControlState>()(
  persist(
    (set, get) => ({
      masterVolume: 0.9,
      voiceVolume: 1.0,
      mediaVolume: 1.0,
      muted: false,

      setMasterVolume: (v) => set({ masterVolume: Math.max(0, Math.min(1, v)) }),
      setVoiceVolume: (v) => set({ voiceVolume: Math.max(0, Math.min(1, v)) }),
      setMediaVolume: (v) => set({ mediaVolume: Math.max(0, Math.min(2, v)) }),
      setMuted: (muted) => set({ muted }),
      toggleMute: () => set((s) => ({ muted: !s.muted })),

      effectiveVoiceVolume: () => {
        const s = get();
        if (s.muted) return 0;
        return Math.max(0, Math.min(1, s.masterVolume * s.voiceVolume));
      },

      effectiveMediaVolume: () => {
        const s = get();
        if (s.muted) return 0;
        return Math.max(0, Math.min(2, s.masterVolume * s.mediaVolume));
      },
    }),
    {
      name: "jarvis-audio-controls-v1",
      partialize: (s) => ({
        masterVolume: s.masterVolume,
        voiceVolume: s.voiceVolume,
        mediaVolume: s.mediaVolume,
        muted: s.muted,
      }),
    },
  ),
);
