/**
 * REST client for the JARVIS backend (Memory, Skills, Settings tabs).
 * Base URL is overridable via localStorage `jarvis-backend-url` so the
 * backend address is never hardcoded into the UI logic.
 */

const DEFAULT_BASE = "http://127.0.0.1:8420";

export function backendBaseUrl(): string {
  if (typeof localStorage === "undefined") return DEFAULT_BASE;
  return localStorage.getItem("jarvis-backend-url") || DEFAULT_BASE;
}

export function setBackendBaseUrl(url: string): void {
  localStorage.setItem("jarvis-backend-url", url.replace(/\/+$/, ""));
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
  tab: "keys" | "accounts";
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

/* ---------------- endpoints ---------------- */

export const agentApi = {
  status: () =>
    request<{
      brain: string;
      initError: string | null;
      model: string | null;
      models: { default: string; fast: string; heavy: string };
      tts: { enabled: boolean; rate: number; pitch: number };
      confirmDangerousTools: boolean;
      hasKey: boolean;
    }>("/agent/status"),

  // Memory
  getMemory: () => request<{ items: MemoryItem[] }>("/agent/memory"),
  getMemoryContent: (path: string) =>
    request<{ path: string; content: string }>(
      `/agent/memory/content?path=${encodeURIComponent(path)}`,
    ),
  deleteMemory: (path: string) =>
    request<{ ok: boolean }>(`/agent/memory?path=${encodeURIComponent(path)}`, { method: "DELETE" }),

  // Skills
  getSkills: () => request<{ items: SkillItem[] }>("/agent/skills"),
  getSkillContent: (path: string) =>
    request<{ path: string; content: string; files?: string[] }>(
      `/agent/skills/content?path=${encodeURIComponent(path)}`,
    ),
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
  /** Removes the stored provider key (Windows Credential Manager). */
  removeKey: () =>
    request<{ ok: boolean }>("/agent/settings", {
      method: "POST",
      body: JSON.stringify({ removeKey: true }),
    }),
  /** Tiny real provider request with the stored key → plain-language result. */
  testConnection: () =>
    request<{ ok: boolean; message: string }>("/agent/test-connection", { method: "POST" }),

  // Desktop actions (frontend must confirm with the user first)
  runCode: (language: string, code: string) =>
    request<{ ok: boolean; stdout?: string; stderr?: string; error?: string; durationMs?: number }>(
      "/workspace/run-code",
      { method: "POST", body: JSON.stringify({ language, code }) },
    ),

  // ---------------- Workspace artifacts (Phase 6) ----------------
  listArtifacts: () =>
    request<{ artifacts: WorkspaceArtifact[]; current: WorkspaceArtifact | null }>(
      "/workspace/artifacts",
    ),
  clearArtifacts: () =>
    request<{ ok: boolean }>("/workspace/clear", { method: "POST" }),
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
    request<{ ok: boolean; folder: string; error?: string }>("/workspace/pick-folder", {
      method: "POST",
    }),

  // ---------------- Hermes control (Phase 3) ----------------
  getProviders: () => request<{ providers: ProviderInfo[] }>("/hermes/providers"),
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
    request<{ ok: boolean }>("/hermes/mcp/remove", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  testMcpServer: (name: string) =>
    request<{ ok: boolean; output: string }>("/hermes/mcp/test", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

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
  getSkillsHub: (q = "") => request<{ output: string }>(`/hermes/skills/hub?q=${encodeURIComponent(q)}`),
  installSkill: (name: string) =>
    request<{ ok: boolean; output: string }>("/hermes/skills/install", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  uninstallSkill: (name: string) =>
    request<{ ok: boolean; output: string }>("/hermes/skills/uninstall", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  // ---------------- PC control, files, vision (Phase 4) ----------------
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

  planFiles: (directory: string) =>
    request<FilePlan>("/files/plan", { method: "POST", body: JSON.stringify({ directory }) }),
  applyFiles: (planId: string) =>
    request<{ ok: boolean; moved: number; failed: { name: string; reason: string }[]; error?: string }>(
      "/files/apply",
      { method: "POST", body: JSON.stringify({ planId }) },
    ),
  undoFiles: () =>
    request<{ ok: boolean; restored: number; problems: string[]; error?: string }>("/files/undo", {
      method: "POST",
    }),
  getFileJournal: () =>
    request<{ entries: { id: string; ts: string; directory: string; moves: { from: string; to: string }[]; undone: boolean }[] }>(
      "/files/journal",
    ),
  getProtectedFolders: () => request<{ folders: string[] }>("/files/protected"),
  setProtectedFolders: (folders: string[]) =>
    request<{ ok: boolean; folders: string[] }>("/files/protected", {
      method: "POST",
      body: JSON.stringify({ folders }),
    }),

  seeScreen: (payload: { question?: string; window?: string; model?: string }) =>
    request<{ ok: boolean; description?: string; model?: string; imagePath?: string; error?: string }>(
      "/vision/see",
      { method: "POST", body: JSON.stringify(payload) },
    ),
  visionImageUrl: (path: string) =>
    `${backendBaseUrl()}/vision/image?path=${encodeURIComponent(path)}`,

  // ---------------- voice, actions, music (Phase 5) ----------------
  voiceStatus: () => request<VoiceSettings>("/voice/status"),
  getMics: () => request<{ mics: MicInfo[] }>("/voice/mics"),
  listenVoice: (source = "manual") =>
    request<{ ok: boolean; state?: string; error?: string }>("/voice/listen", {
      method: "POST",
      body: JSON.stringify({ source }),
    }),
  cancelVoice: () => request<{ ok: boolean; state?: string }>("/voice/cancel", { method: "POST" }),
  testWav: (path: string, simulateWake = false) =>
    request<{ ok: boolean; text?: string; wakeScore?: number | null; duration?: number; error?: string }>(
      "/voice/test-wav",
      { method: "POST", body: JSON.stringify({ path, simulateWake }) },
    ),
  runAction: (text: string) =>
    request<{ handled: boolean; reply?: string; data?: Record<string, unknown> }>("/actions/run", {
      method: "POST",
      body: JSON.stringify({ text }),
    }),

  spotifyStatus: () => request<SpotifyStatus>("/music/spotify/status"),
  setSpotifyClientId: (clientId: string) =>
    request<{ ok: boolean; clientId: string }>("/music/spotify/client", {
      method: "POST",
      body: JSON.stringify({ clientId }),
    }),
  spotifyAuthUrl: (open = false) =>
    request<{ ok: boolean; url?: string; error?: string }>(
      `/music/spotify/auth-url?open=${open ? "true" : "false"}`,
    ),
  spotifyPlay: (query: string) =>
    request<{ ok: boolean; detail?: string; level?: number; error?: string }>("/music/spotify/play", {
      method: "POST",
      body: JSON.stringify({ query }),
    }),
  spotifyControl: (action: "play" | "pause" | "next" | "previous") =>
    request<{ ok: boolean; detail?: string; error?: string }>("/music/spotify/control", {
      method: "POST",
      body: JSON.stringify({ action }),
    }),
  spotifyDisconnect: () => request<{ ok: boolean }>("/music/spotify/disconnect", { method: "POST" }),
  spotifyRedirectUri: () => `${backendBaseUrl()}/music/spotify/callback`,
};

export interface MicInfo {
  id: string;
  name: string;
  channels: number;
  default: boolean;
}
