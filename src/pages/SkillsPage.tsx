import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Eye, Puzzle, RefreshCw, Trash2 } from "lucide-react";
import { agentApi, type SkillItem } from "@/lib/agentApi";

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
 * Skills tab: reusable skills JARVIS has learned (Hermes skill library).
 */
export default function SkillsPage() {
  const [items, setItems] = useState<SkillItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openSkill, setOpenSkill] = useState<{ item: SkillItem; content: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await agentApi.getSkills();
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

  const remove = async (item: SkillItem) => {
    try {
      await agentApi.deleteSkill(item.path);
      setItems((current) => current.filter((i) => i.path !== item.path));
      if (openSkill?.item.path === item.path) setOpenSkill(null);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    }
  };

  const open = async (item: SkillItem) => {
    try {
      const data = await agentApi.getSkillContent(item.path);
      setOpenSkill({ item, content: data.content });
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    }
  };

  return (
    <div className="flex h-full flex-col px-6 pb-5 pt-4">
      <div className="flex items-center justify-between pb-3">
        <div>
          <h1 className="flex items-center gap-2 text-base font-medium tracking-tight">
            <Puzzle size={17} className="text-accent" /> Skills JARVIS has learned
          </h1>
          <p className="mt-0.5 text-xs text-fg-muted">Reusable procedures JARVIS teaches itself from experience.</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-fg-muted transition-colors hover:bg-white/5 hover:text-fg"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-xl border border-red-400/25 bg-red-400/10 px-3.5 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {loading ? (
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-28 animate-pulse rounded-2xl bg-white/[0.04]" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Puzzle size={26} strokeWidth={1.4} className="text-fg-muted" />
            <p className="text-sm text-fg/85">No skills yet.</p>
            <p className="max-w-sm text-xs leading-relaxed text-fg-muted">
              As you use JARVIS, it will learn reusable skills automatically.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="glass group flex flex-col justify-between rounded-2xl p-3.5"
              >
                <div>
                  <p className="truncate text-sm font-medium text-fg/90">{item.name}</p>
                  <p className="mt-1 text-[11px] text-fg-muted">Learned {timeAgo(item.updatedAt)}</p>
                </div>
                <div className="mt-3 flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => void open(item)}
                    className="flex items-center gap-1 rounded-lg bg-white/5 px-2.5 py-1.5 text-[11px] text-fg-muted transition-colors hover:bg-accent/15 hover:text-accent"
                  >
                    <Eye size={12} /> View
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(item)}
                    className="flex items-center gap-1 rounded-lg bg-white/5 px-2.5 py-1.5 text-[11px] text-fg-muted transition-colors hover:bg-red-400/10 hover:text-red-300"
                  >
                    <Trash2 size={12} /> Delete
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* skill viewer */}
      {openSkill && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50 p-8 backdrop-blur-sm" onClick={() => setOpenSkill(null)}>
          <div className="glass flex max-h-[80%] w-[560px] flex-col rounded-2xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <h2 className="text-sm font-medium">{openSkill.item.name}</h2>
              <button type="button" onClick={() => setOpenSkill(null)} className="rounded-lg px-2 py-1 text-xs text-fg-muted hover:bg-white/5 hover:text-fg">
                Close
              </button>
            </div>
            <pre className="overflow-auto whitespace-pre-wrap p-4 font-mono text-xs leading-relaxed text-fg/85">
              {openSkill.content || "(empty skill file)"}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
