import { useCallback, useEffect, useState } from "react";
import { Pause, Play, Plus, RefreshCw, RotateCcw, Trash2, X } from "lucide-react";
import { agentApi, type CronJobInfo } from "@/lib/agentApi";
import { cn } from "@/lib/cn";

/**
 * Tasks tab (Phase 3): scheduled Hermes jobs (cron). Jobs are stored by the
 * Hermes runtime under HERMES_HOME/cron/jobs.json and tick via the gateway.
 */
export default function TasksPage() {
  const [jobs, setJobs] = useState<CronJobInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [gatewayRunning, setGatewayRunning] = useState<boolean | null>(null);
  // create form
  const [schedule, setSchedule] = useState("0 9 * * *");
  const [prompt, setPrompt] = useState("");
  const [name, setName] = useState("");
  const [deliver, setDeliver] = useState("local");
  const [repeat, setRepeat] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [c, g] = await Promise.all([agentApi.getCronJobs(), agentApi.getGateway()]);
      setJobs(c.jobs);
      setGatewayRunning(g.running);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!schedule.trim() || !prompt.trim()) return;
    setBusy("create");
    setError(null);
    try {
      const r = await agentApi.createCronJob({
        schedule: schedule.trim(),
        prompt: prompt.trim(),
        name: name.trim() || undefined,
        deliver: deliver || undefined,
        repeat: repeat ? Number(repeat) : undefined,
      });
      setJobs(r.jobs);
      setPrompt("");
      setName("");
      setNotice("Task created");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setBusy(null);
    }
  };

  const action = async (job: CronJobInfo, kind: "pause" | "resume" | "run" | "remove") => {
    setBusy(`${kind}:${job.id}`);
    setError(null);
    try {
      const r = await agentApi.cronAction(kind, job.id);
      setJobs(r.jobs);
      setNotice(`Task ${kind}${kind.endsWith("e") ? "d" : "ed"}: ${job.name}`);
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
          <h1 className="text-sm font-medium">Tasks</h1>
          <p className="text-[11px] text-fg-muted">
            Scheduled agent jobs ({schedule.trim() ? "cron syntax or 30m / every 2h" : ""}).
          </p>
        </div>
        <button type="button" onClick={() => void load()} className="rounded-lg p-1.5 text-fg-muted hover:bg-white/5">
          <RefreshCw size={14} className={cn(loading && "animate-spin")} />
        </button>
      </header>

      {gatewayRunning === false && (
        <div className="mx-5 mt-3 rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-300">
          The gateway is stopped — scheduled tasks won't run until you start it in the Gateway tab.
        </div>
      )}
      {notice && (
        <div className="mx-5 mt-3 flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-300">
          {notice}
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
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-muted">New task</h2>
        <div className="rounded-2xl border border-white/5 bg-elevated/40 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
              placeholder="0 9 * * *"
              className="w-36 rounded-lg border border-white/10 bg-surface px-2.5 py-1.5 font-mono text-xs outline-none focus:border-accent/40"
            />
            <select
              value={deliver}
              onChange={(e) => setDeliver(e.target.value)}
              className="rounded-lg border border-white/10 bg-surface px-2 py-1.5 text-xs outline-none focus:border-accent/40"
            >
              <option value="local">deliver: local</option>
              <option value="origin">deliver: origin</option>
              <option value="telegram">deliver: telegram</option>
              <option value="discord">deliver: discord</option>
            </select>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="name (optional)"
              className="w-40 rounded-lg border border-white/10 bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-accent/40"
            />
            <input
              value={repeat}
              onChange={(e) => setRepeat(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="repeat (optional)"
              className="w-32 rounded-lg border border-white/10 bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-accent/40"
            />
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="What should JARVIS do when this runs?"
            rows={2}
            className="mt-2 w-full resize-none rounded-lg border border-white/10 bg-surface px-2.5 py-1.5 text-xs outline-none placeholder:text-fg-muted focus:border-accent/40"
          />
          <button
            type="button"
            onClick={() => void create()}
            disabled={busy === "create"}
            className="mt-2 flex items-center gap-1 rounded-lg bg-accent/15 px-3 py-1.5 text-xs text-accent hover:bg-accent/25"
          >
            <Plus size={12} /> Create task
          </button>
        </div>

        <h2 className="mb-2 mt-6 text-xs font-medium uppercase tracking-wide text-fg-muted">
          Scheduled jobs ({jobs.length})
        </h2>
        {jobs.length === 0 ? (
          <p className="text-[11px] text-fg-muted">No scheduled jobs yet.</p>
        ) : (
          <div className="space-y-2">
            {jobs.map((job) => (
              <div key={job.id} className="rounded-xl border border-white/5 bg-elevated/40 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium">{job.name}</span>
                  <span className="rounded-full bg-white/5 px-2 py-0.5 font-mono text-[10px] text-fg-muted">
                    {job.schedule}
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] uppercase",
                      job.state === "paused"
                        ? "bg-amber-400/10 text-amber-300"
                        : "bg-emerald-400/10 text-emerald-300",
                    )}
                  >
                    {job.state}
                  </span>
                  <span className="text-[10px] text-fg-muted">
                    → {Array.isArray(job.deliver) ? job.deliver.join(",") : job.deliver}
                  </span>
                  <div className="ml-auto flex items-center gap-1">
                    {job.state === "paused" ? (
                      <button
                        type="button"
                        onClick={() => void action(job, "resume")}
                        disabled={busy === `resume:${job.id}`}
                        className="rounded-lg p-1.5 text-fg-muted hover:bg-white/5 hover:text-fg"
                        title="Resume"
                      >
                        <Play size={12} />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void action(job, "pause")}
                        disabled={busy === `pause:${job.id}`}
                        className="rounded-lg p-1.5 text-fg-muted hover:bg-white/5 hover:text-fg"
                        title="Pause"
                      >
                        <Pause size={12} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void action(job, "run")}
                      disabled={busy === `run:${job.id}`}
                      className="rounded-lg p-1.5 text-fg-muted hover:bg-white/5 hover:text-fg"
                      title="Run now"
                    >
                      <RotateCcw size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void action(job, "remove")}
                      className="rounded-lg p-1.5 text-fg-muted hover:bg-red-400/10 hover:text-red-300"
                      title="Delete"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
                {job.prompt && <p className="mt-1 line-clamp-2 text-[11px] text-fg-muted">{job.prompt}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
