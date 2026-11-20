/**
 * Chat model picker — the pill in the composer bar (owner request, Phase 2).
 * Lists the LIVE model list for the ACTIVE provider from the backend (Hermes
 * provider catalog / OpenRouter free list), never a hardcoded list. The choice
 * is a per-message override: it is sent with every message from this composer
 * and persisted by the parent (InputBar → localStorage), while the persistent
 * default lives in Settings.
 *
 * Provider-aware by design: sending an OpenRouter `:free` slug to NVIDIA NIM
 * was the Phase 5 "model doesn't exist" bug.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, RefreshCw, Search } from "lucide-react";
import { agentApi, type FreeModel } from "@/lib/agentApi";
import { cn } from "@/lib/cn";

const CACHE_TTL_MS = 5 * 60 * 1000;

let cache: { provider: string; models: FreeModel[]; at: number } | null = null;

/** "NVIDIA: Nemotron 3.5 Super VL (free)" → "Nemotron 3.5 Super VL" */
function shortName(model: FreeModel): string {
  const name = model.name || model.id;
  const match = name.match(/^[^:]+:\s*(.+)$/);
  const base = match ? match[1] : name;
  return base.replace(/\s*\(free\)\s*$/i, "").trim() || model.id;
}

/** Fallback display when the saved id isn't in the live list anymore. */
function labelFromId(id: string): string {
  const tail = id.split("/").pop() || id;
  return tail.replace(/:free$/, "");
}

interface Props {
  value: string; // "" = default routing
  onChange: (id: string) => void;
  className?: string;
}

export function ModelPicker({ value, onChange, className }: Props) {
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState(cache?.provider ?? "");
  const [models, setModels] = useState<FreeModel[]>(cache?.models ?? []);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const load = async (force: boolean) => {
    setLoading(true);
    try {
      const settings = await agentApi.getSettings();
      const active = settings.provider || "openrouter";
      setProvider(active);
      if (cache && !force && cache.provider === active && Date.now() - cache.at < CACHE_TTL_MS) {
        setModels(cache.models);
        return;
      }
      const data =
        active === "openrouter"
          ? (await agentApi.getFreeModels()).free
          : (await agentApi.getProviderModels(active, true)).models;
      cache = { provider: active, models: data, at: Date.now() };
      setModels(data);
    } catch {
      /* keep whatever we have; the empty state says so */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      void load(false);
      window.setTimeout(() => searchRef.current?.focus(), 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models.filter(
      (m) => m.id.toLowerCase().includes(q) || (m.name || "").toLowerCase().includes(q),
    );
  }, [models, query]);

  const selectedModel = models.find((m) => m.id === value);
  const label = value
    ? selectedModel
      ? shortName(selectedModel)
      : `${labelFromId(value)} (saved)`
    : "Default";

  const choose = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Model for your next messages"
        className={cn(
          "flex max-w-44 items-center gap-1 rounded-full px-2.5 py-1.5 text-xs transition-colors",
          "text-fg-muted hover:bg-white/5 hover:text-fg",
          value && "text-accent/90",
        )}
      >
        <span className="truncate">{label}</span>
        <ChevronDown size={12} className={cn("shrink-0 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <div
            role="listbox"
            className="glass absolute bottom-full left-0 z-40 mb-2 w-72 overflow-hidden rounded-2xl shadow-[0_8px_40px_rgb(0_0_0/0.6)]"
          >
            <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2">
              <Search size={12} className="text-fg-muted" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={provider ? `Search ${provider} models…` : "Search models…"}
                className="w-full bg-transparent text-xs outline-none placeholder:text-fg-muted"
              />
              <button
                type="button"
                onClick={() => void load(true)}
                title="Refresh the list for the active provider"
                className="text-fg-muted hover:text-fg"
              >
                <RefreshCw size={12} className={cn(loading && "animate-spin")} />
              </button>
            </div>
            <div className="max-h-72 overflow-y-auto p-1.5">
              <button
                type="button"
                onClick={() => choose("")}
                className="flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left text-xs hover:bg-white/5"
              >
                <span>
                  Default <span className="text-fg-muted">(Settings decides the tier)</span>
                </span>
                {!value && <Check size={13} className="text-accent" />}
              </button>
              {filtered.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => choose(m.id)}
                  className="flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left hover:bg-white/5"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-xs">{shortName(m)}</span>
                    <span className="block truncate text-[10px] text-fg-muted">
                      {m.id}
                      {m.context ? ` · ${(m.context / 1000).toFixed(0)}k ctx` : ""}
                    </span>
                  </span>
                  {value === m.id && <Check size={13} className="shrink-0 text-accent" />}
                </button>
              ))}
              {!loading && filtered.length === 0 && (
                <p className="px-2.5 py-3 text-center text-[11px] text-fg-muted">
                  {models.length === 0
                    ? "Couldn't load the model list — check the backend, then press refresh."
                    : "No models match that search."}
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
