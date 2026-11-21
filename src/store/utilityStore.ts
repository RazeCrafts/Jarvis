import { create } from "zustand";
import { persist } from "zustand/middleware";
import { agentApi } from "@/lib/agentApi";
import {
  computeDueReminders,
  stepCountdownTimers,
  type CountdownTimer,
  type StopwatchLap,
  type WbReminder,
} from "@/lib/timersAndReminders";

function playAlarmChime(): void {
  try {
    const Ctx =
      (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
        .AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    const notes = [659.25, 880, 1046.5];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      const start = now + idx * 0.14;
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(0.14, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.36);
    });
    window.setTimeout(() => void ctx.close(), 1200);
  } catch {
    /* ignore audio blocked */
  }
}

interface UtilityState {
  reminders: WbReminder[];
  dueAlertIds: string[];
  timers: CountdownTimer[];
  lastTimerTickAt: number | null;
  lastRungTimerTitle: string | null;

  stopwatchRunning: boolean;
  stopwatchElapsedMs: number;
  stopwatchLastTickAt: number | null;
  stopwatchLaps: StopwatchLap[];

  syncUtilities: () => Promise<void>;
  addReminder: (payload: {
    title: string;
    dueAt: number;
    priority?: WbReminder["priority"];
    notes?: string;
  }) => Promise<void>;
  markReminderDone: (id: string) => Promise<void>;
  snoozeReminder: (id: string, minutes: number) => Promise<void>;
  deleteReminder: (id: string) => Promise<void>;
  dismissDueAlert: (id: string) => void;

  addTimer: (label: string, durationMs: number) => void;
  toggleTimer: (id: string) => void;
  resetTimer: (id: string) => void;
  deleteTimer: (id: string) => void;
  dismissTimerChime: () => void;

  startStopwatch: () => void;
  pauseStopwatch: () => void;
  resetStopwatch: () => void;
  lapStopwatch: () => void;
  handleStopwatchCommand: (action: "start" | "pause" | "reset" | "lap") => void;

  tick: (nowMs?: number) => void;
}

export const useUtilityStore = create<UtilityState>()(
  persist(
    (set, get) => ({
      reminders: [],
      dueAlertIds: [],
      timers: [],
      lastTimerTickAt: null,
      lastRungTimerTitle: null,

      stopwatchRunning: false,
      stopwatchElapsedMs: 0,
      stopwatchLastTickAt: null,
      stopwatchLaps: [],

      syncUtilities: async () => {
        try {
          const res = await agentApi.getUtilities();
          const now = Date.now();
          const due = computeDueReminders(res.wbReminders, now).map((r) => r.id);
          set((s) => ({
            reminders: res.wbReminders,
            dueAlertIds: due,
            timers: res.timers.length > 0 && s.timers.length === 0 ? res.timers : s.timers,
          }));
        } catch {
          /* offline tolerance */
        }
      },

      addReminder: async (payload) => {
        const res = await agentApi.createWbReminder(payload);
        const now = Date.now();
        set({
          reminders: res.items,
          dueAlertIds: computeDueReminders(res.items, now).map((r) => r.id),
        });
      },

      markReminderDone: async (id) => {
        const res = await agentApi.updateWbReminder(id, { status: "done" });
        set((s) => ({
          reminders: res.items,
          dueAlertIds: s.dueAlertIds.filter((x) => x !== id),
        }));
      },

      snoozeReminder: async (id, minutes) => {
        const dueAt = Date.now() + minutes * 60_000;
        const res = await agentApi.updateWbReminder(id, { status: "snoozed", dueAt });
        set((s) => ({
          reminders: res.items,
          dueAlertIds: s.dueAlertIds.filter((x) => x !== id),
        }));
      },

      deleteReminder: async (id) => {
        const res = await agentApi.deleteWbReminder(id);
        set((s) => ({
          reminders: res.items,
          dueAlertIds: s.dueAlertIds.filter((x) => x !== id),
        }));
      },

      dismissDueAlert: (id) =>
        set((s) => ({ dueAlertIds: s.dueAlertIds.filter((x) => x !== id) })),

      addTimer: (label, durationMs) => {
        const now = Date.now();
        const item: CountdownTimer = {
          id: `tmr-${now}-${Math.random().toString(36).slice(2, 6)}`,
          label: label.trim() || "Countdown",
          durationMs,
          remainingMs: durationMs,
          running: true,
          finished: false,
          createdAt: now,
        };
        const nextTimers = [item, ...get().timers];
        set({ timers: nextTimers, lastTimerTickAt: now });
        void agentApi.saveTimers(nextTimers).catch(() => undefined);
      },

      toggleTimer: (id) => {
        const now = Date.now();
        const nextTimers = get().timers.map((t) => {
          if (t.id !== id) return t;
          if (t.running) {
            return { ...t, running: false };
          }
          const base = t.finished || t.remainingMs <= 0 ? t.durationMs : t.remainingMs;
          return { ...t, running: true, finished: false, remainingMs: base };
        });
        set({ timers: nextTimers, lastTimerTickAt: now });
        void agentApi.saveTimers(nextTimers).catch(() => undefined);
      },

      resetTimer: (id) => {
        const nextTimers = get().timers.map((t) =>
          t.id === id ? { ...t, running: false, finished: false, remainingMs: t.durationMs } : t,
        );
        set({ timers: nextTimers });
        void agentApi.saveTimers(nextTimers).catch(() => undefined);
      },

      deleteTimer: (id) => {
        const nextTimers = get().timers.filter((t) => t.id !== id);
        set({ timers: nextTimers });
        void agentApi.saveTimers(nextTimers).catch(() => undefined);
      },

      dismissTimerChime: () => set({ lastRungTimerTitle: null }),

      startStopwatch: () =>
        set((s) =>
          s.stopwatchRunning ? s : { stopwatchRunning: true, stopwatchLastTickAt: Date.now() },
        ),

      pauseStopwatch: () => {
        const now = Date.now();
        const s = get();
        const delta = s.stopwatchRunning && s.stopwatchLastTickAt ? now - s.stopwatchLastTickAt : 0;
        set({
          stopwatchRunning: false,
          stopwatchElapsedMs: s.stopwatchElapsedMs + delta,
          stopwatchLastTickAt: null,
        });
      },

      resetStopwatch: () =>
        set({
          stopwatchRunning: false,
          stopwatchElapsedMs: 0,
          stopwatchLastTickAt: null,
          stopwatchLaps: [],
        }),

      lapStopwatch: () => {
        const now = Date.now();
        const s = get();
        const extra = s.stopwatchRunning && s.stopwatchLastTickAt ? now - s.stopwatchLastTickAt : 0;
        const totalMs = s.stopwatchElapsedMs + extra;
        const prevTotal = s.stopwatchLaps[0]?.splitMs ?? 0;
        const nextLap: StopwatchLap = {
          id: `lap-${now}-${s.stopwatchLaps.length + 1}`,
          index: s.stopwatchLaps.length + 1,
          splitMs: totalMs,
          lapMs: Math.max(0, totalMs - prevTotal),
        };
        set({
          stopwatchElapsedMs: totalMs,
          stopwatchLastTickAt: s.stopwatchRunning ? now : null,
          stopwatchLaps: [nextLap, ...s.stopwatchLaps],
        });
      },

      handleStopwatchCommand: (action) => {
        const store = get();
        if (action === "start") store.startStopwatch();
        else if (action === "pause") store.pauseStopwatch();
        else if (action === "reset") store.resetStopwatch();
        else if (action === "lap") store.lapStopwatch();
      },

      tick: (nowMs = Date.now()) => {
        const s = get();
        let nextElapsed = s.stopwatchElapsedMs;
        let nextLastTick = s.stopwatchLastTickAt;
        if (s.stopwatchRunning) {
          nextElapsed += s.stopwatchLastTickAt ? Math.max(0, nowMs - s.stopwatchLastTickAt) : 0;
          nextLastTick = nowMs;
        }

        const hasRunningTimer = s.timers.some((t) => t.running);
        if (hasRunningTimer) {
          const deltaMs = s.lastTimerTickAt ? Math.max(0, nowMs - s.lastTimerTickAt) : 100;
          const { timers: nextTimers, newlyFinished } = stepCountdownTimers(s.timers, deltaMs);
          if (newlyFinished.length > 0) {
            playAlarmChime();
            void agentApi.saveTimers(nextTimers).catch(() => undefined);
          }
          set({
            stopwatchElapsedMs: nextElapsed,
            stopwatchLastTickAt: nextLastTick,
            timers: nextTimers,
            lastTimerTickAt: nowMs,
            lastRungTimerTitle: newlyFinished[0]?.label ?? s.lastRungTimerTitle,
          });
        } else if (s.stopwatchRunning) {
          set({
            stopwatchElapsedMs: nextElapsed,
            stopwatchLastTickAt: nextLastTick,
            lastTimerTickAt: nowMs,
          });
        }
      },
    }),
    {
      name: "jarvis-utilities-v1",
      partialize: (s) => ({
        timers: s.timers,
        stopwatchElapsedMs: s.stopwatchElapsedMs,
        stopwatchLaps: s.stopwatchLaps,
      }),
    },
  ),
);
