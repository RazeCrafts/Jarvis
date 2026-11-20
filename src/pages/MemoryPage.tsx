import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Brain, RefreshCw, Search, Trash2 } from "lucide-react";
import { agentApi, type MemoryItem } from "@/lib/agentApi";
import { cn } from "@/lib/cn";

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

/**
 * Memory tab: what JARVIS permanently knows about you. Backed by the
 * Hermes memory files exposed through GET/DELETE /agent/memory.
 */
export default function MemoryPage() {
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [openItem, setOpenItem] = useState<{ item: MemoryItem; content: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await agentApi.getMemory();
      setItems(data.items);
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
    if (!q) return items;
    return items.filter((i) => i.title.toLowerCase().includes(q));
  }, [items, query]);

  const remove = async (item: MemoryItem) => {
    try {
      await agentApi.deleteMemory(item.path);
      setItems((current) => current.filter((i) => i.path !== item.path));
      if (openItem?.item.path === item.path) setOpenItem(null);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    }
  };

  const open = async (item: MemoryItem) => {
    try {
      const data = await agentApi.getMemoryContent(item.path);
      setOpenItem({ item, content: data.content });
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    }
  };

  return (
    <div className="flex h-full flex-col px-6 pb-5 pt-4">
      <div className="flex items-center justify-between pb-3">
        <div>
          <h1 className="flex items-center gap-2 text-base font-medium tracking-tight">
            <Brain size={17} className="text-accent" /> What JARVIS knows about you
          </h1>
          <p className="mt-0.5 text-xs text-fg-muted">Everything below is stored locally in the agent's memory.</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-fg-muted transition-colors hover:bg-white/5 hover:text-fg"
        >
          <RefreshCw size={12} className={cn(loading && "animate-spin")} /> Refresh
        </button>
      </div>

      <div className="glass mb-3 flex items-center gap-2 rounded-full px-3.5 py-2">
        <Search size={14} className="text-fg-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search memories…"
          className="w-full bg-transparent text-sm outline-none placeholder:text-fg-muted"
        />
      </div>

      {error && (
        <div className="mb-3 rounded-xl border border-red-400/25 bg-red-400/10 px-3.5 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {loading ? (
          <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-2xl bg-white/[0.04]" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Brain size={26} strokeWidth={1.4} className="text-fg-muted" />
            <p className="text-sm text-fg/85">{query ? "No memories match your search." : "No memories yet."}</p>
            <p className="max-w-sm text-xs leading-relaxed text-fg-muted">
              As you talk with JARVIS, facts worth keeping — preferences, projects, people — are remembered here automatically.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-2">
            {filtered.map((item) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="glass group flex items-start justify-between gap-3 rounded-2xl p-3.5"
              >
                <button type="button" onClick={() => void open(item)} className="min-w-0 flex-1 text-left">
                  <p className="truncate text-sm text-fg/90">{item.title}</p>
                  <p className="mt-1 text-[11px] text-fg-muted">
                    Learned {timeAgo(item.updatedAt)} · {(item.size / 1024).toFixed(1)} KB
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => void remove(item)}
                  aria-label={`Delete ${item.title}`}
                  className="rounded-lg p-1.5 text-fg-muted opacity-0 transition-all hover:bg-red-400/10 hover:text-red-300 group-hover:opacity-100"
                >
                  <Trash2 size={14} />
                </button>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* memory content viewer */}
      {openItem && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50 p-8 backdrop-blur-sm" onClick={() => setOpenItem(null)}>
          <div className="glass flex max-h-[80%] w-[560px] flex-col rounded-2xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <h2 className="text-sm font-medium">{openItem.item.title}</h2>
              <button type="button" onClick={() => setOpenItem(null)} className="rounded-lg px-2 py-1 text-xs text-fg-muted hover:bg-white/5 hover:text-fg">
                Close
              </button>
            </div>
            <pre className="overflow-auto whitespace-pre-wrap p-4 font-mono text-xs leading-relaxed text-fg/85">
              {openItem.content}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
