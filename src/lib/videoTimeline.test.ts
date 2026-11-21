import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCssFilter,
  clampClipTrim,
  clipEffectiveDuration,
  computeKenBurnsTransform,
  createDefaultClip,
  formatTimecode,
  generateTimedCaptions,
  moveClip,
  resolveTimelineClipAt,
  splitClipAtSourceTime,
  totalTimelineDuration,
} from "./videoTimeline";

test("computes effective duration with trim and speed", () => {
  const clip = {
    ...createDefaultClip({ name: "Intro", src: "blob:test", duration: 10 }),
    trimStart: 2,
    trimEnd: 8,
    speed: 2,
  };
  assert.equal(clipEffectiveDuration(clip), 3);
  assert.equal(totalTimelineDuration([clip, clip]), 6);
});

test("resolveTimelineClipAt maps continuous timeline time across multiple clips", () => {
  const c1 = { ...createDefaultClip({ id: "c1", name: "Clip 1", src: "", duration: 4 }), trimEnd: 3 };
  const c2 = { ...createDefaultClip({ id: "c2", name: "Clip 2", src: "", duration: 6 }), trimStart: 1, trimEnd: 5, speed: 2 };
  // c1 takes 3s (0..3), c2 takes (5-1)/2 = 2s (3..5)
  const at1 = resolveTimelineClipAt([c1, c2], 1.5);
  assert.equal(at1.clipIndex, 0);
  assert.equal(at1.sourceTime, 1.5);

  const at4 = resolveTimelineClipAt([c1, c2], 4.0);
  assert.equal(at4.clipIndex, 1);
  assert.equal(at4.sourceTime, 3.0);
});

test("splits clip cleanly at source timestamp without dropping frames", () => {
  const clip = createDefaultClip({ id: "c1", name: "Scene", src: "blob:a", duration: 12 });
  const split = splitClipAtSourceTime([clip], "c1", 5);
  assert.equal(split.length, 2);
  assert.equal(split[0].trimEnd, 5);
  assert.equal(split[1].trimStart, 5);
  assert.equal(totalTimelineDuration(split), 12);
});

test("reorders clips, computes Ken Burns motion, and generates timed captions", () => {
  const a = createDefaultClip({ id: "a", name: "First", src: "blob:a", duration: 4 });
  const b = createDefaultClip({ id: "b", name: "Second", src: "blob:b", duration: 4 });
  const moved = moveClip([a, b], "b", -1);
  assert.deepEqual(
    moved.map((c) => c.id),
    ["b", "a"],
  );

  const zoom = computeKenBurnsTransform("zoom-in", 0.5);
  assert.equal(zoom.scale, 1.08);
  const pan = computeKenBurnsTransform("pan-left", 1);
  assert.equal(pan.translateXPercent, -4);

  const cues = generateTimedCaptions("Systems online. Telemetry nominal.", 4);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].start, 0);
  assert.equal(cues[1].end, 4);
});

test("clamps trim bounds and builds CSS filter strings", () => {
  const clip = createDefaultClip({ name: "Demo", src: "blob:b", duration: 6 });
  const clamped = clampClipTrim(clip, -2, 10);
  assert.equal(clamped.trimStart, 0);
  assert.equal(clamped.trimEnd, 6);
  const noir = buildCssFilter({ ...clip, filterPreset: "noir" });
  assert.ok(noir.includes("saturate(0%)"));
  assert.equal(formatTimecode(65.4), "01:05.4");
});
