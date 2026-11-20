import test from "node:test";
import assert from "node:assert/strict";
import {
  computeManifestSha,
  draftSkillFromWorkflow,
  normalizeGitHubRawUrl,
  parseAnyExtensionManifest,
  parsePluginYamlManifest,
  parseSkillMarkdown,
  runPluginDoctor,
} from "./pluginAdapter";

test("parses upstream plugin.yaml, preserves unknown fields, and computes pinned SHA", () => {
  const yamlInput = `
name: claude-subscription-directsdk
version: 1.2.0
description: Route model turns through a local subscription CLI bridge
provides_tools:
  - direct_chat
provides_hooks:
  - on_turn_start
auth_mode: local_cli
future_schema_v3_flag: true
custom_capabilities:
  - streaming_v2
`;
  const plugin = parsePluginYamlManifest(yamlInput, {
    upstreamUrl: "https://github.com/NousResearch/hermes-official-plugins",
  });
  assert.equal(plugin.id, "claude-subscription-directsdk");
  assert.equal(plugin.requiresBridge, true);
  assert.deepEqual(plugin.providesTools, ["direct_chat"]);
  assert.equal(plugin.extraSchema.future_schema_v3_flag, true);
  assert.equal(plugin.pinnedSha, computeManifestSha(yamlInput));
  assert.ok(plugin.pinnedSha && plugin.pinnedSha.length >= 8);
});

test("parses SKILL.md frontmatter and body", () => {
  const md = `---
name: Weekly Briefing
description: Summarize upcoming calendar and notes every Monday
triggers:
  - weekly brief
tools:
  - calendar
  - notes
---

# Weekly Briefing
Gather all upcoming tasks and present an executive summary.
`;
  const skill = parseAnyExtensionManifest(md, { filenameHint: "SKILL.md" });
  assert.equal(skill.sourceKind, "skill_md");
  assert.equal(skill.name, "Weekly Briefing");
  assert.deepEqual(skill.triggers, ["weekly brief"]);
  assert.ok(skill.instructions.includes("executive summary"));
});

test("normalizes GitHub blob and tree URLs to raw URLs", () => {
  assert.equal(
    normalizeGitHubRawUrl("https://github.com/NousResearch/hermes-official-plugins/blob/main/plugins/foo/plugin.yaml"),
    "https://raw.githubusercontent.com/NousResearch/hermes-official-plugins/main/plugins/foo/plugin.yaml",
  );
  assert.equal(
    normalizeGitHubRawUrl("https://github.com/NousResearch/hermes-official-plugins/tree/main/plugins/foo"),
    "https://raw.githubusercontent.com/NousResearch/hermes-official-plugins/main/plugins/foo/plugin.yaml",
  );
});

test("auto-drafts skill from workflow steps and runs Plugin Doctor diagnostics", () => {
  const drafted = draftSkillFromWorkflow("Evening Wind Down", [
    "Dim living room lights to 20%",
    "Check tomorrow's morning calendar events",
    "Summarize uncompleted notes",
  ]);
  assert.equal(drafted.autoDrafted, true);
  assert.ok(drafted.pinnedSha);
  assert.ok(drafted.instructions.includes("1. Dim living room lights"));

  const yamlPlugin = parsePluginYamlManifest(`
name: bridge-runner
version: 1.0.0
requires_bridge: true
instructions: Test bridge
`);
  const report = runPluginDoctor([drafted, yamlPlugin], false);
  assert.equal(report.total, 2);
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((i) => i.pluginId === "bridge-runner" && i.severity === "warn"));

  const cleanReport = runPluginDoctor([drafted, yamlPlugin], true);
  assert.equal(cleanReport.ok, true);
});

test("rejects malformed empty skill markdown cleanly", () => {
  assert.throws(() => parseSkillMarkdown("   "), /cannot be empty/);
});
