import test from "node:test";
import assert from "node:assert/strict";
import { detectNaturalNavigationIntent, extractVideoEditDirective } from "./autoNavigator";

test("detects video studio navigation when clips are attached", () => {
  const intent = detectNaturalNavigationIntent("make a fast montage", true);
  assert.equal(intent.tab, "video");
  assert.equal(intent.videoEdit?.speed, 1.5);
  assert.equal(intent.videoEdit?.motionPreset, "zoom-in");
});

test("detects video edit intent without attachments", () => {
  const intent = detectNaturalNavigationIntent(
    "take me to the video editing studio and apply noir filter with title 'Night Run'",
  );
  assert.equal(intent.tab, "video");
  assert.equal(intent.videoEdit?.filterPreset, "noir");
  assert.equal(intent.videoEdit?.overlayText, "Night Run");
});

test("detects ArtCraft MCP app family", () => {
  const intent = detectNaturalNavigationIntent("Ask LightCraft via MCP to warm up the rim light");
  assert.equal(intent.artCraftApp, "lightcraft");
});

test("extractVideoEditDirective ignores unrelated chat", () => {
  assert.equal(extractVideoEditDirective("what is the weather tomorrow?"), undefined);
});
