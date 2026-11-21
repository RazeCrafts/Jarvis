import { create } from "zustand";
import { persist } from "zustand/middleware";
import { applyThemeToDocument, getThemeById } from "@/lib/themes";
import { agentApi, type HudConfig, type PersonaConfig } from "@/lib/agentApi";

export type HudWidgetId = "core" | "schedule" | "memories" | "media";
export type ResponseMode = "butler" | "deep";

export interface GlassFogConfig {
  enabled: boolean;
  panelBlurPx: number;
  panelOpacity: number;
  buttonBlurPx: number;
  buttonOpacity: number;
  galaxyBlurPx: number;
  galaxyOpacity: number;
  blobOpacity: number;
}

export const DEFAULT_GLASS_FOG: GlassFogConfig = {
  enabled: false,
  panelBlurPx: 14,
  panelOpacity: 0.84,
  buttonBlurPx: 8,
  buttonOpacity: 0.9,
  galaxyBlurPx: 12,
  galaxyOpacity: 0.82,
  blobOpacity: 0.94,
};

export const DEFAULT_HUD: HudConfig = {
  themeId: "golden-hologram",
  customAccent: "",
  borderRadius: 14,
  compactMode: false,
  visibleWidgets: ["core", "schedule", "memories", "media"],
};

export const DEFAULT_PERSONA: PersonaConfig = {
  assistantName: "JARVIS",
  userTitle: "Sir",
  witLevel: "balanced",
  conciseness: "brief",
  proactiveMemory: true,
  liveGraphsByDefault: true,
  systemDirectives:
    "You are JARVIS, a refined, hyper-competent British personal butler and autonomous engineering workstation. Keep Butler Mode replies crisp and conversational; expand deeply in Full Text Agent Mode.",
};

export type CloseBehavior = "blob" | "confirm";
export type HudSectionId = "core" | "chat" | "dock";

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
  responseMode: ResponseMode;
  layoutEditMode: boolean;
  sectionOrder: HudSectionId[];
  glassFog: GlassFogConfig;
  blobAvatarUrl: string;
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
  setResponseMode: (mode: ResponseMode) => void;
  setLayoutEditMode: (editing: boolean) => void;
  setSectionOrder: (order: HudSectionId[]) => void;
  updateGlassFog: (patch: Partial<GlassFogConfig>) => void;
  setBlobAvatarUrl: (url: string) => void;
  toggleWidget: (id: HudWidgetId) => void;
  moveWidget: (id: HudWidgetId, dir: -1 | 1) => void;
  reorderWidgets: (next: HudWidgetId[]) => void;
  setDockOpen: (open: boolean) => void;
  updatePersona: (patch: Partial<PersonaConfig>) => void;
  applyActiveTheme: () => void;
  syncFromServer: () => Promise<void>;
  persistToServer: () => Promise<void>;
  resetHud: () => void;
}

const clampWidth = (v: number, min = 220, max = 460) => Math.max(min, Math.min(max, Math.round(v)));

function applyGlassFogCss(fog: GlassFogConfig): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!fog.enabled) {
    root.style.setProperty("--jarvis-panel-blur", "0px");
    root.style.setProperty("--jarvis-panel-opacity", "1");
    root.style.setProperty("--jarvis-btn-blur", "0px");
    root.style.setProperty("--jarvis-btn-opacity", "1");
    return;
  }
  root.style.setProperty("--jarvis-panel-blur", `${fog.panelBlurPx}px`);
  root.style.setProperty("--jarvis-panel-opacity", String(fog.panelOpacity));
  root.style.setProperty("--jarvis-btn-blur", `${fog.buttonBlurPx}px`);
  root.style.setProperty("--jarvis-btn-opacity", String(fog.buttonOpacity));
}

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
      responseMode: "butler",
      layoutEditMode: false,
      sectionOrder: ["core", "chat", "dock"],
      glassFog: DEFAULT_GLASS_FOG,
      blobAvatarUrl: "",

      applyActiveTheme: () => {
        const s = get();
        const theme = getThemeById(s.themeId);
        applyThemeToDocument(theme, {
          customAccent: s.customAccent,
          borderRadius: s.borderRadius,
        });
        applyGlassFogCss(s.glassFog);
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
      setResponseMode: (responseMode) => {
        set((s) => ({
          responseMode,
          persona: {
            ...s.persona,
            conciseness: responseMode === "butler" ? "brief" : "detailed",
          },
        }));
        void get().persistToServer();
      },
      setLayoutEditMode: (layoutEditMode) => set({ layoutEditMode }),
      setSectionOrder: (sectionOrder) => set({ sectionOrder }),
      updateGlassFog: (patch) => {
        set((s) => {
          const next = { ...s.glassFog, ...patch };
          applyGlassFogCss(next);
          return { glassFog: next };
        });
      },
      setBlobAvatarUrl: (blobAvatarUrl) => set({ blobAvatarUrl }),

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

      reorderWidgets: (next) => {
        set({ visibleWidgets: next });
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
          const incomingWidgets = Array.isArray(res.hud?.visibleWidgets)
            ? res.hud.visibleWidgets.filter((w) => w !== "smarthome")
            : undefined;
          set((s) => ({
            ...s,
            ...(res.hud || {}),
            ...(incomingWidgets ? { visibleWidgets: incomingWidgets } : {}),
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
          coreWidthPx: 304,
          dockWidthPx: 300,
          hudScale: 1,
          hudGrid: true,
          autoSwitchTabs: true,
          closeBehavior: "blob",
          visualizerAbilities: true,
          blobPos: { x: 24, y: 24 },
          responseMode: "butler",
          layoutEditMode: false,
          sectionOrder: ["core", "chat", "dock"],
          glassFog: DEFAULT_GLASS_FOG,
          blobAvatarUrl: "",
        });
        get().applyActiveTheme();
        void get().persistToServer();
      },
    }),
    {
      name: "jarvis-hud",
      version: 3,
      migrate: (persistedState) => {
        const raw = (persistedState ?? {}) as Partial<HudState>;
        const rawWidgets = Array.isArray(raw.visibleWidgets)
          ? raw.visibleWidgets.filter((w) => w !== "smarthome")
          : DEFAULT_HUD.visibleWidgets;
        return {
          themeId: typeof raw.themeId === "string" && raw.themeId !== "arc-titanium" ? raw.themeId : DEFAULT_HUD.themeId,
          customAccent: typeof raw.customAccent === "string" ? raw.customAccent : DEFAULT_HUD.customAccent,
          borderRadius: typeof raw.borderRadius === "number" ? raw.borderRadius : DEFAULT_HUD.borderRadius,
          compactMode: typeof raw.compactMode === "boolean" ? raw.compactMode : DEFAULT_HUD.compactMode,
          visibleWidgets: rawWidgets,
          persona: { ...DEFAULT_PERSONA, ...(raw.persona ?? {}) },
          dockOpen: typeof raw.dockOpen === "boolean" ? raw.dockOpen : true,
          coreWidthPx: typeof raw.coreWidthPx === "number" ? clampWidth(raw.coreWidthPx, 220, 440) : 304,
          dockWidthPx: typeof raw.dockWidthPx === "number" ? clampWidth(raw.dockWidthPx, 240, 460) : 300,
          hudScale: typeof raw.hudScale === "number" ? raw.hudScale : 1,
          hudGrid: typeof raw.hudGrid === "boolean" ? raw.hudGrid : true,
          autoSwitchTabs: typeof raw.autoSwitchTabs === "boolean" ? raw.autoSwitchTabs : true,
          closeBehavior: raw.closeBehavior === "confirm" ? ("confirm" as CloseBehavior) : ("blob" as CloseBehavior),
          visualizerAbilities: typeof raw.visualizerAbilities === "boolean" ? raw.visualizerAbilities : true,
          blobPos:
            raw.blobPos && typeof raw.blobPos.x === "number" && typeof raw.blobPos.y === "number"
              ? raw.blobPos
              : { x: 24, y: 24 },
          responseMode: raw.responseMode === "deep" ? ("deep" as ResponseMode) : ("butler" as ResponseMode),
          layoutEditMode: false,
          sectionOrder: (Array.isArray(raw.sectionOrder)
            ? raw.sectionOrder.filter((s): s is HudSectionId => s === "core" || s === "chat" || s === "dock")
            : ["core", "chat", "dock"]) as HudSectionId[],
          glassFog: { ...DEFAULT_GLASS_FOG, ...(raw.glassFog ?? {}) },
          blobAvatarUrl: typeof raw.blobAvatarUrl === "string" ? raw.blobAvatarUrl : "",
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
        responseMode: s.responseMode,
        sectionOrder: s.sectionOrder,
        glassFog: s.glassFog,
        blobAvatarUrl: s.blobAvatarUrl,
      }),
    },
  ),
);
