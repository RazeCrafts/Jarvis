import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  BellRing,
  Calendar,
  CheckCircle2,
  Eye,
  Globe,
  LayoutGrid,
  PhoneCall,
  Pin,
  Play,
  Sliders,
  Sparkles,
  Trash2,
} from "lucide-react";
import JarvisOrb from "@/components/JarvisOrb";
import { ChatWindow } from "@/components/home/ChatWindow";
import { InputBar } from "@/components/home/InputBar";
import { OrbCustomizer } from "@/components/home/OrbCustomizer";
import { SessionBar } from "@/components/home/SessionBar";
import { LiveCallPanel } from "@/components/voice/LiveCallPanel";
import { agentApi } from "@/lib/agentApi";
import { agentService } from "@/lib/agentService";
import { searchMemories, sortUpcomingEvents } from "@/lib/memoryAndCalendar";
import { cn } from "@/lib/cn";
import { useChatStore, useHudStore, useLifeStore, useUiStore } from "@/store";
import type { LiveVisualSpec } from "@/types";

export default function HomePage() {
  const [customizerOpen, setCustomizerOpen] = useState(false);
  const [liveCallOpen, setLiveCallOpen] = useState(false);
  const [briefingOpen, setBriefingOpen] = useState(false);
  const [urlBarOpen, setUrlBarOpen] = useState(false);
  const [extractUrl, setExtractUrl] = useState("");
  const [extractFocus, setExtractFocus] = useState("");
  const [extractSaveNote, setExtractSaveNote] = useState(true);
  const [extracting, setExtracting] = useState(false);
  const [briefingData, setBriefingData] = useState<Awaited<ReturnType<typeof agentApi.getBriefing>> | null>(null);

  const visibleWidgets = useHudStore((s) => s.visibleWidgets);
  const dockOpen = useHudStore((s) => s.dockOpen);
  const setDockOpen = useHudStore((s) => s.setDockOpen);
  const coreWidthPx = useHudStore((s) => s.coreWidthPx);
  const dockWidthPx = useHudStore((s) => s.dockWidthPx);
  const setCoreWidthPx = useHudStore((s) => s.setCoreWidthPx);
  const setDockWidthPx = useHudStore((s) => s.setDockWidthPx);
  const assistantName = useHudStore((s) => s.persona.assistantName || "JARVIS");

  const dragStateRef = useRef<{ side: "core" | "dock"; startX: number; startW: number } | null>(null);

  const clearMessages = useChatStore((s) => s.clearMessages);
  const addMessage = useChatStore((s) => s.addMessage);
  const attachVisualToMessage = useChatStore((s) => s.attachVisualToMessage);
  const attachCitationsToMessage = useChatStore((s) => s.attachCitationsToMessage);
  const messagesCount = useChatStore((s) => s.messages.length);
  const isListening = useChatStore((s) => s.isListening);
  const isSpeaking = useChatStore((s) => s.isSpeaking);

  const memories = useLifeStore((s) => s.memories);
  const calendar = useLifeStore((s) => s.calendar);
  const mediaHistory = useLifeStore((s) => s.mediaHistory);
  const refreshAll = useLifeStore((s) => s.refreshAll);
  const refreshDomain = useLifeStore((s) => s.refreshDomain);

  const setActiveTab = useUiStore((s) => s.setActiveTab);

  useEffect(() => {
    void refreshAll();
    void agentApi.getBriefing().then(setBriefingData).catch(() => undefined);
    const onToggleLive = () => setLiveCallOpen((v) => !v);
    window.addEventListener("jarvis-toggle-live-call", onToggleLive);
    return () => window.removeEventListener("jarvis-toggle-live-call", onToggleLive);
  }, [refreshAll]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragStateRef.current) return;
      const dx = e.clientX - dragStateRef.current.startX;
      if (dragStateRef.current.side === "core") {
        setCoreWidthPx(dragStateRef.current.startW + dx);
      } else {
        setDockWidthPx(dragStateRef.current.startW - dx);
      }
    };
    const onUp = () => {
      dragStateRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [setCoreWidthPx, setDockWidthPx]);

  const upcomingEvents = useMemo(
    () => sortUpcomingEvents(calendar).filter((e) => !e.completed).slice(0, 4),
    [calendar],
  );
  const topMemories = useMemo(() => searchMemories(memories, "").slice(0, 4), [memories]);

  const showCore = visibleWidgets.includes("core");
  const dockWidgets = visibleWidgets.filter((w) => w !== "core");

  const completeEvent = async (id: string) => {
    await agentApi.updateCalendarEvent(id, { completed: true });
    await refreshDomain("calendar");
  };

  const openBriefing = async () => {
    const next = !briefingOpen;
    setBriefingOpen(next);
    if (next) {
      const res = await agentApi.getBriefing().catch(() => null);
      if (res) setBriefingData(res);
    }
  };

  const runUrlExtract = async () => {
    if (!extractUrl.trim() || extracting) return;
    setExtracting(true);
    try {
      const res = await agentApi.extractWebUrl({
        url: extractUrl.trim(),
        question: extractFocus.trim(),
        saveAsNote: extractSaveNote,
      });
      if (!res.ok) {
        addMessage("system", `⚠ ${res.error || "Could not extract URL"}`);
      } else {
        addMessage("user", `Extract insights from ${res.url}${extractFocus ? ` (${extractFocus})` : ""}`);
        const msgId = addMessage("assistant", res.summary, false);
        if (res.visual) {
          attachVisualToMessage(msgId, res.visual as unknown as LiveVisualSpec);
        }
        if (res.citations?.length) {
          attachCitationsToMessage(msgId, res.citations);
        }
        if (extractSaveNote) {
          void refreshDomain("notes");
        }
        setUrlBarOpen(false);
        setExtractUrl("");
        setExtractFocus("");
      }
    } finally {
      setExtracting(false);
    }
  };

  const coreStateLabel = isSpeaking
    ? "Speaking"
    : isListening
      ? "Listening"
      : "Standby";

  return (
    <div
      className="flex h-full min-h-0 flex-col lg:flex-row"
      style={
        {
          "--core-w": `${coreWidthPx}px`,
          "--dock-w": `${dockWidthPx}px`,
        } as CSSProperties
      }
    >
      {/* Left Core Visualizer Stage */}
      {showCore && (
        <aside className="flex shrink-0 flex-col border-b border-border bg-background/40 p-4 lg:w-[var(--core-w)] lg:border-b-0">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-display text-xs font-semibold uppercase tracking-[0.14em] text-fg">
                {assistantName} Core
              </p>
              <p className="text-[11px] text-fg-muted">{coreStateLabel}</p>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setLiveCallOpen((v) => !v)}
                title="Live Duplex Voice & Screen Co-Pilot"
                className={cn(
                  "flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors",
                  liveCallOpen
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-border text-fg-muted hover:border-accent hover:text-fg",
                )}
              >
                <PhoneCall size={12} /> Live
              </button>
              <button
                type="button"
                onClick={() => setCustomizerOpen((v) => !v)}
                title="Customize 3D Core Visualizer"
                className={cn(
                  "rounded-lg border border-border p-1.5 text-fg-muted transition-colors hover:border-accent hover:text-fg",
                  customizerOpen && "border-accent text-accent",
                )}
              >
                <Sliders size={14} />
              </button>
            </div>
          </div>

          <div className="relative my-2 h-44 w-full shrink-0 lg:h-56">
            <JarvisOrb />
          </div>

          {liveCallOpen && (
            <div className="mb-2.5">
              <LiveCallPanel onClose={() => setLiveCallOpen(false)} />
            </div>
          )}

          {customizerOpen && (
            <div className="mb-3 max-h-60 overflow-y-auto">
              <OrbCustomizer open={customizerOpen} onClose={() => setCustomizerOpen(false)} />
            </div>
          )}

          <div className="mt-auto grid grid-cols-2 gap-1.5 pt-2 text-[11px]">
            <button
              type="button"
              onClick={() =>
                agentService.send(
                  briefingData?.briefing.suggestedPrompt ||
                    "Give me a concise briefing of my schedule and explain our priorities with a live chart.",
                )
              }
              className="hud-elevated px-2.5 py-2 text-left font-medium text-fg transition-colors hover:border-accent"
            >
              Daily Briefing
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("workspace")}
              className="hud-elevated px-2.5 py-2 text-left font-medium text-fg transition-colors hover:border-accent"
            >
              Open Workshop
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("video")}
              className="hud-elevated px-2.5 py-2 text-left font-medium text-fg transition-colors hover:border-accent"
            >
              Video Studio
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("media")}
              className="hud-elevated px-2.5 py-2 text-left font-medium text-fg transition-colors hover:border-accent"
            >
              Movies &amp; Music
            </button>
          </div>
        </aside>
      )}

      {showCore && (
        <div
          role="separator"
          aria-orientation="vertical"
          title="Drag to resize JARVIS Core column"
          onPointerDown={(e) => {
            dragStateRef.current = { side: "core", startX: e.clientX, startW: coreWidthPx };
          }}
          className="hidden w-1.5 shrink-0 cursor-col-resize border-l border-border bg-transparent transition-colors hover:bg-accent/50 lg:block"
        />
      )}

      {/* Center Command Conversation & Live Graphs */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-2.5">
          <div className="flex items-center gap-2">
            <h1 className="font-display text-sm font-semibold text-fg">Command HUD</h1>
            <span className="hidden text-xs text-fg-muted sm:inline">
              Live visuals · Search · Screen Vision · Personal Butler
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void openBriefing()}
              className={cn(
                "flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors",
                briefingOpen
                  ? "border-accent bg-elevated text-accent"
                  : "border-border text-fg-muted hover:text-fg",
              )}
            >
              <BellRing size={12} /> Briefing
            </button>
            <button
              type="button"
              onClick={() => setUrlBarOpen((v) => !v)}
              className={cn(
                "flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors",
                urlBarOpen
                  ? "border-accent bg-elevated text-accent"
                  : "border-border text-fg-muted hover:text-fg",
              )}
            >
              <Globe size={12} /> Read URL
            </button>
            {messagesCount > 0 && (
              <button
                type="button"
                onClick={() => clearMessages()}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-fg-muted transition-colors hover:bg-elevated hover:text-fg"
              >
                <Trash2 size={12} /> Clear
              </button>
            )}
            <button
              type="button"
              onClick={() => setDockOpen(!dockOpen)}
              className={cn(
                "hidden items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors lg:inline-flex",
                dockOpen
                  ? "border-accent/50 bg-elevated text-accent"
                  : "border-border text-fg-muted hover:text-fg",
              )}
            >
              <LayoutGrid size={12} /> HUD Dock
            </button>
          </div>
        </div>

        <SessionBar />

        {/* Proactive Butler Briefing Drawer */}
        {briefingOpen && briefingData && (
          <div className="border-b border-border bg-elevated/80 px-5 py-3">
            <div className="mx-auto flex max-w-3xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-fg">
                  <Sparkles size={13} className="text-accent" /> {briefingData.briefing.headline}
                </p>
                {briefingData.briefing.alerts.length > 0 && (
                  <p className="text-[11px] text-fg-muted">
                    {briefingData.briefing.alerts.join(" · ")}
                  </p>
                )}
                {briefingData.triggeredAutomations.length > 0 && (
                  <p className="text-[11px] text-accent">
                    Active Automation: {briefingData.triggeredAutomations[0].message}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setBriefingOpen(false);
                  agentService.send(briefingData.briefing.suggestedPrompt);
                }}
                className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-background"
              >
                Visual Briefing
              </button>
            </div>
          </div>
        )}

        {/* Active Web URL Extractor Bar */}
        {urlBarOpen && (
          <div className="border-b border-border bg-elevated/80 px-5 py-2.5">
            <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2">
              <input
                value={extractUrl}
                onChange={(e) => setExtractUrl(e.target.value)}
                placeholder="https://example.com/article-or-docs"
                className="min-w-48 flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-fg outline-none focus:border-accent"
              />
              <input
                value={extractFocus}
                onChange={(e) => setExtractFocus(e.target.value)}
                placeholder="Focus (optional)"
                className="w-40 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-fg outline-none focus:border-accent"
              />
              <label className="flex items-center gap-1 text-[11px] text-fg-muted">
                <input
                  type="checkbox"
                  checked={extractSaveNote}
                  onChange={(e) => setExtractSaveNote(e.target.checked)}
                  className="accent-[var(--color-accent)]"
                />
                Save Note
              </label>
              <button
                type="button"
                disabled={extracting || !extractUrl.trim()}
                onClick={() => void runUrlExtract()}
                className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-background disabled:opacity-50"
              >
                {extracting ? "Reading…" : "Extract"}
              </button>
            </div>
          </div>
        )}

        <ChatWindow onQuickPrompt={(p) => agentService.send(p)} />
        <InputBar onSend={(text, model, atts) => agentService.send(text, model, atts)} />
      </section>

      {/* Right Customizable HUD Widget Dock */}
      {dockOpen && dockWidgets.length > 0 && (
        <>
          <div
            role="separator"
            aria-orientation="vertical"
            title="Drag to resize HUD Dock"
            onPointerDown={(e) => {
              dragStateRef.current = { side: "dock", startX: e.clientX, startW: dockWidthPx };
            }}
            className="hidden w-1.5 shrink-0 cursor-col-resize border-l border-border bg-transparent transition-colors hover:bg-accent/50 lg:block"
          />
          <aside className="hidden shrink-0 flex-col gap-3 overflow-y-auto bg-background/30 p-3.5 lg:flex lg:w-[var(--dock-w)]">
          {dockWidgets.map((widgetId) => {
            if (widgetId === "schedule") {
              return (
                <div key="schedule" className="hud-panel p-3.5">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-fg">
                      <Calendar size={13} className="text-accent" /> Upcoming Schedule
                    </span>
                    <button
                      type="button"
                      onClick={() => setActiveTab("memory")}
                      className="text-[11px] text-accent hover:underline"
                    >
                      View all
                    </button>
                  </div>
                  {upcomingEvents.length === 0 ? (
                    <p className="text-xs text-fg-muted">No pending events today.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {upcomingEvents.map((ev) => (
                        <div
                          key={ev.id}
                          className="hud-elevated flex items-start justify-between gap-2 px-2.5 py-2 text-xs"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-medium text-fg">{ev.title}</p>
                            <p className="font-mono text-[10px] text-fg-muted tabular-nums">
                              {new Date(ev.startISO).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                              {ev.location ? ` · ${ev.location}` : ""}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void completeEvent(ev.id)}
                            title="Mark complete"
                            className="text-fg-muted transition-colors hover:text-accent"
                          >
                            <CheckCircle2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            }

            if (widgetId === "memories") {
              return (
                <div key="memories" className="hud-panel p-3.5">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-fg">
                      <Pin size={13} className="text-accent" /> Personal Memory
                    </span>
                    <button
                      type="button"
                      onClick={() => setActiveTab("memory")}
                      className="text-[11px] text-accent hover:underline"
                    >
                      Manage
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    {topMemories.map((m) => (
                      <div key={m.id} className="hud-elevated px-2.5 py-2 text-xs">
                        <p className="font-medium text-fg">{m.title}</p>
                        <p className="mt-0.5 line-clamp-2 text-[11px] text-fg-muted">{m.content}</p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            }

            if (widgetId === "media") {
              return (
                <div key="media" className="hud-panel p-3.5">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-fg">
                      <Play size={13} className="text-accent" /> Media Queue
                    </span>
                    <button
                      type="button"
                      onClick={() => setActiveTab("media")}
                      className="text-[11px] text-accent hover:underline"
                    >
                      Open Hub
                    </button>
                  </div>
                  {mediaHistory.length === 0 ? (
                    <p className="text-xs text-fg-muted">Ask JARVIS to find a video or song.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {mediaHistory.slice(0, 2).map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setActiveTab("media")}
                          className="hud-elevated flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left text-xs transition-colors hover:border-accent"
                        >
                          <span className="min-w-0 truncate font-medium text-fg">{item.title}</span>
                          <Eye size={12} className="shrink-0 text-accent" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            }

            return null;
          })}
          </aside>
        </>
      )}
    </div>
  );
}
