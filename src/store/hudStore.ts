import { create } from "zustand";
import { persist } from "zustand/middleware";
import { applyThemeToDocument, getThemeById } from "@/lib/themes";
import { agentApi, type HudConfig, type PersonaConfig } from "@/lib/agentApi";

export type HudWidgetId = "core" | "schedule" | "memories" | "smarthome" | "media";

export const DEFAULT_HUD: HudConfig = {
  themeId: "arc-titanium",
  customAccent: "",
  borderRadius: 14,
  compactMode: false,
  visibleWidgets: ["core", "schedule", "memories", "smarthome", "media"],
};

export const DEFAULT_PERSONA: PersonaConfig = {
  assistantName: "JARVIS",
  userTitle: "Sir",
  witLevel: "balanced",
  conciseness: "detailed",
  proactiveMemory: true,
  liveGraphsByDefault: true,
  systemDirectives:
    "You are JARVIS, a refined, hyper-competent British personal butler and engineering confidant. Anticipate needs, explain complex systems clearly with live visual diagrams when helpful, and remember personal details the user shares.",
};

export type CloseBehavior = "blob" | "confirm";

interface HudState extends HudConfig {
  persona: PersonaConfig;
  dockOpen: boolean;
  coreWidthPx: number;
  dockWidthPx: number;
  hudScale: number;
  hudGrid: boolean;
  autoSwitchTabs: boolean;
  closeBehavior: CloseBehavior;
  visualizerAbilities: boolean;
  blobPos: { x: number; y: number };
  setThemeId: (themeId: string) => void;
  setCustomAccent: (customAccent: string) => void;
  setBorderRadius: (borderRadius: number) => void;
  setCompactMode: (compactMode: boolean) => void;
  setCoreWidthPx: (w: number) => void;
  setDockWidthPx: (w: number) => void;
  setHudScale: (scale: number) => void;
  setHudGrid: (grid: boolean) => void;
  setAutoSwitchTabs: (enabled: boolean) => void;
  setCloseBehavior: (behavior: CloseBehavior) => void;
  setVisualizerAbilities: (enabled: boolean) => void;
  setBlobPos: (pos: { x: number; y: number }) => void;
  toggleWidget: (id: HudWidgetId) => void;
  moveWidget: (id: HudWidgetId, dir: -1 | 1) => void;
  setDockOpen: (open: boolean) => void;
  updatePersona: (patch: Partial<PersonaConfig>) => void;
  applyActiveTheme: () => void;
  syncFromServer: () => Promise<void>;
  persistToServer: () => Promise<void>;
  resetHud: () => void;
}

const clampWidth = (v: number, min = 220, max = 460) => Math.max(min, Math.min(max, Math.round(v)));

export const useHudStore = create<HudState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_HUD,
      persona: DEFAULT_PERSONA,
      dockOpen: true,
      coreWidthPx: 304,
      dockWidthPx: 300,
      hudScale: 1,
      hudGrid: true,
      autoSwitchTabs: true,
      closeBehavior: "blob",
      visualizerAbilities: true,
      blobPos: { x: 24, y: 24 },

      applyActiveTheme: () => {
        const s = get();
        const theme = getThemeById(s.themeId);
        applyThemeToDocument(theme, {
          customAccent: s.customAccent,
          borderRadius: s.borderRadius,
        });
        if (typeof document !== "undefined") {
          document.documentElement.style.fontSize = `${Math.round(16 * s.hudScale)}px`;
        }
      },

      setThemeId: (themeId) => {
        set({ themeId });
        get().applyActiveTheme();
        void get().persistToServer();
      },

      setCustomAccent: (customAccent) => {
        set({ customAccent });
        get().applyActiveTheme();
        void get().persistToServer();
      },

      setBorderRadius: (borderRadius) => {
        set({ borderRadius });
        get().applyActiveTheme();
        void get().persistToServer();
      },

      setCompactMode: (compactMode) => {
        set({ compactMode });
        void get().persistToServer();
      },

      setCoreWidthPx: (w) => set({ coreWidthPx: clampWidth(w, 220, 440) }),
      setDockWidthPx: (w) => set({ dockWidthPx: clampWidth(w, 240, 460) }),
      setHudScale: (hudScale) => {
        const clamped = Math.max(0.88, Math.min(1.15, hudScale));
        set({ hudScale: clamped });
        get().applyActiveTheme();
      },
      setHudGrid: (hudGrid) => set({ hudGrid }),
      setAutoSwitchTabs: (autoSwitchTabs) => set({ autoSwitchTabs }),
      setCloseBehavior: (closeBehavior) => set({ closeBehavior }),
      setVisualizerAbilities: (visualizerAbilities) => set({ visualizerAbilities }),
      setBlobPos: (blobPos) => set({ blobPos }),

      toggleWidget: (id) => {
        const current = get().visibleWidgets;
        const next = current.includes(id)
          ? current.filter((w) => w !== id)
          : [...current, id];
        set({ visibleWidgets: next });
        void get().persistToServer();
      },

      moveWidget: (id, dir) => {
        const list = [...get().visibleWidgets];
        const idx = list.indexOf(id);
        if (idx === -1) return;
        const target = idx + dir;
        if (target < 0 || target >= list.length) return;
        [list[idx], list[target]] = [list[target], list[idx]];
        set({ visibleWidgets: list });
        void get().persistToServer();
      },

      setDockOpen: (dockOpen) => set({ dockOpen }),

      updatePersona: (patch) => {
        set((s) => ({ persona: { ...s.persona, ...patch } }));
        void get().persistToServer();
      },

      syncFromServer: async () => {
        try {
          const res = await agentApi.getHudPersona();
          set((s) => ({
            ...s,
            ...(res.hud || {}),
            persona: { ...s.persona, ...(res.persona || {}) },
          }));
          get().applyActiveTheme();
        } catch {
          get().applyActiveTheme();
        }
      },

      persistToServer: async () => {
        const s = get();
        try {
          await agentApi.saveHudPersona({
            hud: {
              themeId: s.themeId,
              customAccent: s.customAccent,
              borderRadius: s.borderRadius,
              compactMode: s.compactMode,
              visibleWidgets: s.visibleWidgets,
            },
            persona: s.persona,
          });
        } catch {
          /* localStorage already updated */
        }
      },

      resetHud: () => {
        set({
          ...DEFAULT_HUD,
          persona: DEFAULT_PERSONA,
          coreWidthPx: 280,
          dockWidthPx: 300,
          hudScale: 1,
          hudGrid: true,
          autoSwitchTabs: true,
          closeBehavior: "blob",
          visualizerAbilities: true,
          blobPos: { x: 24, y: 24 },
        });
        get().applyActiveTheme();
        void get().persistToServer();
      },
    }),
    {
      name: "jarvis-hud",
      version: 2,
      migrate: (persistedState) => {
        const raw = (persistedState ?? {}) as Partial<HudState>;
        return {
          themeId: typeof raw.themeId === "string" ? raw.themeId : DEFAULT_HUD.themeId,
          customAccent: typeof raw.customAccent === "string" ? raw.customAccent : DEFAULT_HUD.customAccent,
          borderRadius: typeof raw.borderRadius === "number" ? raw.borderRadius : DEFAULT_HUD.borderRadius,
          compactMode: typeof raw.compactMode === "boolean" ? raw.compactMode : DEFAULT_HUD.compactMode,
          visibleWidgets: Array.isArray(raw.visibleWidgets)
            ? raw.visibleWidgets
            : DEFAULT_HUD.visibleWidgets,
          persona: { ...DEFAULT_PERSONA, ...(raw.persona ?? {}) },
          dockOpen: typeof raw.dockOpen === "boolean" ? raw.dockOpen : true,
          coreWidthPx: typeof raw.coreWidthPx === "number" ? clampWidth(raw.coreWidthPx, 220, 440) : 280,
          dockWidthPx: typeof raw.dockWidthPx === "number" ? clampWidth(raw.dockWidthPx, 240, 460) : 300,
          hudScale: typeof raw.hudScale === "number" ? raw.hudScale : 1,
          hudGrid: typeof raw.hudGrid === "boolean" ? raw.hudGrid : true,
          autoSwitchTabs: typeof raw.autoSwitchTabs === "boolean" ? raw.autoSwitchTabs : true,
          closeBehavior: raw.closeBehavior === "confirm" ? "confirm" : "blob",
          visualizerAbilities: typeof raw.visualizerAbilities === "boolean" ? raw.visualizerAbilities : true,
          blobPos:
            raw.blobPos && typeof raw.blobPos.x === "number" && typeof raw.blobPos.y === "number"
              ? raw.blobPos
              : { x: 24, y: 24 },
        };
      },
      partialize: (s) => ({
        themeId: s.themeId,
        customAccent: s.customAccent,
        borderRadius: s.borderRadius,
        compactMode: s.compactMode,
        visibleWidgets: s.visibleWidgets,
        persona: s.persona,
        dockOpen: s.dockOpen,
        coreWidthPx: s.coreWidthPx,
        dockWidthPx: s.dockWidthPx,
        hudScale: s.hudScale,
        hudGrid: s.hudGrid,
        autoSwitchTabs: s.autoSwitchTabs,
        closeBehavior: s.closeBehavior,
        visualizerAbilities: s.visualizerAbilities,
        blobPos: s.blobPos,
      }),
    },
  ),
);
