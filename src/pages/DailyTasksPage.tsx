import { useEffect, useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { agentApi, type AutomationRuleItem, type CronJobInfo } from "@/lib/agentApi";
import { cn } from "@/lib/cn";

export default function DailyTasksPage() {
  const [jobs, setJobs] = useState<CronJobInfo[]>([]);
  const [automations, setAutomations] = useState<AutomationRuleItem[]>([]);
  const [logs, setLogs] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");

  const [name, setName] = useState("");
  const [schedule, setSchedule] = useState("0 8 * * *");
  const [prompt, setPrompt] = useState("");
  const [deliver, setDeliver] = useState("hud");

  const refresh = async () => {
    setLoading(true);
    try {
      const [cronRes, autoRes, logRes] = await Promise.all([
        agentApi.getCronJobs().catch(() => ({ jobs: [] })),
        fetch("/api/automations").then((r) => r.json()).catch(() => ({ items: [] })),
        agentApi.getGatewayLogs(60).catch(() => ({ logs: "" })),
      ]);
      setJobs(cronRes.jobs || []);
      setAutomations((autoRes as { items?: AutomationRuleItem[] }).items || []);
      setLogs(logRes.logs || "");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const handleCreate = async () => {
    if (!name.trim() || !prompt.trim()) return;
    await agentApi.createCronJob({
      name: name.trim(),
      schedule: schedule.trim() || "0 8 * * *",
      prompt: prompt.trim(),
      deliver,
    });
    setName("");
    setPrompt("");
    setNotice("Scheduled routine created.");
    await refresh();
  };

  const handleCronAction = async (action: "pause" | "resume" | "run" | "remove", jobId: string) => {
    await agentApi.cronAction(action, jobId);
    setNotice(`Routine ${action} executed.`);
    await refresh();
  };

  const handleToggleRule = async (id: string, enabled: boolean) => {
    await agentApi.toggleAutomation(id, enabled);
    await refresh();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
        <div>
          <h1 className="flex items-center gap-2 font-display text-base font-semibold text-fg">
            <CalendarClock size={16} className="text-accent" /> Daily Tasks &amp; Autonomous Routines
          </h1>
          <p className="text-xs text-fg-muted">
            Schedule recurring research, morning digests, repo backups, and autonomous triggers with live execution logs.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-elevated px-3 py-1.5 text-xs text-fg hover:border-accent"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {notice && (
        <div className="border-b border-border bg-elevated px-5 py-1.5 text-xs text-accent">
          {notice}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-5 lg:grid-cols-12">
        <section className="space-y-4 lg:col-span-7">
          <div className="hud-panel space-y-3 p-4">
            <h2 className="font-display text-sm font-semibold text-fg">Create Autonomous Routine</h2>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Routine name (e.g., Morning Inbox Digest)"
                className="rounded-lg border border-border bg-elevated px-3 py-2 text-xs text-fg outline-none focus:border-accent"
              />
              <div className="flex gap-2">
                <input
                  value={schedule}
                  onChange={(e) => setSchedule(e.target.value)}
                  placeholder="Cron (e.g. 0 8 * * *)"
                  className="w-full rounded-lg border border-border bg-elevated px-3 py-2 font-mono text-xs text-fg outline-none focus:border-accent"
                />
                <select
                  value={deliver}
                  onChange={(e) => setDeliver(e.target.value)}
                  className="rounded-lg border border-border bg-elevated px-2.5 py-2 text-xs text-fg outline-none"
                >
                  <option value="hud">Deliver: HUD</option>
                  <option value="telegram">Telegram</option>
                  <option value="discord">Discord</option>
                </select>
              </div>
            </div>
            <textarea
              rows={2}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Instruction for JARVIS (e.g., Summarize unread priority emails, check repo tests, and draft study questions)"
              className="w-full rounded-lg border border-border bg-elevated p-2.5 text-xs text-fg outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={!name.trim() || !prompt.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-xs font-medium text-background disabled:opacity-40"
            >
              <Plus size={13} /> Schedule Task
            </button>
          </div>

          <div className="hud-panel space-y-2.5 p-4">
            <h2 className="font-display text-sm font-semibold text-fg">Scheduled Jobs ({jobs.length})</h2>
            {jobs.length === 0 ? (
              <p className="text-xs text-fg-muted">No scheduled cron tasks yet. Add one above or ask JARVIS to automate a daily job.</p>
            ) : (
              <div className="space-y-2">
                {jobs.map((job) => (
                  <div key={job.id} className="hud-elevated flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-xs">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-fg">{job.name}</span>
                        <span className="font-mono text-[10px] text-accent">{job.schedule}</span>
                        <span className="font-mono text-[10px] text-fg-muted">{job.enabled ? "ACTIVE" : "PAUSED"}</span>
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-fg-muted">{job.prompt}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => void handleCronAction("run", job.id)}
                        className="rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-background"
                        title="Run Now"
                      >
                        <Play size={11} />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleCronAction(job.enabled ? "pause" : "resume", job.id)}
                        className="rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-fg"
                        title={job.enabled ? "Pause" : "Resume"}
                      >
                        {job.enabled ? <Pause size={11} /> : <CheckCircle2 size={11} />}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleCronAction("remove", job.id)}
                        className="rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-fg-muted hover:text-red-400"
                        title="Delete"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="space-y-4 lg:col-span-5">
          <div className="hud-panel space-y-2.5 p-4">
            <h2 className="font-display text-sm font-semibold text-fg">Conditional Triggers ({automations.length})</h2>
            <div className="space-y-2">
              {automations.map((rule) => (
                <div key={rule.id} className="hud-elevated flex items-center justify-between gap-2 px-3 py-2 text-xs">
                  <div className="min-w-0">
                    <p className="font-medium text-fg">{rule.name}</p>
                    <p className="truncate text-[11px] text-fg-muted">{rule.actionSummary}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleToggleRule(rule.id, !rule.enabled)}
                    className={cn(
                      "shrink-0 rounded-md px-2.5 py-1 text-[11px] font-medium",
                      rule.enabled ? "bg-accent text-background" : "border border-border bg-surface text-fg-muted",
                    )}
                  >
                    {rule.enabled ? "Enabled" : "Paused"}
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="hud-panel space-y-2 p-4">
            <h2 className="font-display text-sm font-semibold text-fg">Execution Log</h2>
            <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-background/80 p-3 font-mono text-[11px] text-fg-muted">
              {logs || "Scheduler standing by."}
            </pre>
          </div>
        </section>
      </div>
    </div>
  );
}
