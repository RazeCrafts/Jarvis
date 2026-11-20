import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ORB_STYLES, type OrbStyleId } from "@/components/orb/styles";

interface OrbState {
  style: OrbStyleId;
  ring: boolean;
  reticle: boolean;
  particleDensity: number;
  intensity: number;
  speed: number;
  setStyle: (style: OrbStyleId) => void;
  setRing: (ring: boolean) => void;
  setReticle: (reticle: boolean) => void;
  setParticleDensity: (density: number) => void;
  setIntensity: (intensity: number) => void;
  setSpeed: (speed: number) => void;
  reset: () => void;
}

const DEFAULTS = {
  style: "reactor" as OrbStyleId,
  ring: true,
  reticle: true,
  particleDensity: 1,
  intensity: 1.1,
  speed: 1,
};

export const useOrbStore = create<OrbState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      setStyle: (style) => set({ style }),
      setRing: (ring) => set({ ring }),
      setReticle: (reticle) => set({ reticle }),
      setParticleDensity: (particleDensity) => set({ particleDensity: clamp(particleDensity) }),
      setIntensity: (intensity) => set({ intensity: clamp(intensity) }),
      setSpeed: (speed) => set({ speed: clamp(speed) }),
      reset: () => set({ ...DEFAULTS }),
    }),
    {
      name: "jarvis-orb",
      version: 2,
      migrate: (persistedState) => {
        const p = (persistedState ?? {}) as Partial<OrbState>;
        const style = ORB_STYLES.some((s) => s.id === p.style) ? p.style! : DEFAULTS.style;
        return {
          style,
          ring: typeof p.ring === "boolean" ? p.ring : DEFAULTS.ring,
          reticle: typeof p.reticle === "boolean" ? p.reticle : DEFAULTS.reticle,
          particleDensity:
            typeof p.particleDensity === "number" ? clamp(p.particleDensity) : DEFAULTS.particleDensity,
          intensity: typeof p.intensity === "number" ? clamp(p.intensity) : DEFAULTS.intensity,
          speed: typeof p.speed === "number" ? clamp(p.speed) : DEFAULTS.speed,
        };
      },
      partialize: (s) => ({
        style: s.style,
        ring: s.ring,
        reticle: s.reticle,
        particleDensity: s.particleDensity,
        intensity: s.intensity,
        speed: s.speed,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<OrbState>;
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
