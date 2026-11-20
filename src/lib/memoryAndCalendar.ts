export type MemoryCategory = "preference" | "person" | "project" | "fact" | "routine";

export interface PersonalMemory {
  id: string;
  category: MemoryCategory;
  title: string;
  content: string;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface PersonalNote {
  id: string;
  title: string;
  body: string;
  tags: string[];
  updatedAt: number;
}

export interface CalendarEvent {
  id: string;
  title: string;
  startISO: string;
  endISO: string;
  location?: string;
  notes?: string;
  recurrence?: "none" | "daily" | "weekly" | "monthly";
  reminderMinutes: number;
  completed?: boolean;
}

export interface AutomationRule {
  id: string;
  name: string;
  triggerType: "lock_unlocked_away" | "meeting_approaching" | "motion_detected" | "evening_hour";
  actionSummary: string;
  targetSceneId?: string;
  enabled: boolean;
  lastTriggeredAt?: number;
}

export interface SecurityLogEntry {
  id: string;
  severity: "info" | "alert";
  source: string;
  message: string;
  ts: number;
}

export interface WikiSection {
  id: string;
  title: string;
  category: MemoryCategory | "notes";
  summary: string;
  entries: Array<{
    id: string;
    title: string;
    detail: string;
    pinned: boolean;
    tags: string[];
    sourceType: "memory" | "note";
    updatedAt: number;
  }>;
}

export interface ProactiveBriefing {
  headline: string;
  period: "morning" | "afternoon" | "evening";
  securityStatus: string;
  upcomingCount: number;
  nextEventTitle: string | null;
  pinnedFocus: string[];
  alerts: string[];
  suggestedPrompt: string;
}

const MEMORY_PATTERNS: Array<{ re: RegExp; category: MemoryCategory; prefix: string }> = [
  { re: /^(?:remember(?:\s+that)?|don'?t\s+forget(?:\s+that)?|keep\s+in\s+mind(?:\s+that)?)\s+(.+)/i, category: "fact", prefix: "Saved memory" },
  { re: /\bmy\s+(?:favorite|preferred|go-to)\s+(.+?)\s+is\s+(.+)/i, category: "preference", prefix: "Preference" },
  { re: /\bi\s+(?:really\s+)?(?:like|love|prefer|enjoy|hate|dislike)\s+(.+)/i, category: "preference", prefix: "Preference" },
  { re: /\bmy\s+(?:name\s+is|friend|sister|brother|mom|mother|dad|father|partner|boss|colleague)\b(.+)/i, category: "person", prefix: "Personal context" },
  { re: /\bi(?:'m|\s+am)\s+(?:working\s+on|building|studying|preparing\s+for)\s+(.+)/i, category: "project", prefix: "Active project" },
  { re: /\bevery\s+(?:morning|evening|night|day|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+i\s+(.+)/i, category: "routine", prefix: "Routine" },
];

export function extractPersonalMemoriesFromTurn(userText: string): Array<{
  category: MemoryCategory;
  title: string;
  content: string;
}> {
  const cleaned = userText.trim().replace(/\s+/g, " ");
  if (cleaned.length < 8 || cleaned.endsWith("?")) return [];

  const found: Array<{ category: MemoryCategory; title: string; content: string }> = [];
  for (const pat of MEMORY_PATTERNS) {
    if (pat.re.test(cleaned)) {
      const m = cleaned.match(pat.re);
      const detail = (m?.[1] || cleaned).trim();
      const shortTitle = detail.split(" ").slice(0, 6).join(" ").replace(/[.!?]+$/, "");
      found.push({
        category: pat.category,
        title: `${pat.prefix}: ${shortTitle.charAt(0).toUpperCase()}${shortTitle.slice(1)}`,
        content: cleaned,
      });
      break;
    }
  }
  return found;
}

export function searchMemories(memories: PersonalMemory[], query: string, category?: MemoryCategory | "all"): PersonalMemory[] {
  const q = query.trim().toLowerCase();
  return [...memories]
    .filter((m) => (!category || category === "all" ? true : m.category === category))
    .filter((m) => !q || `${m.title} ${m.content} ${m.category}`.toLowerCase().includes(q))
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });
}

export function sortUpcomingEvents(events: CalendarEvent[], nowMs = Date.now()): CalendarEvent[] {
  return [...events].sort((a, b) => {
    const ta = Date.parse(a.startISO) || nowMs;
    const tb = Date.parse(b.startISO) || nowMs;
    return ta - tb;
  });
}

function toIcsTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "20260101T090000Z";
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function exportEventsToIcs(events: CalendarEvent[]): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//JARVIS//Personal Butler Schedule//EN",
  ];
  for (const ev of events) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${ev.id}@jarvis.local`);
    lines.push(`DTSTART:${toIcsTimestamp(ev.startISO)}`);
    lines.push(`DTEND:${toIcsTimestamp(ev.endISO)}`);
    lines.push(`SUMMARY:${ev.title.replace(/\r?\n/g, " ")}`);
    if (ev.location) lines.push(`LOCATION:${ev.location.replace(/\r?\n/g, " ")}`);
    if (ev.notes) lines.push(`DESCRIPTION:${ev.notes.replace(/\r?\n/g, "\\n")}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

const WIKI_TOPIC_META: Record<MemoryCategory, { title: string; summary: string }> = {
  project: { title: "Active Projects & Builds", summary: "Ongoing engineering builds, goals, and workspace initiatives." },
  preference: { title: "Personal Preferences", summary: "Taste, UI defaults, audio/visual style, and butler interaction rules." },
  person: { title: "People & Circle", summary: "Contacts, family, collaborators, and key relationship context." },
  routine: { title: "Daily Routines & Habits", summary: "Recurring daily habits and scheduled cadence." },
  fact: { title: "Saved Facts & Reference", summary: "Explicit details JARVIS was asked to remember indefinitely." },
};

/**
 * Compiles personal memories and markdown notes into an organized Knowledge Wiki.
 */
export function buildMemoryWiki(memories: PersonalMemory[], notes: PersonalNote[]): WikiSection[] {
  const order: MemoryCategory[] = ["project", "preference", "person", "routine", "fact"];
  const sections: WikiSection[] = [];

  for (const cat of order) {
    const matchingMem = searchMemories(memories, "", cat).map((m) => ({
      id: m.id,
      title: m.title,
      detail: m.content,
      pinned: m.pinned,
      tags: [cat],
      sourceType: "memory" as const,
      updatedAt: m.updatedAt,
    }));

    const relatedNotes = notes
      .filter((n) => n.tags.some((t) => t.toLowerCase().includes(cat)))
      .map((n) => ({
        id: n.id,
        title: n.title,
        detail: n.body,
        pinned: false,
        tags: n.tags,
        sourceType: "note" as const,
        updatedAt: n.updatedAt,
      }));

    const entries = [...matchingMem, ...relatedNotes];
    if (entries.length > 0) {
      sections.push({
        id: `wiki-${cat}`,
        title: WIKI_TOPIC_META[cat].title,
        category: cat,
        summary: WIKI_TOPIC_META[cat].summary,
        entries,
      });
    }
  }

  if (notes.length > 0) {
    sections.push({
      id: "wiki-notes",
      title: "Notebook Pages",
      category: "notes",
      summary: "Long-form markdown notes, plans, and captured web extracts.",
      entries: [...notes]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((n) => ({
          id: n.id,
          title: n.title,
          detail: n.body,
          pinned: false,
          tags: n.tags,
          sourceType: "note" as const,
          updatedAt: n.updatedAt,
        })),
    });
  }

  return sections;
}

/**
 * Evaluates condition-triggered smart-home / calendar automation rules safely.
 */
export function evaluateAutomationRules(
  rules: AutomationRule[],
  devices: Array<{ id: string; name: string; type: string; on: boolean; statusText: string }>,
  calendar: CalendarEvent[],
  watchdogArmed: boolean,
  nowMs = Date.now(),
): Array<{ ruleId: string; ruleName: string; message: string; targetSceneId?: string }> {
  const triggered: Array<{ ruleId: string; ruleName: string; message: string; targetSceneId?: string }> = [];
  const hour = new Date(nowMs).getHours();

  for (const rule of rules) {
    if (!rule.enabled) continue;

    if (rule.triggerType === "lock_unlocked_away" && watchdogArmed) {
      const unlocked = devices.find((d) => d.type === "lock" && !d.on);
      if (unlocked) {
        triggered.push({
          ruleId: rule.id,
          ruleName: rule.name,
          message: `Watchdog alert: ${unlocked.name} is unlocked while Watchdog Mode is armed.`,
          targetSceneId: rule.targetSceneId,
        });
      }
    }

    if (rule.triggerType === "meeting_approaching") {
      const soon = calendar.find((ev) => {
        if (ev.completed) return false;
        const start = Date.parse(ev.startISO);
        if (!Number.isFinite(start)) return false;
        const diffMin = (start - nowMs) / 60000;
        return diffMin >= 0 && diffMin <= 30;
      });
      if (soon) {
        triggered.push({
          ruleId: rule.id,
          ruleName: rule.name,
          message: `Upcoming schedule trigger: "${soon.title}" starts within 30 minutes.`,
          targetSceneId: rule.targetSceneId,
        });
      }
    }

    if (rule.triggerType === "evening_hour" && hour >= 20) {
      triggered.push({
        ruleId: rule.id,
        ruleName: rule.name,
        message: `Evening routine (${hour}:00) ready: ${rule.actionSummary}`,
        targetSceneId: rule.targetSceneId,
      });
    }
  }

  return triggered;
}

/**
 * Synthesizes a deterministic proactive butler briefing from current life state.
 */
export function buildProactiveBriefing(input: {
  userTitle?: string;
  memories: PersonalMemory[];
  calendar: CalendarEvent[];
  devices: Array<{ type: string; on: boolean; name: string }>;
  watchdogArmed: boolean;
  securityAlertsCount?: number;
  nowMs?: number;
}): ProactiveBriefing {
  const nowMs = input.nowMs ?? Date.now();
  const hour = new Date(nowMs).getHours();
  const period: ProactiveBriefing["period"] =
    hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  const userTitle = input.userTitle?.trim() || "Sir";

  const upcoming = sortUpcomingEvents(input.calendar, nowMs).filter((e) => !e.completed);
  const nextEvent = upcoming[0] ?? null;

  const unlockedCount = input.devices.filter((d) => d.type === "lock" && !d.on).length;
  const activeLights = input.devices.filter((d) => d.type === "light" && d.on).length;
  const securityStatus = input.watchdogArmed
    ? unlockedCount > 0
      ? `Watchdog Armed · ${unlockedCount} lock open`
      : "Watchdog Armed · Perimeter secure"
    : `${activeLights} lights active · ${unlockedCount === 0 ? "Locks secure" : `${unlockedCount} lock unlocked`}`;

  const pinnedFocus = searchMemories(input.memories, "")
    .filter((m) => m.pinned)
    .slice(0, 3)
    .map((m) => m.title);

  const alerts: string[] = [];
  if (input.watchdogArmed && unlockedCount > 0) {
    alerts.push(`${unlockedCount} smart lock is unlocked while Watchdog Mode is active.`);
  }
  if ((input.securityAlertsCount || 0) > 0) {
    alerts.push(`${input.securityAlertsCount} recent home security event logged.`);
  }
  if (nextEvent) {
    alerts.push(`Next on schedule: ${nextEvent.title}`);
  }

  return {
    headline: `Good ${period}, ${userTitle}. ${upcoming.length} pending event${upcoming.length === 1 ? "" : "s"} · ${securityStatus}.`,
    period,
    securityStatus,
    upcomingCount: upcoming.length,
    nextEventTitle: nextEvent ? nextEvent.title : null,
    pinnedFocus,
    alerts,
    suggestedPrompt:
      "Deliver a full proactive briefing of my schedule, pinned focus items, and home status with a live visual summary chart.",
  };
}
