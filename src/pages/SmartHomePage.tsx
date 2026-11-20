import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  Camera,
  ExternalLink,
  Home,
  Lightbulb,
  Lock,
  Music,
  Play,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Thermometer,
  Trash2,
  Unlock,
  Volume2,
} from "lucide-react";
import {
  agentApi,
  type AutomationRuleItem,
  type SecurityLogEntryItem,
} from "@/lib/agentApi";
import { useLifeStore } from "@/store";
import { cn } from "@/lib/cn";

export default function SmartHomePage() {
  const smartHome = useLifeStore((s) => s.smartHome);
  const mediaHistory = useLifeStore((s) => s.mediaHistory);
  const refreshDomain = useLifeStore((s) => s.refreshDomain);

  const [roomFilter, setRoomFilter] = useState("All");
  const [haUrl, setHaUrl] = useState("");
  const [haToken, setHaToken] = useState("");
  const [haMsg, setHaMsg] = useState("");
  const [mediaQuery, setMediaQuery] = useState("");
  const [mediaKind, setMediaKind] = useState<"video" | "music">("video");
  const [searchingMedia, setSearchingMedia] = useState(false);
  const [activeMediaUrl, setActiveMediaUrl] = useState<string>("");

  // Watchdog & Conditional Automations
  const [watchdogArmed, setWatchdogArmed] = useState(false);
  const [securityLog, setSecurityLog] = useState<SecurityLogEntryItem[]>([]);
  const [automations, setAutomations] = useState<AutomationRuleItem[]>([]);
  const [autoName, setAutoName] = useState("");
  const [autoTrigger, setAutoTrigger] =
    useState<AutomationRuleItem["triggerType"]>("meeting_approaching");
  const [autoAction, setAutoAction] = useState("");
  const [autoNotice, setAutoNotice] = useState("");

  const loadWatchdog = async () => {
    try {
      const res = await agentApi.getWatchdogState();
      setWatchdogArmed(res.watchdogArmed);
      setSecurityLog(res.securityLog);
      setAutomations(res.automations);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    void refreshDomain("smarthome");
    void refreshDomain("media");
    void loadWatchdog();
  }, [refreshDomain]);

  useEffect(() => {
    if (smartHome.homeAssistantUrl) setHaUrl(smartHome.homeAssistantUrl);
  }, [smartHome.homeAssistantUrl]);

  const activeTrack = useMemo(
    () => mediaHistory.find((m) => m.embedUrl && m.embedUrl === activeMediaUrl) ?? mediaHistory[0] ?? null,
    [mediaHistory, activeMediaUrl],
  );

  const rooms = useMemo(() => {
    const set = new Set<string>(["All"]);
    for (const d of smartHome.devices) set.add(d.room);
    return Array.from(set);
  }, [smartHome.devices]);

  const devices = useMemo(
    () =>
      roomFilter === "All"
        ? smartHome.devices
        : smartHome.devices.filter((d) => d.room === roomFilter),
    [smartHome.devices, roomFilter],
  );

  const toggleDevice = async (id: string, on: boolean) => {
    await agentApi.controlSmartDevice(id, { on: !on });
    await refreshDomain("smarthome");
  };

  const setLevel = async (id: string, level: number) => {
    await agentApi.controlSmartDevice(id, { level, on: level > 0 });
    await refreshDomain("smarthome");
  };

  const stepTemp = async (id: string, nextTemp: number) => {
    await agentApi.controlSmartDevice(id, { targetTemp: nextTemp, on: true });
    await refreshDomain("smarthome");
  };

  const runScene = async (id: string) => {
    await agentApi.activateSmartScene(id);
    await refreshDomain("smarthome");
  };

  const connectHa = async () => {
    const res = await agentApi.connectHomeAssistant(haUrl, haToken);
    setHaMsg(res.message);
    await refreshDomain("smarthome");
  };

  const toggleWatchdog = async () => {
    const res = await agentApi.toggleWatchdog(!watchdogArmed);
    setWatchdogArmed(res.watchdogArmed);
    setSecurityLog(res.securityLog);
    await refreshDomain("smarthome");
  };

  const simulateSensorPing = async () => {
    const res = await agentApi.logWatchdogEvent({
      source: "Front Porch Camera",
      message: watchdogArmed
        ? "Motion alert recorded while Watchdog Mode armed."
        : "Routine perimeter sweep completed clear.",
      severity: watchdogArmed ? "alert" : "info",
    });
    setSecurityLog(res.securityLog);
  };

  const addAutomation = async () => {
    if (!autoName.trim() || !autoAction.trim()) return;
    await agentApi.createAutomation({
      name: autoName.trim(),
      triggerType: autoTrigger,
      actionSummary: autoAction.trim(),
    });
    setAutoName("");
    setAutoAction("");
    await loadWatchdog();
  };

  const evaluateRules = async () => {
    const res = await agentApi.evaluateAutomations();
    setAutoNotice(
      res.triggered.length > 0
        ? `Triggered (${res.triggered.length}): ${res.triggered.map((t) => t.message).join(" | ")}`
        : "Evaluated all rules — no alert conditions currently active.",
    );
  };

  const runMediaSearch = async () => {
    if (!mediaQuery.trim()) return;
    setSearchingMedia(true);
    try {
      const res = await agentApi.searchMedia(mediaQuery, mediaKind);
      await refreshDomain("media");
      const firstEmbed = res.results[0]?.embedUrl;
      if (firstEmbed) setActiveMediaUrl(firstEmbed);
    } finally {
      setSearchingMedia(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
        <div>
          <h1 className="font-display text-base font-semibold text-fg">Smart Home, Watchdog & Media Hub</h1>
          <p className="text-xs text-fg-muted">
            Whole-home monitor · Away Watchdog & conditional automations · Video & music playback
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => void toggleWatchdog()}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              watchdogArmed
                ? "bg-amber-500 text-black"
                : "border border-border bg-elevated text-fg hover:border-accent",
            )}
          >
            {watchdogArmed ? <ShieldAlert size={13} /> : <ShieldCheck size={13} />}
            {watchdogArmed ? "Watchdog Armed" : "Arm Watchdog"}
          </button>
          {smartHome.scenes.map((scene) => (
            <button
              key={scene.id}
              type="button"
              onClick={() => void runScene(scene.id)}
              className="flex items-center gap-1 rounded-lg border border-border bg-elevated px-2.5 py-1.5 text-xs font-medium text-fg transition-colors hover:border-accent hover:text-accent"
            >
              <Sparkles size={12} /> {scene.name}
            </button>
          ))}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 lg:grid-cols-12">
        {/* Left: Rooms, Devices, Watchdog & Automations */}
        <div className="space-y-4 lg:col-span-7">
          <div className="flex flex-wrap gap-1.5">
            {rooms.map((room) => (
              <button
                key={room}
                type="button"
                onClick={() => setRoomFilter(room)}
                className={cn(
                  "rounded-lg border px-3 py-1 text-xs font-medium transition-colors",
                  roomFilter === room
                    ? "border-accent bg-accent text-background"
                    : "border-border bg-surface text-fg-muted hover:text-fg",
                )}
              >
                {room}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {devices.map((dev) => {
              const Icon =
                dev.type === "light"
                  ? Lightbulb
                  : dev.type === "climate"
                    ? Thermometer
                    : dev.type === "lock"
                      ? dev.on
                        ? Lock
                        : Unlock
                      : dev.type === "camera"
                        ? Camera
                        : dev.type === "speaker"
                          ? Volume2
                          : Home;

              return (
                <div key={dev.id} className="hud-panel flex flex-col justify-between gap-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span
                        className={cn(
                          "flex h-9 w-9 items-center justify-center rounded-lg border",
                          dev.on
                            ? "border-accent bg-elevated text-accent"
                            : "border-border bg-background text-fg-muted",
                        )}
                      >
                        <Icon size={17} />
                      </span>
                      <div>
                        <p className="text-xs font-semibold text-fg">{dev.name}</p>
                        <p className="text-[11px] text-fg-muted">
                          {dev.room} · {dev.statusText}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void toggleDevice(dev.id, dev.on)}
                      className={cn(
                        "rounded-lg px-2.5 py-1 text-xs font-medium transition-colors",
                        dev.on
                          ? "bg-accent text-background"
                          : "border border-border bg-elevated text-fg-muted hover:text-fg",
                      )}
                    >
                      {dev.type === "lock" ? (dev.on ? "Locked" : "Unlocked") : dev.on ? "On" : "Off"}
                    </button>
                  </div>

                  {(dev.type === "light" || dev.type === "speaker") && typeof dev.level === "number" && (
                    <div>
                      <div className="mb-1 flex justify-between text-[11px] text-fg-muted">
                        <span>{dev.type === "light" ? "Brightness" : "Volume"}</span>
                        <span className="font-mono tabular-nums">{dev.level}%</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={dev.level}
                        onChange={(e) => void setLevel(dev.id, Number(e.target.value))}
                        className="w-full accent-[var(--color-accent)]"
                      />
                    </div>
                  )}

                  {dev.type === "climate" && (
                    <div className="flex items-center justify-between rounded-lg border border-border bg-elevated px-3 py-2">
                      <span className="text-xs text-fg-muted">
                        Current <strong className="font-mono text-fg tabular-nums">{dev.currentTemp ?? 71}°F</strong>
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void stepTemp(dev.id, (dev.targetTemp ?? 70) - 1)}
                          className="rounded border border-border px-2 py-0.5 text-xs text-fg hover:border-accent"
                        >
                          -
                        </button>
                        <span className="font-mono text-xs font-semibold text-accent tabular-nums">
                          {dev.targetTemp ?? 70}°F
                        </span>
                        <button
                          type="button"
                          onClick={() => void stepTemp(dev.id, (dev.targetTemp ?? 70) + 1)}
                          className="rounded border border-border px-2 py-0.5 text-xs text-fg hover:border-accent"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Conditional Automations & Security Timeline */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="hud-panel space-y-2.5 p-4">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-fg-muted">
                  <Bell size={12} className="text-accent" /> Conditional Automations
                </h2>
                <button
                  type="button"
                  onClick={() => void evaluateRules()}
                  className="text-[11px] font-medium text-accent hover:underline"
                >
                  Check Rules
                </button>
              </div>
              {autoNotice && <p className="text-[11px] text-accent">{autoNotice}</p>}
              <div className="space-y-1.5">
                {automations.map((rule) => (
                  <div key={rule.id} className="hud-elevated flex items-start justify-between gap-2 px-2.5 py-2 text-xs">
                    <div className="min-w-0">
                      <p className="font-medium text-fg">{rule.name}</p>
                      <p className="text-[10px] text-fg-muted">{rule.actionSummary}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          void agentApi.toggleAutomation(rule.id, !rule.enabled).then(loadWatchdog)
                        }
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[10px] font-medium",
                          rule.enabled ? "bg-accent text-background" : "border border-border text-fg-muted",
                        )}
                      >
                        {rule.enabled ? "On" : "Off"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void agentApi.deleteAutomation(rule.id).then(loadWatchdog)}
                        className="text-fg-muted hover:text-red-500"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="space-y-1.5 border-t border-border pt-2">
                <input
                  value={autoName}
                  onChange={(e) => setAutoName(e.target.value)}
                  placeholder="Rule name..."
                  className="w-full rounded-lg border border-border bg-elevated px-2.5 py-1 text-xs text-fg outline-none focus:border-accent"
                />
                <select
                  value={autoTrigger}
                  onChange={(e) => setAutoTrigger(e.target.value as AutomationRuleItem["triggerType"])}
                  className="w-full rounded-lg border border-border bg-elevated px-2.5 py-1 text-xs text-fg outline-none"
                >
                  <option value="meeting_approaching">When Calendar Event &lt; 30m</option>
                  <option value="lock_unlocked_away">When Watchdog Armed &amp; Lock Open</option>
                  <option value="evening_hour">Evening Routine (After 8 PM)</option>
                  <option value="motion_detected">Exterior Camera Motion</option>
                </select>
                <div className="flex gap-1.5">
                  <input
                    value={autoAction}
                    onChange={(e) => setAutoAction(e.target.value)}
                    placeholder="Action summary..."
                    className="min-w-0 flex-1 rounded-lg border border-border bg-elevated px-2.5 py-1 text-xs text-fg outline-none focus:border-accent"
                  />
                  <button
                    type="button"
                    onClick={() => void addAutomation()}
                    className="flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-background"
                  >
                    <Plus size={12} /> Add
                  </button>
                </div>
              </div>
            </div>

            <div className="hud-panel space-y-2.5 p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
                  Watchdog Security Timeline
                </h2>
                <button
                  type="button"
                  onClick={() => void simulateSensorPing()}
                  className="text-[11px] font-medium text-accent hover:underline"
                >
                  Test Sensor
                </button>
              </div>
              <div className="max-h-56 space-y-1.5 overflow-y-auto">
                {securityLog.map((entry) => (
                  <div key={entry.id} className="hud-elevated px-2.5 py-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={cn(
                          "font-semibold",
                          entry.severity === "alert" ? "text-amber-400" : "text-accent",
                        )}
                      >
                        {entry.source}
                      </span>
                      <span className="font-mono text-[10px] text-fg-muted">
                        {new Date(entry.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-fg-muted">{entry.message}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Home Assistant Live Connector */}
          <div className="hud-panel space-y-2.5 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
                Home Assistant Bridge
              </h2>
              <span className="text-[11px] text-fg-muted">
                {smartHome.homeAssistantConnected ? "Connected" : "Local Simulator"}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <input
                value={haUrl}
                onChange={(e) => setHaUrl(e.target.value)}
                placeholder="http://homeassistant.local:8123"
                className="rounded-lg border border-border bg-elevated px-3 py-1.5 text-xs text-fg outline-none focus:border-accent"
              />
              <input
                type="password"
                value={haToken}
                onChange={(e) => setHaToken(e.target.value)}
                placeholder="Long-lived access token"
                className="rounded-lg border border-border bg-elevated px-3 py-1.5 text-xs text-fg outline-none focus:border-accent"
              />
              <button
                type="button"
                onClick={() => void connectHa()}
                className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-background"
              >
                Connect Home Assistant
              </button>
            </div>
            {haMsg && <p className="text-xs text-accent">{haMsg}</p>}
          </div>
        </div>

        {/* Right: Video & Music Search + Player */}
        <div className="flex flex-col gap-3 lg:col-span-5">
          <div className="hud-panel space-y-3 p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
              Video & Music Hub
            </h2>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => setMediaKind("video")}
                className={cn(
                  "flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs",
                  mediaKind === "video" ? "border-accent bg-elevated text-accent" : "border-border text-fg-muted",
                )}
              >
                <Play size={12} /> Videos
              </button>
              <button
                type="button"
                onClick={() => setMediaKind("music")}
                className={cn(
                  "flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs",
                  mediaKind === "music" ? "border-accent bg-elevated text-accent" : "border-border text-fg-muted",
                )}
              >
                <Music size={12} /> Music
              </button>
            </div>
            <div className="flex gap-2">
              <input
                value={mediaQuery}
                onChange={(e) => setMediaQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void runMediaSearch();
                }}
                placeholder="Search YouTube videos, documentaries, lo-fi..."
                className="min-w-0 flex-1 rounded-lg border border-border bg-elevated px-3 py-1.5 text-xs text-fg outline-none focus:border-accent"
              />
              <button
                type="button"
                disabled={searchingMedia}
                onClick={() => void runMediaSearch()}
                className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-background disabled:opacity-50"
              >
                <Search size={12} /> {searchingMedia ? "Searching…" : "Find"}
              </button>
            </div>

            {activeMediaUrl ? (
              <div className="aspect-video w-full overflow-hidden rounded-xl border border-border bg-black">
                <iframe
                  title="JARVIS Media Player"
                  src={activeMediaUrl}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  className="h-full w-full border-0"
                />
              </div>
            ) : activeTrack ? (
              <div className="hud-elevated flex aspect-video w-full flex-col items-center justify-center gap-2.5 p-5 text-center">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent/15 text-accent">
                  <Play size={20} />
                </span>
                <div className="max-w-sm">
                  <p className="truncate text-sm font-semibold text-fg">{activeTrack.title}</p>
                  <p className="mt-0.5 text-xs text-fg-muted">{activeTrack.channel} · Ready for playback</p>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  {activeTrack.embedUrl && (
                    <button
                      type="button"
                      onClick={() => setActiveMediaUrl(activeTrack.embedUrl!)}
                      className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-background"
                    >
                      <Play size={12} /> Load Player
                    </button>
                  )}
                  <a
                    href={activeTrack.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-fg hover:border-accent"
                  >
                    <ExternalLink size={12} /> Open Source
                  </a>
                </div>
              </div>
            ) : null}

            <div className="max-h-64 space-y-1.5 overflow-y-auto">
              {mediaHistory.map((item) => (
                <div
                  key={item.id}
                  className="hud-elevated flex items-center justify-between gap-2 px-3 py-2 text-xs"
                >
                  <button
                    type="button"
                    onClick={() => item.embedUrl && setActiveMediaUrl(item.embedUrl)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="truncate font-medium text-fg">{item.title}</p>
                    <p className="text-[10px] text-fg-muted">{item.channel}</p>
                  </button>
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent hover:underline"
                    title="Open externally"
                  >
                    <ExternalLink size={13} />
                  </a>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
