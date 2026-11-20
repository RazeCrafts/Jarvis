import { useCallback, useEffect, useState } from "react";
import { Check, Plus, RefreshCw, Stethoscope, Trash2, X } from "lucide-react";
import { agentApi, type McpServerInfo, type ToolsetInfo } from "@/lib/agentApi";
import { cn } from "@/lib/cn";

/**
 * Tools tab (Phase 3): Hermes toolsets + MCP servers + doctor.
 * Toolset list and enable state come from the runtime (/hermes/toolsets);
 * toggles are persisted and mirrored into Hermes's own config.
 */
export default function ToolsPage() {
  const [toolsets, setToolsets] = useState<ToolsetInfo[]>([]);
  const [servers, setServers] = useState<McpServerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [doctor, setDoctor] = useState<string | null>(null);
  const [doctorBusy, setDoctorBusy] = useState(false);
  // add-MCP form
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, m] = await Promise.all([agentApi.getToolsets(), agentApi.getMcpServers()]);
      setToolsets(t.toolsets);
      setServers(m.servers);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (toolset: ToolsetInfo) => {
    setBusy(toolset.name);
    setError(null);
    try {
      await agentApi.toggleToolset(toolset.name, !toolset.enabled);
      setToolsets((prev) =>
        prev.map((t) => (t.name === toolset.name ? { ...t, enabled: !t.enabled } : t)),
      );
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setBusy(null);
    }
  };

  const addServer = async () => {
    if (!name.trim() || (!url.trim() && !command.trim())) return;
    setBusy("mcp-add");
    setError(null);
    try {
      await agentApi.addMcpServer({
        name: name.trim(),
        ...(url.trim() ? { url: url.trim() } : { command: command.trim(), args: args.trim() ? args.trim().split(/\s+/) : [] }),
      });
      setName("");
      setUrl("");
      setCommand("");
      setArgs("");
      setNotice("MCP server added");
      await load();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setBusy(null);
    }
  };

  const testServer = async (server: McpServerInfo) => {
    setBusy(`test:${server.name}`);
    setError(null);
    try {
      const r = await agentApi.testMcpServer(server.name);
      setNotice(`${server.name}: ${r.ok ? "connected" : "failed"} — ${r.output.split("\n").slice(-3).join(" · ")}`);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setBusy(null);
    }
  };

  const removeServer = async (server: McpServerInfo) => {
    setBusy(`del:${server.name}`);
    try {
      await agentApi.removeMcpServer(server.name);
      await load();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setBusy(null);
    }
  };

  const runDoctor = async () => {
    setDoctorBusy(true);
    setError(null);
    try {
      const r = await agentApi.getDoctor();
      setDoctor(r.report);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setDoctorBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-white/5 px-5 py-3">
        <div>
          <h1 className="text-sm font-medium">Tools</h1>
          <p className="text-[11px] text-fg-muted">
            Tool access for the agent, MCP servers, and runtime diagnostics.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void runDoctor()}
            disabled={doctorBusy}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-fg-muted hover:bg-white/5 hover:text-fg"
          >
            <Stethoscope size={12} /> {doctorBusy ? "Running doctor…" : "Run doctor"}
          </button>
          <button type="button" onClick={() => void load()} className="rounded-lg p-1.5 text-fg-muted hover:bg-white/5">
            <RefreshCw size={14} className={cn(loading && "animate-spin")} />
          </button>
        </div>
      </header>

      {notice && (
        <div className="mx-5 mt-3 flex items-start gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-300">
          <Check size={13} className="mt-0.5 shrink-0" />
          <span className="min-w-0 break-words">{notice}</span>
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
        {doctor && (
          <div className="mb-5 rounded-2xl border border-white/5 bg-surface/60 p-3">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-xs font-medium text-fg-muted">hermes doctor</h2>
              <button type="button" className="text-[11px] text-fg-muted hover:text-fg" onClick={() => setDoctor(null)}>
                hide
              </button>
            </div>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-[10.5px] leading-relaxed text-fg-muted">
              {doctor}
            </pre>
          </div>
        )}

        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-muted">Toolsets</h2>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {toolsets.map((t) => (
            <button
              key={t.name}
              type="button"
              onClick={() => void toggle(t)}
              disabled={busy === t.name}
              className={cn(
                "flex items-start justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                t.enabled
                  ? "border-accent/20 bg-accent/5 hover:bg-accent/10"
                  : "border-white/5 bg-elevated/30 hover:bg-white/5",
              )}
            >
              <span className="min-w-0">
                <span className="block text-xs font-medium">{t.label}</span>
                <span className="mt-0.5 block truncate text-[10.5px] text-fg-muted">{t.description}</span>
              </span>
              <span
                className={cn(
                  "mt-0.5 flex h-4 w-7 shrink-0 items-center rounded-full px-0.5 transition-colors",
                  t.enabled ? "bg-accent/60" : "bg-white/10",
                )}
              >
                <span
                  className={cn(
                    "h-3 w-3 rounded-full bg-white transition-transform",
                    t.enabled && "translate-x-3",
                  )}
                />
              </span>
            </button>
          ))}
        </div>

        <h2 className="mb-2 mt-6 text-xs font-medium uppercase tracking-wide text-fg-muted">MCP servers</h2>
        {servers.length === 0 ? (
          <p className="text-[11px] text-fg-muted">No MCP servers configured.</p>
        ) : (
          <div className="space-y-1.5">
            {servers.map((s) => (
              <div key={s.name} className="flex items-center gap-3 rounded-xl border border-white/5 bg-elevated/40 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium">
                    {s.name} <span className="ml-1 text-[10px] uppercase text-fg-muted">{s.type}</span>
                  </p>
                  <p className="truncate text-[11px] text-fg-muted">
                    {s.url || `${s.command} ${s.args.join(" ")}`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void testServer(s)}
                  disabled={busy === `test:${s.name}`}
                  className="rounded-lg bg-white/5 px-2 py-1 text-[11px] hover:bg-white/10"
                >
                  {busy === `test:${s.name}` ? "Testing…" : "Test"}
                </button>
                <button
                  type="button"
                  onClick={() => void removeServer(s)}
                  className="rounded-lg p-1 text-fg-muted hover:bg-red-400/10 hover:text-red-300"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="server name"
            className="w-32 rounded-lg border border-white/10 bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-accent/40"
          />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="remote URL (https://…)"
            className="w-56 rounded-lg border border-white/10 bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-accent/40"
          />
          <span className="text-[10px] text-fg-muted">or</span>
          <input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="command (stdio)"
            className="w-40 rounded-lg border border-white/10 bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-accent/40"
          />
          <input
            value={args}
            onChange={(e) => setArgs(e.target.value)}
            placeholder="args"
            className="w-32 rounded-lg border border-white/10 bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-accent/40"
          />
          <button
            type="button"
            onClick={() => void addServer()}
            disabled={busy === "mcp-add"}
            className="flex items-center gap-1 rounded-lg bg-accent/15 px-3 py-1.5 text-xs text-accent hover:bg-accent/25"
          >
            <Plus size={12} /> Add server
          </button>
        </div>
      </div>
    </div>
  );
}
