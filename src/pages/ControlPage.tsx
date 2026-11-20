import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Check,
  Eye,
  FileCog,
  FolderSearch,
  Keyboard,
  Monitor,
  Power,
  RefreshCw,
  ShieldAlert,
  Undo2,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  agentApi,
  type AgentSettings,
  type AuditEntry,
  type FilePlan,
  type PermissionsState,
  type StartMenuApp,
  type ToolsetInfo,
} from "@/lib/agentApi";
import { cn } from "@/lib/cn";

/**
 * Control tab (Phase 4): apps, file organization with dry-run + undo,
 * per-tool permissions, kill switch, screen vision and the live audit feed.
 * Every list here comes from the backend (Start Menu index, Hermes toolsets),
 * never hardcoded.
 */

const MODE_LABELS: Record<string, string> = {
  "": "default",
  ask: "ask every time",
  risky: "ask if risky",
  allow: "always allow",
};

function Section({
  icon: Icon,
  title,
  hint,
  children,
  actions,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/5 bg-elevated/40 p-4">
      <div className="mb-3 flex items-start gap-2">
        <Icon size={15} className="mt-0.5 text-accent/80" />
        <div className="min-w-0 flex-1">
          <h2 className="text-xs font-medium uppercase tracking-wide text-fg-muted">{title}</h2>
          {hint && <p className="mt-0.5 text-[11px] text-fg-muted/80">{hint}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function Banner({ tone, children }: { tone: "ok" | "err"; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-xl border px-3 py-2 text-xs",
        tone === "ok"
          ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
          : "border-red-400/20 bg-red-400/10 text-red-300",
      )}
    >
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

export default function ControlPage() {
  const [settings, setSettings] = useState<AgentSettings | null>(null);
  const [perm, setPerm] = useState<PermissionsState | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [toolsets, setToolsets] = useState<ToolsetInfo[]>([]);
  const [apps, setApps] = useState<StartMenuApp[]>([]);
  const [appCount, setAppCount] = useState<number | null>(null);
  const [indexedAt, setIndexedAt] = useState<string | null>(null);
  const [appQuery, setAppQuery] = useState("");
  const [appBusy, setAppBusy] = useState(false);
  const [allowText, setAllowText] = useState("");
  const [protectedText, setProtectedText] = useState("");
  const [hotkey, setHotkey] = useState("");
  const [dir, setDir] = useState("");
  const [plan, setPlan] = useState<FilePlan | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [fileNotice, setFileNotice] = useState<string | null>(null);
  const [visionQ, setVisionQ] = useState("");
  const [visionWin, setVisionWin] = useState("");
  const [windows, setWindows] = useState<{ title: string; pid: number }[]>([]);
  const [vision, setVision] = useState<{ ok: boolean; text: string; imagePath?: string } | null>(null);
  const [visionBusy, setVisionBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [s, p, a, t, ap] = await Promise.allSettled([
      agentApi.getSettings(),
      agentApi.getPermissions(),
      agentApi.getAudit(40),
      agentApi.getToolsets(),
      agentApi.getApps(),
    ]);
    if (s.status === "fulfilled") {
      setSettings(s.value);
      setAllowText((s.value.allowedApps || []).join(", "));
      setProtectedText((s.value.protectedFolders || []).join("\n"));
      setHotkey(s.value.killSwitch?.hotkey || "");
    }
    if (p.status === "fulfilled") setPerm(p.value);
    if (a.status === "fulfilled") setAudit(a.value.entries);
    if (t.status === "fulfilled") setToolsets(t.value.toolsets);
    if (ap.status === "fulfilled") {
      setApps(ap.value.apps);
      setAppCount(ap.value.count);
      setIndexedAt(ap.value.indexedAt);
    }
    const failed = [s, p, a, t, ap].find((r) => r.status === "rejected");
    if (failed && failed.status === "rejected") {
      setError(failed.reason instanceof Error ? failed.reason.message : String(failed.reason));
    }
    if (!dir) {
      setDir("C:\\Users\\ramch\\Downloads");
    }
    void agentApi.listWindows().then((w) => setWindows(w.windows)).catch(() => undefined);
  }, [dir]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void agentApi
        .getAudit(40)
        .then((a) => setAudit(a.entries))
        .catch(() => undefined);
      void agentApi
        .getPermissions()
        .then(setPerm)
        .catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, []);

  const searchApps = async () => {
    setAppBusy(true);
    try {
      const r = await agentApi.getApps(appQuery.trim());
      setApps(r.apps);
      if (r.count !== null) setAppCount(r.count);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setAppBusy(false);
    }
  };

  const doRefreshIndex = async () => {
    setAppBusy(true);
    try {
      const r = await agentApi.refreshApps();
      setAppCount(r.count);
      await searchApps();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setAppBusy(false);
    }
  };

  const launch = async (name: string) => {
    setBusy(`launch:${name}`);
    try {
      const r = await agentApi.launchApp(name);
      if (!r.ok) setError(r.error || "Launch failed");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setBusy(null);
    }
  };

  const winAction = async (name: string, action: "focus" | "minimize" | "close") => {
    setBusy(`win:${name}:${action}`);
    try {
      const r = await agentApi.windowAction(name, action);
      if (!r.ok) setError(r.error || "Window action failed");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setBusy(null);
    }
  };

  const saveAllowlist = async () => {
    setBusy("allowlist");
    try {
      const list = allowText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      await agentApi.saveSettings({ allowedApps: list });
      setFileNotice("Allowed apps saved.");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setBusy(null);
    }
  };

  const runPlan = async () => {
    setPlanBusy(true);
    setPlan(null);
    setFileNotice(null);
    try {
      const r = await agentApi.planFiles(dir);
      setPlan(r);
      if (!r.ok) setError(r.error || "Could not build a plan");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setPlanBusy(false);
    }
  };

  const applyPlan = async () => {
    if (!plan?.id) return;
    setPlanBusy(true);
    try {
      const r = await agentApi.applyFiles(plan.id);
      if (!r.ok) {
        setError(r.error || "Apply failed");
      } else {
        setFileNotice(
          `Moved ${r.moved} file(s)${r.failed.length ? `, ${r.failed.length} skipped` : ""}. Undo is available.`,
        );
        setPlan(null);
      }
      await agentApi.getAudit(40).then((a) => setAudit(a.entries));
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setPlanBusy(false);
    }
  };

  const undo = async () => {
    setPlanBusy(true);
    try {
      const r = await agentApi.undoFiles();
      if (!r.ok) setError(r.error || "Nothing to undo");
      else
        setFileNotice(
          `Restored ${r.restored} file(s)${r.problems.length ? ` — ${r.problems.length} problem(s)` : ""}.`,
        );
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setPlanBusy(false);
    }
  };

  const saveProtected = async () => {
    setBusy("protected");
    try {
      const folders = protectedText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const r = await agentApi.setProtectedFolders(folders);
      setProtectedText(r.folders.join("\n"));
      setFileNotice("Protected folders saved.");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setBusy(null);
    }
  };

  const toggleKill = async () => {
    if (!perm) return;
    setBusy("kill");
    try {
      const next = !perm.killSwitch.engaged;
      const r = await agentApi.setKillSwitch(next);
      setPerm({ ...perm, killSwitch: { ...perm.killSwitch, engaged: r.engaged } });
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setBusy(null);
    }
  };

  const saveHotkey = async () => {
    setBusy("hotkey");
    try {
      await agentApi.saveSettings({ killSwitchHotkey: hotkey.trim() });
      setFileNotice("Kill-switch hotkey saved.");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setBusy(null);
    }
  };

  const setMode = async (tool: string, mode: string) => {
    if (!settings) return;
    setBusy(`mode:${tool}`);
    try {
      if (mode === "") {
        const next = { ...(settings.permissions || {}) };
        delete next[tool];
        await agentApi.saveSettings({ permissions: next });
        setSettings({ ...settings, permissions: next });
      } else {
        const r = await agentApi.setToolMode(tool, mode);
        setSettings({ ...settings, permissions: r.modes });
      }
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setBusy(null);
    }
  };

  const seeScreen = async () => {
    setVisionBusy(true);
    setVision(null);
    try {
      const r = await agentApi.seeScreen({
        question: visionQ,
        window: visionWin || undefined,
      });
      setVision({
        ok: r.ok,
        text: r.ok ? r.description || "" : r.error || "Vision failed",
        imagePath: r.imagePath,
      });
    } catch (exc) {
      setVision({ ok: false, text: exc instanceof Error ? exc.message : String(exc) });
    } finally {
      setVisionBusy(false);
    }
  };

  const visibleApps = useMemo(() => apps.slice(0, 12), [apps]);
  const modeRows = useMemo(
    () => toolsets.filter((t) => t.enabled).map((t) => t.name),
    [toolsets],
  );

  const engaged = perm?.killSwitch.engaged ?? false;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-white/5 px-5 py-3">
        <div>
          <h1 className="text-sm font-medium">Control</h1>
          <p className="text-[11px] text-fg-muted">
            Apps, files, permissions, vision — every action is logged.
          </p>
        </div>
        <button type="button" onClick={() => void load()} className="rounded-lg p-1.5 text-fg-muted hover:bg-white/5">
          <RefreshCw size={14} />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {error && (
          <Banner tone="err">
            {error}
            <button type="button" className="ml-2 underline" onClick={() => setError(null)}>
              dismiss
            </button>
          </Banner>
        )}
        {fileNotice && <Banner tone="ok">{fileNotice}</Banner>}

        <Section
          icon={Power}
          title="Kill switch"
          hint="Stops every agent tool and desktop action immediately."
          actions={
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide",
                engaged ? "bg-red-400/15 text-red-300" : "bg-emerald-400/10 text-emerald-300",
              )}
            >
              {engaged ? "engaged" : "released"}
            </span>
          }
        >
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void toggleKill()}
              disabled={busy === "kill"}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium",
                engaged
                  ? "bg-emerald-400/15 text-emerald-300 hover:bg-emerald-400/25"
                  : "bg-red-400/15 text-red-300 hover:bg-red-400/25",
              )}
            >
              <ShieldAlert size={13} />
              {engaged ? "Release actions" : "Stop all actions"}
            </button>
            <input
              value={hotkey}
              onChange={(e) => setHotkey(e.target.value)}
              placeholder="ctrl+shift+x"
              className="w-44 rounded-lg border border-white/10 bg-surface px-2.5 py-1.5 font-mono text-xs outline-none focus:border-accent/40"
            />
            <button
              type="button"
              onClick={() => void saveHotkey()}
              disabled={busy === "hotkey"}
              className="rounded-lg bg-white/5 px-2.5 py-1.5 text-xs hover:bg-white/10"
            >
              Save hotkey
            </button>
          </div>
        </Section>

        <Section
          icon={Monitor}
          title="Apps"
          hint={`Start Menu index${appCount !== null ? ` · ${appCount} apps` : ""}${indexedAt ? ` · ${indexedAt}` : ""}`}
          actions={
            <button
              type="button"
              onClick={() => void doRefreshIndex()}
              disabled={appBusy}
              className="rounded-lg bg-white/5 px-2 py-1 text-[11px] hover:bg-white/10"
            >
              Reindex
            </button>
          }
        >
          <div className="flex items-center gap-2">
            <input
              value={appQuery}
              onChange={(e) => setAppQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void searchApps()}
              placeholder="Search installed apps…"
              className="w-64 rounded-lg border border-white/10 bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-accent/40"
            />
            <button
              type="button"
              onClick={() => void searchApps()}
              className="rounded-lg bg-white/5 px-2.5 py-1.5 text-xs hover:bg-white/10"
            >
              Search
            </button>
          </div>
          <div className="mt-2 grid grid-cols-1 gap-1.5 md:grid-cols-2">
            {visibleApps.map((app) => (
              <div key={app.appId} className="flex items-center gap-2 rounded-xl border border-white/5 bg-surface/40 px-2.5 py-1.5">
                <span className="min-w-0 flex-1 truncate text-xs">{app.name}</span>
                {typeof app.score === "number" && (
                  <span className="text-[10px] text-fg-muted">{app.score.toFixed(2)}</span>
                )}
                <button
                  type="button"
                  onClick={() => void launch(app.name)}
                  disabled={busy === `launch:${app.name}`}
                  className="rounded-md bg-accent/15 px-2 py-0.5 text-[11px] text-accent hover:bg-accent/25"
                >
                  Open
                </button>
                <button
                  type="button"
                  onClick={() => void winAction(app.name, "focus")}
                  className="rounded-md bg-white/5 px-2 py-0.5 text-[11px] hover:bg-white/10"
                >
                  Focus
                </button>
                <button
                  type="button"
                  onClick={() => void winAction(app.name, "close")}
                  className="rounded-md p-1 text-fg-muted hover:bg-red-400/10 hover:text-red-300"
                  title="Close window"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-[11px] text-fg-muted">Agent allowlist</span>
            <input
              value={allowText}
              onChange={(e) => setAllowText(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-accent/40"
            />
            <button
              type="button"
              onClick={() => void saveAllowlist()}
              disabled={busy === "allowlist"}
              className="rounded-lg bg-white/5 px-2.5 py-1.5 text-xs hover:bg-white/10"
            >
              Save
            </button>
          </div>
        </Section>

        <Section
          icon={FolderSearch}
          title="Files — organize with a dry run"
          hint="Move only, never delete. Nothing changes until you press Apply."
          actions={
            <button
              type="button"
              onClick={() => void undo()}
              disabled={planBusy}
              className="flex items-center gap-1 rounded-lg bg-white/5 px-2 py-1 text-[11px] hover:bg-white/10"
            >
              <Undo2 size={11} /> Undo last
            </button>
          }
        >
          <div className="flex items-center gap-2">
            <input
              value={dir}
              onChange={(e) => setDir(e.target.value)}
              placeholder="C:\Users\ramch\Downloads"
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-accent/40"
            />
            <button
              type="button"
              onClick={() => void runPlan()}
              disabled={planBusy}
              className="flex items-center gap-1 rounded-lg bg-accent/15 px-2.5 py-1.5 text-xs text-accent hover:bg-accent/25"
            >
              <FileCog size={12} /> {planBusy ? "Planning…" : "Plan"}
            </button>
          </div>
          {plan && plan.ok && (
            <div className="mt-3">
              <p className="mb-1 text-[11px] text-fg-muted">
                {plan.moves.length} move(s) planned in {plan.directory}
                {plan.skipped.length > 0 && ` · ${plan.skipped.length} skipped`}
              </p>
              <div className="max-h-56 overflow-y-auto rounded-xl border border-white/5 bg-surface/50">
                {plan.moves.map((m) => (
                  <div key={m.from} className="flex items-center gap-2 border-b border-white/5 px-2.5 py-1.5 text-[11px] last:border-0">
                    <span className="min-w-0 flex-1 truncate">{m.name}</span>
                    <span className="text-fg-muted">→</span>
                    <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px]">{m.category}/</span>
                  </div>
                ))}
                {plan.skipped.map((s) => (
                  <div key={s.name} className="flex items-center gap-2 px-2.5 py-1 text-[11px] text-amber-300/80">
                    <span className="min-w-0 flex-1 truncate">{s.name}</span>
                    <span className="text-[10px]">{s.reason}</span>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => void applyPlan()}
                disabled={planBusy || plan.moves.length === 0}
                className="mt-2 flex items-center gap-1 rounded-lg bg-emerald-400/15 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-400/25 disabled:opacity-50"
              >
                <Check size={12} /> Apply {plan.moves.length} move(s)
              </button>
            </div>
          )}
          <details className="mt-3">
            <summary className="cursor-pointer text-[11px] text-fg-muted">Protected folders</summary>
            <textarea
              value={protectedText}
              onChange={(e) => setProtectedText(e.target.value)}
              rows={5}
              className="mt-2 w-full rounded-lg border border-white/10 bg-surface px-2.5 py-1.5 font-mono text-[11px] outline-none focus:border-accent/40"
            />
            <button
              type="button"
              onClick={() => void saveProtected()}
              disabled={busy === "protected"}
              className="mt-1 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs hover:bg-white/10"
            >
              Save protected folders
            </button>
          </details>
        </Section>

        <Section icon={Keyboard} title="Permissions per tool" hint="Default follows the safety toggle in Settings. Overrides win.">
          <div className="space-y-1.5">
            {modeRows.map((tool) => (
              <div key={tool} className="flex items-center gap-2 rounded-lg border border-white/5 bg-surface/40 px-2.5 py-1.5">
                <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{tool}</span>
                <select
                  value={settings?.permissions?.[tool] || ""}
                  onChange={(e) => void setMode(tool, e.target.value)}
                  disabled={busy === `mode:${tool}`}
                  className="rounded-md border border-white/10 bg-surface px-1.5 py-1 text-[11px] outline-none focus:border-accent/40"
                >
                  {Object.entries(MODE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            {modeRows.length === 0 && <p className="text-[11px] text-fg-muted">No enabled toolsets.</p>}
          </div>
        </Section>

        <Section icon={Eye} title="See my screen" hint="Screenshot goes only to the active provider's vision model.">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={visionQ}
              onChange={(e) => setVisionQ(e.target.value)}
              placeholder="What should I look for? (optional)"
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-accent/40"
            />
            <select
              value={visionWin}
              onChange={(e) => setVisionWin(e.target.value)}
              className="max-w-64 rounded-lg border border-white/10 bg-surface px-2 py-1.5 text-xs outline-none focus:border-accent/40"
            >
              <option value="">Whole screen</option>
              {windows.map((w) => (
                <option key={`${w.pid}:${w.title}`} value={w.title}>
                  {w.title.slice(0, 60)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void seeScreen()}
              disabled={visionBusy}
              className="flex items-center gap-1 rounded-lg bg-accent/15 px-2.5 py-1.5 text-xs text-accent hover:bg-accent/25"
            >
              <Eye size={12} /> {visionBusy ? "Looking…" : "Look"}
            </button>
          </div>
          {vision && (
            <div className="mt-3 flex gap-3">
              {vision.imagePath && (
                <img
                  src={agentApi.visionImageUrl(vision.imagePath)}
                  alt="Screenshot"
                  className="h-28 w-auto rounded-lg border border-white/10 object-cover"
                />
              )}
              <p className={cn("min-w-0 flex-1 whitespace-pre-wrap text-[11px]", vision.ok ? "text-fg" : "text-red-300")}>
                {vision.text}
              </p>
            </div>
          )}
        </Section>

        <Section
          icon={Activity}
          title="Activity"
          hint="Audit log — newest first, refreshed every 5s."
          actions={<span className="text-[10px] text-fg-muted">{audit.length} entries</span>}
        >
          <div className="max-h-64 overflow-y-auto rounded-xl border border-white/5 bg-black/30">
            {audit.length === 0 ? (
              <p className="px-3 py-2 text-[11px] text-fg-muted">No actions logged yet.</p>
            ) : (
              audit.map((entry, index) => (
                <div
                  key={`${entry.ts}:${index}`}
                  className="flex items-center gap-2 border-b border-white/5 px-2.5 py-1.5 text-[11px] last:border-0"
                >
                  <span className="w-32 shrink-0 text-[10px] text-fg-muted">{entry.ts.slice(11)}</span>
                  <span className="min-w-0 flex-1 truncate font-mono">{entry.tool}</span>
                  <span
                    className={cn(
                      "shrink-0 rounded px-1.5 py-0.5 text-[10px]",
                      entry.decision === "allowed" || entry.decision === "approved" || entry.decision === "planned"
                        ? "bg-emerald-400/10 text-emerald-300"
                        : entry.decision === "blocked" || entry.decision === "denied" || entry.decision === "failed"
                          ? "bg-red-400/10 text-red-300"
                          : "bg-white/5 text-fg-muted",
                    )}
                  >
                    {entry.decision}
                  </span>
                  <span className="w-14 shrink-0 text-right text-[10px] uppercase text-fg-muted">{entry.source}</span>
                </div>
              ))
            )}
          </div>
        </Section>
      </div>
    </div>
  );
}
