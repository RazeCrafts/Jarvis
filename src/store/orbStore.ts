import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ORB_STYLES, type OrbStyleId } from "@/components/orb/styles";

interface OrbState {
  /** Which orb visual is active. */
  style: OrbStyleId;
  /** Show the tilted orbital ring. */
  ring: boolean;
  /** Multiplies displacement and glow energy. 0.5 – 1.5 */
  intensity: number;
  /** Multiplies animation speed. 0.5 – 1.5 */
  speed: number;
  setStyle: (style: OrbStyleId) => void;
  setRing: (ring: boolean) => void;
  setIntensity: (intensity: number) => void;
  setSpeed: (speed: number) => void;
  reset: () => void;
}

const DEFAULTS = { style: "swirl" as OrbStyleId, ring: true, intensity: 1, speed: 1 };

export const useOrbStore = create<OrbState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      setStyle: (style) => set({ style }),
      setRing: (ring) => set({ ring }),
      setIntensity: (intensity) => set({ intensity: clamp(intensity) }),
      setSpeed: (speed) => set({ speed: clamp(speed) }),
      reset: () => set({ ...DEFAULTS }),
    }),
    {
      name: "jarvis-orb",
      // Only persist the visual choices, not the setters.
      partialize: (s) => ({ style: s.style, ring: s.ring, intensity: s.intensity, speed: s.speed }),
      // Guard against a persisted style id that no longer exists.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Pick<OrbState, "style" | "ring" | "intensity" | "speed">>;
        const style = ORB_STYLES.some((s) => s.id === p.style) ? p.style! : DEFAULTS.style;
        return { ...current, ...p, style };
      },
    },
  ),
);

function clamp(v: number): number {
  if (Number.isNaN(v)) return 1;
  return Math.min(1.5, Math.max(0.5, v));
}
