import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { NormalizedPlugin } from "../src/lib/pluginAdapter";
import type {
  AutomationRule,
  CalendarEvent,
  PersonalMemory,
  PersonalNote,
} from "../src/lib/memoryAndCalendar";

import type { WorkspaceVaultFile } from "../src/lib/fileGalaxy";
import type { CountdownTimer, WbReminder } from "../src/lib/timersAndReminders";
import type { ApiCostEntry } from "../src/lib/workshopProtocol";

export interface GatewayMessageEntry {
  id: string;
  platform: "telegram" | "discord" | "slack" | "whatsapp";
  sender: string;
  direction: "inbound" | "outbound";
  text: string;
  ts: number;
}

export interface PersistedCronJob {
  id: string;
  name: string;
  schedule: string;
  prompt: string;
  deliver: string[];
  state: string;
  enabled: boolean;
  skills: string[];
}

export interface PersonaConfig {
  assistantName: string;
  userTitle: string;
  witLevel: "dry" | "balanced" | "warm";
  conciseness: "brief" | "detailed";
  proactiveMemory: boolean;
  liveGraphsByDefault: boolean;
  systemDirectives: string;
}

export interface HudConfig {
  themeId: string;
  customAccent: string;
  borderRadius: number;
  compactMode: boolean;
  visibleWidgets: string[];
}

export interface AccountConnectorState {
  id: string;
  name: string;
  providerSlug: string;
  authMode: "oauth_portal" | "oauth_device" | "local_cli_bridge";
  connected: boolean;
  accountLabel: string;
  lastCheckedAt: number | null;
  notes: string;
}

export interface PersistedJarvisData {
  activeProfileName: string;
  persona: PersonaConfig;
  hud: HudConfig;
  memories: PersonalMemory[];
  notes: PersonalNote[];
  calendar: CalendarEvent[];
  vaultFiles: WorkspaceVaultFile[];
  wbReminders: WbReminder[];
  timers: CountdownTimer[];
  costLog: ApiCostEntry[];
  automations: AutomationRule[];
  gatewayMessages: GatewayMessageEntry[];
  cronJobs: PersistedCronJob[];
  plugins: NormalizedPlugin[];
  accountConnectors: AccountConnectorState[];
  mediaHistory: Array<{ id: string; title: string; channel: string; url: string; embedUrl?: string; kind: "video" | "music"; addedAt: number }>;
}

const DATA_DIR = path.resolve(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "jarvis-state.json");

function createDefaultData(): PersistedJarvisData {
  const now = Date.now();
  const today = new Date();
  const isoDay = today.toISOString().slice(0, 10);

  return {
    activeProfileName: "Personal",
    persona: {
      assistantName: "JARVIS",
      userTitle: "Sir",
      witLevel: "balanced",
      conciseness: "brief",
      proactiveMemory: true,
      liveGraphsByDefault: true,
      systemDirectives:
        "You are JARVIS, a refined, hyper-competent British personal butler and autonomous engineering workstation. Keep Butler Mode replies crisp and conversational; expand deeply in Full Text Agent Mode.",
    },
    hud: {
      themeId: "golden-hologram",
      customAccent: "",
      borderRadius: 14,
      compactMode: false,
      visibleWidgets: ["core", "schedule", "memories", "media"],
    },
    memories: [
      {
        id: "mem-1",
        category: "preference",
        title: "HUD Visual Preference",
        content: "Prefers the Golden Holographic Core aesthetic with clean data charts and Butler Mode voice brevity.",
        pinned: true,
        createdAt: now - 86400000,
        updatedAt: now - 3600000,
      },
      {
        id: "mem-2",
        category: "project",
        title: "JARVIS Autonomous Workstation",
        content: "Desktop-first cross-platform engineering assistant with Hermes plugins, coding self-healing, and media search.",
        pinned: true,
        createdAt: now - 43200000,
        updatedAt: now - 1800000,
      },
    ],
    notes: [
      {
        id: "note-1",
        title: "Workshop & Automation Ideas",
        body: "- Connect living room lights to Movie Night scene\n- Organize weekend video edit timeline\n- Import community skills via URL without breaking core setup",
        tags: ["ideas", "automation"],
        updatedAt: now - 7200000,
      },
    ],
    calendar: [
      {
        id: "cal-1",
        title: "Morning Systems & Schedule Briefing",
        startISO: `${isoDay}T09:00:00`,
        endISO: `${isoDay}T09:30:00`,
        location: "Command HUD",
        notes: "Daily summary of tasks, notes, and home status.",
        recurrence: "daily",
        reminderMinutes: 10,
        completed: false,
      },
      {
        id: "cal-2",
        title: "Workshop Design & Video Review",
        startISO: `${isoDay}T15:00:00`,
        endISO: `${isoDay}T16:00:00`,
        location: "Studio",
        notes: "Inspect latest 3D prototype and render cut.",
        recurrence: "none",
        reminderMinutes: 15,
        completed: false,
      },
    ],
    vaultFiles: [
      {
        id: "file-spec-1",
        name: "orbital-truss-specs.md",
        mimeType: "text/markdown",
        sizeBytes: 1840,
        category: "document",
        tags: ["aerospace", "workshop", "cad"],
        textPreview:
          "# Orbital Truss Assembly\nPrimary frame: brushed titanium.\nSolar wing hinges linked to [[Workshop & Automation Ideas]].\nMass budget target: 4.2 kg.",
        createdAt: now - 5400000,
        updatedAt: now - 5400000,
      },
      {
        id: "file-telemetry-1",
        name: "acoustic-eq-preset.json",
        mimeType: "application/json",
        sizeBytes: 620,
        category: "data",
        tags: ["audio", "vlc", "preset"],
        textPreview: '{"profile":"Studio Warm","preampPercent":120,"bands":[3,1,0,2,4]}',
        createdAt: now - 3200000,
        updatedAt: now - 3200000,
      },
    ],
    wbReminders: [
      {
        id: "rem-1",
        title: "Review Workshop Exploded Print tolerances",
        notes: "Check 0.2mm clearance on rotor mounts before exporting STL.",
        dueAt: now + 3600_000,
        priority: "normal",
        status: "pending",
        createdAt: now - 600_000,
      },
    ],
    timers: [],
    costLog: [],
    automations: [
      {
        id: "auto-morning",
        name: "Morning Schedule & Inbox Digest",
        triggerType: "morning_brief",
        actionSummary: "Compile schedule highlights and top unread priorities",
        targetChannel: "hud",
        enabled: true,
      },
      {
        id: "auto-meeting",
        name: "Meeting Focus Prep",
        triggerType: "meeting_approaching",
        actionSummary: "Notify HUD with calendar notes 30m before events",
        targetChannel: "hud",
        enabled: true,
      },
    ],
    gatewayMessages: [],
    cronJobs: [],
    plugins: [
      {
        id: "live-visual-explainer",
        name: "Live Visual Explainer",
        version: "1.0.0",
        description: "Automatically generates interactive charts, graphs, and flowcharts while explaining topics.",
        sourceKind: "builtin",
        schemaVersion: 1,
        upstreamUrl: "",
        pinnedSha: "builtin001",
        triggers: ["graph", "chart", "visualize", "compare", "explain"],
        providesTools: ["render_live_visual"],
        providesHooks: ["on_assistant_explain"],
        requiresBridge: false,
        instructions: "Produce structured chart/diagram specs alongside explanations so the user sees live data visually.",
        enabled: true,
        updatedAt: now,
        rawSource: "",
        extraSchema: {},
      },
      {
        id: "personal-memory-concierge",
        name: "Personal Memory & Notes Concierge",
        version: "1.0.0",
        description: "Automatically remembers personal preferences, people, routines, and saves notes on request.",
        sourceKind: "builtin",
        schemaVersion: 1,
        upstreamUrl: "",
        pinnedSha: "builtin002",
        triggers: ["remember", "note", "recall", "my favorite"],
        providesTools: ["save_personal_memory", "save_note", "schedule_calendar_event"],
        providesHooks: ["on_user_message"],
        requiresBridge: false,
        instructions: "Extract personal details worth recalling later and confirm succinctly.",
        enabled: true,
        updatedAt: now,
        rawSource: "",
        extraSchema: {},
      },
      {
        id: "computer-use-background",
        name: "Computer Use (Background-First CUA)",
        version: "1.4.0",
        description: "Background-first desktop interaction, window control, Circle-to-Search vision crops, and non-disruptive OS automation.",
        sourceKind: "builtin",
        schemaVersion: 1,
        upstreamUrl: "https://github.com/NousResearch/hermes-official-plugins",
        pinnedSha: "builtin003",
        triggers: ["computer use", "open app", "circle screen", "read screen", "automate pc"],
        providesTools: ["navigate_and_act"],
        providesHooks: ["on_user_message"],
        requiresBridge: false,
        instructions: "Inspect visible UI or desktop frames cleanly, invoke native actions when paired, and switch tabs inside JARVIS automatically when needed.",
        enabled: true,
        updatedAt: now,
        rawSource: "",
        extraSchema: {},
      },
      {
        id: "react-reasoning-planner",
        name: "ReAct Multi-Step Planner (ReA)",
        version: "1.2.0",
        description: "Structured Thought -> Action -> Observation planning engine for research, coding, and autonomous workflows.",
        sourceKind: "builtin",
        schemaVersion: 1,
        upstreamUrl: "https://github.com/NousResearch/hermes-official-plugins",
        pinnedSha: "builtin004",
        triggers: ["rea", "react", "plan", "reason", "step by step"],
        providesTools: ["render_live_visual", "extract_url_insights", "navigate_and_act"],
        providesHooks: ["on_user_message"],
        requiresBridge: false,
        instructions: "Execute multi-step verification using grounded tools and live charts before concluding.",
        enabled: true,
        updatedAt: now,
        rawSource: "",
        extraSchema: {},
      },
      {
        id: "video-auto-director",
        name: "Auto Video Studio Director",
        version: "1.2.0",
        description: "Switches to Video Studio automatically when clips are sent, places them on the timeline, applies motion/grades/captions, and exports.",
        sourceKind: "builtin",
        schemaVersion: 1,
        upstreamUrl: "",
        pinnedSha: "builtin005",
        triggers: ["edit video", "edit clips", "montage", "trim clip", "ken burns"],
        providesTools: ["navigate_and_act"],
        providesHooks: ["on_user_message"],
        requiresBridge: false,
        instructions: "When video clips or editing instructions arrive, automatically navigate to the video tab and emit editing directives.",
        enabled: true,
        updatedAt: now,
        rawSource: "",
        extraSchema: {},
      },
      {
        id: "artcraft-mcp-studio",
        name: "Storytold ArtCraft MCP Studio",
        version: "1.1.0",
        description: "Edits designs, photos, vectors, and stage lighting inside Storytold ArtCraft apps (DesignCraft, PhotoCraft, VectorCraft, LightCraft) via MCP.",
        sourceKind: "builtin",
        schemaVersion: 1,
        upstreamUrl: "https://github.com/storytold",
        pinnedSha: "builtin006",
        triggers: ["artcraft", "designcraft", "photocraft", "vectorcraft", "lightcraft"],
        providesTools: ["run_artcraft_mcp"],
        providesHooks: ["on_creative_edit"],
        requiresBridge: false,
        instructions: "Forward creative canvas/layer/lighting edits to Storytold Craft MCP endpoints using run_artcraft_mcp.",
        enabled: true,
        updatedAt: now,
        rawSource: "",
        extraSchema: {},
      },
    ],
    accountConnectors: [
      {
        id: "nous-portal",
        name: "Nous Portal Account",
        providerSlug: "nous-portal",
        authMode: "oauth_portal",
        connected: false,
        accountLabel: "",
        lastCheckedAt: null,
        notes: "Sign in with your Nous Portal subscription gateway without managing raw provider keys.",
      },
      {
        id: "chatgpt-codex",
        name: "ChatGPT / Codex Subscription",
        providerSlug: "openai-oauth",
        authMode: "oauth_device",
        connected: false,
        accountLabel: "",
        lastCheckedAt: null,
        notes: "Authenticate using device/account OAuth flow compatible with upstream plugin specs.",
      },
      {
        id: "claude-subscription-directsdk",
        name: "Claude Subscription DirectSDK",
        providerSlug: "claude-directsdk",
        authMode: "local_cli_bridge",
        connected: false,
        accountLabel: "",
        lastCheckedAt: null,
        notes: "Routes requests through your active Claude Pro/Max CLI session via the optional Local Desktop Bridge.",
      },
    ],
    mediaHistory: [
      {
        id: "vid-demo-1",
        title: "NASA Live Earth Views & Orbital Science",
        channel: "NASA",
        url: "https://www.youtube.com/watch?v=xRPjKQtRXR8",
        embedUrl: "https://www.youtube.com/embed/xRPjKQtRXR8",
        kind: "video",
        addedAt: now - 3600000,
      },
    ],
  };
}

let cachedData: PersistedJarvisData | null = null;
let writeQueue: Promise<void> = Promise.resolve();

export async function loadJarvisData(): Promise<PersistedJarvisData> {
  if (cachedData) return cachedData;
  const defaults = createDefaultData();
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<PersistedJarvisData>;
    const existingPlugins =
      Array.isArray(parsed.plugins) && parsed.plugins.length ? parsed.plugins : defaults.plugins;
    const mergedPlugins = [...existingPlugins];
    for (const defPlugin of defaults.plugins) {
      if (defPlugin.sourceKind === "builtin" && !mergedPlugins.some((p) => p.id === defPlugin.id)) {
        mergedPlugins.push(defPlugin);
      }
    }
    const cleanedWidgets = Array.isArray(parsed.hud?.visibleWidgets)
      ? parsed.hud.visibleWidgets.filter((w) => w !== "smarthome")
      : defaults.hud.visibleWidgets;
    cachedData = {
      ...defaults,
      ...parsed,
      activeProfileName: parsed.activeProfileName || defaults.activeProfileName,
      persona: { ...defaults.persona, ...(parsed.persona || {}) },
      hud: {
        ...defaults.hud,
        ...(parsed.hud || {}),
        themeId: parsed.hud?.themeId && parsed.hud.themeId !== "arc-titanium" ? parsed.hud.themeId : defaults.hud.themeId,
        visibleWidgets: cleanedWidgets,
      },
      automations: Array.isArray(parsed.automations)
        ? parsed.automations.filter((a) => a.triggerType !== ("lock_unlocked_away" as string) && a.triggerType !== ("motion_detected" as string))
        : defaults.automations,
      gatewayMessages: Array.isArray(parsed.gatewayMessages) ? parsed.gatewayMessages : defaults.gatewayMessages,
      cronJobs: Array.isArray(parsed.cronJobs) ? parsed.cronJobs : defaults.cronJobs,
      memories: Array.isArray(parsed.memories) ? parsed.memories : defaults.memories,
      notes: Array.isArray(parsed.notes) ? parsed.notes : defaults.notes,
      calendar: Array.isArray(parsed.calendar) ? parsed.calendar : defaults.calendar,
      vaultFiles: Array.isArray(parsed.vaultFiles) ? parsed.vaultFiles : defaults.vaultFiles,
      wbReminders: Array.isArray(parsed.wbReminders) ? parsed.wbReminders : defaults.wbReminders,
      timers: Array.isArray(parsed.timers) ? parsed.timers : defaults.timers,
      costLog: Array.isArray(parsed.costLog) ? parsed.costLog : defaults.costLog,
      plugins: mergedPlugins,
      accountConnectors:
        Array.isArray(parsed.accountConnectors) && parsed.accountConnectors.length
          ? parsed.accountConnectors
          : defaults.accountConnectors,
      mediaHistory: Array.isArray(parsed.mediaHistory) ? parsed.mediaHistory : defaults.mediaHistory,
    };
  } catch {
    cachedData = defaults;
    await saveJarvisData(cachedData);
  }
  return cachedData;
}

export async function saveJarvisData(next: PersistedJarvisData): Promise<void> {
  cachedData = next;
  writeQueue = writeQueue.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(next, null, 2), "utf8");
  });
  await writeQueue;
}

export function exportShareBundle(data: PersistedJarvisData) {
  return {
    bundleFormat: "jarvis-profile-v2",
    profileName: data.activeProfileName,
    exportedAt: new Date().toISOString(),
    persona: data.persona,
    hud: data.hud,
    notes: data.notes,
    calendar: data.calendar,
    memories: data.memories,
    automations: data.automations,
    plugins: data.plugins.map((p) => ({
      ...p,
      webhookUrl: p.webhookUrl || undefined,
    })),
  };
}

export async function importShareBundle(bundle: Record<string, unknown>): Promise<PersistedJarvisData> {
  const current = await loadJarvisData();
  const next: PersistedJarvisData = { ...current };

  if (typeof bundle.profileName === "string" && bundle.profileName.trim()) {
    next.activeProfileName = bundle.profileName.trim();
  }
  if (bundle.persona && typeof bundle.persona === "object") {
    next.persona = { ...current.persona, ...(bundle.persona as Partial<PersonaConfig>) };
  }
  if (bundle.hud && typeof bundle.hud === "object") {
    next.hud = { ...current.hud, ...(bundle.hud as Partial<HudConfig>) };
  }
  if (Array.isArray(bundle.notes)) {
    next.notes = bundle.notes as PersonalNote[];
  }
  if (Array.isArray(bundle.calendar)) {
    next.calendar = bundle.calendar as CalendarEvent[];
  }
  if (Array.isArray(bundle.memories)) {
    next.memories = bundle.memories as PersonalMemory[];
  }
  if (Array.isArray(bundle.automations)) {
    next.automations = bundle.automations as AutomationRule[];
  }
  if (Array.isArray(bundle.plugins)) {
    const merged = new Map<string, NormalizedPlugin>();
    for (const p of current.plugins) merged.set(p.id, p);
    for (const p of bundle.plugins as NormalizedPlugin[]) {
      if (p?.id && p?.name) merged.set(p.id, p);
    }
    next.plugins = Array.from(merged.values());
  }

  await saveJarvisData(next);
  return next;
}

export function newId(prefix = "id"): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}
