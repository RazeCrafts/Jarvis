import { GoogleGenAI, Modality, Type, type FunctionDeclaration } from "@google/genai";
import type { WebSocket } from "ws";
import { loadJarvisData, saveJarvisData, newId } from "./storage";
import { dispatchBridgeCommand } from "./bridgeCompanion";
import { extractPersonalMemoriesFromTurn } from "../src/lib/memoryAndCalendar";
import { draftSkillFromWorkflow } from "../src/lib/pluginAdapter";

export const DEFAULT_GEMINI_MODEL = "gemini-4-hydrogen";
export const LIGHT_GEMINI_MODEL = "gemini-3.1-flash-lite";
export const LIVE_GEMINI_MODEL = "gemini-3.8-live";
export const TTS_GEMINI_MODEL = "gemini-3.8-flash-lite-tts";

function getClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { "User-Agent": "aistudio-build" } },
  });
}

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

const renderLiveVisualDecl: FunctionDeclaration = {
  name: "render_live_visual",
  description:
    "Render an interactive live chart, comparison graph, metric table, or step flowchart alongside your explanation in JARVIS.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING, description: "Clear title for the chart or diagram" },
      subtitle: { type: Type.STRING, description: "Short subtitle explaining units or context" },
      chartType: {
        type: Type.STRING,
        description: "One of: line, area, bar, pie, radar, flowchart, table",
      },
      labels: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: "Category or X-axis labels (for line/area/bar/pie/radar)",
      },
      series: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            values: { type: Type.ARRAY, items: { type: Type.NUMBER } },
          },
          required: ["name", "values"],
        },
        description: "Numeric data series matching the length of labels",
      },
      nodes: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            label: { type: Type.STRING },
            detail: { type: Type.STRING },
          },
          required: ["id", "label"],
        },
        description: "Nodes when chartType is flowchart",
      },
      edges: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            from: { type: Type.STRING },
            to: { type: Type.STRING },
            label: { type: Type.STRING },
          },
          required: ["from", "to"],
        },
        description: "Directed connections when chartType is flowchart",
      },
    },
    required: ["title", "chartType"],
  },
};

const saveMemoryDecl: FunctionDeclaration = {
  name: "save_personal_memory",
  description: "Remember a personal preference, relationship, project, fact, or routine shared by the user.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      category: { type: Type.STRING, description: "preference | person | project | fact | routine" },
      title: { type: Type.STRING, description: "Short 2-6 word label" },
      content: { type: Type.STRING, description: "Concise personal fact to recall later" },
    },
    required: ["category", "title", "content"],
  },
};

const saveNoteDecl: FunctionDeclaration = {
  name: "save_note",
  description: "Take down or save a personal note or meeting summary in the Notes notebook.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING, description: "Note title" },
      body: { type: Type.STRING, description: "Markdown note body" },
      tags: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Short topic tags" },
    },
    required: ["title", "body"],
  },
};

const scheduleEventDecl: FunctionDeclaration = {
  name: "schedule_calendar_event",
  description: "Create a scheduled calendar event or reminder for the user.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING, description: "Event title" },
      startISO: { type: Type.STRING, description: "Start ISO timestamp e.g. 2026-11-21T10:00:00" },
      endISO: { type: Type.STRING, description: "End ISO timestamp e.g. 2026-11-21T11:00:00" },
      location: { type: Type.STRING, description: "Optional location" },
      notes: { type: Type.STRING, description: "Optional notes" },
    },
    required: ["title", "startISO"],
  },
};

const controlHomeDecl: FunctionDeclaration = {
  name: "control_smart_home",
  description: "Control a smart home device (light, climate, lock, speaker) or activate a home scene.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      sceneName: { type: Type.STRING, description: "Optional scene name like Movie Night or Workshop Focus" },
      deviceName: { type: Type.STRING, description: "Device or room name" },
      on: { type: Type.BOOLEAN, description: "Power on/off" },
      level: { type: Type.NUMBER, description: "Brightness or volume 0-100" },
      targetTemp: { type: Type.NUMBER, description: "Thermostat target temperature in F" },
    },
  },
};

const searchMediaDecl: FunctionDeclaration = {
  name: "search_videos",
  description: "Search for YouTube videos or music streams to play inside JARVIS.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: { type: Type.STRING, description: "Video or music search query" },
      kind: { type: Type.STRING, description: "video or music" },
    },
    required: ["query"],
  },
};

const autoDraftSkillDecl: FunctionDeclaration = {
  name: "auto_draft_skill",
  description: "Draft and save a reusable custom JARVIS skill from a repeatable multi-step user workflow.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      name: { type: Type.STRING, description: "Short descriptive skill name" },
      description: { type: Type.STRING, description: "One sentence summary of what the skill automates" },
      triggers: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Trigger phrases" },
      steps: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Ordered workflow steps" },
    },
    required: ["name", "steps"],
  },
};

const extractUrlDecl: FunctionDeclaration = {
  name: "extract_url_insights",
  description: "Read and summarize a public webpage URL cleanly into structured notes or takeaways.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      url: { type: Type.STRING, description: "Full https:// URL to read" },
      question: { type: Type.STRING, description: "Specific question or focus for the extraction" },
    },
    required: ["url"],
  },
};

const navigateAndActDecl: FunctionDeclaration = {
  name: "navigate_and_act",
  description:
    "Automatically switch JARVIS to a specific workspace tab (such as video, workspace, smarthome, memory, skills, providers, settings, home) and optionally apply automated Video Studio edits (filter, Ken Burns motion, speed, overlay caption, montage).",
  parameters: {
    type: Type.OBJECT,
    properties: {
      tab: {
        type: Type.STRING,
        description: "One of: home, workspace, video, smarthome, memory, skills, providers, settings",
      },
      filterPreset: {
        type: Type.STRING,
        description: "Optional video filter preset: none, cinematic, vivid, noir, warm, cool",
      },
      motionPreset: {
        type: Type.STRING,
        description: "Optional video motion preset: none, zoom-in, zoom-out, pan-left, pan-right",
      },
      speed: {
        type: Type.NUMBER,
        description: "Optional playback speed multiplier e.g. 0.5, 1, 1.5, 2",
      },
      overlayText: {
        type: Type.STRING,
        description: "Optional title/caption overlay text for Video Studio clips",
      },
      autoMontage: {
        type: Type.BOOLEAN,
        description: "Whether to auto-tighten and sequence clips cleanly",
      },
    },
    required: ["tab"],
  },
};

const runArtCraftMcpDecl: FunctionDeclaration = {
  name: "run_artcraft_mcp",
  description:
    "Send an editing instruction or MCP tool invocation to a Storytold ArtCraft app (DesignCraft, PhotoCraft, VectorCraft, LightCraft).",
  parameters: {
    type: Type.OBJECT,
    properties: {
      app: {
        type: Type.STRING,
        description: "One of: designcraft, photocraft, vectorcraft, lightcraft",
      },
      instruction: {
        type: Type.STRING,
        description: "Plain-English creative edit or MCP command to perform inside the ArtCraft app",
      },
      toolName: {
        type: Type.STRING,
        description: "Optional MCP tool name if known (defaults to craft_edit)",
      },
      endpointUrl: {
        type: Type.STRING,
        description: "Optional local HTTP MCP endpoint e.g. http://127.0.0.1:4311/mcp",
      },
    },
    required: ["app", "instruction"],
  },
};

const ARTCRAFT_DEFAULT_PORTS: Record<string, number> = {
  designcraft: 4311,
  photocraft: 4312,
  vectorcraft: 4313,
  lightcraft: 4314,
};

export async function executeArtCraftMcpCommand(params: {
  app: string;
  instruction: string;
  toolName?: string;
  endpointUrl?: string;
}): Promise<Record<string, unknown>> {
  const appKey = (params.app || "designcraft").toLowerCase().trim();
  const instruction = (params.instruction || "").trim();
  const toolName = (params.toolName || "craft_edit").trim();
  const defaultPort = ARTCRAFT_DEFAULT_PORTS[appKey] || 4311;
  const endpointUrl = (params.endpointUrl || `http://127.0.0.1:${defaultPort}/mcp`).trim();

  try {
    const resp = await fetch(endpointUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `jarvis-${Date.now()}`,
        method: "tools/call",
        params: {
          name: toolName,
          arguments: { app: appKey, instruction },
        },
      }),
      signal: AbortSignal.timeout(4500),
    });
    if (resp.ok) {
      const payload = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
      return {
        ok: true,
        via: "http-mcp",
        app: appKey,
        endpointUrl,
        result: payload.result ?? payload,
      };
    }
  } catch {
    /* Fall through to Desktop Bridge if local HTTP MCP isn't directly reachable */
  }

  const bridgeRes = await dispatchBridgeCommand("mcp_artcraft_call", {
    app: appKey,
    instruction,
    toolName,
    port: defaultPort,
  });

  if (bridgeRes.ok) {
    return {
      ok: true,
      via: "desktop-bridge",
      app: appKey,
      port: defaultPort,
      output: bridgeRes.output ?? bridgeRes,
    };
  }

  return {
    ok: false,
    app: appKey,
    port: defaultPort,
    endpointUrl,
    cliCommand: `${appKey}-cli mcp --connect 127.0.0.1:${defaultPort}`,
    error:
      String(bridgeRes.error || "").trim() ||
      `No running ${appKey} MCP server detected on 127.0.0.1:${defaultPort}. Pair the Desktop Bridge or launch \`${appKey}-cli mcp --connect 127.0.0.1:${defaultPort}\`.`,
  };
}

export async function executeToolCall(
  name: string,
  args: Record<string, unknown>,
  emitEvent: (evt: Record<string, unknown>) => void,
): Promise<Record<string, unknown>> {
  const data = await loadJarvisData();

  if (name === "render_live_visual") {
    const visual = {
      id: newId("vis"),
      title: String(args.title || "Live Visual"),
      subtitle: typeof args.subtitle === "string" ? args.subtitle : "",
      chartType: String(args.chartType || "bar"),
      labels: Array.isArray(args.labels) ? args.labels.map(String) : [],
      series: Array.isArray(args.series) ? args.series : [],
      nodes: Array.isArray(args.nodes) ? args.nodes : [],
      edges: Array.isArray(args.edges) ? args.edges : [],
      createdAt: Date.now(),
    };
    emitEvent({ type: "visual", visual });
    return { ok: true, displayed: visual.title };
  }

  if (name === "save_personal_memory") {
    const cat = String(args.category || "fact");
    const validCat = ["preference", "person", "project", "fact", "routine"].includes(cat)
      ? (cat as "preference" | "person" | "project" | "fact" | "routine")
      : "fact";
    const entry = {
      id: newId("mem"),
      category: validCat,
      title: String(args.title || "Personal Memory"),
      content: String(args.content || ""),
      pinned: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    if (entry.content) {
      data.memories.unshift(entry);
      await saveJarvisData(data);
      emitEvent({ type: "data_sync", domain: "memories" });
    }
    return { ok: true, id: entry.id, title: entry.title };
  }

  if (name === "save_note") {
    const note = {
      id: newId("note"),
      title: String(args.title || "Untitled Note"),
      body: String(args.body || ""),
      tags: Array.isArray(args.tags) ? args.tags.map(String) : [],
      updatedAt: Date.now(),
    };
    data.notes.unshift(note);
    await saveJarvisData(data);
    emitEvent({ type: "data_sync", domain: "notes" });
    return { ok: true, id: note.id, title: note.title };
  }

  if (name === "schedule_calendar_event") {
    const startISO = String(args.startISO || new Date(Date.now() + 3600000).toISOString());
    const startMs = Date.parse(startISO) || Date.now() + 3600000;
    const endISO =
      typeof args.endISO === "string" && args.endISO
        ? args.endISO
        : new Date(startMs + 3600000).toISOString();
    const ev = {
      id: newId("cal"),
      title: String(args.title || "Scheduled Event"),
      startISO,
      endISO,
      location: typeof args.location === "string" ? args.location : "",
      notes: typeof args.notes === "string" ? args.notes : "",
      recurrence: "none" as const,
      reminderMinutes: 15,
      completed: false,
    };
    data.calendar.push(ev);
    await saveJarvisData(data);
    emitEvent({ type: "data_sync", domain: "calendar" });
    return { ok: true, id: ev.id, title: ev.title, startISO };
  }

  if (name === "control_smart_home") {
    const sceneName = String(args.sceneName || "").toLowerCase();
    if (sceneName) {
      const scene = data.smartHome.scenes.find((s) => s.name.toLowerCase().includes(sceneName));
      if (scene) {
        for (const act of scene.actions) {
          const d = data.smartHome.devices.find((dev) => dev.id === act.deviceId);
          if (d) {
            d.on = act.on;
            if (typeof act.level === "number") d.level = act.level;
            if (typeof act.targetTemp === "number") d.targetTemp = act.targetTemp;
            d.statusText = d.on ? (typeof d.level === "number" ? `${d.level}% Active` : "Active") : "Off";
          }
        }
        await saveJarvisData(data);
        emitEvent({ type: "data_sync", domain: "smarthome" });
        return { ok: true, scene: scene.name };
      }
    }
    const target = String(args.deviceName || "").toLowerCase();
    const device = data.smartHome.devices.find(
      (d) => d.name.toLowerCase().includes(target) || d.room.toLowerCase().includes(target),
    );
    if (device) {
      if (typeof args.on === "boolean") device.on = args.on;
      if (typeof args.level === "number") device.level = Math.max(0, Math.min(100, args.level));
      if (typeof args.targetTemp === "number") device.targetTemp = args.targetTemp;
      device.statusText =
        device.type === "climate"
          ? `Target ${device.targetTemp ?? 70}°F`
          : device.type === "lock"
            ? device.on
              ? "Locked"
              : "Unlocked"
            : device.on
              ? `${device.level ?? 100}% Active`
              : "Off";
      await saveJarvisData(data);
      emitEvent({ type: "data_sync", domain: "smarthome" });
      return { ok: true, device: device.name, on: device.on, statusText: device.statusText };
    }
    return { ok: false, error: "Matching smart home device or scene not found." };
  }

  if (name === "search_videos") {
    const query = String(args.query || "").trim();
    const results = await searchVideosWithGemini(query);
    if (results.length > 0) {
      data.mediaHistory.unshift({
        id: newId("med"),
        title: results[0].title,
        channel: results[0].channel,
        url: results[0].url,
        embedUrl: results[0].embedUrl,
        kind: args.kind === "music" ? "music" : "video",
        addedAt: Date.now(),
      });
      data.mediaHistory = data.mediaHistory.slice(0, 20);
      await saveJarvisData(data);
      emitEvent({ type: "data_sync", domain: "media" });
    }
    return { ok: true, query, results };
  }

  if (name === "auto_draft_skill") {
    const steps = Array.isArray(args.steps) ? args.steps.map(String) : [];
    const drafted = draftSkillFromWorkflow(String(args.name || "Custom Workflow"), steps, {
      description: typeof args.description === "string" ? args.description : undefined,
      triggers: Array.isArray(args.triggers) ? args.triggers.map(String) : undefined,
    });
    const idx = data.plugins.findIndex((p) => p.id === drafted.id);
    if (idx >= 0) data.plugins[idx] = drafted;
    else data.plugins.unshift(drafted);
    await saveJarvisData(data);
    emitEvent({ type: "data_sync", domain: "plugins" });
    return { ok: true, id: drafted.id, name: drafted.name, pinnedSha: drafted.pinnedSha };
  }

  if (name === "extract_url_insights") {
    const res = await extractWebContextWithGemini(
      String(args.url || ""),
      typeof args.question === "string" ? args.question : "",
    );
    if (res.visual) emitEvent({ type: "visual", visual: res.visual });
    if (res.citations?.length) emitEvent({ type: "citations", citations: res.citations });
    return res;
  }

  if (name === "navigate_and_act") {
    const tab = String(args.tab || "home").trim();
    const videoEdit: Record<string, unknown> = {};
    if (typeof args.filterPreset === "string") videoEdit.filterPreset = args.filterPreset;
    if (typeof args.motionPreset === "string") videoEdit.motionPreset = args.motionPreset;
    if (typeof args.speed === "number") videoEdit.speed = args.speed;
    if (typeof args.overlayText === "string") videoEdit.overlayText = args.overlayText;
    if (typeof args.autoMontage === "boolean") videoEdit.autoMontage = args.autoMontage;
    emitEvent({
      type: "action",
      data: {
        action: "navigate",
        tab,
        ...(Object.keys(videoEdit).length ? { videoEdit } : {}),
      },
    });
    return { ok: true, navigatedTo: tab, appliedVideoEdit: Object.keys(videoEdit).length ? videoEdit : null };
  }

  if (name === "run_artcraft_mcp") {
    const mcpResult = await executeArtCraftMcpCommand({
      app: String(args.app || "designcraft"),
      instruction: String(args.instruction || ""),
      toolName: typeof args.toolName === "string" ? args.toolName : undefined,
      endpointUrl: typeof args.endpointUrl === "string" ? args.endpointUrl : undefined,
    });
    return mcpResult;
  }

  return { ok: false, error: `Unknown tool: ${name}` };
}

async function buildButlerSystemPrompt(): Promise<string> {
  const data = await loadJarvisData();
  const pinnedMemories = data.memories
    .slice(0, 12)
    .map((m) => `- [${m.category}] ${m.title}: ${m.content}`)
    .join("\n");
  const activeSkills = data.plugins
    .filter((p) => p.enabled && p.instructions)
    .map((p) => `- ${p.name}: ${p.instructions}`)
    .join("\n");
  const upcoming = data.calendar
    .slice(0, 5)
    .map((c) => `- ${c.title} at ${c.startISO}`)
    .join("\n");

  return `${data.persona.systemDirectives}
Address the user naturally as "${data.persona.userTitle}" occasionally. Wit level: ${data.persona.witLevel}.
When explaining metrics, trends, architectures, comparisons, or quantitative concepts, call render_live_visual so the user receives a live interactive chart or flowchart alongside your explanation.
When the user shares personal preferences, projects, people, or says "remember", call save_personal_memory or save_note.
When the user asks to schedule something, call schedule_calendar_event.
When the user provides a specific webpage URL to read or compare, call extract_url_insights.
When the user asks to open/switch tabs OR attaches video clips and asks to edit them, call navigate_and_act with tab="video" (or the matching tab) and the requested video edit parameters.
When the user asks to edit in Storytold ArtCraft apps (DesignCraft, PhotoCraft, VectorCraft, LightCraft), call run_artcraft_mcp.
Current date/time: ${new Date().toISOString()}

PERSONAL MEMORIES:
${pinnedMemories || "(None saved yet)"}

UPCOMING SCHEDULE:
${upcoming || "(No upcoming events)"}

ENABLED SKILLS:
${activeSkills || "(Standard built-in capabilities)"}`;
}

export async function runGeminiTurn(
  prompt: string,
  history: Array<{ role: string; content: string }>,
  modelId: string | undefined,
  emitEvent: (evt: Record<string, unknown>) => void,
  options: { rawMode?: boolean } = {},
): Promise<string> {
  const client = getClient();
  const data = await loadJarvisData();

  if (!options.rawMode && data.persona.proactiveMemory) {
    const auto = extractPersonalMemoriesFromTurn(prompt);
    if (auto.length > 0) {
      for (const m of auto) {
        const duplicate = data.memories.some((ex) => ex.content.toLowerCase() === m.content.toLowerCase());
        if (!duplicate) {
          data.memories.unshift({
            id: newId("mem"),
            ...m,
            pinned: false,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
          await saveJarvisData(data);
          emitEvent({ type: "data_sync", domain: "memories" });
        }
      }
    }
  }

  if (!client) {
    const msg =
      "Built-in Gemini environment key is unavailable in this shell. Select an OpenAI-compatible provider or add a key in Models & Bridge.";
    emitEvent({ type: "error", message: msg });
    return "";
  }

  const chosen =
    modelId && modelId.startsWith("gemini-") ? modelId : DEFAULT_GEMINI_MODEL;
  emitEvent({ type: "status", brain: "gemini-builtin", model: chosen });

  const systemInstruction = options.rawMode
    ? "You are an expert 3D WebGL, SVG, and HTML engineer."
    : await buildButlerSystemPrompt();

  const contents: Array<Record<string, unknown>> = history
    .slice(-16)
    .filter((m) => m.content && (m.role === "user" || m.role === "assistant"))
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  contents.push({ role: "user", parts: [{ text: prompt }] });

  const tools = options.rawMode
    ? undefined
    : [
        { googleSearch: {} },
        {
          functionDeclarations: [
            renderLiveVisualDecl,
            saveMemoryDecl,
            saveNoteDecl,
            scheduleEventDecl,
            controlHomeDecl,
            searchMediaDecl,
            autoDraftSkillDecl,
            extractUrlDecl,
            navigateAndActDecl,
            runArtCraftMcpDecl,
          ],
        },
      ];

  const config: Record<string, unknown> = {
    systemInstruction,
  };
  if (tools) {
    config.tools = tools;
    config.toolConfig = { includeServerSideToolInvocations: true };
  }

  let finalText = "";
  let currentContents = contents;

  for (let step = 0; step < 3; step += 1) {
    const response = await client.models.generateContent({
      model: chosen,
      contents: currentContents as never,
      config: config as never,
    });

    const candidateContent = response.candidates?.[0]?.content;
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks as
      | Array<{ web?: { uri?: string; title?: string } }>
      | undefined;
    if (chunks?.length) {
      const citations = chunks
        .filter((c) => c.web?.uri)
        .map((c) => ({ title: c.web?.title || c.web?.uri || "Source", uri: c.web?.uri || "" }))
        .slice(0, 6);
      if (citations.length > 0) {
        emitEvent({ type: "citations", citations });
      }
    }

    const calls = response.functionCalls;
    if (calls && calls.length > 0 && candidateContent) {
      const responseParts: Array<Record<string, unknown>> = [];
      for (const call of calls) {
        emitEvent({ type: "tool_call", tool: call.name });
        const result = await executeToolCall(
          call.name || "",
          (call.args || {}) as Record<string, unknown>,
          emitEvent,
        );
        responseParts.push({
          functionResponse: {
            id: call.id,
            name: call.name,
            response: result,
          },
        });
      }
      currentContents = [
        ...currentContents,
        candidateContent as unknown as Record<string, unknown>,
        { role: "user", parts: responseParts },
      ];
      continue;
    }

    finalText = response.text || "";
    break;
  }

  if (finalText) {
    emitEvent({ type: "token", content: finalText });
  }
  return finalText;
}

export async function analyzeScreenFrameWithGemini(
  imageBase64: string,
  mimeType: string,
  question: string,
): Promise<{ ok: boolean; description?: string; model?: string; error?: string }> {
  const client = getClient();
  if (!client) {
    return { ok: false, error: "Built-in Gemini vision key is unavailable." };
  }
  const cleanData = imageBase64.replace(/^data:[^;]+;base64,/, "");
  const response = await client.models.generateContent({
    model: DEFAULT_GEMINI_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { data: cleanData, mimeType: mimeType || "image/png" } },
          {
            text:
              question.trim() ||
              "Read what is on my screen right now, summarize key items concisely as JARVIS, and highlight any errors or actionable details.",
          },
        ],
      },
    ],
  });
  return {
    ok: true,
    description: response.text || "I scanned the frame, sir, though no readable text was detected.",
    model: DEFAULT_GEMINI_MODEL,
  };
}

export async function searchVideosWithGemini(
  query: string,
): Promise<Array<{ title: string; channel: string; url: string; embedUrl?: string; snippet: string }>> {
  const client = getClient();
  if (!client || !query.trim()) {
    return [];
  }
  try {
    const response = await client.models.generateContent({
      model: DEFAULT_GEMINI_MODEL,
      contents: `Find 5 real YouTube videos matching "${query}". Return concise titles and YouTube watch URLs.`,
      config: { tools: [{ googleSearch: {} }] },
    });
    const chunks = (response.candidates?.[0]?.groundingMetadata?.groundingChunks || []) as Array<{
      web?: { uri?: string; title?: string };
    }>;
    const ytLinks = chunks
      .filter((c) => c.web?.uri && /youtube\.com\/watch\?v=|youtu\.be\//i.test(c.web.uri))
      .map((c) => {
        const uri = c.web!.uri!;
        const idMatch = uri.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
        const videoId = idMatch?.[1];
        return {
          title: c.web?.title || query,
          channel: "YouTube",
          url: uri,
          embedUrl: videoId ? `https://www.youtube.com/embed/${videoId}` : undefined,
          snippet: response.text?.slice(0, 140) || "",
        };
      });
    return ytLinks.slice(0, 5);
  } catch {
    return [];
  }
}

export async function generateSpeechWavWithGemini(
  text: string,
  voiceName = "Charon",
  styleHint = "Speak clearly as a composed British butler narrator:",
): Promise<{ ok: boolean; audioBase64?: string; mimeType?: string; error?: string }> {
  const client = getClient();
  if (!client) {
    return { ok: false, error: "Built-in Gemini intelligence key is unavailable for voice synthesis." };
  }
  const cleanText = text.trim();
  if (!cleanText) {
    return { ok: false, error: "Narration text cannot be empty." };
  }
  try {
    const prompt = `${styleHint} ${cleanText}`;
    const response = await client.models.generateContent({
      model: TTS_GEMINI_MODEL,
      contents: prompt,
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      } as never,
    });
    const inline = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    if (!inline?.data) {
      return { ok: false, error: "TTS model returned no audio stream." };
    }
    return {
      ok: true,
      audioBase64: inline.data,
      mimeType: inline.mimeType || "audio/wav",
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function extractWebContextWithGemini(
  urlInput: string,
  question = "",
): Promise<{
  ok: boolean;
  url: string;
  summary: string;
  highlights: string[];
  visual?: Record<string, unknown>;
  citations: Array<{ title: string; uri: string }>;
  error?: string;
}> {
  const url = urlInput.trim();
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return {
      ok: false,
      url,
      summary: "",
      highlights: [],
      citations: [],
      error: "Please enter a valid http:// or https:// URL.",
    };
  }
  const client = getClient();
  if (!client) {
    return {
      ok: false,
      url,
      summary: "",
      highlights: [],
      citations: [],
      error: "Built-in Gemini intelligence key is unavailable.",
    };
  }

  try {
    const prompt = `Read the URL ${url} and extract structured insights.
${question.trim() ? `Focus on: ${question.trim()}` : "Summarize the core argument, key facts/numbers, and actionable takeaways cleanly as JARVIS."}
Return concise prose plus 4-6 bullet highlights.`;

    const response = await client.models.generateContent({
      model: DEFAULT_GEMINI_MODEL,
      contents: prompt,
      config: {
        tools: [{ urlContext: {} }, { googleSearch: {} }],
      } as never,
    });

    const summary = response.text || "Completed webpage inspection.";
    const highlights = summary
      .split(/\r?\n/)
      .map((line) => line.replace(/^[-*•\d.)\s]+/, "").trim())
      .filter((line) => line.length > 12)
      .slice(0, 6);

    const chunks = (response.candidates?.[0]?.groundingMetadata?.groundingChunks || []) as Array<{
      web?: { uri?: string; title?: string };
    }>;
    const citations = chunks
      .filter((c) => c.web?.uri)
      .map((c) => ({ title: c.web?.title || c.web?.uri || "Source", uri: c.web?.uri || "" }))
      .slice(0, 5);
    if (!citations.some((c) => c.uri === url)) {
      citations.unshift({ title: url.replace(/^https?:\/\//, "").slice(0, 48), uri: url });
    }

    const visual =
      highlights.length >= 2
        ? {
            id: newId("vis"),
            title: `Web Brief: ${url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]}`,
            subtitle: question.trim() || "Key Takeaways Breakdown",
            chartType: "flowchart",
            nodes: highlights.slice(0, 4).map((h, idx) => ({
              id: `n${idx + 1}`,
              label: h.slice(0, 42),
              detail: h.slice(0, 120),
            })),
            edges: highlights.slice(0, 3).map((_, idx) => ({
              from: `n${idx + 1}`,
              to: `n${idx + 2}`,
              label: "Next",
            })),
            createdAt: Date.now(),
          }
        : undefined;

    return { ok: true, url, summary, highlights, visual, citations };
  } catch (err) {
    return {
      ok: false,
      url,
      summary: "",
      highlights: [],
      citations: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runGeminiLiveBridge(ws: WebSocket): Promise<void> {
  const send = (payload: Record<string, unknown>) => {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(payload));
    }
  };

  const client = getClient();
  if (!client) {
    send({ type: "error", message: "Built-in Gemini intelligence key is unavailable for Live Call mode." });
    ws.close();
    return;
  }

  const systemInstruction = `${await buildButlerSystemPrompt()}
Keep spoken responses crisp, poised, and conversational (1-3 sentences per turn) unless asked to elaborate.`;

  let session: Awaited<ReturnType<typeof client.live.connect>> | null = null;
  let closed = false;

  try {
    session = await client.live.connect({
      model: LIVE_GEMINI_MODEL,
      config: {
        responseModalities: [Modality.AUDIO],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: "Charon" },
          },
        },
        systemInstruction,
      },
      callbacks: {
        onopen: () => {
          send({ type: "ready", model: LIVE_GEMINI_MODEL, voice: "Charon" });
        },
        onmessage: (message) => {
          if (closed) return;
          const sc = message.serverContent;
          if (!sc) return;

          if (sc.interrupted) {
            send({ type: "interrupted" });
          }
          if (sc.inputTranscription?.text) {
            send({ type: "input_transcript", text: sc.inputTranscription.text });
          }
          if (sc.outputTranscription?.text) {
            send({ type: "output_transcript", text: sc.outputTranscription.text });
          }
          const parts = sc.modelTurn?.parts || [];
          for (const part of parts) {
            if (part.inlineData?.data) {
              send({
                type: "audio",
                data: part.inlineData.data,
                mimeType: part.inlineData.mimeType || "audio/pcm;rate=24000",
              });
            }
          }
          if (sc.turnComplete) {
            send({ type: "turn_complete" });
          }
        },
        onerror: (err) => {
          send({ type: "error", message: err instanceof Error ? err.message : "Live voice stream error" });
        },
        onclose: () => {
          if (!closed) {
            send({ type: "closed" });
            ws.close();
          }
        },
      },
    });
  } catch (err) {
    send({ type: "error", message: err instanceof Error ? err.message : String(err) });
    ws.close();
    return;
  }

  ws.on("message", (raw) => {
    if (!session || closed) return;
    try {
      const msg = JSON.parse(String(raw)) as {
        type?: string;
        data?: string;
        mimeType?: string;
        text?: string;
      };
      if (msg.type === "audio" && msg.data) {
        session.sendRealtimeInput({
          audio: {
            data: msg.data,
            mimeType: msg.mimeType || "audio/pcm;rate=16000",
          },
        });
      } else if (msg.type === "video" && msg.data) {
        session.sendRealtimeInput({
          video: {
            data: msg.data,
            mimeType: msg.mimeType || "image/jpeg",
          },
        });
      } else if (msg.type === "text" && msg.text) {
        session.sendClientContent({
          turns: msg.text,
          turnComplete: true,
        });
      }
    } catch {
      /* ignore malformed frame */
    }
  });

  ws.on("close", () => {
    closed = true;
    try {
      session?.close();
    } catch {
      /* ignore */
    }
  });
}
