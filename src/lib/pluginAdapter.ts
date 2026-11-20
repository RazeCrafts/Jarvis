import * as yaml from "js-yaml";

export type PluginSourceKind = "builtin" | "skill_md" | "plugin_yaml" | "custom_nocode";

export interface NormalizedPlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  sourceKind: PluginSourceKind;
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
  authMode?: string;
  instructions: string;
  webhookUrl?: string;
  enabled: boolean;
  updatedAt: number;
  rawSource: string;
  /** Preserves any future upstream plugin.yaml/SKILL.md keys without breaking. */
  extraSchema: Record<string, unknown>;
}

export interface PluginDoctorIssue {
  pluginId: string;
  pluginName: string;
  severity: "warn" | "info";
  message: string;
}

export interface PluginDoctorReport {
  ok: boolean;
  total: number;
  healthyCount: number;
  pinnedCount: number;
  issues: PluginDoctorIssue[];
}

const KNOWN_PLUGIN_YAML_KEYS = new Set([
  "name",
  "version",
  "description",
  "provides_tools",
  "provides_hooks",
  "triggers",
  "requires_bridge",
  "auth_mode",
  "instructions",
  "webhook_url",
]);

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "custom-skill"
  );
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v).trim()).filter(Boolean);
}

/**
 * Computes a deterministic short manifest digest (`sha8`) in both browser & Node.
 */
export function computeManifestSha(raw: string): string {
  const normalized = raw.replace(/\r\n/g, "\n").trim();
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < normalized.length; i += 1) {
    const code = normalized.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= code + (i & 255);
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  const partA = (h1 >>> 0).toString(16).padStart(8, "0");
  const partB = (h2 >>> 0).toString(16).padStart(8, "0");
  return `${partA}${partB}`.slice(0, 10);
}

/**
 * Normalizes an upstream `plugin.yaml` manifest (including future schema fields)
 * into JARVIS's versioned internal plugin structure.
 */
export function parsePluginYamlManifest(
  rawYaml: string,
  options: { upstreamUrl?: string; enabled?: boolean; pinnedSha?: string } = {},
): NormalizedPlugin {
  const parsed = yaml.load(rawYaml);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid plugin.yaml manifest: expected a YAML object.");
  }
  const obj = parsed as Record<string, unknown>;
  const name = String(obj.name || "").trim();
  if (!name) {
    throw new Error("Invalid plugin.yaml manifest: missing required 'name' field.");
  }

  const extraSchema: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!KNOWN_PLUGIN_YAML_KEYS.has(k)) {
      extraSchema[k] = v;
    }
  }

  const providesTools = toStringArray(obj.provides_tools);
  const providesHooks = toStringArray(obj.provides_hooks);
  const authMode = typeof obj.auth_mode === "string" ? obj.auth_mode.trim() : undefined;
  const requiresBridge =
    typeof obj.requires_bridge === "boolean"
      ? obj.requires_bridge
      : authMode === "local_cli" || name.includes("directsdk");

  return {
    id: slugify(name),
    name,
    version: String(obj.version || "1.0.0").trim(),
    description: String(obj.description || "Community plugin manifest").trim(),
    sourceKind: "plugin_yaml",
    schemaVersion: 1,
    upstreamUrl: options.upstreamUrl || "",
    pinnedSha: options.pinnedSha || computeManifestSha(rawYaml),
    triggers: toStringArray(obj.triggers),
    providesTools,
    providesHooks,
    requiresBridge,
    authMode,
    instructions: typeof obj.instructions === "string" ? obj.instructions.trim() : "",
    webhookUrl: typeof obj.webhook_url === "string" ? obj.webhook_url.trim() : undefined,
    enabled: options.enabled ?? true,
    updatedAt: Date.now(),
    rawSource: rawYaml,
    extraSchema,
  };
}

/**
 * Parses an `agentskills.io` / open-source `SKILL.md` file with YAML frontmatter
 * and Markdown procedure instructions.
 */
export function parseSkillMarkdown(
  rawMarkdown: string,
  options: { upstreamUrl?: string; enabled?: boolean; fallbackName?: string; pinnedSha?: string } = {},
): NormalizedPlugin {
  const trimmed = rawMarkdown.trim();
  if (!trimmed) {
    throw new Error("SKILL.md content cannot be empty.");
  }

  let frontmatter: Record<string, unknown> = {};
  let body = trimmed;

  const fmMatch = trimmed.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n([\s\S]*))?$/);
  if (fmMatch) {
    const loaded = yaml.load(fmMatch[1]);
    if (loaded && typeof loaded === "object" && !Array.isArray(loaded)) {
      frontmatter = loaded as Record<string, unknown>;
    }
    body = (fmMatch[2] || "").trim();
  }

  const headingMatch = body.match(/^#\s+(.+)$/m);
  const name = String(
    frontmatter.name || options.fallbackName || headingMatch?.[1] || "Untitled Skill",
  ).trim();
  const description = String(
    frontmatter.description ||
      body.split(/\r?\n/).find((line) => line.trim() && !line.trim().startsWith("#")) ||
      "Imported Markdown skill",
  ).trim();

  const knownFm = new Set(["name", "description", "version", "triggers", "tools", "requires_bridge"]);
  const extraSchema: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(frontmatter)) {
    if (!knownFm.has(k)) extraSchema[k] = v;
  }

  return {
    id: slugify(name),
    name,
    version: String(frontmatter.version || "1.0.0").trim(),
    description: description.slice(0, 280),
    sourceKind: "skill_md",
    schemaVersion: 1,
    upstreamUrl: options.upstreamUrl || "",
    pinnedSha: options.pinnedSha || computeManifestSha(rawMarkdown),
    triggers: toStringArray(frontmatter.triggers),
    providesTools: toStringArray(frontmatter.tools),
    providesHooks: [],
    requiresBridge: Boolean(frontmatter.requires_bridge),
    instructions: body,
    enabled: options.enabled ?? true,
    updatedAt: Date.now(),
    rawSource: rawMarkdown,
    extraSchema,
  };
}

/**
 * Auto-detects whether a raw string is a `plugin.yaml` manifest or `SKILL.md`
 * document and normalizes it safely.
 */
export function parseAnyExtensionManifest(
  raw: string,
  options: { upstreamUrl?: string; filenameHint?: string; enabled?: boolean; pinnedSha?: string } = {},
): NormalizedPlugin {
  const hint = (options.filenameHint || options.upstreamUrl || "").toLowerCase();
  const looksLikeSkillMd =
    hint.endsWith(".md") || /^---\s*\r?\n[\s\S]*?\r?\n---/.test(raw.trim()) || raw.trim().startsWith("#");

  if (looksLikeSkillMd) {
    return parseSkillMarkdown(raw, options);
  }
  return parsePluginYamlManifest(raw, options);
}

/**
 * Converts standard GitHub web URLs into raw downloadable URLs for `SKILL.md`
 * or `plugin.yaml`.
 */
export function normalizeGitHubRawUrl(inputUrl: string): string {
  const trimmed = inputUrl.trim();
  if (!trimmed) return "";
  if (trimmed.includes("raw.githubusercontent.com")) return trimmed;

  const blobMatch = trimmed.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/i,
  );
  if (blobMatch) {
    return `https://raw.githubusercontent.com/${blobMatch[1]}/${blobMatch[2]}/${blobMatch[3]}/${blobMatch[4]}`;
  }

  const treeMatch = trimmed.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+?)\/?$/i,
  );
  if (treeMatch) {
    return `https://raw.githubusercontent.com/${treeMatch[1]}/${treeMatch[2]}/${treeMatch[3]}/${treeMatch[4]}/plugin.yaml`;
  }

  return trimmed;
}

/**
 * Drafts a clean, reusable JARVIS skill from repeated user workflow steps.
 */
export function draftSkillFromWorkflow(
  name: string,
  steps: string[],
  options: { description?: string; triggers?: string[] } = {},
): NormalizedPlugin {
  const cleanName = name.trim() || "Auto-Drafted Workflow Skill";
  const cleanSteps = steps.map((s) => s.trim()).filter(Boolean);
  if (cleanSteps.length === 0) {
    throw new Error("Provide at least one workflow step to draft a skill.");
  }
  const triggers =
    options.triggers && options.triggers.length > 0
      ? options.triggers.map((t) => t.trim()).filter(Boolean)
      : [cleanName.toLowerCase()];

  const instructions = cleanSteps.map((step, i) => `${i + 1}. ${step}`).join("\n");
  const rawMd = `---
name: ${cleanName}
version: 1.0.0
description: ${options.description?.trim() || `Automated multi-step workflow (${cleanSteps.length} steps)`}
triggers:
${triggers.map((t) => `  - ${t}`).join("\n")}
---

# ${cleanName}
${instructions}
`;

  return {
    id: slugify(cleanName),
    name: cleanName,
    version: "1.0.0",
    description: options.description?.trim() || `Automated multi-step workflow (${cleanSteps.length} steps)`,
    sourceKind: "custom_nocode",
    schemaVersion: 1,
    upstreamUrl: "",
    pinnedSha: computeManifestSha(rawMd),
    autoDrafted: true,
    triggers,
    providesTools: [],
    providesHooks: ["on_user_message"],
    requiresBridge: false,
    instructions,
    enabled: true,
    updatedAt: Date.now(),
    rawSource: rawMd,
    extraSchema: {},
  };
}

/**
 * Evaluates all installed extensions for schema completeness, pinned integrity,
 * bridge requirements, and duplicate trigger collisions.
 */
export function runPluginDoctor(
  plugins: NormalizedPlugin[],
  bridgeConnected = false,
): PluginDoctorReport {
  const issues: PluginDoctorIssue[] = [];
  const triggerOwners = new Map<string, string>();
  let pinnedCount = 0;

  for (const p of plugins) {
    if (p.pinnedSha) pinnedCount += 1;
    if (p.sourceKind !== "builtin" && !p.pinnedSha) {
      issues.push({
        pluginId: p.id,
        pluginName: p.name,
        severity: "info",
        message: "Extension does not yet have a pinned manifest digest; re-sync to pin.",
      });
    }
    if (p.requiresBridge && p.enabled && !bridgeConnected) {
      issues.push({
        pluginId: p.id,
        pluginName: p.name,
        severity: "warn",
        message: "Enabled extension requires the optional Desktop Bridge companion to execute local commands.",
      });
    }
    if (p.enabled && !p.instructions && p.providesTools.length === 0) {
      issues.push({
        pluginId: p.id,
        pluginName: p.name,
        severity: "warn",
        message: "Extension has no instructions or registered tool bindings.",
      });
    }
    for (const trig of p.triggers) {
      const low = trig.toLowerCase();
      const prev = triggerOwners.get(low);
      if (prev && prev !== p.name) {
        issues.push({
          pluginId: p.id,
          pluginName: p.name,
          severity: "info",
          message: `Trigger "${trig}" overlaps with "${prev}".`,
        });
      } else {
        triggerOwners.set(low, p.name);
      }
    }
  }

  const warnCount = new Set(issues.filter((i) => i.severity === "warn").map((i) => i.pluginId)).size;
  return {
    ok: warnCount === 0,
    total: plugins.length,
    healthyCount: Math.max(0, plugins.length - warnCount),
    pinnedCount,
    issues,
  };
}
