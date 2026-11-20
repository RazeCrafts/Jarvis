import express, { type Request, type Response } from "express";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import {
  loadJarvisData,
  saveJarvisData,
  exportShareBundle,
  importShareBundle,
  newId,
} from "./server/storage";
import {
  COMMUNITY_PLUGIN_CATALOG,
  installFromManifestText,
  installFromRemoteUrl,
  checkUpstreamPluginUpdates,
  rollbackPluginVersion,
  diagnoseAllPlugins,
} from "./server/pluginAdapter";
import {
  DEFAULT_GEMINI_MODEL,
  LIGHT_GEMINI_MODEL,
  isGeminiConfigured,
  runGeminiTurn,
  analyzeScreenFrameWithGemini,
  searchVideosWithGemini,
  generateSpeechWavWithGemini,
  extractWebContextWithGemini,
  runGeminiLiveBridge,
  executeArtCraftMcpCommand,
} from "./server/geminiService";
import {
  getBridgeStatus,
  rotatePairingToken,
  validatePairingToken,
  registerBridgeSocket,
  dispatchBridgeCommand,
  generateBridgeCompanionScript,
} from "./server/bridgeCompanion";
import {
  buildMemoryWiki,
  buildProactiveBriefing,
  evaluateAutomationRules,
  exportEventsToIcs,
} from "./src/lib/memoryAndCalendar";
import { draftSkillFromWorkflow } from "./src/lib/pluginAdapter";
import { detectNaturalNavigationIntent } from "./src/lib/autoNavigator";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || process.env.JARVIS_PORT || 3000);
const IS_PROD = process.env.NODE_ENV === "production";

/* ------------------------------------------------------------------ providers */

interface ProviderProfile {
  slug: string;
  label: string;
  description: string;
  authType: "builtin" | "api_key" | "oauth" | "local_cli";
  tab: "builtin" | "keys" | "accounts";
  envVars: string[];
  baseUrlEnvVar: string;
  signupUrl: string;
  baseUrl: string;
}

const PROVIDERS: ProviderProfile[] = [
  {
    slug: "gemini-builtin",
    label: "JARVIS Core Intelligence",
    description: "Built-in multimodal reasoning, live search grounding, chart generation, and screen vision.",
    authType: "builtin",
    tab: "builtin",
    envVars: [],
    baseUrlEnvVar: "",
    signupUrl: "",
    baseUrl: "",
  },
  {
    slug: "openrouter",
    label: "OpenRouter",
    description: "Unified gateway to 200+ open-source and frontier models",
    authType: "api_key",
    tab: "keys",
    envVars: ["OPENROUTER_API_KEY"],
    baseUrlEnvVar: "OPENROUTER_BASE_URL",
    signupUrl: "https://openrouter.ai/keys",
    baseUrl: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
  },
  {
    slug: "openai",
    label: "OpenAI",
    description: "GPT-4o, o3, and OpenAI reasoning models",
    authType: "api_key",
    tab: "keys",
    envVars: ["OPENAI_API_KEY"],
    baseUrlEnvVar: "OPENAI_BASE_URL",
    signupUrl: "https://platform.openai.com/api-keys",
    baseUrl: "https://api.openai.com/v1",
  },
  {
    slug: "anthropic",
    label: "Anthropic",
    description: "Claude Sonnet and Opus models via API key",
    authType: "api_key",
    tab: "keys",
    envVars: ["ANTHROPIC_API_KEY"],
    baseUrlEnvVar: "ANTHROPIC_BASE_URL",
    signupUrl: "https://console.anthropic.com",
    baseUrl: "https://api.anthropic.com/v1",
  },
  {
    slug: "nvidia",
    label: "NVIDIA NIM",
    description: "Nemotron, Llama, and DeepSeek hosted on NVIDIA NIM",
    authType: "api_key",
    tab: "keys",
    envVars: ["NVIDIA_API_KEY"],
    baseUrlEnvVar: "NVIDIA_BASE_URL",
    signupUrl: "https://build.nvidia.com",
    baseUrl: "https://integrate.api.nvidia.com/v1",
  },
  {
    slug: "groq",
    label: "Groq",
    description: "Ultra-fast LPU inference for Llama and Mixtral",
    authType: "api_key",
    tab: "keys",
    envVars: ["GROQ_API_KEY"],
    baseUrlEnvVar: "GROQ_BASE_URL",
    signupUrl: "https://console.groq.com/keys",
    baseUrl: "https://api.groq.com/openai/v1",
  },
  {
    slug: "together",
    label: "Together AI",
    description: "Open-source models with OpenAI-compatible chat API",
    authType: "api_key",
    tab: "keys",
    envVars: ["TOGETHER_API_KEY"],
    baseUrlEnvVar: "TOGETHER_BASE_URL",
    signupUrl: "https://api.together.xyz",
    baseUrl: "https://api.together.xyz/v1",
  },
  {
    slug: "deepseek",
    label: "DeepSeek",
    description: "DeepSeek V3 and R1 reasoning models",
    authType: "api_key",
    tab: "keys",
    envVars: ["DEEPSEEK_API_KEY"],
    baseUrlEnvVar: "DEEPSEEK_BASE_URL",
    signupUrl: "https://platform.deepseek.com",
    baseUrl: "https://api.deepseek.com/v1",
  },
  {
    slug: "mistral",
    label: "Mistral AI",
    description: "Mistral Large, Codestral, and Pixtral models",
    authType: "api_key",
    tab: "keys",
    envVars: ["MISTRAL_API_KEY"],
    baseUrlEnvVar: "MISTRAL_BASE_URL",
    signupUrl: "https://console.mistral.ai",
    baseUrl: "https://api.mistral.ai/v1",
  },
  {
    slug: "xai",
    label: "xAI (Grok)",
    description: "Grok models via xAI API",
    authType: "api_key",
    tab: "keys",
    envVars: ["XAI_API_KEY"],
    baseUrlEnvVar: "XAI_BASE_URL",
    signupUrl: "https://console.x.ai",
    baseUrl: "https://api.x.ai/v1",
  },
  {
    slug: "nous-portal",
    label: "Nous Portal (Account OAuth)",
    description: "Key-less Nous Portal OAuth gateway connector",
    authType: "oauth",
    tab: "accounts",
    envVars: [],
    baseUrlEnvVar: "",
    signupUrl: "https://portal.nousresearch.com",
    baseUrl: "https://inference-api.nousresearch.com/v1",
  },
  {
    slug: "openai-oauth",
    label: "ChatGPT / Codex Subscription",
    description: "Account OAuth / device-code session flow",
    authType: "oauth",
    tab: "accounts",
    envVars: [],
    baseUrlEnvVar: "",
    signupUrl: "https://chatgpt.com",
    baseUrl: "https://api.openai.com/v1",
  },
  {
    slug: "claude-directsdk",
    label: "Claude Subscription DirectSDK",
    description: "Key-less routing through your active Claude CLI session via Desktop Bridge",
    authType: "local_cli",
    tab: "accounts",
    envVars: [],
    baseUrlEnvVar: "",
    signupUrl: "https://claude.ai",
    baseUrl: "",
  },
];

const keyStore = new Map<string, string>();
for (const p of PROVIDERS) {
  for (const envVar of p.envVars) {
    const val = process.env[envVar];
    if (val) keyStore.set(envVar, val.trim());
  }
}

/* ------------------------------------------------------------------ runtime state */

interface ArtifactVersion {
  n: number;
  at: number;
  content: string;
}

interface StoredArtifact {
  id: string;
  kind: "three" | "html" | "svg" | "code" | "markdown" | "image";
  title: string;
  language: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  versions: ArtifactVersion[];
}

const state = {
  brain: (process.env.JARVIS_BRAIN || "auto") as "hermes" | "openrouter" | "auto",
  provider: isGeminiConfigured() ? "gemini-builtin" : "openrouter",
  models: {
    default: isGeminiConfigured()
      ? DEFAULT_GEMINI_MODEL
      : process.env.JARVIS_DEFAULT_MODEL || "nvidia/nemotron-3.5-super-vl:free",
    fast: isGeminiConfigured()
      ? LIGHT_GEMINI_MODEL
      : process.env.JARVIS_FAST_MODEL || "nvidia/nemotron-3.5-lightning:free",
    heavy: isGeminiConfigured()
      ? DEFAULT_GEMINI_MODEL
      : process.env.JARVIS_HEAVY_MODEL || "nvidia/nemotron-3-ultra-550b-a55b:free",
  },
  confirmDangerousTools: (process.env.JARVIS_CONFIRM_DANGEROUS_TOOLS ?? "true") !== "false",
  allowedApps: (process.env.JARVIS_ALLOWED_APPS || "notepad,calculator,explorer,spotify,chrome,edge,code")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  tts: {
    enabled: (process.env.JARVIS_TTS_ENABLED ?? "true") !== "false",
    rate: Number(process.env.JARVIS_TTS_RATE || 0.98),
    pitch: Number(process.env.JARVIS_TTS_PITCH || 0.85),
  },
  voice: {
    state: "stopped" as "idle" | "listening" | "transcribing" | "stopped",
    wakeEnabled: false,
    wakeWord: "hey_jarvis_v0.1",
    wakeThreshold: 0.55,
    pttHotkey: "ctrl+alt+j",
    micDevice: "",
    sttModel: "browser-web-speech",
    streamOpen: false,
    wakeModelReady: false,
    wakeError: "",
    sttReady: true,
    sttError: "",
    ttsSpeaking: false,
  },
  spotify: {
    clientId: "",
    authorized: false,
    displayName: null as string | null,
    product: null as string | null,
    premium: null as boolean | null,
  },
  customProviders: {} as Record<string, { api?: string; key_env?: string; transport?: string }>,
  permissions: {} as Record<string, string>,
  killSwitch: {
    engaged: false,
    hotkey: "ctrl+shift+x",
    active: false,
  },
  protectedFolders: ["/etc", "/usr", "/bin", "/System", "C:\\Windows", "C:\\Program Files"],
  visionModel: DEFAULT_GEMINI_MODEL,
  toolsets: [
    { name: "web", label: "Web & Video Search", description: "Grounded web search and video discovery", enabled: true },
    { name: "workspace", label: "Live Workshop & Charts", description: "Generate 3D Three.js, HTML, SVG, and live graphs", enabled: true },
    { name: "memory", label: "Personal Memory & Notes", description: "Recall personal facts, preferences, and markdown notes", enabled: true },
    { name: "calendar", label: "Calendar & Routines", description: "Schedule events, reminders, and recurring routines", enabled: true },
    { name: "smarthome", label: "Smart Home & Media", description: "Control rooms, lights, climate, and media queues", enabled: true },
    { name: "code", label: "Code Sandbox", description: "Execute sandboxed JavaScript snippets", enabled: true },
    { name: "desktop", label: "Desktop Bridge Actions", description: "OS app launching & CLI bridge (requires companion)", enabled: false },
  ],
  mcpServers: [] as { name: string; type: "remote" | "stdio"; url?: string | null; command?: string | null; args: string[]; enabled: boolean }[],
  cronJobs: [] as { id: string; name: string; schedule: string; prompt: string; deliver: string[]; state: string; enabled: boolean; skills: string[] }[],
  gateway: {
    running: false,
    pid: null as number | null,
    platformTokens: new Map<string, string>(),
    logs: ["[gateway] JARVIS web runtime ready."],
  },
  audit: [] as { ts: string; tool: string; decision: string; source: string; detail: string; args: string }[],
  artifacts: [] as StoredArtifact[],
  repaired: new Map<string, number>(),
};

function maskSecret(val: string | undefined): string {
  const s = (val || "").trim();
  if (!s) return "";
  if (s.length <= 8) return "••••";
  return `${s.slice(0, 4)}••••${s.slice(-4)}`;
}

function addAudit(tool: string, decision: string, source = "user", detail = "", args = ""): void {
  state.audit.unshift({ ts: new Date().toISOString(), tool, decision, source, detail, args });
  if (state.audit.length > 100) state.audit.length = 100;
}

function getProviderEndpoint(slugOverride?: string) {
  const slug = (slugOverride || state.provider || "openrouter").trim();
  if (slug === "gemini-builtin") return null;
  if (slug.startsWith("custom:")) {
    const name = slug.slice("custom:".length);
    const cfg = state.customProviders[name];
    if (!cfg) return null;
    const key = cfg.key_env ? keyStore.get(cfg.key_env) || "" : "";
    return {
      slug,
      label: name,
      baseUrl: (cfg.api || "").replace(/\/+$/, ""),
      apiKey: key || "not-needed",
      headers: {} as Record<string, string>,
    };
  }
  const profile = PROVIDERS.find((p) => p.slug === slug);
  if (!profile || !profile.baseUrl) return null;
  const envVar = profile.envVars[0];
  const apiKey = envVar ? keyStore.get(envVar) || "" : "";
  const headers: Record<string, string> =
    slug === "openrouter" ? { "HTTP-Referer": `http://localhost:${PORT}`, "X-Title": "JARVIS" } : {};
  return {
    slug,
    label: profile.label,
    baseUrl: profile.baseUrl.replace(/\/+$/, ""),
    apiKey,
    headers,
  };
}

/* ------------------------------------------------------------------ workspace helpers */

const BUILD_RE = /\b(build|make|create|generate|design|draw|render|code|program|craft|model)\b/i;
const EDIT_RE = /\b(add|change|make|turn|recolou?r|colou?r|remove|delete|move|rotate|scale|shrink|enlarge|bigger|smaller|replace|fix|animate|glow|thicken|thin|update|adjust|put|swap|bend|reposition|zoom|brighten|darken)\b/i;
const TARGET_RE = /\b(3d|three\.?js|scene|model|spaceship|space\s?ship|rocket|ship|car|vehicle|planet|solar\s+system|earth|moon|sun|house|robot|character|creature|logo|svg|icon|web\s?page|website|html|dashboard|timer|clock|calculator|todo|to-do|app|game|simulation|animation|canvas|artifact|diagram|poster|form|quiz|piano|keyboard)\b/i;
const REF_RE = /\b(it|its|this|that|them|those|the\s+(scene|model|ship|car|object|artifact|design|render|animation|app|page|logo|art))\b/i;
const CHAT_ONLY_RE = /\b(email|e-mail|remind|reminder|note|summary|summari[sz]e|explain|what\s+is|who\s+is|how\s+do|why\s+|tell\s+me|message|call|schedule|meeting|weather|news|search|google|chart|graph)\b/i;

function inferArtifactKind(message: string): "three" | "html" | "svg" {
  const lowered = message.toLowerCase();
  if (/\b(svg|logo|icon|vector|badge|emblem)\b/.test(lowered)) return "svg";
  if (/\b(html|web\s?page|website|landing|dashboard|timer|clock|calculator|todo|to-do|app|canvas|bouncing|simulation|game|form|quiz|piano|keyboard)\b/.test(lowered)) {
    return "html";
  }
  return "three";
}

function toPublicArtifact(item: StoredArtifact) {
  const numbers = item.versions.map((v) => v.n).filter((n) => n > 0);
  const latest = numbers[numbers.length - 1] ?? 1;
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    language: item.language,
    content: item.content,
    version: latest,
    versionCount: numbers.length || 1,
    versions: numbers.length ? numbers : [1],
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function currentArtifact(): StoredArtifact | null {
  return state.artifacts.length ? state.artifacts[state.artifacts.length - 1] : null;
}

function detectWorkspaceRequest(message: string): {
  kind: "three" | "html" | "svg";
  edit: boolean;
  artifact: StoredArtifact | null;
} | null {
  let text = message.trim();
  if (!text) return null;
  const forced = text.toLowerCase().startsWith("workspace:");
  if (forced) text = text.split(":", 2)[1]?.trim() || text;

  const latest = currentArtifact();
  let build = BUILD_RE.test(text) && TARGET_RE.test(text);
  let edit =
    Boolean(latest) &&
    !build &&
    EDIT_RE.test(text) &&
    text.length < 140 &&
    !CHAT_ONLY_RE.test(text) &&
    (REF_RE.test(text) || TARGET_RE.test(text) || text.length < 80);

  if (forced) {
    const wantsEdit = Boolean(latest) && /\b(add|change|make|fix|update|remove|recolor|colou?r|animate|move|rotate)\b/i.test(text);
    edit = wantsEdit;
    build = !wantsEdit;
  } else if (!build && !edit) {
    return null;
  }

  const kind: "three" | "html" | "svg" =
    edit && latest && (latest.kind === "three" || latest.kind === "html" || latest.kind === "svg")
      ? latest.kind
      : inferArtifactKind(text);

  return { kind, edit, artifact: edit ? latest : null };
}

const THREE_HELPER_DOC = `THREE HELPERS (already loaded — do not import anything):
  JARVIS.scene({background:'#0a0a12'})                      -> THREE.Scene
  JARVIS.camera({fov:50, position:[3,2,5], lookAt:[0,0,0]}) -> camera
  JARVIS.lights({ambient:0.6, key:1.6, fill:0.6})           -> {ambient,key,fill}
  JARVIS.mat('#ff5533', {metalness:0.6, roughness:0.35})    -> MeshStandardMaterial
  JARVIS.box(w,h,d,mat)  JARVIS.sphere(r,mat)  JARVIS.cylinder(rTop,rBottom,h,mat)
  JARVIS.cone(r,h,mat)   JARVIS.torus(r,tube,mat)  JARVIS.plane(w,h,mat)
  JARVIS.group(...objects)                                  -> THREE.Group
  JARVIS.at(object, [x,y,z], {rotation:[x,y,z], scale:[x,y,z]}) -> the same object
  JARVIS.add(...objects)                                    -> adds to the scene
  JARVIS.fit({padding:1.4})                                 -> auto-fit camera (call once)
  JARVIS.onFrame((tSeconds, deltaSeconds) => { ... })       -> animation hook
  JARVIS.orbit({autoRotate:true, autoRotateSpeed:0.8, minDistance:2, maxDistance:20})`;

function buildWorkspacePrompt(message: string, artifact: StoredArtifact | null, kind: "three" | "html" | "svg"): string {
  const rules = `You are building a LIVE artifact for JARVIS's Workshop.
OUTPUT RULES
- Reply with one or two short sentences about what you built, then EXACTLY ONE fenced code block tagged \`${kind}\`.
- Do not add any other code block or file.
- The artifact runs offline inside a sandboxed iframe: no imports, no CDN, no fetch, no external assets.
`;
  const body =
    kind === "three"
      ? `- Write plain JavaScript (no imports). Use the helpers below inside the block.\n- End with JARVIS.fit() and JARVIS.onFrame(...) when animated.\n\n${THREE_HELPER_DOC}`
      : kind === "svg"
        ? `- Return a complete \`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">…</svg>\`.`
        : `- Return a complete \`<!doctype html>\` document with inline CSS and JS.`;

  const current = artifact
    ? `\nCURRENT ARTIFACT (v${artifact.versions[artifact.versions.length - 1]?.n ?? 1}):\n\`\`\`${artifact.kind}\n${artifact.content}\n\`\`\`\nApply the edit and return the complete updated artifact.\n`
    : "";

  return `${rules}${body}\n${current}\nUSER REQUEST: ${message}`;
}

function buildRepairPrompt(artifact: StoredArtifact, error: string): string {
  const kind = artifact.kind === "html" || artifact.kind === "svg" ? artifact.kind : "three";
  return `Repair this Workshop artifact:\nERROR:\n\`\`\`\n${error.slice(0, 1500)}\n\`\`\`\nCURRENT CODE:\n\`\`\`${kind}\n${artifact.content}\n\`\`\`\nReply with one short sentence then one fenced \`${kind}\` block.\n${kind === "three" ? THREE_HELPER_DOC : ""}`;
}

function parseArtifactReply(text: string): { kind: "three" | "html" | "svg"; content: string } | null {
  const re = /```([\w-]*)\s*\n([\s\S]*?)```/gm;
  const blocks: Array<[string, string]> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    blocks.push([m[1].toLowerCase(), m[2].trimEnd()]);
  }
  if (!blocks.length) return null;
  for (const [lang, code] of blocks) {
    if (lang === "three" || lang === "html" || lang === "svg") {
      return { kind: lang, content: code.replace(/^\n+|\n+$/g, "") };
    }
  }
  for (const [, code] of blocks) {
    const low = code.toLowerCase();
    if (low.includes("<svg")) return { kind: "svg", content: code.trim() };
    if (low.includes("<html") || low.includes("<!doctype")) return { kind: "html", content: code.trim() };
    if (low.includes("three") || low.includes("jarvis.")) return { kind: "three", content: code.trim() };
  }
  return null;
}

function stripFences(text: string): string {
  return text.replace(/```[\w-]*\s*\n[\s\S]*?```/gm, "").replace(/\n{3,}/g, "\n\n").trim();
}

function titleFromPrompt(message: string): string {
  let t = message.trim().replace(/^(hey\s+jarvis[,!.]?\s*)/i, "");
  t = t.replace(/^(please\s+)?(can\s+you\s+)?(build|make|create|generate|design|draw|render|code|program)\s+(me\s+)?(a|an|the)?\s*/i, "");
  t = t.replace(/\s+/g, " ").replace(/^[ .!?]+|[ .!?]+$/g, "");
  if (!t) return "Artifact";
  const words = t.split(" ").slice(0, 7).join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function saveArtifact(kind: StoredArtifact["kind"], title: string, content: string, editId?: string | null): StoredArtifact {
  const now = Date.now();
  const existing = editId ? state.artifacts.find((a) => a.id === editId && a.kind === kind) : undefined;
  if (existing) {
    const latestN = existing.versions[existing.versions.length - 1]?.n ?? existing.versions.length;
    existing.content = content;
    existing.updatedAt = now;
    if (title.trim()) existing.title = title.trim().slice(0, 70);
    existing.versions.push({ n: latestN + 1, at: now, content });
    if (existing.versions.length > 10) existing.versions = existing.versions.slice(-10);
    return existing;
  }
  const created: StoredArtifact = {
    id: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
    kind,
    title: (title || "Artifact").trim().slice(0, 70),
    language: kind === "three" ? "javascript" : kind,
    content,
    createdAt: now,
    updatedAt: now,
    versions: [{ n: 1, at: now, content }],
  };
  state.artifacts.push(created);
  if (state.artifacts.length > 24) state.artifacts = state.artifacts.slice(-24);
  return created;
}

/* ------------------------------------------------------------------ deterministic actions */

function runDeterministicAction(text: string): { handled: boolean; reply?: string; data?: Record<string, unknown>; stopSpeaking?: boolean } {
  const original = text.trim().replace(/\s+/g, " ");
  if (!original) return { handled: false };

  if (/^(?:stop|be quiet|quiet|silence|shut up|never mind|nevermind)[.!]?$/i.test(original)) {
    return { handled: true, reply: "", data: { action: "stop_speaking" }, stopSpeaking: true };
  }

  const navMatch = original.match(
    /^(?:open|show|go\s+to|switch\s+to)\s+(?:the\s+)?(workspace|workshop|memory|calendar|notes|settings|customize|themes|tools|control|gateway|tasks|providers|bridge|skills|plugins|home|hud|video|video\s+studio|smart\s+home|media)[.!]?$/i,
  );
  if (navMatch) {
    const target = navMatch[1].toLowerCase();
    const map: Record<string, string> = {
      workspace: "workspace",
      workshop: "workspace",
      home: "home",
      hud: "home",
      video: "video",
      "video studio": "video",
      "smart home": "smarthome",
      media: "smarthome",
      memory: "memory",
      calendar: "memory",
      notes: "memory",
      skills: "skills",
      plugins: "skills",
      providers: "providers",
      bridge: "providers",
      control: "providers",
      tools: "skills",
      gateway: "providers",
      tasks: "memory",
      settings: "settings",
      customize: "settings",
      themes: "settings",
    };
    return {
      handled: true,
      reply: `Opening ${target}, sir.`,
      data: { action: "navigate", tab: map[target] || "home" },
    };
  }

  const stageMatch = original.match(
    /^(pull\s+it\s+apart|pull\s+apart|explode\s+it|explode|put\s+it\s+back\s+together|put\s+it\s+back|reassemble|from\s+the\s+top|top\s+view|camera\s+from\s+the\s+top|from\s+the\s+front|front\s+view|3d\s+print\s+it|export\s+3d\s+print|export\s+glb|photograph\s+it|take\s+a\s+photo|render\s+it)[.!]?$/i,
  );
  if (stageMatch) {
    const cmdRaw = stageMatch[1].toLowerCase();
    let command = "unknown";
    let reply = "Right away, sir.";
    if (cmdRaw.includes("pull") || cmdRaw.includes("explode")) {
      command = "explode";
      reply = "Pulling the assembly apart, sir.";
    } else if (cmdRaw.includes("back") || cmdRaw.includes("reassemble")) {
      command = "assemble";
      reply = "Reassembling the model, sir.";
    } else if (cmdRaw.includes("top")) {
      command = "camera_top";
      reply = "Viewing from the top.";
    } else if (cmdRaw.includes("front")) {
      command = "camera_front";
      reply = "Viewing from the front.";
    } else if (cmdRaw.includes("print") || cmdRaw.includes("glb")) {
      command = "export_glb";
      reply = "Exporting 3D print file, sir.";
    } else if (cmdRaw.includes("photograph") || cmdRaw.includes("photo") || cmdRaw.includes("render")) {
      command = "export_png";
      reply = "Capturing studio photograph, sir.";
    }
    return { handled: true, reply, data: { action: "stage_control", command } };
  }

  const navIntent = detectNaturalNavigationIntent(original);
  if (navIntent.tab) {
    const labelMap: Record<string, string> = {
      home: "Command HUD",
      workspace: "Workshop Studio",
      video: "Video Studio",
      smarthome: "Smart Home & Media",
      memory: "Memory & Calendar",
      skills: "Skills & Plugins",
      providers: "Models & Bridge",
      settings: "Customize & Settings",
    };
    const tabLabel = labelMap[navIntent.tab] || navIntent.tab;
    const isPureNavOrVideoEdit =
      navIntent.tab === "video" ||
      original.split(/\s+/).length <= 8;
    if (isPureNavOrVideoEdit) {
      const editSummary = navIntent.videoEdit
        ? " Applying your requested timeline edits now, sir."
        : "";
      return {
        handled: true,
        reply: `Opening ${tabLabel}, sir.${editSummary}`,
        data: {
          action: "navigate",
          tab: navIntent.tab,
          ...(navIntent.videoEdit ? { videoEdit: navIntent.videoEdit } : {}),
        },
      };
    }
  }

  return { handled: false };
}

/* ------------------------------------------------------------------ LLM routing */

const HEAVY_HINTS = /\b(analyz\w*|reason\w*|proof|prove|derive|solve|complex|refactor|architect\w*|research|deep|compare|strategy|debug|why)\b/i;

function pickModel(message: string, override?: string | null): string {
  if (override) return override;
  if (HEAVY_HINTS.test(message)) return state.models.heavy;
  return state.models.default;
}

async function fetchOpenRouterFreeModels(): Promise<{ id: string; name: string | null; context: number | null }[]> {
  try {
    const baseUrl = PROVIDERS[1].baseUrl.replace(/\/+$/, "");
    const key = keyStore.get("OPENROUTER_API_KEY");
    const resp = await fetch(`${baseUrl}/models`, {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      signal: AbortSignal.timeout(12000),
    });
    if (!resp.ok) return [];
    const json = (await resp.json()) as { data?: Array<{ id?: string; name?: string; context_length?: number }> };
    return (json.data || [])
      .filter((m) => (m.id || "").endsWith(":free"))
      .map((m) => ({ id: m.id || "", name: m.name || null, context: m.context_length ?? null }))
      .sort((a, b) => a.id.localeCompare(b.id));
  } catch {
    return [];
  }
}

async function streamProviderCompletion(
  prompt: string,
  history: Array<{ role: string; content: string }>,
  modelOverride: string | null,
  onEvent: (event: Record<string, unknown>) => void,
  options: { rawMode?: boolean } = {},
): Promise<string> {
  const chosenProvider = modelOverride?.startsWith("gemini-") ? "gemini-builtin" : state.provider;

  if (chosenProvider === "claude-directsdk") {
    onEvent({ type: "status", brain: "claude-directsdk", model: "claude-subscription" });
    const bridgeRes = await dispatchBridgeCommand("claude_cli", { prompt });
    if (bridgeRes.ok && typeof bridgeRes.output === "string") {
      onEvent({ type: "token", content: bridgeRes.output });
      return bridgeRes.output;
    }
    onEvent({ type: "error", message: String(bridgeRes.error || "Claude CLI bridge failed.") });
    return "";
  }

  if (chosenProvider === "gemini-builtin" || (isGeminiConfigured() && !getProviderEndpoint(chosenProvider)?.apiKey)) {
    return runGeminiTurn(prompt, history, modelOverride || state.models.default, onEvent, options);
  }

  const endpoint = getProviderEndpoint(chosenProvider);
  if (!endpoint) {
    onEvent({ type: "error", message: `No API profile found for provider '${chosenProvider}'.` });
    return "";
  }
  if (!endpoint.baseUrl) {
    onEvent({ type: "error", message: `No endpoint URL configured for ${endpoint.label}.` });
    return "";
  }
  if (!endpoint.apiKey) {
    onEvent({
      type: "error",
      message: `No credentials configured for ${endpoint.label}. Switch to Built-In Intelligence or configure ${endpoint.label} in Models & Bridge.`,
    });
    return "";
  }

  const chosen = pickModel(prompt, modelOverride);
  onEvent({ type: "status", brain: endpoint.slug, model: chosen });
  const data = await loadJarvisData();

  const messages = [
    { role: "system", content: data.persona.systemDirectives },
    ...history.filter((m) => (m.role === "user" || m.role === "assistant") && m.content),
    { role: "user", content: prompt },
  ];

  const resp = await fetch(`${endpoint.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${endpoint.apiKey}`,
      "Content-Type": "application/json",
      ...endpoint.headers,
    },
    body: JSON.stringify({ model: chosen, messages, stream: true }),
    signal: AbortSignal.timeout(90000),
  });

  if (!resp.ok || !resp.body) {
    const errText = await resp.text().catch(() => resp.statusText);
    onEvent({ type: "error", message: `${endpoint.label} returned ${resp.status}: ${errText.slice(0, 300)}` });
    return "";
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const collected: string[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") break;
      try {
        const chunk = JSON.parse(payload) as {
          error?: { message?: string } | string;
          choices?: Array<{ delta?: { content?: string } }>;
        };
        if (chunk.error) {
          const msg = typeof chunk.error === "string" ? chunk.error : chunk.error.message || "Provider error";
          onEvent({ type: "error", message: msg.slice(0, 400) });
          return "";
        }
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          collected.push(delta);
          onEvent({ type: "token", content: delta });
        }
      } catch {
        /* ignore */
      }
    }
  }
  return collected.join("");
}

/* ------------------------------------------------------------------ Express app */

const app = express();
app.use(express.json({ limit: "16mb" }));

app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    brain: state.brain,
    provider: state.provider,
    model: state.models.default,
    hasGeminiBuiltin: isGeminiConfigured(),
    hasKey: isGeminiConfigured() || Boolean(keyStore.get("OPENROUTER_API_KEY")),
    confirmDangerousTools: state.confirmDangerousTools,
    version: "1.0.0",
  });
});

app.get("/agent/status", (_req: Request, res: Response) => {
  res.json({
    brain: state.brain,
    provider: state.provider,
    initError: null,
    model: state.models.default,
    models: state.models,
    tts: state.tts,
    confirmDangerousTools: state.confirmDangerousTools,
    hasKey: isGeminiConfigured() || Boolean(keyStore.get("OPENROUTER_API_KEY")),
    hasGeminiBuiltin: isGeminiConfigured(),
  });
});

/* ---------------- Personal Memory, Notes & Calendar ---------------- */

app.get("/api/memories", async (_req: Request, res: Response) => {
  const data = await loadJarvisData();
  res.json({ items: data.memories });
});

app.post("/api/memories", async (req: Request, res: Response) => {
  const data = await loadJarvisData();
  const title = String(req.body?.title || "Personal Memory").trim();
  const content = String(req.body?.content || "").trim();
  if (!content) {
    res.status(400).json({ detail: "content is required" });
    return;
  }
  const cat = String(req.body?.category || "fact");
  const entry = {
    id: newId("mem"),
    category: (["preference", "person", "project", "fact", "routine"].includes(cat) ? cat : "fact") as "preference" | "person" | "project" | "fact" | "routine",
    title,
    content,
    pinned: Boolean(req.body?.pinned),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  data.memories.unshift(entry);
  await saveJarvisData(data);
  res.json({ ok: true, item: entry });
});

app.patch("/api/memories/:id", async (req: Request, res: Response) => {
  const data = await loadJarvisData();
  const item = data.memories.find((m) => m.id === req.params.id);
  if (!item) {
    res.status(404).json({ detail: "memory not found" });
    return;
  }
  if (typeof req.body?.title === "string") item.title = req.body.title;
  if (typeof req.body?.content === "string") item.content = req.body.content;
  if (typeof req.body?.pinned === "boolean") item.pinned = req.body.pinned;
  item.updatedAt = Date.now();
  await saveJarvisData(data);
  res.json({ ok: true, item });
});

app.delete("/api/memories/:id", async (req: Request, res: Response) => {
  const data = await loadJarvisData();
  data.memories = data.memories.filter((m) => m.id !== req.params.id);
  await saveJarvisData(data);
  res.json({ ok: true });
});

// Legacy /agent/memory adapters
app.get("/agent/memory", async (_req: Request, res: Response) => {
  const data = await loadJarvisData();
  res.json({
    items: data.memories.map((m) => ({
      id: m.id,
      kind: m.category,
      title: m.title,
      path: m.id,
      updatedAt: m.updatedAt,
      size: m.content.length,
    })),
  });
});

app.get("/agent/memory/content", async (req: Request, res: Response) => {
  const data = await loadJarvisData();
  const item = data.memories.find((m) => m.id === String(req.query.path || ""));
  if (!item) {
    res.status(404).json({ detail: "memory not found" });
    return;
  }
  res.json({ path: item.id, content: item.content });
});

app.delete("/agent/memory", async (req: Request, res: Response) => {
  const data = await loadJarvisData();
  const id = String(req.query.path || "");
  data.memories = data.memories.filter((m) => m.id !== id);
  await saveJarvisData(data);
  res.json({ ok: true, deleted: id });
});

app.get("/api/notes", async (_req: Request, res: Response) => {
  const data = await loadJarvisData();
  res.json({ items: data.notes });
});

app.post("/api/notes", async (req: Request, res: Response) => {
  const data = await loadJarvisData();
  const note = {
    id: newId("note"),
    title: String(req.body?.title || "Untitled Note").trim(),
    body: String(req.body?.body || ""),
    tags: Array.isArray(req.body?.tags) ? req.body.tags.map(String) : [],
    updatedAt: Date.now(),
  };
  data.notes.unshift(note);
  await saveJarvisData(data);
  res.json({ ok: true, item: note });
});

app.patch("/api/notes/:id", async (req: Request, res: Response) => {
  const data = await loadJarvisData();
  const note = data.notes.find((n) => n.id === req.params.id);
  if (!note) {
    res.status(404).json({ detail: "note not found" });
    return;
  }
  if (typeof req.body?.title === "string") note.title = req.body.title;
  if (typeof req.body?.body === "string") note.body = req.body.body;
  if (Array.isArray(req.body?.tags)) note.tags = req.body.tags.map(String);
  note.updatedAt = Date.now();
  await saveJarvisData(data);
  res.json({ ok: true, item: note });
});

app.delete("/api/notes/:id", async (req: Request, res: Response) => {
  const data = await loadJarvisData();
  data.notes = data.notes.filter((n) => n.id !== req.params.id);
  await saveJarvisData(data);
  res.json({ ok: true });
});

app.get("/api/calendar", async (_req: Request, res: Response) => {
  const data = await loadJarvisData();
  res.json({ items: data.calendar });
});

app.post("/api/calendar", async (req: Request, res: Response) => {
  const data = await loadJarvisData();
  const title = String(req.body?.title || "").trim();
  const startISO = String(req.body?.startISO || "").trim();
  if (!title || !startISO) {
    res.status(400).json({ detail: "title and startISO are required" });
    return;
  }
  const ev = {
    id: newId("cal"),
    title,
    startISO,
    endISO: String(req.body?.endISO || startISO),
    location: String(req.body?.location || ""),
    notes: String(req.body?.notes || ""),
    recurrence: (req.body?.recurrence || "none") as "none" | "daily" | "weekly" | "monthly",
    reminderMinutes: Number(req.body?.reminderMinutes ?? 15),
    completed: Boolean(req.body?.completed),
  };
  data.calendar.push(ev);
  await saveJarvisData(data);
  res.json({ ok: true, item: ev });
});

app.patch("/api/calendar/:id", async (req: Request, res: Response) => {
  const data = await loadJarvisData();
  const ev = data.calendar.find((c) => c.id === req.params.id);
  if (!ev) {
    res.status(404).json({ detail: "event not found" });
    return;
  }
  if (typeof req.body?.title === "string") ev.title = req.body.title;
  if (typeof req.body?.startISO === "string") ev.startISO = req.body.startISO;
  if (typeof req.body?.endISO === "string") ev.endISO = req.body.endISO;
  if (typeof req.body?.completed === "boolean") ev.completed = req.body.completed;
  if (typeof req.body?.notes === "string") ev.notes = req.body.notes;
  await saveJarvisData(data);
  res.json({ ok: true, item: ev });
});

app.delete("/api/calendar/:id", async (req: Request, res: Response) => {
  const data = await loadJarvisData();
  data.calendar = data.calendar.filter((c) => c.id !== req.params.id);
  await saveJarvisData(data);
  res.json({ ok: true });
});

app.get("/api/calendar/export.ics", async (_req: Request, res: Response) => {
  const data = await loadJarvisData();
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="jarvis-schedule.ics"');
  res.send(exportEventsToIcs(data.calendar));
});

/* ---------------- Smart Home & Media Hub ---------------- */

app.get("/api/smarthome", async (_req: Request, res: Response) => {
  const data = await loadJarvisData();
  res.json(data.smartHome);
});

app.post("/api/smarthome/device/:id", async (req: Request, res: Response) => {
  const data = await loadJarvisData();
  const dev = data.smartHome.devices.find((d) => d.id === req.params.id);
  if (!dev) {
    res.status(404).json({ detail: "device not found" });
    return;
  }
  if (typeof req.body?.on === "boolean") dev.on = req.body.on;
  if (typeof req.body?.level === "number") dev.level = Math.max(0, Math.min(100, req.body.level));
  if (typeof req.body?.targetTemp === "number") dev.targetTemp = req.body.targetTemp;

  if (dev.type === "climate") {
    dev.statusText = dev.on ? `Cooling to ${dev.targetTemp ?? 70}°F` : "Climate Off";
  } else if (dev.type === "lock") {
    dev.statusText = dev.on ? "Locked" : "Unlocked";
  } else if (dev.type === "camera") {
    dev.statusText = dev.on ? "Live Monitoring" : "Privacy Shutter";
  } else {
    dev.statusText = dev.on ? `${dev.level ?? 100}% Active` : "Standby";
  }

  await saveJarvisData(data);
  res.json({ ok: true, device: dev });
});

app.post("/api/smarthome/scene/:id", async (req: Request, res: Response) => {
  const data = await loadJarvisData();
  const scene = data.smartHome.scenes.find((s) => s.id === req.params.id);
  if (!scene) {
    res.status(404).json({ detail: "scene not found" });
    return;
  }
  for (const act of scene.actions) {
    const dev = data.smartHome.devices.find((d) => d.id === act.deviceId);
    if (dev) {
      dev.on = act.on;
      if (typeof act.level === "number") dev.level = act.level;
      if (typeof act.targetTemp === "number") dev.targetTemp = act.targetTemp;
      if (dev.type === "lock") dev.statusText = dev.on ? "Locked" : "Unlocked";
      else if (dev.type === "camera") dev.statusText = dev.on ? "Live Monitoring" : "Standby";
      else dev.statusText = dev.on ? `${dev.level ?? 100}% Active` : "Standby";
    }
  }
  await saveJarvisData(data);
  res.json({ ok: true, smartHome: data.smartHome });
});

app.post("/api/smarthome/home-assistant", async (req: Request, res: Response) => {
  const data = await loadJarvisData();
  const url = String(req.body?.url || "").trim().replace(/\/+$/, "");
  const token = String(req.body?.token || "").trim();
  if (!url || !token) {
    data.smartHome.homeAssistantUrl = "";
    data.smartHome.homeAssistantConnected = false;
    await saveJarvisData(data);
    res.json({ ok: true, connected: false, message: "Home Assistant disconnected." });
    return;
  }
  try {
    const resp = await fetch(`${url}/api/`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) {
      res.json({ ok: false, connected: false, message: `Home Assistant returned ${resp.status}.` });
      return;
    }
    keyStore.set("HOME_ASSISTANT_TOKEN", token);
    data.smartHome.homeAssistantUrl = url;
    data.smartHome.homeAssistantConnected = true;
    await saveJarvisData(data);
    res.json({ ok: true, connected: true, message: "Connected to Home Assistant instance." });
  } catch (err) {
    res.json({
      ok: false,
      connected: false,
      message: `Could not reach ${url}: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
});

app.get("/api/media", async (_req: Request, res: Response) => {
  const data = await loadJarvisData();
  res.json({ items: data.mediaHistory });
});

app.post("/api/media/search", async (req: Request, res: Response) => {
  const query = String(req.body?.query || "").trim();
  const kind = req.body?.kind === "music" ? "music" : "video";
  if (!query) {
    res.status(400).json({ detail: "query is required" });
    return;
  }
  const results = await searchVideosWithGemini(query);
  const data = await loadJarvisData();
  if (results.length > 0) {
    for (const r of results.slice(0, 3)) {
      if (!data.mediaHistory.some((m) => m.url === r.url)) {
        data.mediaHistory.unshift({
          id: newId("med"),
          title: r.title,
          channel: r.channel,
          url: r.url,
          embedUrl: r.embedUrl,
          kind,
          addedAt: Date.now(),
        });
      }
    }
    data.mediaHistory = data.mediaHistory.slice(0, 24);
    await saveJarvisData(data);
  }
  res.json({ ok: true, results, history: data.mediaHistory });
});

/* ---------------- Persona, HUD & Share Bundle ---------------- */

app.get("/api/hud-persona", async (_req: Request, res: Response) => {
  const data = await loadJarvisData();
  res.json({ persona: data.persona, hud: data.hud });
});

app.post("/api/hud-persona", async (req: Request, res: Response) => {
  const data = await loadJarvisData();
  if (req.body?.persona && typeof req.body.persona === "object") {
    data.persona = { ...data.persona, ...req.body.persona };
  }
  if (req.body?.hud && typeof req.body.hud === "object") {
    data.hud = { ...data.hud, ...req.body.hud };
  }
  await saveJarvisData(data);
  res.json({ ok: true, persona: data.persona, hud: data.hud });
});

app.get("/api/bundle/export", async (_req: Request, res: Response) => {
  const data = await loadJarvisData();
  res.json(exportShareBundle(data));
});

app.post("/api/bundle/import", async (req: Request, res: Response) => {
  const next = await importShareBundle((req.body || {}) as Record<string, unknown>);
  res.json({ ok: true, persona: next.persona, hud: next.hud, pluginCount: next.plugins.length });
});

/* ---------------- Open Plugin & Skill Compatibility Registry ---------------- */

app.get("/api/plugins", async (_req: Request, res: Response) => {
  const data = await loadJarvisData();
  res.json({ installed: data.plugins, catalog: COMMUNITY_PLUGIN_CATALOG });
});

app.post("/api/plugins/install-catalog", async (req: Request, res: Response) => {
  const id = String(req.body?.id || "").trim();
  const entry = COMMUNITY_PLUGIN_CATALOG.find((c) => c.id === id);
  if (!entry) {
    res.status(404).json({ detail: "Catalog plugin not found" });
    return;
  }
  const plugin = await installFromManifestText(entry.rawManifest, {
    upstreamUrl: entry.upstreamUrl,
    filenameHint: entry.sourceKind === "skill_md" ? "SKILL.md" : "plugin.yaml",
  });
  res.json({ ok: true, plugin });
});

app.post("/api/plugins/install-url", async (req: Request, res: Response) => {
  try {
    const url = String(req.body?.url || "").trim();
    const plugin = await installFromRemoteUrl(url);
    res.json({ ok: true, plugin });
  } catch (err) {
    res.status(400).json({ detail: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/plugins/install-manifest", async (req: Request, res: Response) => {
  try {
    const raw = String(req.body?.raw || "");
    const filenameHint = String(req.body?.filenameHint || "");
    const plugin = await installFromManifestText(raw, { filenameHint });
    res.json({ ok: true, plugin });
  } catch (err) {
    res.status(400).json({ detail: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/plugins/create-nocode", async (req: Request, res: Response) => {
  const name = String(req.body?.name || "").trim();
  const description = String(req.body?.description || "").trim();
  const instructions = String(req.body?.instructions || "").trim();
  if (!name || !instructions) {
    res.status(400).json({ detail: "name and instructions are required" });
    return;
  }
  const triggers = Array.isArray(req.body?.triggers) ? req.body.triggers.map(String).filter(Boolean) : [];
  const data = await loadJarvisData();
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || newId("skill");
  const plugin = {
    id,
    name,
    version: "1.0.0",
    description: description || "Custom user skill",
    sourceKind: "custom_nocode" as const,
    schemaVersion: 1,
    upstreamUrl: "",
    triggers,
    providesTools: [],
    providesHooks: ["on_user_message"],
    requiresBridge: false,
    instructions,
    webhookUrl: typeof req.body?.webhookUrl === "string" ? req.body.webhookUrl.trim() : undefined,
    enabled: true,
    updatedAt: Date.now(),
    rawSource: instructions,
    extraSchema: {},
  };
  const idx = data.plugins.findIndex((p) => p.id === id);
  if (idx >= 0) data.plugins[idx] = plugin;
  else data.plugins.unshift(plugin);
  await saveJarvisData(data);
  res.json({ ok: true, plugin });
});

app.post("/api/plugins/:id/toggle", async (req: Request, res: Response) => {
  const data = await loadJarvisData();
  const plugin = data.plugins.find((p) => p.id === req.params.id);
  if (!plugin) {
    res.status(404).json({ detail: "plugin not found" });
    return;
  }
  plugin.enabled = Boolean(req.body?.enabled);
  await saveJarvisData(data);
  res.json({ ok: true, plugin });
});

app.delete("/api/plugins/:id", async (req: Request, res: Response) => {
  const data = await loadJarvisData();
  data.plugins = data.plugins.filter((p) => p.id !== req.params.id);
  await saveJarvisData(data);
  res.json({ ok: true });
});

app.post("/api/plugins/check-updates", async (_req: Request, res: Response) => {
  const result = await checkUpstreamPluginUpdates();
  res.json({ ok: true, ...result });
});

app.post("/api/plugins/:id/rollback", async (req: Request, res: Response) => {
  const restored = await rollbackPluginVersion(String(req.params.id || ""));
  if (!restored) {
    res.status(400).json({ detail: "No previous version available to roll back." });
    return;
  }
  res.json({ ok: true, plugin: restored });
});

app.get("/api/plugins/doctor", async (_req: Request, res: Response) => {
  const report = await diagnoseAllPlugins();
  res.json(report);
});

app.post("/api/plugins/draft-workflow", async (req: Request, res: Response) => {
  try {
    const name = String(req.body?.name || "").trim();
    const description = String(req.body?.description || "").trim();
    const rawSteps = Array.isArray(req.body?.steps)
      ? req.body.steps.map(String)
      : String(req.body?.stepsText || "")
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);
    const triggers = Array.isArray(req.body?.triggers) ? req.body.triggers.map(String) : [];
    const plugin = draftSkillFromWorkflow(name, rawSteps, { description, triggers });
    const data = await loadJarvisData();
    const idx = data.plugins.findIndex((p) => p.id === plugin.id);
    if (idx >= 0) data.plugins[idx] = plugin;
    else data.plugins.unshift(plugin);
    await saveJarvisData(data);
    res.json({ ok: true, plugin });
  } catch (err) {
    res.status(400).json({ detail: err instanceof Error ? err.message : String(err) });
  }
});

/* ---------------- Memory Wiki, Briefing, Watchdog, Automations, Video TTS & Web Extract ---------------- */

app.get("/api/memory/wiki", async (_req: Request, res: Response) => {
  const data = await loadJarvisData();
  res.json({ sections: buildMemoryWiki(data.memories, data.notes) });
});

app.get("/api/briefing", async (_req: Request, res: Response) => {
  const data = await loadJarvisData();
  const unreadAlerts = data.securityLog.filter((l) => l.severity === "alert").length;
  const briefing = buildProactiveBriefing({
    userTitle: data.persona.userTitle,
    memories: data.memories,
    calendar: data.calendar,
    devices: data.smartHome.devices,
    watchdogArmed: data.smartHome.watchdogArmed,
    securityAlertsCount: unreadAlerts,
  });
  const triggeredAutomations = evaluateAutomationRules(
    data.automations,
    data.smartHome.devices,
    data.calendar,
    data.smartHome.watchdogArmed,
  );
  res.json({ briefing, triggeredAutomations });
});

app.get("/api/smarthome/watchdog", async (_req: Request, res: Response) => {
  const data = await loadJarvisData();
  res.json({
    watchdogArmed: data.smartHome.watchdogArmed,
    securityLog: data.securityLog.slice(0, 30),
    automations: data.automations,
  });
});

app.post("/api/smarthome/watchdog/toggle", async (req: Request, res: Response) => {
  const data = await loadJarvisData();
  const armed = typeof req.body?.armed === "boolean" ? req.body.armed : !data.smartHome.watchdogArmed;
  data.smartHome.watchdogArmed = armed;
  data.securityLog.unshift({
    id: newId("sec"),
    severity: "info",
    source: "Watchdog Mode",
    message: armed ? "Residence Watchdog armed. Locks & exterior cameras monitored." : "Watchdog disarmed by user.",
    ts: Date.now(),
  });
  data.securityLog = data.securityLog.slice(0, 50);
  await saveJarvisData(data);
  res.json({ ok: true, watchdogArmed: armed, securityLog: data.securityLog.slice(0, 30) });
});

app.post("/api/smarthome/watchdog/event", async (req: Request, res: Response) => {
  const data = await loadJarvisData();
  const source = String(req.body?.source || "Front Porch Camera").trim();
  const message = String(req.body?.message || "Motion detected near residence entry.").trim();
  const severity = req.body?.severity === "info" ? "info" : "alert";
  const entry = { id: newId("sec"), severity: severity as "info" | "alert", source, message, ts: Date.now() };
  data.securityLog.unshift(entry);
  data.securityLog = data.securityLog.slice(0, 50);
  await saveJarvisData(data);
  res.json({ ok: true, entry, securityLog: data.securityLog.slice(0, 30) });
});

app.get("/api/automations", async (_req: Request, res: Response) => {
  const data = await loadJarvisData();
  res.json({ items: data.automations });
});

app.post("/api/automations", async (req: Request, res: Response) => {
  const data = await loadJarvisData();
  const name = String(req.body?.name || "").trim();
  const actionSummary = String(req.body?.actionSummary || "").trim();
  const triggerType = String(req.body?.triggerType || "meeting_approaching");
  if (!name || !actionSummary) {
    res.status(400).json({ detail: "name and actionSummary are required" });
    return;
  }
  const validTrigger = ["lock_unlocked_away", "meeting_approaching", "motion_detected", "evening_hour"].includes(triggerType)
    ? (triggerType as "lock_unlocked_away" | "meeting_approaching" | "motion_detected" | "evening_hour")
    : "meeting_approaching";
  const item = {
    id: newId("auto"),
    name,
    triggerType: validTrigger,
    actionSummary,
    targetSceneId: typeof req.body?.targetSceneId === "string" ? req.body.targetSceneId : undefined,
    enabled: true,
  };
  data.automations.unshift(item);
  await saveJarvisData(data);
  res.json({ ok: true, item });
});

app.patch("/api/automations/:id", async (req: Request, res: Response) => {
  const data = await loadJarvisData();
  const item = data.automations.find((a) => a.id === req.params.id);
  if (!item) {
    res.status(404).json({ detail: "automation not found" });
    return;
  }
  if (typeof req.body?.enabled === "boolean") item.enabled = req.body.enabled;
  await saveJarvisData(data);
  res.json({ ok: true, item });
});

app.delete("/api/automations/:id", async (req: Request, res: Response) => {
  const data = await loadJarvisData();
  data.automations = data.automations.filter((a) => a.id !== req.params.id);
  await saveJarvisData(data);
  res.json({ ok: true });
});

app.post("/api/automations/evaluate", async (_req: Request, res: Response) => {
  const data = await loadJarvisData();
  const triggered = evaluateAutomationRules(
    data.automations,
    data.smartHome.devices,
    data.calendar,
    data.smartHome.watchdogArmed,
  );
  res.json({ ok: true, triggered });
});

app.post("/api/video/voiceover", async (req: Request, res: Response) => {
  const text = String(req.body?.text || "").trim();
  const voiceName = String(req.body?.voiceName || "Charon").trim();
  const styleHint = String(req.body?.styleHint || "Speak clearly as a composed British butler narrator:");
  const result = await generateSpeechWavWithGemini(text, voiceName, styleHint);
  res.json(result);
});

app.post("/api/web/extract", async (req: Request, res: Response) => {
  const url = String(req.body?.url || "").trim();
  const question = String(req.body?.question || "").trim();
  const saveAsNote = Boolean(req.body?.saveAsNote);
  const result = await extractWebContextWithGemini(url, question);
  if (result.ok && saveAsNote) {
    const data = await loadJarvisData();
    data.notes.unshift({
      id: newId("note"),
      title: `Web Extract: ${url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 48)}`,
      body: `Source: ${url}\n\n${result.summary}`,
      tags: ["web-extract", "research"],
      updatedAt: Date.now(),
    });
    await saveJarvisData(data);
  }
  res.json(result);
});

app.post("/api/bridge/blender", async (req: Request, res: Response) => {
  const script = String(req.body?.script || "").trim();
  if (!script) {
    res.status(400).json({ detail: "Blender Python script is required." });
    return;
  }
  const result = await dispatchBridgeCommand("blender_exec", { script });
  res.json(result);
});

// Legacy /agent/skills + /hermes/skills compatibility routes
app.get("/agent/skills", async (_req: Request, res: Response) => {
  const data = await loadJarvisData();
  res.json({
    items: data.plugins.map((p) => ({
      id: p.id,
      name: p.name,
      path: p.id,
      updatedAt: p.updatedAt,
    })),
  });
});

app.get("/agent/skills/content", async (req: Request, res: Response) => {
  const data = await loadJarvisData();
  const plugin = data.plugins.find((p) => p.id === String(req.query.path || ""));
  if (!plugin) {
    res.status(404).json({ detail: "skill not found" });
    return;
  }
  res.json({ path: plugin.id, content: plugin.rawSource || plugin.instructions });
});

app.delete("/agent/skills", async (req: Request, res: Response) => {
  const data = await loadJarvisData();
  const id = String(req.query.path || "");
  data.plugins = data.plugins.filter((p) => p.id !== id);
  await saveJarvisData(data);
  res.json({ ok: true, deleted: id });
});

/* ---------------- Multimodal Screen Vision ---------------- */

app.post("/api/vision/analyze", async (req: Request, res: Response) => {
  const imageData = String(req.body?.imageData || "");
  const question = String(req.body?.question || "");
  if (!imageData) {
    res.status(400).json({ ok: false, error: "No screen frame image supplied." });
    return;
  }
  try {
    const result = await analyzeScreenFrameWithGemini(imageData, "image/png", question);
    res.json(result);
  } catch (err) {
    res.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

/* ---------------- Desktop Bridge Routes ---------------- */

app.get("/api/bridge/status", (_req: Request, res: Response) => {
  res.json(getBridgeStatus());
});

app.post("/api/bridge/rotate-token", (_req: Request, res: Response) => {
  res.json({ ok: true, pairingToken: rotatePairingToken() });
});

app.get("/api/bridge/companion-script", (req: Request, res: Response) => {
  const origin = `${req.protocol}://${req.get("host") || `localhost:${PORT}`}`;
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="jarvis-bridge.mjs"');
  res.send(generateBridgeCompanionScript(origin));
});

/* ---------------- Account Connectors & Providers ---------------- */

app.get("/api/account-connectors", async (_req: Request, res: Response) => {
  const data = await loadJarvisData();
  res.json({ connectors: data.accountConnectors, bridge: getBridgeStatus() });
});

app.post("/api/account-connectors/:id/connect", async (req: Request, res: Response) => {
  const data = await loadJarvisData();
  const connector = data.accountConnectors.find((c) => c.id === req.params.id);
  if (!connector) {
    res.status(404).json({ detail: "Connector not found" });
    return;
  }
  if (connector.authMode === "local_cli_bridge" && !getBridgeStatus().connected) {
    res.json({
      ok: false,
      connected: false,
      message: "Connect the optional Local Desktop Bridge first so JARVIS can reach your local Claude CLI session.",
    });
    return;
  }
  const tokenOrLabel = String(req.body?.token || req.body?.accountLabel || "").trim();
  if (connector.authMode !== "local_cli_bridge" && !tokenOrLabel) {
    res.status(400).json({ detail: "Provide your session token or account handle from your OAuth sign-in." });
    return;
  }
  if (tokenOrLabel) keyStore.set(`ACCOUNT_${connector.id.toUpperCase()}`, tokenOrLabel);
  connector.connected = true;
  connector.accountLabel = String(req.body?.accountLabel || "Authenticated Session");
  connector.lastCheckedAt = Date.now();
  await saveJarvisData(data);
  res.json({ ok: true, connector });
});

app.post("/api/account-connectors/:id/disconnect", async (req: Request, res: Response) => {
  const data = await loadJarvisData();
  const connector = data.accountConnectors.find((c) => c.id === req.params.id);
  if (connector) {
    connector.connected = false;
    connector.accountLabel = "";
    keyStore.delete(`ACCOUNT_${connector.id.toUpperCase()}`);
    await saveJarvisData(data);
  }
  res.json({ ok: true });
});

// Models & settings
app.get("/agent/models", async (_req: Request, res: Response) => {
  const free = await fetchOpenRouterFreeModels();
  const builtin = isGeminiConfigured()
    ? [
        { id: DEFAULT_GEMINI_MODEL, name: "JARVIS Core (Gemini 4 Hydrogen)", context: 1000000 },
        { id: LIGHT_GEMINI_MODEL, name: "JARVIS Rapid (Gemini 3.1 Flash Lite)", context: 1000000 },
      ]
    : [];
  res.json({ free: [...builtin, ...free] });
});

app.post("/agent/brain", (req: Request, res: Response) => {
  const brain = String(req.body?.brain || "").trim().toLowerCase();
  if (brain !== "hermes" && brain !== "openrouter" && brain !== "auto") {
    res.status(400).json({ detail: "brain must be hermes|openrouter|auto" });
    return;
  }
  state.brain = brain;
  res.json({ ok: true, brain });
});

function buildSettingsResponse(req: Request) {
  const origin = `${req.protocol}://${req.get("host") || `localhost:${PORT}`}`;
  const openrouterKey = keyStore.get("OPENROUTER_API_KEY");
  return {
    brain: state.brain,
    provider: state.provider,
    openrouterApiKeyMasked: maskSecret(openrouterKey),
    hasKey: isGeminiConfigured() || Boolean(openrouterKey),
    hasGeminiBuiltin: isGeminiConfigured(),
    models: state.models,
    confirmDangerousTools: state.confirmDangerousTools,
    allowedApps: state.allowedApps,
    tts: state.tts,
    voice: { ...state.voice, tts: state.tts },
    spotify: {
      configured: Boolean(state.spotify.clientId),
      authorized: state.spotify.authorized,
      clientIdMasked: maskSecret(state.spotify.clientId),
      redirectUri: `${origin}/music/spotify/callback`,
      premium: state.spotify.premium,
      displayName: state.spotify.displayName,
      product: state.spotify.product,
    },
    toolsets: state.toolsets.filter((t) => t.enabled).map((t) => t.name),
    customProviders: state.customProviders,
    permissions: state.permissions,
    killSwitch: state.killSwitch,
    protectedFolders: state.protectedFolders,
    visionModel: state.visionModel,
  };
}

app.get("/agent/settings", (req: Request, res: Response) => {
  res.json(buildSettingsResponse(req));
});

app.post("/agent/settings", (req: Request, res: Response) => {
  const body = (req.body || {}) as Record<string, unknown>;
  const applied: string[] = [];

  if (typeof body.defaultModel === "string") {
    state.models.default = body.defaultModel.trim();
    applied.push("jarvis_default_model");
  }
  if (typeof body.fastModel === "string") {
    state.models.fast = body.fastModel.trim();
    applied.push("jarvis_fast_model");
  }
  if (typeof body.heavyModel === "string") {
    state.models.heavy = body.heavyModel.trim();
    applied.push("jarvis_heavy_model");
  }
  if (typeof body.brain === "string" && ["hermes", "openrouter", "auto"].includes(body.brain)) {
    state.brain = body.brain as typeof state.brain;
    applied.push("jarvis_brain");
  }
  if (typeof body.provider === "string" && body.provider.trim()) {
    state.provider = body.provider.trim();
    applied.push("jarvis_provider");
  }
  if (typeof body.confirmDangerousTools === "boolean") {
    state.confirmDangerousTools = body.confirmDangerousTools;
    applied.push("jarvis_confirm_dangerous_tools");
  }
  if (Array.isArray(body.allowedApps)) {
    state.allowedApps = body.allowedApps.map((s) => String(s).trim().toLowerCase()).filter(Boolean);
    applied.push("jarvis_allowed_apps");
  }
  if (typeof body.ttsEnabled === "boolean") {
    state.tts.enabled = body.ttsEnabled;
    applied.push("jarvis_tts_enabled");
  }
  if (typeof body.ttsRate === "number") {
    state.tts.rate = body.ttsRate;
    applied.push("jarvis_tts_rate");
  }
  if (typeof body.ttsPitch === "number") {
    state.tts.pitch = body.ttsPitch;
    applied.push("jarvis_tts_pitch");
  }
  if (typeof body.killSwitchHotkey === "string") {
    state.killSwitch.hotkey = body.killSwitchHotkey.trim();
    applied.push("jarvis_kill_switch_hotkey");
  }
  if (typeof body.visionModel === "string") {
    state.visionModel = body.visionModel.trim();
    applied.push("jarvis_vision_model");
  }
  if (typeof body.wakeWordEnabled === "boolean") {
    state.voice.wakeEnabled = body.wakeWordEnabled;
    applied.push("jarvis_wake_word_enabled");
  }
  if (typeof body.pttHotkey === "string") {
    state.voice.pttHotkey = body.pttHotkey.trim();
    applied.push("jarvis_ptt_hotkey");
  }
  if (typeof body.sttModel === "string") {
    state.voice.sttModel = body.sttModel.trim();
    applied.push("jarvis_stt_model");
  }
  if (typeof body.micDevice === "string") {
    state.voice.micDevice = body.micDevice.trim();
    applied.push("jarvis_mic_device");
  }
  if (body.permissions && typeof body.permissions === "object") {
    state.permissions = body.permissions as Record<string, string>;
    applied.push("jarvis_permissions");
  }
  if (body.removeKey) {
    keyStore.delete("OPENROUTER_API_KEY");
    applied.push("removeKey");
  }
  if (typeof body.openrouterApiKey === "string") {
    const k = body.openrouterApiKey.trim();
    if (!k) {
      res.status(400).json({ detail: "api key cannot be empty" });
      return;
    }
    keyStore.set("OPENROUTER_API_KEY", k);
    applied.push("openrouterApiKey");
  }

  res.json({ ok: true, applied });
});

app.post("/agent/test-connection", async (_req: Request, res: Response) => {
  if (state.provider === "gemini-builtin") {
    res.json({
      ok: isGeminiConfigured(),
      message: isGeminiConfigured()
        ? "Built-in JARVIS Core Intelligence is online."
        : "Built-in intelligence key is not present in environment.",
    });
    return;
  }
  const endpoint = getProviderEndpoint();
  if (!endpoint || !endpoint.apiKey) {
    res.json({ ok: false, message: `No credentials configured for ${endpoint?.label || state.provider}.` });
    return;
  }
  try {
    const resp = await fetch(`${endpoint.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${endpoint.apiKey}`, ...endpoint.headers },
      signal: AbortSignal.timeout(12000),
    });
    res.json({
      ok: resp.ok,
      message: resp.ok ? `Connection works — ${endpoint.label} answered.` : `${endpoint.label} returned ${resp.status}.`,
    });
  } catch (err) {
    res.json({ ok: false, message: err instanceof Error ? err.message : String(err) });
  }
});

function serializeProviders() {
  return PROVIDERS.map((p) => {
    const keys: Record<string, { masked: string; present: boolean }> = {};
    let configured = p.slug === "gemini-builtin" ? isGeminiConfigured() : false;
    for (const env of p.envVars) {
      const v = keyStore.get(env);
      keys[env] = { masked: maskSecret(v), present: Boolean(v) };
      if (v) configured = true;
    }
    return {
      slug: p.slug,
      label: p.label,
      description: p.description,
      authType: p.authType,
      tab: p.tab,
      envVars: p.envVars,
      baseUrlEnvVar: p.baseUrlEnvVar,
      signupUrl: p.signupUrl,
      keys,
      configured,
    };
  });
}

app.get("/agent/providers", (_req: Request, res: Response) => res.json({ providers: serializeProviders() }));
app.get("/hermes/providers", (_req: Request, res: Response) => res.json({ providers: serializeProviders() }));

app.post("/hermes/providers/key", (req: Request, res: Response) => {
  const slug = String(req.body?.slug || "").trim();
  const key = String(req.body?.key || "").trim();
  const profile = PROVIDERS.find((p) => p.slug === slug);
  if (!profile || !key) {
    res.status(400).json({ detail: "valid slug and key are required" });
    return;
  }
  const envVar = String(req.body?.envVar || profile.envVars[0] || "").trim();
  if (!envVar) {
    res.status(400).json({ detail: "provider does not accept raw API keys" });
    return;
  }
  keyStore.set(envVar, key);
  res.json({ ok: true, envVar });
});

app.post("/hermes/providers/remove-key", (req: Request, res: Response) => {
  const slug = String(req.body?.slug || "").trim();
  const profile = PROVIDERS.find((p) => p.slug === slug);
  const envVar = String(req.body?.envVar || profile?.envVars[0] || "").trim();
  if (envVar) keyStore.delete(envVar);
  res.json({ ok: true });
});

app.get("/hermes/providers/:slug/models", async (req: Request, res: Response) => {
  const slug = String(req.params.slug || "");
  if (slug === "gemini-builtin") {
    res.json({
      provider: slug,
      source: "builtin",
      models: [
        { id: DEFAULT_GEMINI_MODEL, name: "JARVIS Core (Gemini 4 Hydrogen)", context: 1000000 },
        { id: LIGHT_GEMINI_MODEL, name: "JARVIS Rapid (Gemini 3.1 Flash Lite)", context: 1000000 },
      ],
    });
    return;
  }
  if (slug === "openrouter") {
    const models = await fetchOpenRouterFreeModels();
    res.json({ provider: slug, source: "openrouter", models });
    return;
  }
  const endpoint = getProviderEndpoint(slug);
  if (endpoint && endpoint.baseUrl && endpoint.apiKey) {
    try {
      const resp = await fetch(`${endpoint.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${endpoint.apiKey}`, ...endpoint.headers },
        signal: AbortSignal.timeout(12000),
      });
      if (resp.ok) {
        const data = (await resp.json()) as { data?: Array<{ id: string; name?: string; context_length?: number }> };
        const models = (data.data || []).map((m) => ({
          id: m.id,
          name: m.name || m.id,
          context: m.context_length ?? null,
        }));
        res.json({ provider: slug, source: "live", models });
        return;
      }
    } catch {
      /* ignore */
    }
  }
  res.json({ provider: slug, source: "none", models: [] });
});

app.post("/hermes/custom-providers", (req: Request, res: Response) => {
  const name = String(req.body?.name || "").trim();
  const baseUrl = String(req.body?.baseUrl || "").trim();
  const keyEnv = String(req.body?.keyEnv || "").trim();
  if (!name || !baseUrl) {
    res.status(400).json({ detail: "name and baseUrl are required" });
    return;
  }
  state.customProviders[name] = { api: baseUrl, key_env: keyEnv || undefined, transport: "openai_chat" };
  res.json({ ok: true, name });
});

app.post("/hermes/custom-providers/remove", (req: Request, res: Response) => {
  const name = String(req.body?.name || "").trim();
  delete state.customProviders[name];
  res.json({ ok: true });
});

app.get("/hermes/toolsets", (_req: Request, res: Response) => res.json({ toolsets: state.toolsets }));
app.post("/hermes/toolsets/toggle", (req: Request, res: Response) => {
  const name = String(req.body?.name || "");
  const enabled = Boolean(req.body?.enabled);
  const t = state.toolsets.find((item) => item.name === name);
  if (t) t.enabled = enabled;
  res.json({ ok: true, enabled: state.toolsets.filter((i) => i.enabled).map((i) => i.name) });
});

app.get("/hermes/mcp", (_req: Request, res: Response) => res.json({ servers: state.mcpServers }));
app.post("/hermes/mcp/add", (req: Request, res: Response) => {
  const name = String(req.body?.name || "").trim();
  if (!name) {
    res.status(400).json({ detail: "name is required" });
    return;
  }
  state.mcpServers.push({
    name,
    type: req.body?.url ? "remote" : "stdio",
    url: req.body?.url || null,
    command: req.body?.command || null,
    args: Array.isArray(req.body?.args) ? req.body.args : [],
    enabled: true,
  });
  res.json({ ok: true });
});
app.post("/hermes/mcp/remove", (req: Request, res: Response) => {
  const name = String(req.body?.name || "").trim();
  state.mcpServers = state.mcpServers.filter((s) => s.name !== name);
  res.json({ ok: true });
});
app.post("/hermes/mcp/test", (req: Request, res: Response) => {
  const name = String(req.body?.name || "").trim();
  res.json({ ok: true, output: `MCP server '${name}' registered.` });
});

const ARTCRAFT_PRESETS = [
  { name: "storytold-designcraft", command: "designcraft-cli", args: ["mcp", "--connect", "127.0.0.1:4311"], url: "http://127.0.0.1:4311/mcp" },
  { name: "storytold-photocraft", command: "photocraft-cli", args: ["mcp", "--connect", "127.0.0.1:4312"], url: "http://127.0.0.1:4312/mcp" },
  { name: "storytold-vectorcraft", command: "vectorcraft-cli", args: ["mcp", "--connect", "127.0.0.1:4313"], url: "http://127.0.0.1:4313/mcp" },
  { name: "storytold-lightcraft", command: "lightcraft-cli", args: ["mcp", "--connect", "127.0.0.1:4314"], url: "http://127.0.0.1:4314/mcp" },
];

app.post("/api/mcp/artcraft/preset", (req: Request, res: Response) => {
  const targetApp = String(req.body?.app || "all").toLowerCase().trim();
  const toInstall =
    targetApp === "all"
      ? ARTCRAFT_PRESETS
      : ARTCRAFT_PRESETS.filter((p) => p.name.includes(targetApp));
  const added: string[] = [];
  for (const preset of toInstall) {
    if (!state.mcpServers.some((s) => s.name === preset.name)) {
      state.mcpServers.push({
        name: preset.name,
        type: "stdio",
        url: preset.url,
        command: preset.command,
        args: preset.args,
        enabled: true,
      });
      added.push(preset.name);
    }
  }
  res.json({ ok: true, added, servers: state.mcpServers });
});

app.post("/api/mcp/artcraft/execute", async (req: Request, res: Response) => {
  const appName = String(req.body?.app || "designcraft").trim();
  const instruction = String(req.body?.instruction || "").trim();
  const toolName = typeof req.body?.toolName === "string" ? req.body.toolName : undefined;
  const endpointUrl = typeof req.body?.endpointUrl === "string" ? req.body.endpointUrl : undefined;
  if (!instruction) {
    res.status(400).json({ ok: false, error: "instruction is required" });
    return;
  }
  const result = await executeArtCraftMcpCommand({
    app: appName,
    instruction,
    toolName,
    endpointUrl,
  });
  res.json(result);
});

app.get("/hermes/cron", async (_req: Request, res: Response) => {
  const data = await loadJarvisData();
  res.json({ jobs: data.cronJobs });
});
app.post("/hermes/cron/create", async (req: Request, res: Response) => {
  const schedule = String(req.body?.schedule || "").trim();
  const prompt = String(req.body?.prompt || "").trim();
  if (!schedule || !prompt) {
    res.status(400).json({ detail: "schedule and prompt are required" });
    return;
  }
  const data = await loadJarvisData();
  data.cronJobs.push({
    id: crypto.randomUUID().slice(0, 8),
    name: String(req.body?.name || "Scheduled routine").trim(),
    schedule,
    prompt,
    deliver: [String(req.body?.deliver || "local")],
    state: "active",
    enabled: true,
    skills: [],
  });
  await saveJarvisData(data);
  res.json({ ok: true, jobs: data.cronJobs });
});
app.post("/hermes/cron/action", async (req: Request, res: Response) => {
  const action = String(req.body?.action || "");
  const jobId = String(req.body?.jobId || "");
  const data = await loadJarvisData();
  if (action === "remove") {
    data.cronJobs = data.cronJobs.filter((j) => j.id !== jobId);
  } else {
    const job = data.cronJobs.find((j) => j.id === jobId);
    if (job) {
      if (action === "pause") job.state = "paused";
      if (action === "resume") job.state = "active";
    }
  }
  await saveJarvisData(data);
  res.json({ ok: true, jobs: data.cronJobs });
});

const GATEWAY_PLATFORMS = [
  { id: "telegram", label: "Telegram", envVar: "TELEGRAM_BOT_TOKEN" },
  { id: "discord", label: "Discord", envVar: "DISCORD_BOT_TOKEN" },
  { id: "slack", label: "Slack", envVar: "SLACK_BOT_TOKEN" },
  { id: "whatsapp", label: "WhatsApp", envVar: "WHATSAPP_WEBHOOK_TOKEN" },
];

async function gatewayStatusPayload() {
  const data = await loadJarvisData();
  const platforms = GATEWAY_PLATFORMS.map((p) => {
    const tok = state.gateway.platformTokens.get(p.id);
    return { ...p, configured: Boolean(tok), masked: maskSecret(tok) };
  });
  return {
    running: state.gateway.running,
    pid: state.gateway.pid,
    platforms,
    configuredPlatforms: platforms.filter((p) => p.configured).map((p) => p.id),
    cronActive: state.gateway.running,
    jobCount: data.cronJobs.length,
  };
}

app.get("/hermes/gateway", async (_req: Request, res: Response) => res.json(await gatewayStatusPayload()));
app.post("/hermes/gateway/start", (_req: Request, res: Response) => {
  state.gateway.running = true;
  state.gateway.pid = process.pid;
  state.gateway.logs.push(`[gateway] Started at ${new Date().toISOString()}`);
  res.json({ ok: true, running: true, pid: process.pid });
});
app.post("/hermes/gateway/stop", (_req: Request, res: Response) => {
  state.gateway.running = false;
  state.gateway.pid = null;
  state.gateway.logs.push(`[gateway] Stopped at ${new Date().toISOString()}`);
  res.json({ ok: true, running: false });
});
app.get("/hermes/gateway/logs", (req: Request, res: Response) => {
  const lines = Number(req.query.lines || 80);
  res.json({ logs: state.gateway.logs.slice(-lines).join("\n") });
});
app.post("/hermes/gateway/platform", (req: Request, res: Response) => {
  const platform = String(req.body?.platform || "").trim();
  const token = String(req.body?.token || "").trim();
  if (!platform || !token) {
    res.status(400).json({ detail: "platform and token required" });
    return;
  }
  state.gateway.platformTokens.set(platform, token);
  state.gateway.logs.push(`[gateway] Paired ${platform} webhook/bot bridge.`);
  res.json({ ok: true });
});
app.post("/hermes/gateway/platform/remove", (req: Request, res: Response) => {
  const platform = String(req.body?.platform || "").trim();
  state.gateway.platformTokens.delete(platform);
  state.gateway.logs.push(`[gateway] Removed ${platform} bridge.`);
  res.json({ ok: true });
});

app.get("/api/gateway/feed", async (_req: Request, res: Response) => {
  const data = await loadJarvisData();
  res.json({ messages: data.gatewayMessages.slice(0, 40) });
});

app.post("/api/gateway/inbound", async (req: Request, res: Response) => {
  const platformRaw = String(req.body?.platform || "telegram").toLowerCase();
  const platform = (["telegram", "discord", "slack", "whatsapp"].includes(platformRaw)
    ? platformRaw
    : "telegram") as "telegram" | "discord" | "slack" | "whatsapp";
  const sender = String(req.body?.sender || "Owner Mobile").trim();
  const text = String(req.body?.text || "").trim();
  if (!text) {
    res.status(400).json({ detail: "message text is required" });
    return;
  }

  const data = await loadJarvisData();
  const inbound = {
    id: newId("gw"),
    platform,
    sender,
    direction: "inbound" as const,
    text,
    ts: Date.now(),
  };
  data.gatewayMessages.unshift(inbound);
  state.gateway.logs.push(`[${platform}] <- ${sender}: ${text}`);

  let reply = "";
  const det = runDeterministicAction(text);
  if (det.handled && det.reply) {
    reply = det.reply;
  } else {
    try {
      reply = await streamProviderCompletion(text, [], null, () => undefined);
    } catch {
      reply = "";
    }
    if (!reply) {
      const upcomingCount = data.calendar.filter((c) => !c.completed).length;
      reply = `Received via ${platform}, ${data.persona.userTitle || "Sir"}. You have ${upcomingCount} active schedule items and ${data.smartHome.devices.filter((d) => d.on).length} active home devices.`;
    }
  }

  const outbound = {
    id: newId("gw"),
    platform,
    sender: data.persona.assistantName || "JARVIS",
    direction: "outbound" as const,
    text: reply,
    ts: Date.now(),
  };
  data.gatewayMessages.unshift(outbound);
  data.gatewayMessages = data.gatewayMessages.slice(0, 50);
  await saveJarvisData(data);
  state.gateway.logs.push(`[${platform}] -> JARVIS: ${reply.slice(0, 120)}`);

  res.json({ ok: true, inbound, outbound, feed: data.gatewayMessages.slice(0, 40) });
});

app.get("/hermes/doctor", (_req: Request, res: Response) => {
  const bridge = getBridgeStatus();
  const lines = [
    `JARVIS Core Runtime Diagnostic (${new Date().toISOString()})`,
    `Active provider: ${state.provider}`,
    `Built-in Gemini intelligence: ${isGeminiConfigured() ? "online" : "not set"}`,
    `Desktop Bridge companion: ${bridge.connected ? `connected (${bridge.machineName})` : "standby (optional)"}`,
    `Enabled toolsets: ${state.toolsets.filter((t) => t.enabled).map((t) => t.name).join(", ")}`,
    `Workspace artifacts: ${state.artifacts.length}`,
  ];
  res.json({ report: lines.join("\n") });
});

app.get("/permissions", (_req: Request, res: Response) => {
  res.json({
    modes: state.permissions,
    modesAvailable: ["ask", "risky", "allow"],
    defaultPosture: state.confirmDangerousTools,
    killSwitch: state.killSwitch,
    riskyPrefixes: ["desktop", "files", "terminal"],
  });
});

app.post("/permissions/mode", (req: Request, res: Response) => {
  const tool = String(req.body?.tool || "").trim();
  const mode = String(req.body?.mode || "").trim();
  if (tool) {
    if (mode) state.permissions[tool] = mode;
    else delete state.permissions[tool];
  }
  addAudit("permissions", "updated", "user", `${tool}=${mode || "default"}`);
  res.json({ ok: true, modes: state.permissions });
});

app.post("/permissions/kill", (req: Request, res: Response) => {
  state.killSwitch.engaged = Boolean(req.body?.engaged);
  state.killSwitch.active = state.killSwitch.engaged;
  addAudit("kill_switch", state.killSwitch.engaged ? "engaged" : "released", "user");
  res.json({ engaged: state.killSwitch.engaged });
});

app.get("/permissions/audit", (req: Request, res: Response) => {
  const limit = Number(req.query.limit || 60);
  res.json({ entries: state.audit.slice(0, limit) });
});

// Desktop & Bridge forwarded actions
app.get("/desktop/apps", (_req: Request, res: Response) => {
  res.json({
    apps: state.allowedApps.map((name) => ({ name, appId: name })),
    count: state.allowedApps.length,
    indexedAt: getBridgeStatus().connected ? "Live Desktop Bridge" : "Web Allowlist",
  });
});
app.post("/desktop/apps/refresh", (_req: Request, res: Response) =>
  res.json({ ok: true, count: state.allowedApps.length }),
);
app.post("/desktop/launch", async (req: Request, res: Response) => {
  const name = String(req.body?.name || "").trim();
  if (state.killSwitch.engaged) {
    res.json({ ok: false, error: "Kill switch is engaged." });
    return;
  }
  const result = await dispatchBridgeCommand("launch_app", { name });
  addAudit("desktop.launch", result.ok ? "allowed" : "blocked", "user", name);
  res.json(result);
});
app.get("/desktop/windows", (_req: Request, res: Response) => res.json({ windows: [] }));
app.post("/desktop/window", (_req: Request, res: Response) =>
  res.json({ ok: false, error: "Connect the Desktop Bridge companion to manage native OS windows." }),
);
app.post("/desktop/type", (_req: Request, res: Response) =>
  res.json({ ok: false, error: "Connect the Desktop Bridge companion for OS keyboard control." }),
);
app.post("/desktop/keys", (_req: Request, res: Response) =>
  res.json({ ok: false, error: "Connect the Desktop Bridge companion for OS hotkey injection." }),
);

// Files & Vision legacy endpoints
app.post("/files/plan", (_req: Request, res: Response) =>
  res.json({ ok: false, moves: [], skipped: [], error: "Pair Desktop Bridge to organize local computer folders." }),
);
app.post("/files/apply", (_req: Request, res: Response) => res.json({ ok: false, moved: 0, failed: [], error: "Requires Desktop Bridge." }));
app.post("/files/undo", (_req: Request, res: Response) => res.json({ ok: false, restored: 0, problems: [], error: "Nothing to undo." }));
app.get("/files/journal", (_req: Request, res: Response) => res.json({ entries: [] }));
app.get("/files/protected", (_req: Request, res: Response) => res.json({ folders: state.protectedFolders }));
app.post("/files/protected", (req: Request, res: Response) => {
  if (Array.isArray(req.body?.folders)) state.protectedFolders = req.body.folders.map(String);
  res.json({ ok: true, folders: state.protectedFolders });
});

app.post("/vision/see", async (req: Request, res: Response) => {
  const imageData = String(req.body?.imageData || "");
  if (imageData) {
    const result = await analyzeScreenFrameWithGemini(imageData, "image/png", String(req.body?.question || ""));
    res.json(result);
    return;
  }
  res.json({ ok: false, error: "Use the Screen Vision capture bar in the HUD to share a tab, window, or monitor." });
});

// Voice, actions & Spotify
app.get("/voice/status", (_req: Request, res: Response) => res.json(state.voice));
app.get("/voice/mics", (_req: Request, res: Response) => res.json({ mics: [] }));
app.post("/voice/listen", (_req: Request, res: Response) => res.json({ ok: true, state: "listening" }));
app.post("/voice/cancel", (_req: Request, res: Response) => res.json({ ok: true, state: "stopped" }));
app.post("/actions/run", (req: Request, res: Response) => res.json(runDeterministicAction(String(req.body?.text || ""))));

app.get("/music/spotify/status", (req: Request, res: Response) => {
  const origin = `${req.protocol}://${req.get("host") || `localhost:${PORT}`}`;
  res.json({
    configured: Boolean(state.spotify.clientId),
    authorized: state.spotify.authorized,
    clientIdMasked: maskSecret(state.spotify.clientId),
    redirectUri: `${origin}/music/spotify/callback`,
    premium: state.spotify.premium,
    displayName: state.spotify.displayName,
    product: state.spotify.product,
  });
});
app.post("/music/spotify/client", (req: Request, res: Response) => {
  state.spotify.clientId = String(req.body?.clientId || "").trim();
  res.json({ ok: true, clientId: state.spotify.clientId });
});
app.get("/music/spotify/auth-url", (_req: Request, res: Response) =>
  res.json({ ok: false, error: "Use the Media & Video Search hub or Spotify web links directly." }),
);
app.post("/music/spotify/play", (_req: Request, res: Response) =>
  res.json({ ok: false, error: "Play tracks directly inside the Smart Home & Media Hub." }),
);
app.post("/music/spotify/control", (_req: Request, res: Response) => res.json({ ok: true }));
app.post("/music/spotify/disconnect", (_req: Request, res: Response) => {
  state.spotify.authorized = false;
  res.json({ ok: true });
});

// Workspace artifacts
app.get("/workspace/artifacts", (_req: Request, res: Response) => {
  const list = state.artifacts.map(toPublicArtifact);
  res.json({ artifacts: list, current: list.length ? list[list.length - 1] : null });
});
app.post("/workspace/clear", (_req: Request, res: Response) => {
  state.artifacts = [];
  res.json({ ok: true });
});
app.post("/workspace/undo", (req: Request, res: Response) => {
  const id = String(req.body?.artifactId || "");
  const art = state.artifacts.find((a) => a.id === id);
  if (!art) {
    res.status(404).json({ detail: "artifact not found" });
    return;
  }
  if (art.versions.length > 1) {
    art.versions.pop();
    art.content = art.versions[art.versions.length - 1].content;
    art.updatedAt = Date.now();
  }
  res.json({ ok: true, artifact: toPublicArtifact(art) });
});
app.post("/workspace/version", (req: Request, res: Response) => {
  const id = String(req.body?.artifactId || "");
  const version = Number(req.body?.version || 0);
  const art = state.artifacts.find((a) => a.id === id);
  if (!art) {
    res.status(404).json({ detail: "artifact not found" });
    return;
  }
  const match = art.versions.find((v) => v.n === version);
  if (match) saveArtifact(art.kind, art.title, match.content, art.id);
  res.json({ ok: true, artifact: toPublicArtifact(art) });
});
app.post("/workspace/pick-folder", (_req: Request, res: Response) =>
  res.json({ ok: false, folder: "", error: "Use Download in the web preview to save artifacts locally." }),
);
app.post("/workspace/save-to-folder", (_req: Request, res: Response) =>
  res.status(400).json({ detail: "Use Download in the web preview." }),
);

app.post("/workspace/run-code", async (req: Request, res: Response) => {
  const language = String(req.body?.language || "").toLowerCase();
  const code = String(req.body?.code || "");
  if (!code.trim()) {
    res.status(400).json({ detail: "code is empty" });
    return;
  }
  if (language !== "javascript" && language !== "typescript") {
    res.json({ ok: false, error: `Running '${language}' is not supported in the Node.js web runtime.` });
    return;
  }
  const tmpFile = path.join(os.tmpdir(), `jarvis-run-${crypto.randomUUID()}.mjs`);
  const started = Date.now();
  try {
    await fs.writeFile(tmpFile, code, "utf8");
    const result = await new Promise<{ ok: boolean; stdout: string; stderr: string; error?: string }>((resolve) => {
      const child = spawn(process.execPath, [tmpFile], { timeout: 15000 });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += String(d)));
      child.stderr.on("data", (d) => (stderr += String(d)));
      child.on("close", (exitCode) => resolve({ ok: exitCode === 0, stdout: stdout.slice(0, 8000), stderr: stderr.slice(0, 4000) }));
      child.on("error", (err) => resolve({ ok: false, stdout, stderr, error: err.message }));
    });
    res.json({ ...result, durationMs: Date.now() - started });
  } finally {
    await fs.unlink(tmpFile).catch(() => undefined);
  }
});

/* ------------------------------------------------------------------ HTTP + WebSockets + Vite */

const httpServer = http.createServer(app);
const chatWss = new WebSocketServer({ noServer: true });
const bridgeWss = new WebSocketServer({ noServer: true });
const liveWss = new WebSocketServer({ noServer: true });

httpServer.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (url.pathname === "/ws/chat") {
    chatWss.handleUpgrade(req, socket, head, (ws) => chatWss.emit("connection", ws, req));
  } else if (url.pathname === "/ws/live") {
    liveWss.handleUpgrade(req, socket, head, (ws) => liveWss.emit("connection", ws, req));
  } else if (url.pathname === "/ws/bridge") {
    const token = url.searchParams.get("token") || "";
    if (!validatePairingToken(token)) {
      socket.destroy();
      return;
    }
    bridgeWss.handleUpgrade(req, socket, head, (ws) => bridgeWss.emit("connection", ws, req));
  } else {
    socket.destroy();
  }
});

liveWss.on("connection", (ws: WebSocket) => {
  void runGeminiLiveBridge(ws);
});

bridgeWss.on("connection", (ws: WebSocket) => {
  registerBridgeSocket(ws, {});
  ws.once("message", (raw) => {
    try {
      const hello = JSON.parse(String(raw)) as { machineName?: string; platform?: string; capabilities?: string[] };
      if (hello && typeof hello === "object") {
        registerBridgeSocket(ws, hello);
      }
    } catch {
      /* ignore */
    }
  });
});

chatWss.on("connection", (ws: WebSocket) => {
  const sessionHistories = new Map<string, Array<{ role: string; content: string }>>();
  let activeTurn = false;

  const getHistoryForSession = (
    sessionId: string,
    clientSeed?: Array<{ role: string; content: string }>,
  ): Array<{ role: string; content: string }> => {
    let list = sessionHistories.get(sessionId);
    if (!list) {
      list = Array.isArray(clientSeed)
        ? clientSeed
            .filter(
              (m) =>
                m &&
                (m.role === "user" || m.role === "assistant") &&
                typeof m.content === "string" &&
                m.content.trim(),
            )
            .slice(-24)
        : [];
      sessionHistories.set(sessionId, list);
    }
    return list;
  };

  const send = (payload: Record<string, unknown>, sessionId?: string) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(sessionId ? { ...payload, sessionId } : payload));
    }
  };

  send({
    type: "status",
    brain: state.provider,
    model: state.models.default,
    confirmDangerousTools: state.confirmDangerousTools,
  });

  const runTurn = async (
    content: string,
    modelOverride: string | null,
    repair?: { artifactId: string; error: string },
    sessionId = "default",
    clientHistory?: Array<{ role: string; content: string }>,
  ) => {
    activeTurn = true;
    const history = getHistoryForSession(sessionId, clientHistory);
    let finalText = "";
    let streamedCount = 0;

    try {
      if (!repair) {
        const action = runDeterministicAction(content);
        if (action.handled) {
          if (action.stopSpeaking) send({ type: "stop_speaking" }, sessionId);
          if (action.data) send({ type: "action", data: action.data }, sessionId);
          if (action.reply) {
            send({ type: "token", content: action.reply }, sessionId);
            streamedCount += 1;
            finalText = action.reply;
          }
          return;
        }
        const proactiveIntent = detectNaturalNavigationIntent(content);
        if (proactiveIntent.tab) {
          send(
            {
              type: "action",
              data: {
                action: "navigate",
                tab: proactiveIntent.tab,
                ...(proactiveIntent.videoEdit ? { videoEdit: proactiveIntent.videoEdit } : {}),
              },
            },
            sessionId,
          );
        }
      }

      let workspaceReq: ReturnType<typeof detectWorkspaceRequest> = null;
      let prompt = content;
      let buffered = false;

      if (repair) {
        const target = state.artifacts.find((a) => a.id === repair.artifactId);
        if (!target) return;
        prompt = buildRepairPrompt(target, repair.error);
        workspaceReq = {
          kind: target.kind === "html" || target.kind === "svg" ? target.kind : "three",
          edit: true,
          artifact: target,
        };
        buffered = true;
      } else {
        workspaceReq = detectWorkspaceRequest(content);
        if (workspaceReq) {
          prompt = buildWorkspacePrompt(content, workspaceReq.artifact, workspaceReq.kind);
          buffered = true;
        }
      }

      const rawReply = await streamProviderCompletion(
        prompt,
        history,
        modelOverride,
        (evt) => {
          if (evt.type === "token") {
            if (buffered) return;
            streamedCount += 1;
          }
          send(evt, sessionId);
        },
        { rawMode: buffered },
      );

      if (workspaceReq && rawReply) {
        const parsed = parseArtifactReply(rawReply);
        if (!parsed) {
          send(
            {
              type: "notice",
              message: "I couldn't turn that into a live artifact. Ask again with a little more detail and I'll retry.",
            },
            sessionId,
          );
        } else {
          const editId =
            workspaceReq.artifact && workspaceReq.artifact.kind === parsed.kind
              ? workspaceReq.artifact.id
              : null;
          const title = workspaceReq.artifact?.title || titleFromPrompt(content);
          const saved = saveArtifact(parsed.kind, title, parsed.content, editId);
          send({ type: "artifact", artifact: toPublicArtifact(saved) }, sessionId);
          finalText = stripFences(rawReply) || "On the bench, sir.";
        }
      } else {
        finalText = rawReply;
      }
    } catch (err) {
      send({ type: "error", message: err instanceof Error ? err.message : String(err) }, sessionId);
    } finally {
      if (finalText && streamedCount === 0) {
        send({ type: "token", content: finalText }, sessionId);
      }
      send({ type: "thinking", status: false }, sessionId);
      if (finalText) {
        if (content) history.push({ role: "user", content });
        history.push({ role: "assistant", content: finalText });
        if (history.length > 60) history.splice(0, history.length - 60);
      }
      send({ type: "done", fullResponse: finalText, brain: state.provider }, sessionId);
      activeTurn = false;
    }
  };

  ws.on("message", (raw) => {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(String(raw)) as Record<string, unknown>;
    } catch {
      send({ type: "error", message: "invalid JSON" });
      return;
    }

    const kind = data.type;
    const sessionId = typeof data.sessionId === "string" && data.sessionId.trim() ? data.sessionId.trim() : "default";
    if (kind === "tts_state") {
      state.voice.ttsSpeaking = Boolean(data.speaking);
      return;
    }
    if (kind === "workspace_repair") {
      const artifactId = String(data.artifactId || "");
      const error = String(data.error || "").slice(0, 4000);
      if (!artifactId || !error || activeTurn) return;
      const art = state.artifacts.find((a) => a.id === artifactId);
      if (!art) return;
      const key = `${artifactId}:${art.versions[art.versions.length - 1]?.n ?? 1}`;
      const last = state.repaired.get(key);
      if (last && Date.now() - last < 15 * 60 * 1000) {
        send({ type: "notice", message: "That scene still isn't rendering after a repair — ask me to rebuild it." }, sessionId);
        return;
      }
      state.repaired.set(key, Date.now());
      send({ type: "notice", message: "The scene hit an error — repairing it…" }, sessionId);
      send({ type: "thinking", status: true }, sessionId);
      void runTurn("", null, { artifactId, error }, sessionId);
      return;
    }

    if (kind !== "message") return;
    const content = String(data.content || "").trim();
    if (!content) return;
    if (activeTurn) {
      send({ type: "notice", message: "Still working on the previous request — one moment." }, sessionId);
      return;
    }
    const modelOverride = typeof data.model === "string" && data.model.trim() ? data.model.trim() : null;
    const clientHistory = Array.isArray(data.history)
      ? (data.history as Array<{ role: string; content: string }>)
      : undefined;
    send({ type: "thinking", status: true }, sessionId);
    void runTurn(content, modelOverride, undefined, sessionId, clientHistory);
  });
});

async function start() {
  await loadJarvisData();
  if (!IS_PROD) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, "dist");
    app.use(express.static(distDir));
    app.use((_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`JARVIS server listening on http://0.0.0.0:${PORT}`);
  });
}

void start();
