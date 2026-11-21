import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMemoryWiki,
  buildProactiveBriefing,
  evaluateAutomationRules,
  exportEventsToIcs,
  extractPersonalMemoriesFromTurn,
  searchMemories,
  sortUpcomingEvents,
  type AutomationRule,
  type PersonalMemory,
  type PersonalNote,
} from "./memoryAndCalendar";

test("extracts personal preferences, projects, and explicit remember requests", () => {
  const explicit = extractPersonalMemoriesFromTurn("Remember that my tea order is Earl Grey with no sugar.");
  assert.equal(explicit.length, 1);
  assert.equal(explicit[0].category, "fact");

  const pref = extractPersonalMemoriesFromTurn("I really prefer dark titanium themes for late-night work.");
  assert.equal(pref.length, 1);
  assert.equal(pref[0].category, "preference");

  const question = extractPersonalMemoriesFromTurn("What is my favorite tea order?");
  assert.equal(question.length, 0);
});

test("searches and prioritizes pinned memories", () => {
  const list: PersonalMemory[] = [
    { id: "1", category: "fact", title: "Tea", content: "Earl Grey", pinned: false, createdAt: 1, updatedAt: 100 },
    { id: "2", category: "project", title: "Workshop", content: "Arc reactor CAD", pinned: true, createdAt: 1, updatedAt: 50 },
  ];
  const results = searchMemories(list, "");
  assert.equal(results[0].id, "2");
  assert.equal(searchMemories(list, "earl", "fact").length, 1);
});

test("builds structured Memory Wiki and evaluates proactive briefings & rules", () => {
  const memories: PersonalMemory[] = [
    { id: "m1", category: "project", title: "Orbital Rig", content: "CAD thruster test", pinned: true, createdAt: 1, updatedAt: 10 },
    { id: "m2", category: "preference", title: "Theme", content: "Arc Titanium HUD", pinned: false, createdAt: 1, updatedAt: 20 },
  ];
  const notes: PersonalNote[] = [
    { id: "n1", title: "Lab Spec", body: "Thrust target 240N", tags: ["project", "lab"], updatedAt: 30 },
  ];
  const wiki = buildMemoryWiki(memories, notes);
  assert.ok(wiki.some((s) => s.category === "project" && s.entries.length === 2));
  assert.ok(wiki.some((s) => s.category === "notes"));

  const now = Date.parse("2026-11-20T09:00:00Z");
  const rules: AutomationRule[] = [
    {
      id: "r1",
      name: "Morning Briefing",
      triggerType: "morning_brief",
      actionSummary: "Summarize schedule and pinned tasks",
      enabled: true,
    },
    {
      id: "r2",
      name: "Meeting Focus",
      triggerType: "meeting_approaching",
      actionSummary: "Send pre-meeting context",
      enabled: true,
    },
  ];
  const triggered = evaluateAutomationRules(
    rules,
    [{ id: "c1", title: "Design Sync", startISO: "2026-11-20T09:15:00Z", endISO: "2026-11-20T09:45:00Z", reminderMinutes: 10 }],
    now,
  );
  assert.ok(triggered.length >= 1);

  const brief = buildProactiveBriefing({
    userTitle: "Sir",
    memories,
    calendar: [{ id: "c1", title: "Design Sync", startISO: "2026-11-20T09:15:00Z", endISO: "2026-11-20T09:45:00Z", reminderMinutes: 10 }],
    activeRoutinesCount: 2,
    nowMs: now,
  });
  assert.equal(brief.upcomingCount, 1);
  assert.ok(brief.workspaceStatus.includes("2 active routines"));
});

test("sorts calendar events chronologically and exports valid ICS", () => {
  const events = sortUpcomingEvents([
    { id: "b", title: "Dinner", startISO: "2026-11-20T19:00:00Z", endISO: "2026-11-20T20:00:00Z", reminderMinutes: 15 },
    { id: "a", title: "Standup", startISO: "2026-11-20T09:00:00Z", endISO: "2026-11-20T09:30:00Z", reminderMinutes: 10 },
  ]);
  assert.equal(events[0].id, "a");
  const ics = exportEventsToIcs(events);
  assert.ok(ics.includes("BEGIN:VCALENDAR"));
  assert.ok(ics.includes("SUMMARY:Standup"));
  assert.ok(ics.includes("END:VCALENDAR"));
});
