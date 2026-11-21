import test from "node:test";
import assert from "node:assert/strict";
import { alignClipsToBeats, analyzePcmForBeats } from "./audioBeatAnalyzer";
import { createDefaultClip } from "./videoTimeline";

test("analyzePcmForBeats detects synthetic 120 BPM beat impulses and generates waveform", () => {
  const sampleRate = 16000;
  const durationSec = 4;
  const samples = new Float32Array(sampleRate * durationSec);

  // Place crisp beat impulses every 0.50s (= 120 BPM)
  for (let beatIdx = 0; beatIdx < 8; beatIdx++) {
    const center = Math.round((beatIdx * 0.5 + 0.25) * sampleRate);
    for (let k = 0; k < 400 && center + k < samples.length; k++) {
      samples[center + k] = 0.9 * Math.sin((k / 400) * Math.PI);
    }
  }

  const res = analyzePcmForBeats(samples, sampleRate, 64);
  assert.equal(res.duration, 4);
  assert.equal(res.waveform.length, 64);
  assert.ok(res.beats.length >= 6, `expected >= 6 beats, got ${res.beats.length}`);
  assert.ok(res.bpm >= 112 && res.bpm <= 128, `expected ~120 BPM, got ${res.bpm}`);
});

test("alignClipsToBeats snaps clip cut spans cleanly to beat intervals", () => {
  const c1 = createDefaultClip({ id: "c1", name: "a.mp4", src: "", duration: 6 });
  const c2 = createDefaultClip({ id: "c2", name: "b.mp4", src: "", duration: 6 });
  const aligned = alignClipsToBeats([c1, c2], [0.5, 1.8, 3.1], 120);
  assert.equal(aligned.length, 2);
  assert.ok(aligned[0].trimEnd <= 1.5);
  assert.equal(aligned[0].transition, "fade");
  assert.equal(aligned[1].transition, "flash");
});
