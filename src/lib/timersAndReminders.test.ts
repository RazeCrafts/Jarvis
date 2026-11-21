import test from "node:test";
import assert from "node:assert/strict";
import {
  computeDueReminders,
  formatClockMs,
  parseDurationMs,
  parseTimerOrReminderCommand,
  stepCountdownTimers,
  type CountdownTimer,
  type WbReminder,
} from "./timersAndReminders.ts";

test("parseDurationMs & formatClockMs handle multi-unit durations", () => {
  assert.equal(parseDurationMs("5 minutes"), 300_000);
  assert.equal(parseDurationMs("1h 30m 10s"), 5_410_000);
  assert.equal(parseDurationMs("02:15"), 135_000);
  assert.equal(formatClockMs(135_400, true), "02:15.4");
  assert.equal(formatClockMs(3_661_000), "01:01:01");
});

test("parseTimerOrReminderCommand extracts timers, stopwatches, and WB reminders", () => {
  const timerCmd = parseTimerOrReminderCommand("Set a 5 minute timer for coffee");
  assert.deepEqual(timerCmd, {
    kind: "start_timer",
    durationMs: 300_000,
    label: "coffee",
  });

  const swCmd = parseTimerOrReminderCommand("Record stopwatch lap");
  assert.deepEqual(swCmd, { kind: "stopwatch", action: "lap" });

  const now = 1_700_000_000_000;
  const remCmd = parseTimerOrReminderCommand("WB remind me in 10 minutes to check the 3D print urgent", now);
  assert.equal(remCmd?.kind, "create_reminder");
  if (remCmd?.kind === "create_reminder") {
    assert.equal(remCmd.dueAt, now + 600_000);
    assert.equal(remCmd.priority, "urgent");
    assert.ok(remCmd.title.includes("check the 3D print"));
  }
});

test("stepCountdownTimers and computeDueReminders detect completion & due items", () => {
  const timers: CountdownTimer[] = [
    { id: "t1", label: "Tea", durationMs: 5000, remainingMs: 500, running: true, finished: false, createdAt: 1 },
  ];
  const stepped = stepCountdownTimers(timers, 600);
  assert.equal(stepped.newlyFinished.length, 1);
  assert.equal(stepped.timers[0].finished, true);
  assert.equal(stepped.timers[0].remainingMs, 0);

  const reminders: WbReminder[] = [
    { id: "r1", title: "Call vendor", dueAt: 1000, priority: "normal", status: "pending", createdAt: 1 },
    { id: "r2", title: "Archive", dueAt: 500, priority: "low", status: "done", createdAt: 1 },
  ];
  const due = computeDueReminders(reminders, 1500);
  assert.deepEqual(
    due.map((r) => r.id),
    ["r1"],
  );
});
