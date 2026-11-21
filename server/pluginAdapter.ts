import {
  normalizeGitHubRawUrl,
  parseAnyExtensionManifest,
  runPluginDoctor,
  type NormalizedPlugin,
  type PluginDoctorReport,
} from "../src/lib/pluginAdapter";
import { getBridgeStatus } from "./bridgeCompanion";
import { loadJarvisData, saveJarvisData } from "./storage";

export interface CatalogEntry {
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

export const COMMUNITY_PLUGIN_CATALOG: CatalogEntry[] = [
  {
    id: "computer-use-background",
    name: "Computer Use (Background-First CUA)",
    version: "1.4.0",
    category: "Skills",
    description: "Background-first desktop interaction using Set-of-Mark targeting, window automation, hotkeys, and Screen Vision without hijacking your cursor.",
    sourceKind: "skill_md",
    requiresBridge: false,
    upstreamUrl: "https://github.com/NousResearch/hermes-official-plugins",
    rawManifest: `---
name: Computer Use (Background-First CUA)
version: 1.4.0
description: Drive desktop applications, read screen regions (Circle-to-Search), launch native tools, and verify UI state safely.
triggers:
  - click
  - open app
  - computer use
  - circle screen
  - read screen
tools:
  - navigate_and_act
  - launch_app
  - analyze_screen
---

# Computer Use (Background-First CUA)
Operate across windows cleanly without disrupting user cursor focus. Capture Set-of-Mark crops via Circle-to-Search or Screen Vision and verify actions step by step.`,
  },
  {
    id: "react-reasoning-planner",
    name: "ReAct Multi-Step Planner (ReA)",
    version: "1.2.0",
    category: "Skills",
    description: "Structured Thought -> Action -> Observation planning engine for multi-step engineering, coding, and visual research.",
    sourceKind: "skill_md",
    requiresBridge: false,
    upstreamUrl: "https://github.com/NousResearch/hermes-official-plugins",
    rawManifest: `---
name: ReAct Multi-Step Planner (ReA)
version: 1.2.0
description: Decomposes complex goals into verified reasoning steps with live charts, tool calls, and automatic tab orchestration.
triggers:
  - plan
  - reason
  - step by step
  - analyze
tools:
  - render_live_visual
  - extract_url_insights
  - navigate_and_act
---

# ReAct Multi-Step Planner (ReA)
Break intricate goals into observable hypotheses, gather live web or screen evidence, and emit crisp visual flowcharts or charts as you execute.`,
  },
  {
    id: "artcraft-mcp-studio",
    name: "Storytold ArtCraft MCP Studio",
    version: "1.1.0",
    category: "Media",
    description: "Connect DesignCraft, PhotoCraft, VectorCraft, and LightCraft from github.com/storytold via headless MCP CLI or local SSE.",
    sourceKind: "plugin_yaml",
    requiresBridge: false,
    upstreamUrl: "https://github.com/storytold",
    rawManifest: `name: Storytold ArtCraft MCP Studio
version: 1.1.0
description: Native MCP integration for Storytold Craft Apps (DesignCraft, PhotoCraft, VectorCraft, LightCraft) with root confinement and live canvas commands.
provides_tools:
  - run_artcraft_mcp
provides_hooks:
  - on_creative_edit
requires_bridge: false
triggers:
  - artcraft
  - designcraft
  - photocraft
  - vectorcraft
  - lightcraft
instructions: Route creative layer edits, vector tweaks, photo adjustments, and lighting instructions to the connected ArtCraft MCP tool server.`,
  },
  {
    id: "browser-automation-cua",
    name: "Autonomous Browser & Web Research",
    version: "1.1.0",
    category: "Productivity",
    description: "Inspect public URLs, extract structured insights, verify sources, and compile flowchart briefings automatically.",
    sourceKind: "skill_md",
    requiresBridge: false,
    upstreamUrl: "https://github.com/NousResearch/hermes-official-plugins",
    rawManifest: `---
name: Autonomous Browser & Web Research
version: 1.1.0
description: Read documentation, summarize webpages, and extract structured facts using live grounding.
triggers:
  - browse
  - read url
  - scrape
  - extract link
tools:
  - extract_url_insights
---

# Autonomous Browser & Web Research
Read supplied URLs completely, cite grounded references, and attach structured flowchart takeaways.`,
  },
  {
    id: "claude-subscription-directsdk",
    name: "Claude Subscription DirectSDK",
    version: "1.2.0",
    category: "Auth & Providers",
    description: "Use an active Claude Pro/Max subscription through your local CLI via the Desktop Bridge—no raw Anthropic API key required.",
    sourceKind: "plugin_yaml",
    requiresBridge: true,
    upstreamUrl: "https://github.com/NousResearch/hermes-official-plugins",
    rawManifest: `name: claude-subscription-directsdk
version: 1.2.0
description: Route chat turns through local Claude Code CLI & Agent SDK via Desktop Bridge
provides_tools:
  - direct_subscription_chat
provides_hooks:
  - on_provider_select
auth_mode: local_cli
requires_bridge: true
triggers:
  - claude bridge
instructions: Forward eligible prompts to the paired Desktop Bridge Claude CLI runner when selected as provider.`,
  },
  {
    id: "nous-portal-connector",
    name: "Nous Portal Gateway",
    version: "1.1.0",
    category: "Auth & Providers",
    description: "Key-less frontier model routing through Nous Portal OAuth account authentication.",
    sourceKind: "plugin_yaml",
    requiresBridge: false,
    upstreamUrl: "https://github.com/NousResearch/hermes-official-plugins",
    rawManifest: `name: nous-portal-connector
version: 1.1.0
description: Unified Nous Portal OAuth account model connector
provides_tools:
  - portal_chat
provides_hooks:
  - on_auth_refresh
auth_mode: oauth_portal
requires_bridge: false
triggers:
  - nous portal`,
  },
  {
    id: "chatgpt-codex-oauth",
    name: "ChatGPT / Codex Subscription OAuth",
    version: "1.0.4",
    category: "Auth & Providers",
    description: "Connect your ChatGPT/Codex account token via device login flow compatible with official open-source plugin specs.",
    sourceKind: "plugin_yaml",
    requiresBridge: false,
    upstreamUrl: "https://github.com/NousResearch/hermes-official-plugins",
    rawManifest: `name: chatgpt-codex-oauth
version: 1.0.4
description: ChatGPT / Codex account authentication adapter
provides_tools:
  - codex_completion
provides_hooks:
  - on_auth_refresh
auth_mode: oauth_device
requires_bridge: false`,
  },
  {
    id: "hermes-autonomous-coder",
    name: "Autonomous Coding & Self-Healing",
    version: "1.3.0",
    category: "Coding",
    description: "Inspect repository files, execute build/test scripts, parse tracebacks, patch root causes, and re-verify cleanly.",
    sourceKind: "skill_md",
    requiresBridge: false,
    upstreamUrl: "https://github.com/NousResearch/hermes-official-plugins",
    rawManifest: `---
name: Autonomous Coding & Self-Healing
version: 1.3.0
description: Local workspace reading/editing, terminal build checks, and traceback-driven self-healing loop.
triggers:
  - fix build
  - refactor
  - run tests
  - debug error
tools:
  - read_file
  - edit_file
  - run_shell
---

# Autonomous Coding & Self-Healing
Always read target files before patching, verify changes via tests or compiler output, and isolate destructive edits safely.`,
  },
  {
    id: "deep-web-research-charts",
    name: "Visual Research & Live Charts",
    version: "1.0.0",
    category: "Productivity",
    description: "Pairs grounded web search results with live interactive comparison charts, timelines, and diagrams.",
    sourceKind: "skill_md",
    requiresBridge: false,
    upstreamUrl: "https://agentskills.io",
    rawManifest: `---
name: Visual Research & Live Charts
version: 1.0.0
description: Grounded web research paired with interactive SVG charts and flow diagrams.
triggers:
  - research
  - graph
  - chart
  - compare
tools:
  - render_live_visual
---

# Visual Research & Live Charts
Whenever explaining trends, comparisons, architectures, or statistics, emit an interactive chart or flowchart alongside concise citations.`,
  },
  {
    id: "video-director-assistant",
    name: "Video Cut & Auto-Timeline Director",
    version: "1.2.0",
    category: "Media",
    description: "Automatically switches to Video Studio when clips are sent, places them on the timeline, applies motion/grades/captions, and exports.",
    sourceKind: "skill_md",
    requiresBridge: false,
    upstreamUrl: "https://agentskills.io",
    rawManifest: `---
name: Video Cut & Auto-Timeline Director
version: 1.2.0
description: Automatically navigates to Video Studio, loads clips onto the timeline, trims, adds Ken Burns motion, and generates voiceovers.
triggers:
  - edit video
  - trim clip
  - add title
  - montage
tools:
  - navigate_and_act
---

# Video Cut & Auto-Timeline Director
Analyze clip durations and user creative direction, switch to the Video Studio tab, and apply requested cuts, grades, and motion automatically.`,
  },
  {
    id: "obsidian-notes-sync",
    name: "Knowledge Wiki & Notebook Compiler",
    version: "1.0.0",
    category: "Productivity",
    description: "Compiles scattered daily notes and personal memories into structured topic chapters in the Memory Wiki.",
    sourceKind: "skill_md",
    requiresBridge: false,
    upstreamUrl: "https://agentskills.io",
    rawManifest: `---
name: Knowledge Wiki & Notebook Compiler
version: 1.0.0
description: Organizes markdown notes and memories into clean cross-referenced wiki chapters.
triggers:
  - wiki
  - organize notes
  - compile memory
tools:
  - save_note
  - save_personal_memory
---

# Knowledge Wiki & Notebook Compiler
Keep project decisions, architecture choices, and personal notes structured and immediately searchable.`,
  },
];

export async function installFromManifestText(
  raw: string,
  options: { upstreamUrl?: string; filenameHint?: string } = {},
): Promise<NormalizedPlugin> {
  const normalized = parseAnyExtensionManifest(raw, options);
  const data = await loadJarvisData();
  const idx = data.plugins.findIndex((p) => p.id === normalized.id);
  if (idx >= 0) {
    const existing = data.plugins[idx];
    const hasChanged = existing.rawSource && existing.rawSource !== normalized.rawSource;
    data.plugins[idx] = {
      ...normalized,
      enabled: existing.enabled,
      previousVersion: hasChanged ? existing.version : existing.previousVersion,
      previousRawSource: hasChanged ? existing.rawSource : existing.previousRawSource,
    };
  } else {
    data.plugins.push(normalized);
  }
  await saveJarvisData(data);
  return data.plugins.find((p) => p.id === normalized.id) || normalized;
}

export async function installFromRemoteUrl(urlInput: string): Promise<NormalizedPlugin> {
  const rawUrl = normalizeGitHubRawUrl(urlInput);
  if (!rawUrl.startsWith("http://") && !rawUrl.startsWith("https://")) {
    throw new Error("Please enter a valid https:// GitHub or manifest URL.");
  }

  let fetchedText = "";
  let resolvedUrl = rawUrl;
  const resp = await fetch(rawUrl, { signal: AbortSignal.timeout(12000) });
  if (resp.ok) {
    fetchedText = await resp.text();
  } else if (!rawUrl.endsWith("SKILL.md") && !rawUrl.endsWith("plugin.yaml")) {
    const cleanBase = rawUrl.replace(/\/+$/, "");
    for (const candidate of [`${cleanBase}/plugin.yaml`, `${cleanBase}/SKILL.md`]) {
      const r = await fetch(candidate, { signal: AbortSignal.timeout(8000) }).catch(() => null);
      if (r && r.ok) {
        fetchedText = await r.text();
        resolvedUrl = candidate;
        break;
      }
    }
  }

  if (!fetchedText.trim()) {
    throw new Error(`Could not fetch SKILL.md or plugin.yaml from ${urlInput}. Paste the manifest content directly if the repo is private.`);
  }

  return installFromManifestText(fetchedText, {
    upstreamUrl: urlInput,
    filenameHint: resolvedUrl,
  });
}

export async function checkUpstreamPluginUpdates(): Promise<{ checked: number; updated: string[] }> {
  const data = await loadJarvisData();
  let checked = 0;
  const updated: string[] = [];

  for (const plugin of data.plugins) {
    if (!plugin.upstreamUrl || (!plugin.upstreamUrl.startsWith("http://") && !plugin.upstreamUrl.startsWith("https://"))) {
      continue;
    }
    checked += 1;
    const rawUrl = normalizeGitHubRawUrl(plugin.upstreamUrl);
    try {
      const r = await fetch(rawUrl, { signal: AbortSignal.timeout(6000) });
      if (!r.ok) continue;
      const raw = await r.text();
      if (raw && raw !== plugin.rawSource) {
        const parsed = parseAnyExtensionManifest(raw, {
          upstreamUrl: plugin.upstreamUrl,
          filenameHint: rawUrl,
          enabled: plugin.enabled,
        });
        const idx = data.plugins.findIndex((p) => p.id === plugin.id);
        if (idx >= 0) {
          data.plugins[idx] = {
            ...parsed,
            previousVersion: plugin.version,
            previousRawSource: plugin.rawSource,
          };
          updated.push(parsed.name);
        }
      }
    } catch {
      /* ignore unreachable upstream while preserving working local plugin */
    }
  }

  if (updated.length > 0) {
    await saveJarvisData(data);
  }
  return { checked, updated };
}

export async function rollbackPluginVersion(id: string): Promise<NormalizedPlugin | null> {
  const data = await loadJarvisData();
  const idx = data.plugins.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  const current = data.plugins[idx];
  if (!current.previousRawSource) return null;

  const restored = parseAnyExtensionManifest(current.previousRawSource, {
    upstreamUrl: current.upstreamUrl,
    filenameHint: current.sourceKind === "skill_md" ? "SKILL.md" : "plugin.yaml",
    enabled: current.enabled,
  });
  data.plugins[idx] = {
    ...restored,
    version: current.previousVersion || restored.version,
    previousVersion: current.version,
    previousRawSource: current.rawSource,
  };
  await saveJarvisData(data);
  return data.plugins[idx];
}

export async function diagnoseAllPlugins(): Promise<PluginDoctorReport> {
  const data = await loadJarvisData();
  return runPluginDoctor(data.plugins, getBridgeStatus().connected);
}
