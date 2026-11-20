import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, KeyRound, RefreshCw, Trash2, X } from "lucide-react";
import {
  agentApi,
  type AgentSettings,
  type FreeModel,
  type ProviderInfo,
} from "@/lib/agentApi";
import { cn } from "@/lib/cn";

/**
 * Providers tab (Phase 3): every provider Hermes supports, driven by the
 * runtime's own catalog (/hermes/providers) — never a hardcoded list.
 * Keys are stored in Windows Credential Manager (backend) and shown masked.
 * "Use" switches the live runtime to that provider (persisted setting).
 */

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-2xl border border-white/5 bg-elevated/40 p-4", className)}>{children}</div>;
}

export default function ProvidersPage() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [settings, setSettings] = useState<AgentSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"keys" | "accounts">("keys");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [keyValue, setKeyValue] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // per-provider model picker state
  const [modelsFor, setModelsFor] = useState<string | null>(null);
  const [models, setModels] = useState<FreeModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  // custom endpoint form
  const [customName, setCustomName] = useState("");
  const [customUrl, setCustomUrl] = useState("");
  const [customKeyEnv, setCustomKeyEnv] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, s] = await Promise.all([agentApi.getProviders(), agentApi.getSettings()]);
      setProviders(p.providers);
      setSettings(s);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return providers
      .filter((p) => p.tab === tab)
      .filter((p) => !q || `${p.slug} ${p.label} ${p.description}`.toLowerCase().includes(q));
  }, [providers, tab, query]);

  const saveKey = async (provider: ProviderInfo) => {
    if (!keyValue.trim()) return;
    setBusy(provider.slug);
    setError(null);
    try {
      await agentApi.saveProviderKey(provider.slug, keyValue.trim());
      setKeyValue("");
      setEditing(null);
      setNotice(`Key saved for ${provider.label}`);
      await load();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setBusy(null);
    }
  };

  const removeKey = async (provider: ProviderInfo) => {
    setBusy(provider.slug);
    setError(null);
    try {
      await agentApi.removeProviderKey(provider.slug);
      setNotice(`Key removed for ${provider.label}`);
      await load();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setBusy(null);
    }
  };

  const openModels = async (slug: string) => {
    setModelsFor(slug);
    setModels([]);
    setModelsLoading(true);
    try {
      const data = await agentApi.getProviderModels(slug, true);
      setModels(data.models);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setModelsLoading(false);
    }
  };

  const useProvider = async (slug: string, model: string) => {
    setBusy(slug);
    setError(null);
    try {
      await agentApi.saveSettings({
        brain: "hermes",
        provider: slug,
        ...(model ? { defaultModel: model } : {}),
      });
      setNotice(`JARVIS now uses ${slug}${model ? ` · ${model}` : ""}`);
      setModelsFor(null);
      await load();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setBusy(null);
    }
  };

  const addCustom = async () => {
    if (!customName.trim() || !customUrl.trim()) return;
    setBusy("custom");
    setError(null);
    try {
      await agentApi.addCustomProvider(customName.trim(), customUrl.trim(), customKeyEnv.trim());
      setCustomName("");
      setCustomUrl("");
      setCustomKeyEnv("");
      setNotice("Custom endpoint saved");
      await load();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setBusy(null);
    }
  };

  const removeCustom = async (name: string) => {
    setBusy(name);
    try {
      await agentApi.removeCustomProvider(name);
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
          <h1 className="text-sm font-medium">Providers</h1>
          <p className="text-[11px] text-fg-muted">
            Connect any model provider Hermes supports — keys go to Windows Credential Manager.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg p-1.5 text-fg-muted hover:bg-white/5 hover:text-fg"
          title="Refresh"
        >
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

      <div className="flex items-center gap-2 px-5 pt-3">
        {(["keys", "accounts"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "rounded-full px-3 py-1 text-xs capitalize transition-colors",
              tab === t ? "bg-accent/15 text-accent" : "text-fg-muted hover:bg-white/5",
            )}
          >
            {t === "keys" ? "API keys" : "Accounts / OAuth"}
          </button>
        ))}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search providers…"
          className="ml-auto w-48 rounded-full border border-white/10 bg-surface px-3 py-1 text-xs outline-none placeholder:text-fg-muted focus:border-accent/40"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {loading && providers.length === 0 ? (
          <p className="text-xs text-fg-muted">Loading provider catalog from Hermes…</p>
        ) : (
          <div className="space-y-3">
            {filtered.map((provider) => {
              const configured = provider.configured;
              const active = settings?.provider === provider.slug;
              return (
                <Card key={provider.slug}>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h2 className="text-sm font-medium">{provider.label}</h2>
                        {active && (
                          <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-accent">
                            active
                          </span>
                        )}
                        {configured && !active && (
                          <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-emerald-300">
                            key saved
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-[11px] text-fg-muted">
                        {provider.description || provider.slug} · <code className="text-fg-muted/80">{provider.slug}</code>
                        {provider.envVars.length > 0 && (
                          <>
                            {" "}
                            · env: <code className="text-fg-muted/80">{provider.envVars[0]}</code>
                          </>
                        )}
                      </p>
                      {provider.envVars.map((env) => {
                        const k = provider.keys[env];
                        return k?.present ? (
                          <p key={env} className="mt-1 text-[11px] text-fg-muted">
                            Saved: <span className="font-mono">{k.masked}</span>
                          </p>
                        ) : null;
                      })}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {provider.envVars.length > 0 && (
                        <>
                          {editing === provider.slug ? (
                            <div className="flex items-center gap-1.5">
                              <input
                                type="password"
                                autoFocus
                                value={keyValue}
                                onChange={(e) => setKeyValue(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && void saveKey(provider)}
                                placeholder="Paste API key"
                                className="w-52 rounded-lg border border-white/10 bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-accent/40"
                              />
                              <button
                                type="button"
                                onClick={() => void saveKey(provider)}
                                disabled={busy === provider.slug}
                                className="rounded-lg bg-accent/15 px-2.5 py-1.5 text-xs text-accent hover:bg-accent/25"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditing(null);
                                  setKeyValue("");
                                }}
                                className="rounded-lg p-1.5 text-fg-muted hover:bg-white/5"
                              >
                                <X size={13} />
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setEditing(provider.slug);
                                setKeyValue("");
                              }}
                              className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-fg-muted hover:bg-white/5 hover:text-fg"
                            >
                              <KeyRound size={12} />
                              {configured ? "Update key" : "Add key"}
                            </button>
                          )}
                          {configured && (
                            <button
                              type="button"
                              onClick={() => void removeKey(provider)}
                              disabled={busy === provider.slug}
                              className="rounded-lg p-1.5 text-fg-muted hover:bg-red-400/10 hover:text-red-300"
                              title="Remove key"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => void openModels(provider.slug)}
                        className="rounded-lg bg-white/5 px-2.5 py-1.5 text-xs hover:bg-white/10"
                      >
                        Choose model
                      </button>
                    </div>
                  </div>

                  {modelsFor === provider.slug && (
                    <div className="mt-3 rounded-xl border border-white/5 bg-surface/60 p-2.5">
                      {modelsLoading ? (
                        <p className="text-[11px] text-fg-muted">Loading model list…</p>
                      ) : models.length === 0 ? (
                        <p className="text-[11px] text-fg-muted">
                          No model list available for this provider yet.{" "}
                          <button
                            type="button"
                            className="text-accent hover:underline"
                            onClick={() => void useProvider(provider.slug, "")}
                          >
                            Use with current default model
                          </button>
                        </p>
                      ) : (
                        <div className="max-h-56 overflow-y-auto">
                          {models.slice(0, 200).map((m) => (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => void useProvider(provider.slug, m.id)}
                              className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs hover:bg-white/5"
                            >
                              <span className="min-w-0 flex-1 truncate">{m.name || m.id}</span>
                              <span className="ml-2 max-w-56 truncate text-[10px] text-fg-muted">{m.id}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}

        <div className="mt-6">
          <h2 className="text-sm font-medium">Custom endpoints (Ollama, LM Studio, vLLM, any OpenAI-compatible server)</h2>
          <p className="mt-0.5 text-[11px] text-fg-muted">
            Saved to the Hermes config as <code>providers.&lt;name&gt;</code>; usable as{" "}
            <code>custom:&lt;name&gt;</code>.
          </p>
          {settings && Object.keys(settings.customProviders || {}).length > 0 && (
            <div className="mt-2 space-y-1.5">
              {Object.entries(settings.customProviders).map(([name, entry]) => (
                <div key={name} className="flex items-center gap-3 rounded-xl border border-white/5 bg-elevated/40 px-3 py-2">
                  <span className="text-xs font-medium">{name}</span>
                  <span className="flex-1 truncate text-[11px] text-fg-muted">{entry.api}</span>
                  <button
                    type="button"
                    onClick={() => void openModels(`custom:${name}` as string)}
                    className="rounded-lg bg-white/5 px-2 py-1 text-[11px] hover:bg-white/10"
                  >
                    Use
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeCustom(name)}
                    className="rounded-lg p-1 text-fg-muted hover:bg-red-400/10 hover:text-red-300"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="name (e.g. lmstudio)"
              className="w-36 rounded-lg border border-white/10 bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-accent/40"
            />
            <input
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              placeholder="http://127.0.0.1:1234/v1"
              className="w-64 rounded-lg border border-white/10 bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-accent/40"
            />
            <input
              value={customKeyEnv}
              onChange={(e) => setCustomKeyEnv(e.target.value)}
              placeholder="key env (optional)"
              className="w-40 rounded-lg border border-white/10 bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-accent/40"
            />
            <button
              type="button"
              onClick={() => void addCustom()}
              disabled={busy === "custom"}
              className="rounded-lg bg-accent/15 px-3 py-1.5 text-xs text-accent hover:bg-accent/25"
            >
              Add endpoint
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
