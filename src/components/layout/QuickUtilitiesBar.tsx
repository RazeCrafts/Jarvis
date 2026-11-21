import { useState } from "react";
import { Bell, Check, Clock, Timer, Volume2, VolumeX } from "lucide-react";
import { formatClockMs } from "@/lib/timersAndReminders";
import { useAudioControlStore, useUiStore, useUtilityStore } from "@/store";
import { cn } from "@/lib/cn";

export function QuickUtilitiesBar() {
  const [mixerOpen, setMixerOpen] = useState(false);
  const masterVolume = useAudioControlStore((s) => s.masterVolume);
  const voiceVolume = useAudioControlStore((s) => s.voiceVolume);
  const mediaVolume = useAudioControlStore((s) => s.mediaVolume);
  const muted = useAudioControlStore((s) => s.muted);
  const setMasterVolume = useAudioControlStore((s) => s.setMasterVolume);
  const setVoiceVolume = useAudioControlStore((s) => s.setVoiceVolume);
  const setMediaVolume = useAudioControlStore((s) => s.setMediaVolume);
  const toggleMute = useAudioControlStore((s) => s.toggleMute);

  const timers = useUtilityStore((s) => s.timers);
  const stopwatchRunning = useUtilityStore((s) => s.stopwatchRunning);
  const stopwatchElapsedMs = useUtilityStore((s) => s.stopwatchElapsedMs);
  const reminders = useUtilityStore((s) => s.reminders);
  const dueAlertIds = useUtilityStore((s) => s.dueAlertIds);
  const setActiveTab = useUiStore((s) => s.setActiveTab);

  const runningTimer = timers.find((t) => t.running) ?? null;
  const dueCount = dueAlertIds.length;
  const pendingCount = reminders.filter((r) => r.status !== "done").length;

  return (
    <div className="relative flex items-center gap-1.5">
      {/* Live running timer or stopwatch chip */}
      {(runningTimer || stopwatchRunning) && (
        <button
          type="button"
          onClick={() => setActiveTab("memory")}
          title="Open Timers & Stopwatch"
          className="flex items-center gap-1 rounded-lg border border-accent/40 bg-elevated px-2 py-1 text-[11px] font-medium text-accent transition-colors hover:border-accent"
        >
          <Timer size={12} />
          <span className="font-mono tabular-nums">
            {runningTimer
              ? formatClockMs(runningTimer.remainingMs)
              : formatClockMs(stopwatchElapsedMs, true)}
          </span>
        </button>
      )}

      {/* WB Reminders quick counter */}
      <button
        type="button"
        onClick={() => setActiveTab("memory")}
        title="Workbench Reminders & Timers"
        className={cn(
          "flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors",
          dueCount > 0
            ? "border-amber-500/60 bg-amber-500/15 text-amber-300"
            : "border-border bg-surface text-fg hover:border-accent",
        )}
      >
        <Bell size={12} className={dueCount > 0 ? "text-amber-400" : "text-accent"} />
        <span className="font-mono tabular-nums">
          {dueCount > 0 ? `${dueCount} Due` : `${pendingCount}`}
        </span>
      </button>

      {/* Master Volume Mixer trigger */}
      <button
        type="button"
        onClick={() => setMixerOpen((v) => !v)}
        aria-label="Master Volume Mixer"
        aria-expanded={mixerOpen}
        title="Master, Voice & Media Volume Mixer"
        className={cn(
          "flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors",
          muted
            ? "border-red-500/50 bg-red-500/10 text-red-400"
            : "border-border bg-surface text-fg hover:border-accent",
        )}
      >
        {muted ? <VolumeX size={13} /> : <Volume2 size={13} className="text-accent" />}
        <span className="hidden font-mono tabular-nums sm:inline">
          {muted ? "MUTE" : `${Math.round(masterVolume * 100)}%`}
        </span>
      </button>

      {mixerOpen && (
        <div
          role="dialog"
          aria-label="Volume Mixer"
          className="hud-panel absolute right-0 top-10 z-50 w-72 space-y-3 border border-border p-3.5 shadow-2xl"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
              Audio Control
            </span>
            <button
              type="button"
              onClick={toggleMute}
              className={cn(
                "rounded-lg px-2 py-0.5 text-[11px] font-medium",
                muted
                  ? "bg-red-500 text-white"
                  : "border border-border bg-elevated text-fg hover:border-accent",
              )}
            >
              {muted ? "Unmute All" : "Mute All"}
            </button>
          </div>

          <div className="space-y-2 text-xs">
            <label className="block">
              <div className="mb-1 flex justify-between text-[11px] text-fg-muted">
                <span>Master Output</span>
                <span className="font-mono tabular-nums text-fg">{Math.round(masterVolume * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(masterVolume * 100)}
                onChange={(e) => setMasterVolume(Number(e.target.value) / 100)}
                className="w-full accent-[var(--color-accent)]"
              />
            </label>

            <label className="block">
              <div className="mb-1 flex justify-between text-[11px] text-fg-muted">
                <span>JARVIS Voice (TTS)</span>
                <span className="font-mono tabular-nums text-fg">{Math.round(voiceVolume * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(voiceVolume * 100)}
                onChange={(e) => setVoiceVolume(Number(e.target.value) / 100)}
                className="w-full accent-[var(--color-accent)]"
              />
            </label>

            <label className="block">
              <div className="mb-1 flex justify-between text-[11px] text-fg-muted">
                <span>Media Output</span>
                <span className="font-mono tabular-nums text-accent">{Math.round(mediaVolume * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={200}
                value={Math.round(mediaVolume * 100)}
                onChange={(e) => setMediaVolume(Number(e.target.value) / 100)}
                className="w-full accent-[var(--color-accent)]"
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

export function WbReminderAlertBanner() {
  const reminders = useUtilityStore((s) => s.reminders);
  const dueAlertIds = useUtilityStore((s) => s.dueAlertIds);
  const lastRungTimerTitle = useUtilityStore((s) => s.lastRungTimerTitle);
  const markReminderDone = useUtilityStore((s) => s.markReminderDone);
  const snoozeReminder = useUtilityStore((s) => s.snoozeReminder);
  const dismissTimerChime = useUtilityStore((s) => s.dismissTimerChime);

  const dueReminder = reminders.find((r) => dueAlertIds.includes(r.id) && r.status !== "done") ?? null;
  if (!dueReminder && !lastRungTimerTitle) return null;

  return (
    <div className="mx-3 mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs text-fg">
      {dueReminder ? (
        <>
          <div className="flex items-center gap-2">
            <Bell size={14} className="text-amber-400" />
            <span className="font-semibold text-amber-300">WB Reminder Due:</span>
            <span>{dueReminder.title}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void snoozeReminder(dueReminder.id, 5)}
              className="flex items-center gap-1 rounded-lg border border-border bg-elevated px-2.5 py-1 text-[11px] hover:border-accent"
            >
              <Clock size={11} /> +5m
            </button>
            <button
              type="button"
              onClick={() => void snoozeReminder(dueReminder.id, 15)}
              className="rounded-lg border border-border bg-elevated px-2.5 py-1 text-[11px] hover:border-accent"
            >
              +15m
            </button>
            <button
              type="button"
              onClick={() => void markReminderDone(dueReminder.id)}
              className="flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1 text-[11px] font-medium text-background"
            >
              <Check size={11} /> Done
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <Timer size={14} className="text-accent" />
            <span className="font-semibold text-accent">Timer Complete:</span>
            <span>{lastRungTimerTitle}</span>
          </div>
          <button
            type="button"
            onClick={dismissTimerChime}
            className="rounded-lg bg-accent px-2.5 py-1 text-[11px] font-medium text-background"
          >
            Dismiss
          </button>
        </>
      )}
    </div>
  );
}
