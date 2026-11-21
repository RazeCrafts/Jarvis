/**
 * REST client for the JARVIS runtime server.
 */

const DEFAULT_BASE = "";

export function backendBaseUrl(): string {
  if (typeof localStorage === "undefined") return DEFAULT_BASE;
  const stored = localStorage.getItem("jarvis-backend-url");
  if (!stored || stored === "http://127.0.0.1:8420") return DEFAULT_BASE;
  return stored;
}

export function setBackendBaseUrl(url: string): void {
  const cleaned = url.trim().replace(/\/+$/, "");
  if (!cleaned) {
    localStorage.removeItem("jarvis-backend-url");
  } else {
    localStorage.setItem("jarvis-backend-url", cleaned);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${backendBaseUrl()}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(`${response.status}: ${detail.slice(0, 300)}`);
  }
  return (await response.json()) as T;
}

/* ---------------- types ---------------- */

export interface MemoryItem {
  id: string;
  kind: string;
  title: string;
  path: string;
  updatedAt: number;
  size: number;
}

export interface PersonalMemoryItem {
  id: string;
  category: "preference" | "person" | "project" | "fact" | "routine";
  title: string;
  content: string;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface PersonalNoteItem {
  id: string;
  title: string;
  body: string;
  tags: string[];
  updatedAt: number;
}

export interface CalendarEventItem {
  id: string;
  title: string;
  startISO: string;
  endISO: string;
  location?: string;
  notes?: string;
  recurrence: "none" | "daily" | "weekly" | "monthly";
  reminderMinutes: number;
  completed: boolean;
}

export interface AutomationRuleItem {
  id: string;
  name: string;
  triggerType: "meeting_approaching" | "morning_brief" | "evening_hour" | "cron";
  actionSummary: string;
  targetChannel?: string;
  enabled: boolean;
  lastTriggeredAt?: number;
}

export interface GatewayMessageItem {
  id: string;
  platform: "telegram" | "discord" | "slack" | "whatsapp";
  sender: string;
  direction: "inbound" | "outbound";
  text: string;
  ts: number;
}

export interface MediaHistoryItem {
  id: string;
  title: string;
  channel: string;
  url: string;
  embedUrl?: string;
  kind: "video" | "music";
  addedAt: number;
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

export interface NormalizedPluginItem {
  id: string;
  name: string;
  version: string;
  description: string;
  sourceKind: "plugin_yaml" | "skill_md" | "custom_nocode" | "builtin";
  schemaVersion: number;
  upstreamUrl: string;
  pinnedSha?: string;
  previousVersion?: string;
  previousRawSource?: string;
  autoDrafted?: boolean;
  triggers: string[];
  providesTools: string[];
  providesHooks: string[];
  requiresBridge: boolean;
  instructions: string;
  webhookUrl?: string;
  enabled: boolean;
  updatedAt: number;
  rawSource: string;
  extraSchema: Record<string, unknown>;
}

export interface PluginDoctorReportItem {
  ok: boolean;
  total: number;
  healthyCount: number;
  pinnedCount: number;
  issues: Array<{
    pluginId: string;
    pluginName: string;
    severity: "warn" | "info";
    message: string;
  }>;
}

export interface CatalogPluginItem {
  id: string;
  name: string;
  version: string;
  category: "Auth & Providers" | "Skills" | "Coding" | "Productivity" | "Media";
  description: string;
  sourceKind: "plugin_yaml" | "skill_md";
  requiresBridge: boolean;
  upstreamUrl: string;
  rawManifest: string;
}

export interface AccountConnectorItem {
  id: string;
  name: string;
  providerSlug: string;
  authMode: "oauth_portal" | "oauth_device" | "local_cli_bridge";
  connected: boolean;
  accountLabel: string;
  lastCheckedAt: number | null;
  notes: string;
}

export interface BridgeStatusInfo {
  connected: boolean;
  machineName: string | null;
  platform: string | null;
  connectedAt: number | null;
  capabilities: string[];
  pairingToken: string;
}

export interface SkillItem {
  id: string;
  name: string;
  path: string;
  updatedAt: number;
}

export interface VoiceSettings {
  state: "idle" | "listening" | "transcribing" | "stopped";
  wakeEnabled: boolean;
  wakeWord: string;
  wakeThreshold: number;
  pttHotkey: string;
  micDevice: string;
  sttModel: string;
  streamOpen: boolean;
  wakeModelReady: boolean;
  wakeError: string;
  sttReady: boolean;
  sttError: string;
  ttsSpeaking: boolean;
  tts?: { enabled: boolean; rate: number; pitch: number };
}

export interface SpotifyStatus {
  configured: boolean;
  authorized: boolean;
  clientIdMasked: string;
  redirectUri: string;
  premium: boolean | null;
  displayName: string | null;
  product: string | null;
  error?: string;
}

export interface AgentSettings {
  brain: "hermes" | "openrouter" | "auto";
  provider: string;
  openrouterApiKeyMasked: string;
  hasKey: boolean;
  hasGeminiBuiltin?: boolean;
  models: { default: string; fast: string; heavy: string };
  confirmDangerousTools: boolean;
  allowedApps: string[];
  tts: { enabled: boolean; rate: number; pitch: number };
  voice: VoiceSettings;
  spotify: SpotifyStatus;
  toolsets: string[];
  customProviders: Record<string, { api?: string; key_env?: string; transport?: string }>;
  permissions: Record<string, string>;
  killSwitch: { engaged: boolean; hotkey: string; active?: boolean };
  protectedFolders: string[];
  visionModel: string;
}

export interface ProviderInfo {
  slug: string;
  label: string;
  description: string;
  authType: string;
  tab: "builtin" | "keys" | "accounts";
  envVars: string[];
  baseUrlEnvVar: string;
  signupUrl: string;
  keys: Record<string, { masked: string; present: boolean }>;
  configured: boolean;
}

export interface ToolsetInfo {
  name: string;
  label: string;
  description: string;
  enabled: boolean;
}

export interface McpServerInfo {
  name: string;
  type: "remote" | "stdio";
  url?: string | null;
  command?: string | null;
  args: string[];
  enabled: boolean;
}

export interface CronJobInfo {
  id: string;
  name: string;
  schedule: string;
  prompt: string;
  deliver: string[] | string;
  state: string;
  enabled: boolean;
  skills: string[];
  script?: string | null;
}

export interface GatewayStatus {
  running: boolean;
  pid: number | null;
  platforms: { id: string; label: string; envVar: string; configured: boolean; masked: string }[];
  configuredPlatforms: string[];
  cronActive: boolean;
  jobCount: number;
}

export interface StartMenuApp {
  name: string;
  appId: string;
  score?: number;
}

export interface AuditEntry {
  ts: string;
  tool: string;
  decision: string;
  source: string;
  detail: string;
  args: string;
}

export interface FileMove {
  name: string;
  from: string;
  to: string;
  category: string;
  size: number;
}

export interface FilePlan {
  ok: boolean;
  id?: string;
  directory?: string;
  moves: FileMove[];
  skipped: { name: string; reason: string }[];
  error?: string;
}

export interface PermissionsState {
  modes: Record<string, string>;
  modesAvailable: string[];
  defaultPosture: boolean;
  killSwitch: { engaged: boolean; hotkey: string };
  riskyPrefixes: string[];
}

export interface FreeModel {
  id: string;
  name: string | null;
  context: number | null;
}

export interface WorkspaceArtifact {
  id: string;
  kind: string;
  title: string;
  language: string;
  content: string;
  version: number;
  versionCount: number;
  versions: number[];
  createdAt: number;
  updatedAt: number;
}

export interface MicInfo {
  id: string;
  name: string;
  channels: number;
  default: boolean;
}

/* ---------------- endpoints ---------------- */

export const agentApi = {
  status: () =>
    request<{
      brain: string;
      provider?: string;
      initError: string | null;
      model: string | null;
      models: { default: string; fast: string; heavy: string };
      tts: { enabled: boolean; rate: number; pitch: number };
      confirmDangerousTools: boolean;
      hasKey: boolean;
      hasGeminiBuiltin?: boolean;
    }>("/agent/status"),

  // Personal Memory, Notes & Calendar
  getMemories: () => request<{ items: PersonalMemoryItem[] }>("/api/memories"),
  createMemory: (payload: {
    category: PersonalMemoryItem["category"];
    title: string;
    content: string;
    pinned?: boolean;
  }) => request<{ ok: boolean; item: PersonalMemoryItem }>("/api/memories", { method: "POST", body: JSON.stringify(payload) }),
  updateMemory: (id: string, payload: Partial<Pick<PersonalMemoryItem, "title" | "content" | "pinned">>) =>
    request<{ ok: boolean; item: PersonalMemoryItem }>(`/api/memories/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deletePersonalMemory: (id: string) =>
    request<{ ok: boolean }>(`/api/memories/${encodeURIComponent(id)}`, { method: "DELETE" }),

  getNotes: () => request<{ items: PersonalNoteItem[] }>("/api/notes"),
  createNote: (payload: { title: string; body: string; tags?: string[] }) =>
    request<{ ok: boolean; item: PersonalNoteItem }>("/api/notes", { method: "POST", body: JSON.stringify(payload) }),
  updateNote: (id: string, payload: Partial<Pick<PersonalNoteItem, "title" | "body" | "tags">>) =>
    request<{ ok: boolean; item: PersonalNoteItem }>(`/api/notes/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteNote: (id: string) =>
    request<{ ok: boolean }>(`/api/notes/${encodeURIComponent(id)}`, { method: "DELETE" }),

  getCalendar: () => request<{ items: CalendarEventItem[] }>("/api/calendar"),
  createCalendarEvent: (payload: {
    title: string;
    startISO: string;
    endISO?: string;
    location?: string;
    notes?: string;
    recurrence?: CalendarEventItem["recurrence"];
    reminderMinutes?: number;
  }) => request<{ ok: boolean; item: CalendarEventItem }>("/api/calendar", { method: "POST", body: JSON.stringify(payload) }),
  updateCalendarEvent: (id: string, payload: Partial<CalendarEventItem>) =>
    request<{ ok: boolean; item: CalendarEventItem }>(`/api/calendar/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteCalendarEvent: (id: string) =>
    request<{ ok: boolean }>(`/api/calendar/${encodeURIComponent(id)}`, { method: "DELETE" }),
  calendarIcsUrl: () => `${backendBaseUrl()}/api/calendar/export.ics`,

  // Online Movies & Music Media Hub
  getMediaHistory: () => request<{ items: MediaHistoryItem[] }>("/api/media"),
  searchMedia: (query: string, kind: "movie" | "video" | "music" = "video") =>
    request<{
      ok: boolean;
      results: Array<{ title: string; channel: string; url: string; embedUrl?: string; snippet: string }>;
      targets?: Array<{
        id: string;
        label: string;
        category: string;
        webUrl: string;
        protocolUri?: string;
        bridgeAppName?: string;
      }>;
      history: MediaHistoryItem[];
    }>("/api/media/search", { method: "POST", body: JSON.stringify({ query, kind }) }),

  // Persona, HUD & Share Bundle
  getHudPersona: () => request<{ persona: PersonaConfig; hud: HudConfig }>("/api/hud-persona"),
  saveHudPersona: (payload: { persona?: Partial<PersonaConfig>; hud?: Partial<HudConfig> }) =>
    request<{ ok: boolean; persona: PersonaConfig; hud: HudConfig }>("/api/hud-persona", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  exportShareBundle: () => request<Record<string, unknown>>("/api/bundle/export"),
  importShareBundle: (bundle: Record<string, unknown>) =>
    request<{ ok: boolean; persona: PersonaConfig; hud: HudConfig; pluginCount: number }>("/api/bundle/import", {
      method: "POST",
      body: JSON.stringify(bundle),
    }),

  // Open Plugin & Skill Compatibility Registry
  getPlugins: () =>
    request<{ installed: NormalizedPluginItem[]; catalog: CatalogPluginItem[] }>("/api/plugins"),
  installCatalogPlugin: (id: string) =>
    request<{ ok: boolean; plugin: NormalizedPluginItem }>("/api/plugins/install-catalog", {
      method: "POST",
      body: JSON.stringify({ id }),
    }),
  installPluginUrl: (url: string) =>
    request<{ ok: boolean; plugin: NormalizedPluginItem }>("/api/plugins/install-url", {
      method: "POST",
      body: JSON.stringify({ url }),
    }),
  installPluginManifest: (raw: string, filenameHint?: string) =>
    request<{ ok: boolean; plugin: NormalizedPluginItem }>("/api/plugins/install-manifest", {
      method: "POST",
      body: JSON.stringify({ raw, filenameHint }),
    }),
  createNoCodeSkill: (payload: {
    name: string;
    description: string;
    triggers: string[];
    instructions: string;
    webhookUrl?: string;
  }) =>
    request<{ ok: boolean; plugin: NormalizedPluginItem }>("/api/plugins/create-nocode", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  togglePlugin: (id: string, enabled: boolean) =>
    request<{ ok: boolean; plugin: NormalizedPluginItem }>(`/api/plugins/${encodeURIComponent(id)}/toggle`, {
      method: "POST",
      body: JSON.stringify({ enabled }),
    }),
  deletePlugin: (id: string) =>
    request<{ ok: boolean }>(`/api/plugins/${encodeURIComponent(id)}`, { method: "DELETE" }),
  checkPluginUpdates: () =>
    request<{ ok: boolean; checked: number; updated: string[] }>("/api/plugins/check-updates", {
      method: "POST",
    }),
  rollbackPlugin: (id: string) =>
    request<{ ok: boolean; plugin: NormalizedPluginItem }>(`/api/plugins/${encodeURIComponent(id)}/rollback`, {
      method: "POST",
    }),
  runPluginDoctor: () => request<PluginDoctorReportItem>("/api/plugins/doctor"),
  draftWorkflowSkill: (payload: { name: string; description?: string; triggers?: string[]; stepsText: string }) =>
    request<{ ok: boolean; plugin: NormalizedPluginItem }>("/api/plugins/draft-workflow", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  // Memory Wiki, Proactive Briefing, Watchdog, Automations, Video TTS & Web Extract
  getMemoryWiki: () =>
    request<{
      sections: Array<{
        id: string;
        title: string;
        category: string;
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
      }>;
    }>("/api/memory/wiki"),
  getBriefing: () =>
    request<{
      briefing: {
        headline: string;
        period: "morning" | "afternoon" | "evening";
        workspaceStatus: string;
        upcomingCount: number;
        nextEventTitle: string | null;
        pinnedFocus: string[];
        alerts: string[];
        suggestedPrompt: string;
      };
      triggeredAutomations: Array<{ ruleId: string; ruleName: string; message: string; targetChannel?: string }>;
    }>("/api/briefing"),
  createAutomation: (payload: {
    name: string;
    triggerType: AutomationRuleItem["triggerType"];
    actionSummary: string;
    targetChannel?: string;
  }) => request<{ ok: boolean; item: AutomationRuleItem }>("/api/automations", { method: "POST", body: JSON.stringify(payload) }),
  toggleAutomation: (id: string, enabled: boolean) =>
    request<{ ok: boolean; item: AutomationRuleItem }>(`/api/automations/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    }),
  deleteAutomation: (id: string) =>
    request<{ ok: boolean }>(`/api/automations/${encodeURIComponent(id)}`, { method: "DELETE" }),
  evaluateAutomations: () =>
    request<{ ok: boolean; triggered: Array<{ ruleId: string; ruleName: string; message: string; targetChannel?: string }> }>(
      "/api/automations/evaluate",
      { method: "POST" },
    ),
  generateVoiceover: (payload: { text: string; voiceName?: string; styleHint?: string }) =>
    request<{ ok: boolean; audioBase64?: string; mimeType?: string; error?: string }>("/api/video/voiceover", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  extractWebUrl: (payload: { url: string; question?: string; saveAsNote?: boolean }) =>
    request<{
      ok: boolean;
      url: string;
      summary: string;
      highlights: string[];
      visual?: Record<string, unknown>;
      citations: Array<{ title: string; uri: string }>;
      error?: string;
    }>("/api/web/extract", { method: "POST", body: JSON.stringify(payload) }),
  sendBlenderScript: (script: string) =>
    request<{ ok: boolean; output?: string; error?: string }>("/api/bridge/blender", {
      method: "POST",
      body: JSON.stringify({ script }),
    }),
  getGatewayFeed: () => request<{ messages: GatewayMessageItem[] }>("/api/gateway/feed"),
  sendGatewayInbound: (payload: {
    platform: "telegram" | "discord" | "slack" | "whatsapp";
    sender?: string;
    text: string;
  }) =>
    request<{ ok: boolean; inbound: GatewayMessageItem; outbound: GatewayMessageItem; feed: GatewayMessageItem[] }>(
      "/api/gateway/inbound",
      { method: "POST", body: JSON.stringify(payload) },
    ),

  // Screen Vision (Browser getDisplayMedia -> Gemini Vision)
  analyzeScreenFrame: (imageData: string, question?: string) =>
    request<{ ok: boolean; description?: string; model?: string; error?: string }>("/api/vision/analyze", {
      method: "POST",
      body: JSON.stringify({ imageData, question }),
    }),

  // Optional Desktop Bridge & Key-less Account Connectors
  getBridgeStatus: () => request<BridgeStatusInfo>("/api/bridge/status"),
  rotateBridgeToken: () => request<{ ok: boolean; pairingToken: string }>("/api/bridge/rotate-token", { method: "POST" }),
  bridgeCompanionDownloadUrl: () => `${backendBaseUrl()}/api/bridge/companion-script`,
  getAccountConnectors: () =>
    request<{ connectors: AccountConnectorItem[]; bridge: BridgeStatusInfo }>("/api/account-connectors"),
  connectAccountConnector: (id: string, payload: { token?: string; accountLabel?: string }) =>
    request<{ ok: boolean; connected?: boolean; message?: string; connector?: AccountConnectorItem }>(
      `/api/account-connectors/${encodeURIComponent(id)}/connect`,
      { method: "POST", body: JSON.stringify(payload) },
    ),
  disconnectAccountConnector: (id: string) =>
    request<{ ok: boolean }>(`/api/account-connectors/${encodeURIComponent(id)}/disconnect`, { method: "POST" }),

  // Legacy Memory & Skills
  getMemory: () => request<{ items: MemoryItem[] }>("/agent/memory"),
  getMemoryContent: (path: string) =>
    request<{ path: string; content: string }>(`/agent/memory/content?path=${encodeURIComponent(path)}`),
  deleteMemory: (path: string) =>
    request<{ ok: boolean }>(`/agent/memory?path=${encodeURIComponent(path)}`, { method: "DELETE" }),
  getSkills: () => request<{ items: SkillItem[] }>("/agent/skills"),
  getSkillContent: (path: string) =>
    request<{ path: string; content: string; files?: string[] }>(`/agent/skills/content?path=${encodeURIComponent(path)}`),
  deleteSkill: (path: string) =>
    request<{ ok: boolean }>(`/agent/skills?path=${encodeURIComponent(path)}`, { method: "DELETE" }),

  // Models + settings
  getFreeModels: () => request<{ free: FreeModel[] }>("/agent/models"),
  setBrain: (brain: AgentSettings["brain"]) =>
    request<{ ok: boolean }>("/agent/brain", { method: "POST", body: JSON.stringify({ brain }) }),
  getSettings: () => request<AgentSettings>("/agent/settings"),
  saveSettings: (payload: Record<string, unknown>) =>
    request<{ ok: boolean; applied: string[] }>("/agent/settings", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  removeKey: () =>
    request<{ ok: boolean }>("/agent/settings", {
      method: "POST",
      body: JSON.stringify({ removeKey: true }),
    }),
  testConnection: () =>
    request<{ ok: boolean; message: string }>("/agent/test-connection", { method: "POST" }),

  // Workshop artifacts & code execution
  runCode: (language: string, code: string) =>
    request<{ ok: boolean; stdout?: string; stderr?: string; error?: string; durationMs?: number }>(
      "/workspace/run-code",
      { method: "POST", body: JSON.stringify({ language, code }) },
    ),
  listArtifacts: () =>
    request<{ artifacts: WorkspaceArtifact[]; current: WorkspaceArtifact | null }>("/workspace/artifacts"),
  clearArtifacts: () => request<{ ok: boolean }>("/workspace/clear", { method: "POST" }),
  undoArtifact: (artifactId: string) =>
    request<{ ok: boolean; artifact: WorkspaceArtifact }>("/workspace/undo", {
      method: "POST",
      body: JSON.stringify({ artifactId }),
    }),
  activateVersion: (artifactId: string, version: number) =>
    request<{ ok: boolean; artifact: WorkspaceArtifact }>("/workspace/version", {
      method: "POST",
      body: JSON.stringify({ artifactId, version }),
    }),
  saveArtifactToFolder: (artifactId: string, folder: string) =>
    request<{ ok: boolean; path?: string }>("/workspace/save-to-folder", {
      method: "POST",
      body: JSON.stringify({ artifactId, folder }),
    }),
  pickFolder: () =>
    request<{ ok: boolean; folder: string; error?: string }>("/workspace/pick-folder", { method: "POST" }),

  // Providers, Toolsets, MCP, Cron, Gateway
  getProviders: () => request<{ providers: ProviderInfo[] }>("/agent/providers"),
  saveProviderKey: (slug: string, key: string, envVar?: string) =>
    request<{ ok: boolean; envVar: string }>("/hermes/providers/key", {
      method: "POST",
      body: JSON.stringify({ slug, key, envVar }),
    }),
  removeProviderKey: (slug: string, envVar?: string) =>
    request<{ ok: boolean }>("/hermes/providers/remove-key", {
      method: "POST",
      body: JSON.stringify({ slug, envVar }),
    }),
  getProviderModels: (slug: string, chatOnly = false) =>
    request<{ provider: string; source: string; models: FreeModel[]; error?: string }>(
      `/hermes/providers/${encodeURIComponent(slug)}/models${chatOnly ? "?chat_only=true" : ""}`,
    ),
  addCustomProvider: (name: string, baseUrl: string, keyEnv?: string) =>
    request<{ ok: boolean; name: string }>("/hermes/custom-providers", {
      method: "POST",
      body: JSON.stringify({ name, baseUrl, keyEnv }),
    }),
  removeCustomProvider: (name: string) =>
    request<{ ok: boolean }>("/hermes/custom-providers/remove", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  getToolsets: () => request<{ toolsets: ToolsetInfo[] }>("/hermes/toolsets"),
  toggleToolset: (name: string, enabled: boolean) =>
    request<{ ok: boolean; enabled: string[] }>("/hermes/toolsets/toggle", {
      method: "POST",
      body: JSON.stringify({ name, enabled }),
    }),
  getMcpServers: () => request<{ servers: McpServerInfo[] }>("/hermes/mcp"),
  addMcpServer: (payload: { name: string; url?: string; command?: string; args?: string[] }) =>
    request<{ ok: boolean }>("/hermes/mcp/add", { method: "POST", body: JSON.stringify(payload) }),
  removeMcpServer: (name: string) =>
    request<{ ok: boolean }>("/hermes/mcp/remove", { method: "POST", body: JSON.stringify({ name }) }),
  testMcpServer: (name: string) =>
    request<{ ok: boolean; output: string }>("/hermes/mcp/test", { method: "POST", body: JSON.stringify({ name }) }),
  addArtCraftMcpPreset: (app: "all" | "designcraft" | "photocraft" | "vectorcraft" | "lightcraft" = "all") =>
    request<{ ok: boolean; added: string[]; servers: McpServerInfo[] }>("/api/mcp/artcraft/preset", {
      method: "POST",
      body: JSON.stringify({ app }),
    }),
  executeArtCraftMcp: (payload: { app: string; instruction: string; toolName?: string; endpointUrl?: string }) =>
    request<{ ok: boolean; via?: string; cliCommand?: string; output?: unknown; result?: unknown; error?: string }>(
      "/api/mcp/artcraft/execute",
      { method: "POST", body: JSON.stringify(payload) },
    ),
  getCronJobs: () => request<{ jobs: CronJobInfo[] }>("/hermes/cron"),
  createCronJob: (payload: {
    schedule: string;
    prompt?: string;
    name?: string;
    deliver?: string;
    repeat?: number;
    noAgent?: boolean;
  }) =>
    request<{ ok: boolean; jobs: CronJobInfo[] }>("/hermes/cron/create", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  cronAction: (action: "pause" | "resume" | "run" | "remove", jobId: string) =>
    request<{ ok: boolean; jobs: CronJobInfo[] }>("/hermes/cron/action", {
      method: "POST",
      body: JSON.stringify({ action, jobId }),
    }),
  getGateway: () => request<GatewayStatus>("/hermes/gateway"),
  startGateway: () => request<{ ok: boolean; running: boolean; pid?: number }>("/hermes/gateway/start", { method: "POST" }),
  stopGateway: () => request<{ ok: boolean; running: boolean }>("/hermes/gateway/stop", { method: "POST" }),
  getGatewayLogs: (lines = 80) => request<{ logs: string }>(`/hermes/gateway/logs?lines=${lines}`),
  setGatewayPlatform: (platform: string, token: string) =>
    request<{ ok: boolean }>("/hermes/gateway/platform", {
      method: "POST",
      body: JSON.stringify({ platform, token }),
    }),
  removeGatewayPlatform: (platform: string) =>
    request<{ ok: boolean }>("/hermes/gateway/platform/remove", {
      method: "POST",
      body: JSON.stringify({ platform }),
    }),
  getDoctor: () => request<{ report: string }>("/hermes/doctor"),

  // Guardrails & Desktop control
  getPermissions: () => request<PermissionsState>("/permissions"),
  setToolMode: (tool: string, mode: string) =>
    request<{ ok: boolean; modes: Record<string, string> }>("/permissions/mode", {
      method: "POST",
      body: JSON.stringify({ tool, mode }),
    }),
  setKillSwitch: (engaged: boolean) =>
    request<{ engaged: boolean }>("/permissions/kill", {
      method: "POST",
      body: JSON.stringify({ engaged }),
    }),
  getAudit: (limit = 60) => request<{ entries: AuditEntry[] }>(`/permissions/audit?limit=${limit}`),
  getApps: (q = "") =>
    request<{ apps: StartMenuApp[]; count: number | null; indexedAt: string | null }>(
      `/desktop/apps?q=${encodeURIComponent(q)}`,
    ),
  refreshApps: () => request<{ ok: boolean; count: number }>("/desktop/apps/refresh", { method: "POST" }),
  launchApp: (name: string) =>
    request<{ ok: boolean; app?: string; error?: string }>("/desktop/launch", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  listWindows: () => request<{ windows: { title: string; pid: number }[] }>("/desktop/windows"),
  windowAction: (name: string, action: "focus" | "minimize" | "maximize" | "restore" | "close") =>
    request<{ ok: boolean; error?: string; window?: string }>("/desktop/window", {
      method: "POST",
      body: JSON.stringify({ name, action }),
    }),
  typeText: (text: string) =>
    request<{ ok: boolean; error?: string }>("/desktop/type", {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
  pressKeys: (keys: string) =>
    request<{ ok: boolean; error?: string }>("/desktop/keys", {
      method: "POST",
      body: JSON.stringify({ keys }),
    }),
  seeScreen: (payload: { question?: string; window?: string; model?: string; imageData?: string }) =>
    request<{ ok: boolean; description?: string; model?: string; imagePath?: string; error?: string }>(
      "/vision/see",
      { method: "POST", body: JSON.stringify(payload) },
    ),

  // Voice & Actions
  voiceStatus: () => request<VoiceSettings>("/voice/status"),
  getMics: () => request<{ mics: MicInfo[] }>("/voice/mics"),
  listenVoice: (source = "manual") =>
    request<{ ok: boolean; state?: string; error?: string }>("/voice/listen", {
      method: "POST",
      body: JSON.stringify({ source }),
    }),
  cancelVoice: () => request<{ ok: boolean; state?: string }>("/voice/cancel", { method: "POST" }),
  runAction: (text: string) =>
    request<{ handled: boolean; reply?: string; data?: Record<string, unknown> }>("/actions/run", {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
  aiAnalyzeVideoEdit: (payload: {
    instruction: string;
    clips: Array<{
      index: number;
      name: string;
      duration: number;
      trimStart: number;
      trimEnd: number;
      speed: number;
      mediaType?: string;
    }>;
    frames: Array<{ clipIndex: number; timestampSec: number; imageBase64: string }>;
    beatInfo: { bpm: number; beats: number[]; musicName?: string };
  }) =>
    request<{
      ok: boolean;
      via: "gemini-vision" | "beat-heuristic";
      frameInsights: string;
      plan: Record<string, unknown>;
    }>("/api/video/ai-analyze-edit", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  // File Galaxy & Butler Brain
  getGalaxy: () =>
    request<{
      graph: import("@/lib/fileGalaxy").GalaxyGraph;
      vaultFiles: import("@/lib/fileGalaxy").WorkspaceVaultFile[];
      stats: { notes: number; memories: number; files: number; totalNodes: number; edges: number };
    }>("/api/galaxy"),
  uploadGalaxyFile: (payload: {
    name: string;
    mimeType: string;
    sizeBytes: number;
    textPreview?: string;
    dataUrl?: string;
    tags?: string[];
  }) =>
    request<{ ok: boolean; file: import("@/lib/fileGalaxy").WorkspaceVaultFile; nodeId: string }>(
      "/api/galaxy/files",
      { method: "POST", body: JSON.stringify(payload) },
    ),
  deleteGalaxyFile: (id: string) =>
    request<{ ok: boolean }>(`/api/galaxy/files/${encodeURIComponent(id)}`, { method: "DELETE" }),
  rememberInGalaxy: (text: string, tags?: string[]) =>
    request<{
      ok: boolean;
      note: PersonalNoteItem;
      nodeId: string;
      graph: import("@/lib/fileGalaxy").GalaxyGraph;
    }>("/api/galaxy/remember", { method: "POST", body: JSON.stringify({ text, tags }) }),
  askGalaxyBrain: (question: string) =>
    request<{
      ok: boolean;
      answer: string;
      cameraAction: import("@/lib/fileGalaxy").BrainCameraAction;
      focusNodeId: string | null;
      litNodeIds: string[];
      neighborNodeIds: string[];
      sources: Array<{ id: string; title: string; kind: string; score: number }>;
    }>("/api/galaxy/ask", { method: "POST", body: JSON.stringify({ question }) }),

  // Workbench Sticky Reminders & Timers
  getUtilities: () =>
    request<{
      wbReminders: import("@/lib/timersAndReminders").WbReminder[];
      timers: import("@/lib/timersAndReminders").CountdownTimer[];
    }>("/api/utilities"),
  createWbReminder: (payload: {
    title: string;
    dueAt?: number;
    priority?: "low" | "normal" | "urgent";
    notes?: string;
  }) =>
    request<{
      ok: boolean;
      item: import("@/lib/timersAndReminders").WbReminder;
      items: import("@/lib/timersAndReminders").WbReminder[];
    }>("/api/utilities/reminders", { method: "POST", body: JSON.stringify(payload) }),
  updateWbReminder: (
    id: string,
    payload: { status?: string; dueAt?: number; title?: string },
  ) =>
    request<{
      ok: boolean;
      item: import("@/lib/timersAndReminders").WbReminder;
      items: import("@/lib/timersAndReminders").WbReminder[];
    }>(`/api/utilities/reminders/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteWbReminder: (id: string) =>
    request<{ ok: boolean; items: import("@/lib/timersAndReminders").WbReminder[] }>(
      `/api/utilities/reminders/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),
  saveTimers: (timers: import("@/lib/timersAndReminders").CountdownTimer[]) =>
    request<{ ok: boolean; timers: import("@/lib/timersAndReminders").CountdownTimer[] }>(
      "/api/utilities/timers",
      { method: "POST", body: JSON.stringify({ timers }) },
    ),

  // Workshop Vision-to-3D, Studio Finish & Surgical Part Edit + Cost Receipt
  workshopVisionTo3D: (payload: { imageBase64: string; mimeType: string; hint?: string }) =>
    request<{
      ok: boolean;
      title?: string;
      code?: string;
      artifact?: WorkspaceArtifact;
      isFloorPlan?: boolean;
      error?: string;
    }>("/api/workshop/vision", { method: "POST", body: JSON.stringify(payload) }),
  workshopFinish: (payload: {
    imageDataUrl: string;
    mode: "photograph" | "miniature";
    title: string;
    exploded?: boolean;
  }) =>
    request<{
      ok: boolean;
      imageDataUrl?: string;
      model?: string;
      error?: string;
    }>("/api/workshop/finish", { method: "POST", body: JSON.stringify(payload) }),
  workshopPartEdit: (payload: { artifactId: string; partName: string; instruction: string }) =>
    request<{
      ok: boolean;
      artifact?: WorkspaceArtifact;
      error?: string;
    }>("/api/workshop/part-edit", { method: "POST", body: JSON.stringify(payload) }),
  getWorkshopReceipt: () =>
    request<{
      summary: {
        totalUsd: number;
        callCount: number;
        totalInputTokens: number;
        totalOutputTokens: number;
        imageCount: number;
        formattedTotal: string;
      };
      entries: import("@/lib/workshopProtocol").ApiCostEntry[];
    }>("/api/workshop/receipt"),
};
