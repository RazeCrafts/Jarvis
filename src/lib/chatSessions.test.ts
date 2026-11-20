import test from "node:test";
import assert from "node:assert/strict";
import {
  createChatSession,
  deriveSessionTitle,
  isDefaultSessionTitle,
  sanitizeSessions,
} from "./chatSessions";

test("deriveSessionTitle truncates long prompts cleanly", () => {
  const short = deriveSessionTitle("Edit my drone video");
  assert.equal(short, "Edit my drone video");
  const long = deriveSessionTitle("Please analyze the telemetry chart and switch to Workshop for a satellite model");
  assert.ok(long.length <= 36);
  assert.ok(long.endsWith("…"));
});

test("isDefaultSessionTitle matches default titles only", () => {
  assert.equal(isDefaultSessionTitle("Command Session"), true);
  assert.equal(isDefaultSessionTitle("Command Session 2"), true);
  assert.equal(isDefaultSessionTitle("New Session 3"), true);
  assert.equal(isDefaultSessionTitle("Video Edit Draft"), false);
});

test("sanitizeSessions migrates legacy flat messages into initial session", () => {
  const migrated = sanitizeSessions(undefined, [
    { id: "m1", role: "user", content: "Build a 3D orbital station", createdAt: 1000, streaming: true },
    { id: "m2", role: "assistant", content: "On the bench, sir.", createdAt: 2000, streaming: false },
  ]);
  assert.equal(migrated.sessions.length, 1);
  assert.equal(migrated.sessions[0].messages.length, 2);
  assert.equal(migrated.sessions[0].messages[0].streaming, false);
  assert.equal(migrated.sessions[0].title, "Build a 3D orbital station");
});

test("createChatSession creates independent empty thread", () => {
  const s1 = createChatSession("Session A", "a");
  const s2 = createChatSession("Session B", "b");
  assert.notEqual(s1.id, s2.id);
  assert.deepEqual(s1.messages, []);
  assert.equal(s2.title, "Session B");
});
