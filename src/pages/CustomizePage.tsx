import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Download,
  Minimize2,
  Palette,
  RotateCcw,
  Sliders,
  Upload,
  Volume2,
} from "lucide-react";
import { agentApi } from "@/lib/agentApi";
import { getTtsPrefs, setTtsPrefs } from "@/lib/agentService";
import { JARVIS_THEMES, type ThemeCategory } from "@/lib/themes";
import { speak } from "@/lib/voiceEngine";
import { useHudStore, useLifeStore, useUiStore } from "@/store";
import type { CloseBehavior, HudWidgetId } from "@/store/hudStore";
import { cn } from "@/lib/cn";

const WIDGET_LABELS: Record<HudWidgetId, string> = {
  core: "3D JARVIS Core Visualizer",
  schedule: "Upcoming Schedule & Routines",
  memories: "Pinned Personal Memories",
  smarthome: "Smart Home Quick Controls",
  media: "Media & Video Queue",
};

const ALL_WIDGETS: HudWidgetId[] = ["core", "schedule", "memories", "smarthome", "media"];

export default function CustomizePage() {
  const themeId = useHudStore((s) => s.themeId);
  const customAccent = useHudStore((s) => s.customAccent);
  const borderRadius = useHudStore((s) => s.borderRadius);
  const coreWidthPx = useHudStore((s) => s.coreWidthPx);
  const dockWidthPx = useHudStore((s) => s.dockWidthPx);
  const hudScale = useHudStore((s) => s.hudScale);
  const hudGrid = useHudStore((s) => s.hudGrid);
  const autoSwitchTabs = useHudStore((s) => s.autoSwitchTabs);
  const closeBehavior = useHudStore((s) => s.closeBehavior);
  const visualizerAbilities = useHudStore((s) => s.visualizerAbilities);
  const visibleWidgets = useHudStore((s) => s.visibleWidgets);
  const persona = useHudStore((s) => s.persona);

  const setThemeId = useHudStore((s) => s.setThemeId);
  const setCustomAccent = useHudStore((s) => s.setCustomAccent);
  const setBorderRadius = useHudStore((s) => s.setBorderRadius);
  const setCoreWidthPx = useHudStore((s) => s.setCoreWidthPx);
  const setDockWidthPx = useHudStore((s) => s.setDockWidthPx);
  const setHudScale = useHudStore((s) => s.setHudScale);
  const setHudGrid = useHudStore((s) => s.setHudGrid);
  const setAutoSwitchTabs = useHudStore((s) => s.setAutoSwitchTabs);
  const setCloseBehavior = useHudStore((s) => s.setCloseBehavior);
  const setVisualizerAbilities = useHudStore((s) => s.setVisualizerAbilities);
  const toggleWidget = useHudStore((s) => s.toggleWidget);
  const moveWidget = useHudStore((s) => s.moveWidget);
  const updatePersona = useHudStore((s) => s.updatePersona);
  const syncFromServer = useHudStore((s) => s.syncFromServer);
  const resetHud = useHudStore((s) => s.resetHud);
  const setMinimizedToBlob = useUiStore((s) => s.setMinimizedToBlob);
  const refreshAll = useLifeStore((s) => s.refreshAll);

  const [category, setCategory] = useState<"All" | ThemeCategory>("All");
  const [tts, setTts] = useState(() => getTtsPrefs());
  const [confirmDangerous, setConfirmDangerous] = useState(true);
  const [bundleMsg, setBundleMsg] = useState("");
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void agentApi
      .getSettings()
      .then((s) => setConfirmDangerous(s.confirmDangerousTools))
      .catch(() => undefined);
  }, []);

  const filteredThemes = useMemo(
    () => (category === "All" ? JARVIS_THEMES : JARVIS_THEMES.filter((t) => t.category === category)),
    [category],
  );

  const saveTts = (next: typeof tts) => {
    setTts(next);
    setTtsPrefs(next);
    void agentApi.saveSettings({
      ttsEnabled: next.enabled,
      ttsRate: next.rate,
      ttsPitch: next.pitch,
    });
  };

  const exportBundle = async () => {
    const bundle = await agentApi.exportShareBundle();
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "jarvis-profile.jarvis-bundle.json";
    a.click();
    URL.revokeObjectURL(url);
    setBundleMsg("Exported portable .jarvis-bundle.json for sharing (API keys excluded).");
  };

  const handleImportBundle = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const res = await agentApi.importShareBundle(parsed);
      await syncFromServer();
      await refreshAll();
      setBundleMsg(`Imported friend's JARVIS bundle (${res.pluginCount} extensions loaded).`);
    } catch (err) {
      setBundleMsg(err instanceof Error ? err.message : "Invalid bundle file.");
    }
    e.target.value = "";
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
        <div>
          <h1 className="font-display text-base font-semibold text-fg">Customize Themes, Layout & Persona</h1>
          <p className="text-xs text-fg-muted">
            40 handcrafted dark & daylight themes · Modular HUD widgets · Editable butler persona · Portable profile export
          </p>
        </div>
        <button
          type="button"
          onClick={resetHud}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-elevated px-3 py-1.5 text-xs text-fg-muted hover:text-fg"
        >
          <RotateCcw size={12} /> Reset Defaults
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5">
        {/* 40-Theme Visual Gallery */}
        <section className="hud-panel space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-1.5 font-display text-sm font-semibold text-fg">
              <Palette size={15} className="text-accent" /> 40 Theme Gallery
            </h2>
            <div className="flex flex-wrap gap-1">
              {(["All", "Stark HUD", "Studio Dark", "Tactical", "Daylight"] as const).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategory(cat)}
                  className={cn(
                    "rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
                    category === cat
                      ? "border-accent bg-accent text-background"
                      : "border-border bg-elevated text-fg-muted hover:text-fg",
                  )}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-5">
            {filteredThemes.map((t) => {
              const active = t.id === themeId;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setThemeId(t.id)}
                  style={{ background: t.surface, borderColor: active ? t.accent : t.border }}
                  className="flex flex-col gap-2 rounded-xl border p-2.5 text-left transition-transform hover:-translate-y-0.5"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      <span className="h-3 w-3 rounded-full" style={{ background: t.background, border: `1px solid ${t.border}` }} />
                      <span className="h-3 w-3 rounded-full" style={{ background: t.accent }} />
                      <span className="h-3 w-3 rounded-full" style={{ background: t.orbSecondary }} />
                    </div>
                    {active && <Check size={13} style={{ color: t.accent }} />}
                  </div>
                  <div>
                    <p className="truncate text-xs font-semibold" style={{ color: t.fg }}>
                      {t.name}
                    </p>
                    <p className="text-[10px]" style={{ color: t.fgMuted }}>
                      {t.category}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {/* HUD Geometry & Widget Dock */}
          <section className="hud-panel space-y-4 p-4 lg:col-span-5">
            <h2 className="font-display text-sm font-semibold text-fg">HUD Layout & Accent</h2>

            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-fg">Custom Accent Override</span>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={customAccent || "#22d3ee"}
                  onChange={(e) => setCustomAccent(e.target.value)}
                  className="h-7 w-10 cursor-pointer rounded border border-border bg-transparent"
                />
                {customAccent && (
                  <button
                    type="button"
                    onClick={() => setCustomAccent("")}
                    className="text-xs text-fg-muted hover:text-fg"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div>
              <div className="mb-1 flex justify-between text-xs text-fg">
                <span>Panel Corner Radius</span>
                <span className="font-mono tabular-nums">{borderRadius}px</span>
              </div>
              <input
                type="range"
                min={4}
                max={22}
                value={borderRadius}
                onChange={(e) => setBorderRadius(Number(e.target.value))}
                className="w-full accent-[var(--color-accent)]"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 border-t border-border pt-3 sm:grid-cols-2">
              <div>
                <div className="mb-1 flex justify-between text-xs text-fg">
                  <span>Core Stage Width</span>
                  <span className="font-mono tabular-nums">{coreWidthPx}px</span>
                </div>
                <input
                  type="range"
                  min={220}
                  max={440}
                  step={10}
                  value={coreWidthPx}
                  onChange={(e) => setCoreWidthPx(Number(e.target.value))}
                  className="w-full accent-[var(--color-accent)]"
                />
              </div>
              <div>
                <div className="mb-1 flex justify-between text-xs text-fg">
                  <span>Right Dock Width</span>
                  <span className="font-mono tabular-nums">{dockWidthPx}px</span>
                </div>
                <input
                  type="range"
                  min={240}
                  max={460}
                  step={10}
                  value={dockWidthPx}
                  onChange={(e) => setDockWidthPx(Number(e.target.value))}
                  className="w-full accent-[var(--color-accent)]"
                />
              </div>
              <div>
                <div className="mb-1 flex justify-between text-xs text-fg">
                  <span>Interface Scale</span>
                  <span className="font-mono tabular-nums">{hudScale.toFixed(2)}x</span>
                </div>
                <input
                  type="range"
                  min={0.88}
                  max={1.15}
                  step={0.01}
                  value={hudScale}
                  onChange={(e) => setHudScale(Number(e.target.value))}
                  className="w-full accent-[var(--color-accent)]"
                />
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => setMinimizedToBlob(true)}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-elevated px-3 py-1.5 text-xs font-medium text-fg hover:border-accent"
                >
                  <Minimize2 size={12} className="text-accent" /> Launch Floating Blob
                </button>
              </div>
            </div>

            <div className="space-y-2 border-t border-border pt-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
                HUD Dock Widgets & Order
              </p>
              {ALL_WIDGETS.map((wid) => {
                const enabled = visibleWidgets.includes(wid);
                return (
                  <div key={wid} className="hud-elevated flex items-center justify-between px-3 py-2 text-xs">
                    <label className="flex cursor-pointer items-center gap-2 text-fg">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={() => toggleWidget(wid)}
                        className="accent-[var(--color-accent)]"
                      />
                      {WIDGET_LABELS[wid]}
                    </label>
                    {enabled && (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => moveWidget(wid, -1)}
                          className="rounded p-1 text-fg-muted hover:text-fg"
                        >
                          <ArrowUp size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveWidget(wid, 1)}
                          className="rounded p-1 text-fg-muted hover:text-fg"
                        >
                          <ArrowDown size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Butler Persona & Voice */}
          <section className="hud-panel space-y-3 p-4 lg:col-span-7">
            <h2 className="font-display text-sm font-semibold text-fg">Butler Persona & Voice</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="text-xs text-fg-muted">
                Assistant Name
                <input
                  value={persona.assistantName}
                  onChange={(e) => updatePersona({ assistantName: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-border bg-elevated px-2.5 py-1.5 text-xs text-fg outline-none focus:border-accent"
                />
              </label>
              <label className="text-xs text-fg-muted">
                How JARVIS Calls You
                <input
                  value={persona.userTitle}
                  onChange={(e) => updatePersona({ userTitle: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-border bg-elevated px-2.5 py-1.5 text-xs text-fg outline-none focus:border-accent"
                />
              </label>
              <label className="text-xs text-fg-muted">
                Wit Level
                <select
                  value={persona.witLevel}
                  onChange={(e) =>
                    updatePersona({ witLevel: e.target.value as "dry" | "balanced" | "warm" })
                  }
                  className="mt-1 w-full rounded-lg border border-border bg-elevated px-2.5 py-1.5 text-xs text-fg outline-none"
                >
                  <option value="dry">Dry British Wit</option>
                  <option value="balanced">Balanced Butler</option>
                  <option value="warm">Warm & Conversational</option>
                </select>
              </label>
            </div>

            <label className="block text-xs text-fg-muted">
              Butler System Directives
              <textarea
                rows={3}
                value={persona.systemDirectives}
                onChange={(e) => updatePersona({ systemDirectives: e.target.value })}
                className="mt-1 w-full rounded-lg border border-border bg-elevated p-2.5 text-xs text-fg outline-none focus:border-accent"
              />
            </label>

            <div className="grid grid-cols-1 gap-3 border-t border-border pt-3 sm:grid-cols-2">
              <div>
                <div className="mb-1 flex justify-between text-xs text-fg-muted">
                  <span>Speech Rate</span>
                  <span className="font-mono tabular-nums text-fg">{tts.rate.toFixed(2)}x</span>
                </div>
                <input
                  type="range"
                  min={0.65}
                  max={1.45}
                  step={0.05}
                  value={tts.rate}
                  onChange={(e) => saveTts({ ...tts, rate: Number(e.target.value) })}
                  className="w-full accent-[var(--color-accent)]"
                />
              </div>
              <div>
                <div className="mb-1 flex justify-between text-xs text-fg-muted">
                  <span>Voice Pitch</span>
                  <span className="font-mono tabular-nums text-fg">{tts.pitch.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min={0.6}
                  max={1.25}
                  step={0.05}
                  value={tts.pitch}
                  onChange={(e) => saveTts({ ...tts, pitch: Number(e.target.value) })}
                  className="w-full accent-[var(--color-accent)]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 border-t border-border pt-3 text-xs text-fg sm:grid-cols-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={persona.proactiveMemory}
                  onChange={(e) => updatePersona({ proactiveMemory: e.target.checked })}
                  className="accent-[var(--color-accent)]"
                />
                Proactive Personal Memory
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={tts.enabled}
                  onChange={(e) => saveTts({ ...tts, enabled: e.target.checked })}
                  className="accent-[var(--color-accent)]"
                />
                Spoken Voice Replies (TTS)
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={autoSwitchTabs}
                  onChange={(e) => setAutoSwitchTabs(e.target.checked)}
                  className="accent-[var(--color-accent)]"
                />
                Auto-Switch Tabs on Task Request
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={hudGrid}
                  onChange={(e) => setHudGrid(e.target.checked)}
                  className="accent-[var(--color-accent)]"
                />
                Blueprint Grid Backdrop
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={visualizerAbilities}
                  onChange={(e) => setVisualizerAbilities(e.target.checked)}
                  className="accent-[var(--color-accent)]"
                />
                Core Visualizer Quick Abilities
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={confirmDangerous}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setConfirmDangerous(next);
                    void agentApi.saveSettings({ confirmDangerousTools: next });
                  }}
                  className="accent-[var(--color-accent)]"
                />
                Confirm High-Impact Desktop Tools
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
              <label className="flex items-center gap-2 text-fg-muted">
                <Sliders size={12} className="text-accent" />
                <span>Windows Close Action:</span>
                <select
                  value={closeBehavior}
                  onChange={(e) => setCloseBehavior(e.target.value as CloseBehavior)}
                  className="rounded-lg border border-border bg-elevated px-2.5 py-1 text-xs text-fg outline-none"
                >
                  <option value="blob">Minimize to System Tray & Floating Blob</option>
                  <option value="confirm">Keep Standard Window Close</option>
                </select>
              </label>
              <button
                type="button"
                onClick={() =>
                  void speak(`At your service, ${persona.userTitle || "Sir"}. All systems nominal.`, {
                    rate: tts.rate,
                    pitch: tts.pitch,
                  })
                }
                className="inline-flex items-center gap-1 text-accent hover:underline"
              >
                <Volume2 size={13} /> Test Butler Voice
              </button>
            </div>

            <div className="border-t border-border pt-3">
              <h3 className="font-display text-sm font-semibold text-fg">Share App Profile With Friends</h3>
              <p className="mt-0.5 text-xs text-fg-muted">
                Export your custom themes, HUD widgets, butler persona, notes, and installed skills into a lightweight JSON bundle.
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <input
                  ref={importRef}
                  type="file"
                  accept=".json"
                  onChange={(e) => void handleImportBundle(e)}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => void exportBundle()}
                  className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-xs font-medium text-background"
                >
                  <Download size={13} /> Export .jarvis-bundle.json
                </button>
                <button
                  type="button"
                  onClick={() => importRef.current?.click()}
                  className="flex items-center gap-1.5 rounded-lg border border-border bg-elevated px-3.5 py-2 text-xs font-medium text-fg hover:border-accent"
                >
                  <Upload size={13} /> Import Friend&apos;s Bundle
                </button>
              </div>
              {bundleMsg && <p className="mt-2 text-xs text-accent">{bundleMsg}</p>}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
