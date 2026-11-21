export type TaskTier =
  | "butler_chat"
  | "voice_turn"
  | "memory_extract"
  | "heavy_coding"
  | "deep_research"
  | "multimodal_vision";

export type ReasoningEffort = "LOW" | "MEDIUM" | "HIGH";
export type CostTier = "free" | "low" | "medium" | "high";

export interface ModelBenchmarkEntry {
  id: string;
  label: string;
  providerSlug: string;
  providerLabel: string;
  keyFree: boolean;
  localOnly: boolean;
  sweBench: number;
  liveCodeBench: number;
  speedTps: number;
  contextTokens: number;
  costTier: CostTier;
  vision: boolean;
  toolPrecision: number;
  strengths: string[];
  recommendedTasks: TaskTier[];
}

export const TASK_LABELS: Record<TaskTier, string> = {
  butler_chat: "Butler Chat",
  voice_turn: "Live Voice",
  memory_extract: "Memory & Triage",
  heavy_coding: "Heavy Coding",
  deep_research: "Deep Research",
  multimodal_vision: "Screen & Vision",
};

export const MODEL_BENCHMARK_CATALOG: ModelBenchmarkEntry[] = [
  {
    id: "gemini-4-hydrogen",
    label: "Gemini 4 Hydrogen",
    providerSlug: "gemini-builtin",
    providerLabel: "Built-In Core",
    keyFree: true,
    localOnly: false,
    sweBench: 76.4,
    liveCodeBench: 78.2,
    speedTps: 195,
    contextTokens: 1_000_000,
    costTier: "free",
    vision: true,
    toolPrecision: 92,
    strengths: ["Zero API key needed", "1M context", "Fast butler turns", "Web Search & Vision"],
    recommendedTasks: ["butler_chat", "voice_turn", "multimodal_vision"],
  },
  {
    id: "gemini-3.1-flash-lite",
    label: "Gemini 3.1 Flash Lite",
    providerSlug: "gemini-builtin",
    providerLabel: "Built-In Core",
    keyFree: true,
    localOnly: false,
    sweBench: 61.5,
    liveCodeBench: 64.0,
    speedTps: 290,
    contextTokens: 1_000_000,
    costTier: "free",
    vision: true,
    toolPrecision: 84,
    strengths: ["Ultra-low latency", "Zero key", "Background memory & triage"],
    recommendedTasks: ["memory_extract", "voice_turn", "butler_chat"],
  },
  {
    id: "gemini-4-neon",
    label: "Gemini 4 Neon",
    providerSlug: "gemini-builtin",
    providerLabel: "Built-In Core",
    keyFree: false,
    localOnly: false,
    sweBench: 83.2,
    liveCodeBench: 86.5,
    speedTps: 112,
    contextTokens: 2_000_000,
    costTier: "medium",
    vision: true,
    toolPrecision: 95,
    strengths: ["2M repo context", "Strong deep research", "Multimodal diagram reasoning"],
    recommendedTasks: ["deep_research", "multimodal_vision", "heavy_coding"],
  },
  {
    id: "claude-opus-4-1",
    label: "Claude Opus 4.1",
    providerSlug: "anthropic",
    providerLabel: "Anthropic",
    keyFree: false,
    localOnly: false,
    sweBench: 88.6,
    liveCodeBench: 84.1,
    speedTps: 54,
    contextTokens: 200_000,
    costTier: "high",
    vision: true,
    toolPrecision: 97,
    strengths: ["Top SWE-bench multi-file refactor", "Long-form essays", "Precise diff adherence"],
    recommendedTasks: ["heavy_coding", "deep_research"],
  },
  {
    id: "claude-sonnet-4-5",
    label: "Claude Sonnet 4.5",
    providerSlug: "anthropic",
    providerLabel: "Anthropic",
    keyFree: false,
    localOnly: false,
    sweBench: 86.4,
    liveCodeBench: 81.8,
    speedTps: 88,
    contextTokens: 200_000,
    costTier: "medium",
    vision: true,
    toolPrecision: 96,
    strengths: ["Best daily coding speed/quality ratio", "Accurate tool use", "Clean prose"],
    recommendedTasks: ["heavy_coding", "deep_research", "multimodal_vision"],
  },
  {
    id: "claude-haiku-3-5",
    label: "Claude Haiku 3.5",
    providerSlug: "anthropic",
    providerLabel: "Anthropic",
    keyFree: false,
    localOnly: false,
    sweBench: 69.2,
    liveCodeBench: 66.5,
    speedTps: 185,
    contextTokens: 200_000,
    costTier: "low",
    vision: true,
    toolPrecision: 89,
    strengths: ["Snappy Butler tone", "Low cost", "Fast tool dispatch"],
    recommendedTasks: ["butler_chat", "memory_extract"],
  },
  {
    id: "gpt-5.2-codex",
    label: "OpenAI GPT-5.2 Codex",
    providerSlug: "openai",
    providerLabel: "OpenAI",
    keyFree: false,
    localOnly: false,
    sweBench: 87.9,
    liveCodeBench: 88.4,
    speedTps: 76,
    contextTokens: 256_000,
    costTier: "high",
    vision: true,
    toolPrecision: 96,
    strengths: ["Terminal debugging mastery", "Algorithmic synthesis", "Architecture planning"],
    recommendedTasks: ["heavy_coding", "deep_research"],
  },
  {
    id: "gpt-4o-mini",
    label: "OpenAI GPT-4o Mini",
    providerSlug: "openai",
    providerLabel: "OpenAI",
    keyFree: false,
    localOnly: false,
    sweBench: 63.0,
    liveCodeBench: 65.1,
    speedTps: 205,
    contextTokens: 128_000,
    costTier: "low",
    vision: true,
    toolPrecision: 87,
    strengths: ["Consistent JSON & function calls", "Budget Butler routing"],
    recommendedTasks: ["butler_chat", "memory_extract"],
  },
  {
    id: "deepseek-r1",
    label: "DeepSeek R1",
    providerSlug: "deepseek",
    providerLabel: "DeepSeek",
    keyFree: false,
    localOnly: false,
    sweBench: 80.5,
    liveCodeBench: 86.0,
    speedTps: 68,
    contextTokens: 128_000,
    costTier: "low",
    vision: false,
    toolPrecision: 88,
    strengths: ["High LiveCodeBench math/algorithms", "Ultra low frontier cost"],
    recommendedTasks: ["deep_research", "heavy_coding"],
  },
  {
    id: "deepseek-chat",
    label: "DeepSeek V3 Chat",
    providerSlug: "deepseek",
    providerLabel: "DeepSeek",
    keyFree: false,
    localOnly: false,
    sweBench: 77.2,
    liveCodeBench: 79.5,
    speedTps: 105,
    contextTokens: 128_000,
    costTier: "low",
    vision: false,
    toolPrecision: 89,
    strengths: ["High coding throughput per dollar", "Crisp technical answers"],
    recommendedTasks: ["heavy_coding", "butler_chat"],
  },
  {
    id: "llama-3.3-70b-versatile",
    label: "Llama 3.3 70B (Groq LPU)",
    providerSlug: "groq",
    providerLabel: "Groq",
    keyFree: false,
    localOnly: false,
    sweBench: 67.8,
    liveCodeBench: 68.4,
    speedTps: 310,
    contextTokens: 128_000,
    costTier: "low",
    vision: false,
    toolPrecision: 86,
    strengths: ["Sub-second voice latency", "310+ TPS throughput"],
    recommendedTasks: ["voice_turn", "butler_chat", "memory_extract"],
  },
  {
    id: "codestral-latest",
    label: "Mistral Codestral",
    providerSlug: "mistral",
    providerLabel: "Mistral AI",
    keyFree: false,
    localOnly: false,
    sweBench: 74.1,
    liveCodeBench: 75.8,
    speedTps: 145,
    contextTokens: 256_000,
    costTier: "low",
    vision: false,
    toolPrecision: 88,
    strengths: ["256k code fill & repo edits", "Fast incremental patches"],
    recommendedTasks: ["heavy_coding"],
  },
  {
    id: "grok-3",
    label: "xAI Grok 3",
    providerSlug: "xai",
    providerLabel: "xAI",
    keyFree: false,
    localOnly: false,
    sweBench: 79.4,
    liveCodeBench: 82.9,
    speedTps: 92,
    contextTokens: 131_072,
    costTier: "medium",
    vision: true,
    toolPrecision: 90,
    strengths: ["Strong general STEM", "Direct conversational voice"],
    recommendedTasks: ["deep_research", "heavy_coding"],
  },
  {
    id: "qwen2.5-coder:32b",
    label: "Qwen 2.5 Coder 32B (Local)",
    providerSlug: "ollama",
    providerLabel: "Local Ollama / LM Studio",
    keyFree: true,
    localOnly: true,
    sweBench: 71.2,
    liveCodeBench: 73.4,
    speedTps: 48,
    contextTokens: 32_768,
    costTier: "free",
    vision: false,
    toolPrecision: 83,
    strengths: ["100% offline & private", "Zero cloud telemetry", "Local coding fallback"],
    recommendedTasks: ["heavy_coding", "butler_chat"],
  },
  {
    id: "llama3.2:latest",
    label: "Llama 3.2 Local (Ollama)",
    providerSlug: "ollama",
    providerLabel: "Local Ollama / LM Studio",
    keyFree: true,
    localOnly: true,
    sweBench: 52.0,
    liveCodeBench: 50.4,
    speedTps: 95,
    contextTokens: 128_000,
    costTier: "free",
    vision: false,
    toolPrecision: 76,
    strengths: ["Instant offline butler", "Private note & schedule triage"],
    recommendedTasks: ["butler_chat", "memory_extract"],
  },
];

const HEAVY_CODE_RE =
  /\b(refactor|traceback|stack\s*trace|compile|typescript|eslint|architect|debug|patch|multi-?file|migration|unit\s*test|algorithm|regex|sql|database|server\.ts|build\s+error|fix\s+the\s+bug|implement\s+a)\b/i;
const DEEP_RESEARCH_RE =
  /\b(essay|multi-?page|comprehensive|deep\s+dive|compare|benchmark|research|quiz|mcq|multiple\s+choice|flowchart|mermaid|study\s+guide|breakdown|analyze\s+in\s+detail|step-?by-?step)\b/i;
const MEMORY_EXTRACT_RE =
  /\b(summarize|summary|triage|digest|extract|checklist|remember\s+that|save\s+note|bullet\s+points)\b/i;

export function classifyPromptTask(
  prompt: string,
  options?: {
    hasImages?: boolean;
    isVoice?: boolean;
    responseMode?: "butler" | "deep";
  },
): { task: TaskTier; reason: string; suggestedEffort: ReasoningEffort } {
  const clean = (prompt || "").trim();

  if (options?.hasImages) {
    return {
      task: "multimodal_vision",
      reason: "Visual media or screenshot attached — routing to multimodal vision model.",
      suggestedEffort: "MEDIUM",
    };
  }
  if (options?.isVoice && !HEAVY_CODE_RE.test(clean) && !DEEP_RESEARCH_RE.test(clean)) {
    return {
      task: "voice_turn",
      reason: "Live spoken turn — prioritizing sub-second conversational latency.",
      suggestedEffort: "LOW",
    };
  }
  if (HEAVY_CODE_RE.test(clean) || (clean.includes("```") && clean.length > 180)) {
    return {
      task: "heavy_coding",
      reason: "Detected engineering / debugging / multi-file implementation task.",
      suggestedEffort: "HIGH",
    };
  }
  if (DEEP_RESEARCH_RE.test(clean) || options?.responseMode === "deep" || clean.length > 420) {
    return {
      task: "deep_research",
      reason: "Long-form synthesis, study quiz, or Deep Agent mode requested.",
      suggestedEffort: "HIGH",
    };
  }
  if (MEMORY_EXTRACT_RE.test(clean)) {
    return {
      task: "memory_extract",
      reason: "Extraction / summarization / triage task.",
      suggestedEffort: "LOW",
    };
  }
  return {
    task: "butler_chat",
    reason: "Quick conversational Butler turn — selecting fastest crisp responder.",
    suggestedEffort: "LOW",
  };
}

function scoreModelForTask(model: ModelBenchmarkEntry, task: TaskTier): number {
  const costBonus = model.costTier === "free" ? 8 : model.costTier === "low" ? 4 : model.costTier === "medium" ? 1 : -2;
  switch (task) {
    case "heavy_coding":
      return model.sweBench * 0.55 + model.liveCodeBench * 0.3 + model.toolPrecision * 0.15 + (model.recommendedTasks.includes("heavy_coding") ? 5 : 0);
    case "deep_research":
      return (
        model.liveCodeBench * 0.35 +
        model.sweBench * 0.25 +
        model.toolPrecision * 0.2 +
        Math.min(20, Math.log10(Math.max(10_000, model.contextTokens)) * 3) +
        (model.recommendedTasks.includes("deep_research") ? 4 : 0)
      );
    case "multimodal_vision":
      if (!model.vision) return -999;
      return model.toolPrecision * 0.5 + model.sweBench * 0.3 + Math.min(20, model.speedTps / 15);
    case "voice_turn":
      return model.speedTps * 0.45 + model.toolPrecision * 0.3 + costBonus * 2;
    case "memory_extract":
      return model.speedTps * 0.4 + model.toolPrecision * 0.25 + costBonus * 3;
    case "butler_chat":
    default:
      return model.speedTps * 0.38 + model.toolPrecision * 0.35 + costBonus * 2.5;
  }
}

export interface RouteDecision {
  task: TaskTier;
  modelId: string;
  modelLabel: string;
  providerSlug: string;
  providerLabel: string;
  reason: string;
  suggestedEffort: ReasoningEffort;
  usedFallback: boolean;
}

export function selectOptimalModel(
  task: TaskTier,
  configuredProviders: Set<string>,
  options?: {
    autoMode?: boolean;
    taskOverrides?: Partial<Record<TaskTier, { providerSlug: string; modelId: string }>>;
    preferredProvider?: string;
    preferredModelId?: string;
    reason?: string;
    suggestedEffort?: ReasoningEffort;
  },
): RouteDecision {
  const autoMode = options?.autoMode ?? true;
  const effort = options?.suggestedEffort ?? (task === "heavy_coding" || task === "deep_research" ? "HIGH" : "LOW");

  // 1. Explicit per-task user override when configured
  const override = options?.taskOverrides?.[task];
  if (override && override.providerSlug && override.modelId) {
    const providerAvailable =
      configuredProviders.has(override.providerSlug) || override.providerSlug.startsWith("custom:");
    if (providerAvailable) {
      const bench = MODEL_BENCHMARK_CATALOG.find((m) => m.id === override.modelId);
      return {
        task,
        modelId: override.modelId,
        modelLabel: bench?.label || override.modelId,
        providerSlug: override.providerSlug,
        providerLabel: bench?.providerLabel || override.providerSlug,
        reason: `Per-task override active for ${TASK_LABELS[task]}.`,
        suggestedEffort: effort,
        usedFallback: false,
      };
    }
  }

  // 2. Manual lock when Auto-Mode is disabled
  if (!autoMode && options?.preferredProvider) {
    const prov = options.preferredProvider;
    const mod = options.preferredModelId || MODEL_BENCHMARK_CATALOG.find((m) => m.providerSlug === prov)?.id || "gemini-4-hydrogen";
    const bench = MODEL_BENCHMARK_CATALOG.find((m) => m.id === mod);
    return {
      task,
      modelId: mod,
      modelLabel: bench?.label || mod,
      providerSlug: prov,
      providerLabel: bench?.providerLabel || prov,
      reason: "Manual model lock (Smart Auto-Mode paused).",
      suggestedEffort: effort,
      usedFallback: false,
    };
  }

  // 3. Auto-mode scoring across configured providers
  const candidates = MODEL_BENCHMARK_CATALOG.filter((m) => {
    if (m.providerSlug === "ollama") return configuredProviders.has("ollama") || configuredProviders.has("custom:local-ollama");
    return configuredProviders.has(m.providerSlug);
  });

  if (candidates.length > 0) {
    const ranked = [...candidates].sort((a, b) => scoreModelForTask(b, task) - scoreModelForTask(a, task));
    const winner = ranked[0];
    if (scoreModelForTask(winner, task) > 0) {
      return {
        task,
        modelId: winner.id,
        modelLabel: winner.label,
        providerSlug: winner.providerSlug === "ollama" && configuredProviders.has("custom:local-ollama")
          ? "custom:local-ollama"
          : winner.providerSlug,
        providerLabel: winner.providerLabel,
        reason: options?.reason || `Auto-selected top ranked model for ${TASK_LABELS[task]}.`,
        suggestedEffort: effort,
        usedFallback: false,
      };
    }
  }

  // 4. Custom or configured fallback provider
  for (const slug of configuredProviders) {
    if (slug.startsWith("custom:") || slug === "openrouter" || slug === "nvidia") {
      return {
        task,
        modelId: options?.preferredModelId || "auto",
        modelLabel: options?.preferredModelId || `${slug} active model`,
        providerSlug: slug,
        providerLabel: slug,
        reason: "Routing through configured OpenAI-compatible endpoint.",
        suggestedEffort: effort,
        usedFallback: true,
      };
    }
  }

  // 5. Key-optional built-in Gemini fallback
  const fallbackModel = task === "memory_extract" ? "gemini-3.1-flash-lite" : "gemini-4-hydrogen";
  return {
    task,
    modelId: fallbackModel,
    modelLabel: fallbackModel === "gemini-3.1-flash-lite" ? "Gemini 3.1 Flash Lite" : "Gemini 4 Hydrogen",
    providerSlug: "gemini-builtin",
    providerLabel: "Built-In Core",
    reason: "Using zero-key Built-In Core fallback (add any provider key to unlock frontier coding comparison).",
    suggestedEffort: effort,
    usedFallback: true,
  };
}
