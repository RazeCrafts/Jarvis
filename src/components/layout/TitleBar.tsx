import { Minimize2, Moon, ScanSearch, Sun } from "lucide-react";
import { QuickUtilitiesBar } from "@/components/layout/QuickUtilitiesBar";
import { cn } from "@/lib/cn";
import { useAgentStore, useHudStore, useUiStore } from "@/store";
import { getThemeById } from "@/lib/themes";
import { TABS } from "@/lib/tabs";

function ArcReactorIcon() {
  const ticks = Array.from({ length: 8 }, (_, i) => i * 45);
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9.5" stroke="var(--color-accent)" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="5.5" stroke="var(--color-accent)" strokeWidth="1.2" opacity="0.7" />
      <circle cx="12" cy="12" r="2.2" fill="var(--color-accent)" />
      {ticks.map((deg) => {
        const rad = ((deg + 90) * Math.PI) / 180;
        return (
          <line
            key={deg}
            x1={12 + 7.1 * Math.cos(rad)}
            y1={12 + 7.1 * Math.sin(rad)}
            x2={12 + 9.4 * Math.cos(rad)}
            y2={12 + 9.4 * Math.sin(rad)}
            stroke="var(--color-accent)"
            strokeWidth="1.1"
            opacity="0.75"
          />
        );
      })}
    </svg>
  );
}

export function TitleBar({ className }: { className?: string }) {
  const activeTab = useUiStore((s) => s.activeTab);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const setMinimizedToBlob = useUiStore((s) => s.setMinimizedToBlob);
  const setCircleToSearchOpen = useUiStore((s) => s.setCircleToSearchOpen);
  const assistantName = useHudStore((s) => s.persona.assistantName || "JARVIS");
  const themeId = useHudStore((s) => s.themeId);
  const setThemeId = useHudStore((s) => s.setThemeId);
  const isConnected = useAgentStore((s) => s.isConnected);

  const theme = getThemeById(themeId);
  const currentTab = TABS.find((t) => t.id === activeTab);

  const toggleDaylight = () => {
    setThemeId(theme.isDark ? "stark-atelier-light" : "arc-titanium");
  };

  return (
    <header
      className={cn(
        "relative z-30 flex h-11 shrink-0 items-center justify-between px-4",
        className,
      )}
    >
      {/* Left: Brand identity */}
      <button
        type="button"
        onClick={() => setActiveTab("home")}
        className="flex items-center gap-2 text-left"
      >
        <ArcReactorIcon />
        <span className="font-display text-sm font-semibold tracking-[0.1em] text-fg">
          {assistantName}
        </span>
      </button>

      {/* Center: Clean context label */}
      <div className="hidden items-center gap-2 text-xs text-fg-muted sm:flex">
        <span>{currentTab?.label || "Command HUD"}</span>
        <span aria-hidden>·</span>
        <span>{theme.name}</span>
      </div>

      {/* Right: Connection + Circle Screen + Quick Blob + Theme Toggle */}
      <div className="flex items-center gap-1.5">
        <span className="mr-1 hidden items-center gap-1.5 text-[11px] text-fg-muted md:inline-flex">
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              isConnected ? "bg-emerald-500" : "bg-fg-muted/40",
            )}
          />
          {isConnected ? "Online" : "Reconnecting"}
        </span>
        <QuickUtilitiesBar />
        <button
          type="button"
          onClick={() => setCircleToSearchOpen(true)}
          title="Circle part of the screen to analyze & search"
          className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-medium text-fg transition-colors hover:border-accent"
        >
          <ScanSearch size={13} className="text-accent" />
          <span className="hidden sm:inline">Circle</span>
        </button>
        <button
          type="button"
          onClick={() => setMinimizedToBlob(true)}
          title="Minimize full HUD into draggable quick-command blob"
          className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-medium text-fg transition-colors hover:border-accent"
        >
          <Minimize2 size={13} className="text-accent" />
          <span className="hidden sm:inline">Blob</span>
        </button>
        <button
          type="button"
          onClick={toggleDaylight}
          title={theme.isDark ? "Switch to Stark Daylight Lab theme" : "Switch to Arc Titanium HUD theme"}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-medium text-fg transition-colors hover:border-accent"
        >
          {theme.isDark ? <Sun size={13} /> : <Moon size={13} />}
          <span>{theme.isDark ? "Daylight" : "Dark HUD"}</span>
        </button>
      </div>
    </header>
  );
}
