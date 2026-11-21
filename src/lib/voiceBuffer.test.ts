import test from "node:test";
import assert from "node:assert/strict";
import {
  FINISH_MS,
  VoiceUtteranceBuffer,
  isImmediateBargeIn,
  isMuteFlagActive,
} from "./voiceBuffer.ts";

test("FINISH_MS is locked at 900ms", () => {
  assert.equal(FINISH_MS, 900);
});

test("VoiceUtteranceBuffer combines paused chunks into one utterance after finishMs", async () => {
  const sent: string[] = [];
  const buf = new VoiceUtteranceBuffer({
    finishMs: 40,
    onDispatch: (text) => sent.push(text),
  });

  buf.push("Build a quadcopter", true);
  await new Promise((r) => setTimeout(r, 15));
  buf.push("with rose gold rotors", true);

  assert.equal(sent.length, 0);
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(sent, ["Build a quadcopter with rose gold rotors"]);
});

test("VoiceUtteranceBuffer fires stop/wait immediately and clears queue", () => {
  const sent: string[] = [];
  const barges: string[] = [];
  const buf = new VoiceUtteranceBuffer({
    finishMs: 200,
    onDispatch: (text) => sent.push(text),
    onBargeIn: (cmd) => barges.push(cmd),
  });

  buf.push("Start describing orbital mechanics", true);
  buf.push("wait", true);

  assert.equal(sent.length, 0);
  assert.deepEqual(barges, ["wait"]);
  assert.equal(buf.pendingText(), "");
  assert.equal(isImmediateBargeIn("Stop!"), true);
});

test("isMuteFlagActive detects ?mute=1 cleanly", () => {
  assert.equal(isMuteFlagActive("?mute=1"), true);
  assert.equal(isMuteFlagActive("?foo=bar&mute=true"), true);
  assert.equal(isMuteFlagActive("?mute=0"), false);
  assert.equal(isMuteFlagActive(""), false);
});
