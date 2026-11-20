import { useCallback, useEffect, useState } from "react";
import { Check, Play, RefreshCw, Square, Trash2, X } from "lucide-react";
import { agentApi, type GatewayStatus } from "@/lib/agentApi";
import { cn } from "@/lib/cn";

/**
 * Gateway tab (Phase 3): the Hermes messaging gateway + token setup.
 * The gateway is a managed child process (hermes gateway run) under our
 * sandboxed HERMES_HOME; scheduled tasks only tick while it runs.
 */
export default function GatewayPage() {
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [logs, setLogs] = useState("");
  const [tokens, setTokens] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, l] = await Promise.all([agentApi.getGateway(), agentApi.getGatewayLogs(120)]);
      setStatus(s);
      setLogs(l.logs);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      void agentApi
        .getGateway()
        .then(setStatus)
        .catch(() => undefined);
    }, 10000);
    return () => window.clearInterval(timer);
  }, [load]);

  const start = async () => {
    setBusy("start");
    setError(null);
    try {
      const r = await agentApi.startGateway();
      setNotice(r.pid ? `Gateway started (pid ${r.pid})` : "Gateway is already running");
      await load();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setBusy(null);
    }
  };

  const stop = async () => {
    setBusy("stop");
    try {
      await agentApi.stopGateway();
      setNotice("Gateway stopped");
      await load();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setBusy(null);
    }
  };

  const saveToken = async (platform: string) => {
    const token = (tokens[platform] || "").trim();
    if (!token) return;
    setBusy(platform);
    setError(null);
    try {
      await agentApi.setGatewayPlatform(platform, token);
      setTokens((prev) => ({ ...prev, [platform]: "" }));
      setNotice(`${platform} token saved`);
      await load();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setBusy(null);
    }
  };

  const removeToken = async (platform: string) => {
    setBusy(platform);
    try {
      await agentApi.removeGatewayPlatform(platform);
      await load();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-white/5 px-5 py-3">
        <div>
          <h1 className="text-sm font-medium">Gateway</h1>
          <p className="text-[11px] text-fg-muted">
            Telegram / Discord / Slack bridge. Scheduled tasks run while the gateway is up.
          </p>
        </div>
        <button type="button" onClick={() => void load()} className="rounded-lg p-1.5 text-fg-muted hover:bg-white/5">
          <RefreshCw size={14} className={cn(loading && "animate-spin")} />
        </button>
      </header>

      {notice && (
        <div className="mx-5 mt-3 flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-300">
          <Check size={13} /> {notice}
          <button type="button" className="ml-auto" onClick={() => setNotice(null)}>
            <X size={12} />
          </button>
        </div>
      )}
      {error && (
        <div className="mx-5 mt-3 flex items-center gap-2 rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2 text-xs text-red-300">
          {error}
          <button type="button" className="ml-auto" onClick={() => setError(null)}>
            <X size={12} />
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="flex items-center gap-3 rounded-2xl border border-white/5 bg-elevated/40 p-4">
          <span
            className={cn(
              "h-2.5 w-2.5 rounded-full",
              status?.running ? "bg-emerald-400 shadow-[0_0_8px_rgb(52_211_153/0.7)]" : "bg-fg-muted/40",
            )}
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{status?.running ? "Gateway running" : "Gateway stopped"}</p>
            <p className="text-[11px] text-fg-muted">
              {status?.running
                ? `pid ${status.pid} · ${status.configuredPlatforms.length} platform(s) · ${status.jobCount} scheduled task(s)`
                : "Start it to receive messages and run scheduled tasks."}
            </p>
          </div>
          {status?.running ? (
            <button
              type="button"
              onClick={() => void stop()}
              disabled={busy === "stop"}
              className="flex items-center gap-1.5 rounded-lg border border-red-400/30 px-3 py-1.5 text-xs text-red-300 hover:bg-red-400/10"
            >
              <Square size={11} /> Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void start()}
              disabled={busy === "start"}
              className="flex items-center gap-1.5 rounded-lg bg-accent/15 px-3 py-1.5 text-xs text-accent hover:bg-accent/25"
            >
              <Play size={11} /> Start
            </button>
          )}
        </div>

        <h2 className="mb-2 mt-6 text-xs font-medium uppercase tracking-wide text-fg-muted">Platforms</h2>
        <div className="space-y-2">
          {(status?.platforms || []).map((p) => (
            <div key={p.id} className="rounded-xl border border-white/5 bg-elevated/40 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium">{p.label}</span>
                {p.configured ? (
                  <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-300">
                    {p.masked}
                  </span>
                ) : (
                  <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-fg-muted">not configured</span>
                )}
                <span className="ml-auto text-[10px] text-fg-muted">{p.envVar}</span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="password"
                  value={tokens[p.id] || ""}
                  onChange={(e) => setTokens((prev) => ({ ...prev, [p.id]: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && void saveToken(p.id)}
                  placeholder={p.configured ? "Replace token" : "Bot token"}
                  className="w-72 rounded-lg border border-white/10 bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-accent/40"
                />
                <button
                  type="button"
                  onClick={() => void saveToken(p.id)}
                  disabled={busy === p.id}
                  className="rounded-lg bg-accent/15 px-2.5 py-1.5 text-xs text-accent hover:bg-accent/25"
                >
                  Save
                </button>
                {p.configured && (
                  <button
                    type="button"
                    onClick={() => void removeToken(p.id)}
                    className="rounded-lg p-1.5 text-fg-muted hover:bg-red-400/10 hover:text-red-300"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <h2 className="mb-2 mt-6 text-xs font-medium uppercase tracking-wide text-fg-muted">Logs</h2>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-xl border border-white/5 bg-black/40 p-3 text-[10.5px] leading-relaxed text-fg-muted">
          {logs || "No gateway logs yet."}
        </pre>
      </div>
    </div>
  );
}
