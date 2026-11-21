import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyPromptTask,
  MODEL_BENCHMARK_CATALOG,
  selectOptimalModel,
} from "./modelRouter";

test("classifyPromptTask routes coding, research, vision, and butler turns accurately", () => {
  const code = classifyPromptTask("Refactor server.ts and fix the TypeScript traceback across files");
  assert.equal(code.task, "heavy_coding");
  assert.equal(code.suggestedEffort, "HIGH");

  const research = classifyPromptTask("Write a comprehensive multi-page essay and MCQ quiz on thermodynamics");
  assert.equal(research.task, "deep_research");
  assert.equal(research.suggestedEffort, "HIGH");

  const vision = classifyPromptTask("What error is on my screen?", { hasImages: true });
  assert.equal(vision.task, "multimodal_vision");

  const butler = classifyPromptTask("What time is my 3pm meeting?");
  assert.equal(butler.task, "butler_chat");
  assert.equal(butler.suggestedEffort, "LOW");
});

test("selectOptimalModel picks top coder for heavy_coding and fastest tier for butler_chat", () => {
  const configured = new Set(["gemini-builtin", "anthropic", "groq"]);

  const heavy = selectOptimalModel("heavy_coding", configured, { autoMode: true });
  assert.equal(heavy.providerSlug, "anthropic");
  assert.equal(heavy.modelId, "claude-opus-4-1");

  const voice = selectOptimalModel("voice_turn", configured, { autoMode: true });
  assert.equal(voice.providerSlug, "groq");
  assert.equal(voice.modelId, "llama-3.3-70b-versatile");
});

test("selectOptimalModel honors per-task override and falls back cleanly without keys", () => {
  const configured = new Set(["gemini-builtin", "deepseek"]);
  const overridden = selectOptimalModel("heavy_coding", configured, {
    autoMode: true,
    taskOverrides: {
      heavy_coding: { providerSlug: "deepseek", modelId: "deepseek-r1" },
    },
  });
  assert.equal(overridden.providerSlug, "deepseek");
  assert.equal(overridden.modelId, "deepseek-r1");

  const keyFreeFallback = selectOptimalModel("butler_chat", new Set(), { autoMode: true });
  assert.equal(keyFreeFallback.providerSlug, "gemini-builtin");
  assert.equal(keyFreeFallback.usedFallback, true);
  assert.ok(MODEL_BENCHMARK_CATALOG.length >= 12);
});
