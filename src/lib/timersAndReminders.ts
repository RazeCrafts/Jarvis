export interface CountdownTimer {
  id: string;
  label: string;
  durationMs: number;
  remainingMs: number;
  running: boolean;
  finished: boolean;
  createdAt: number;
}

export interface StopwatchLap {
  id: string;
  index: number;
  splitMs: number;
  lapMs: number;
}

export type WbReminderPriority = "low" | "normal" | "urgent";
export type WbReminderStatus = "pending" | "due" | "snoozed" | "done";

export interface WbReminder {
  id: string;
  title: string;
  notes?: string;
  dueAt: number;
  priority: WbReminderPriority;
  status: WbReminderStatus;
  createdAt: number;
}

export function formatClockMs(ms: number, includeTenths = false): string {
  const safe = Math.max(0, Math.floor(ms));
  const totalSec = Math.floor(safe / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const tenths = Math.floor((safe % 1000) / 100);

  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  const base = hours > 0 ? `${String(hours).padStart(2, "0")}:${mm}:${ss}` : `${mm}:${ss}`;
  return includeTenths ? `${base}.${tenths}` : base;
}

export function parseDurationMs(input: string): number | null {
  const text = input.toLowerCase();
  let totalMs = 0;
  let matched = false;

  const hMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/);
  if (hMatch) {
    totalMs += Number(hMatch[1]) * 3600_000;
    matched = true;
  }

  const mMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)\b/);
  if (mMatch) {
    totalMs += Number(mMatch[1]) * 60_000;
    matched = true;
  }

  const sMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)\b/);
  if (sMatch) {
    totalMs += Number(sMatch[1]) * 1000;
    matched = true;
  }

  if (!matched) {
    const clock = text.match(/\b(\d{1,2}):(\d{2})\b/);
    if (clock) {
      totalMs = (Number(clock[1]) * 60 + Number(clock[2])) * 1000;
      matched = true;
    }
  }

  return matched && totalMs > 0 ? Math.round(totalMs) : null;
}

export type ParsedUtilityIntent =
  | { kind: "start_timer"; durationMs: number; label: string }
  | { kind: "stopwatch"; action: "start" | "pause" | "reset" | "lap" }
  | { kind: "create_reminder"; title: string; dueAt: number; priority: WbReminderPriority }
  | null;

export function parseTimerOrReminderCommand(raw: string, nowMs = Date.now()): ParsedUtilityIntent {
  const clean = raw.trim().replace(/\s+/g, " ");
  if (!clean) return null;
  const lower = clean.toLowerCase();

  if (/\bstopwatch\b/.test(lower)) {
    if (/\blap|split\b/.test(lower)) return { kind: "stopwatch", action: "lap" };
    if (/\breset|clear\b/.test(lower)) return { kind: "stopwatch", action: "reset" };
    if (/\bstop|pause\b/.test(lower)) return { kind: "stopwatch", action: "pause" };
    return { kind: "stopwatch", action: "start" };
  }

  if (/\b(timer|countdown|alarm)\b/.test(lower) && /\b(set|start|create|add|run|begin)\b/.test(lower)) {
    const durationMs = parseDurationMs(clean);
    if (durationMs) {
      const forMatch = clean.match(/\b(?:for|called|named)\s+(.+?)(?:[.!?]|$)/i);
      const labelCandidate = forMatch?.[1]
        ?.replace(/\b\d+\s*(?:hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/gi, "")
        .trim();
      return {
        kind: "start_timer",
        durationMs,
        label: labelCandidate || `Timer (${formatClockMs(durationMs)})`,
      };
    }
  }

  const remindMatch = clean.match(
    /^(?:wb\s+remind(?:er)?|remind\s+me)\s+(?:in\s+(\d+\s*(?:hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s))\s+)?(?:to\s+)?(.+)/i,
  );
  if (remindMatch) {
    const inClause = remindMatch[1] || "";
    const durationFromTail = parseDurationMs(clean);
    const offsetMs = (inClause ? parseDurationMs(inClause) : durationFromTail) ?? 15 * 60_000;
    const title = remindMatch[2]
      .replace(/\bin\s+\d+\s*(?:hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/gi, "")
      .replace(/^(?:to|that)\s+/i, "")
      .replace(/[.!?]+$/, "")
      .trim();
    if (title) {
      return {
        kind: "create_reminder",
        title,
        dueAt: nowMs + offsetMs,
        priority: /\burgent|asap|important|critical\b/i.test(clean) ? "urgent" : "normal",
      };
    }
  }

  return null;
}

export function computeDueReminders(reminders: WbReminder[], nowMs = Date.now()): WbReminder[] {
  return reminders.filter((r) => r.status !== "done" && r.dueAt <= nowMs);
}

export function stepCountdownTimers(
  timers: CountdownTimer[],
  deltaMs: number,
): { timers: CountdownTimer[]; newlyFinished: CountdownTimer[] } {
  const newlyFinished: CountdownTimer[] = [];
  const next = timers.map((t) => {
    if (!t.running || t.finished) return t;
    const rem = Math.max(0, t.remainingMs - deltaMs);
    if (rem === 0) {
      const done = { ...t, remainingMs: 0, running: false, finished: true };
      newlyFinished.push(done);
      return done;
    }
    return { ...t, remainingMs: rem };
  });
  return { timers: next, newlyFinished };
}
