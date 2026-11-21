import type { VideoClip } from "@/lib/videoTimeline";
import { clampClipTrim } from "@/lib/videoTimeline";

export interface AudioAnalysisResult {
  duration: number;
  bpm: number;
  beats: number[];
  energyDrops: number[];
  waveform: number[];
}

/**
 * Pure DSP onset/beat & waveform analyzer on mono PCM float samples (-1..1).
 * Works cleanly in Node tests and in the browser after AudioContext decoding.
 */
export function analyzePcmForBeats(
  samples: Float32Array,
  sampleRate: number,
  waveformBins = 120,
): AudioAnalysisResult {
  if (!samples || samples.length === 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    return { duration: 0, bpm: 120, beats: [], energyDrops: [], waveform: [] };
  }

  const duration = Number((samples.length / sampleRate).toFixed(2));
  const safeBins = Math.max(16, Math.min(240, waveformBins));
  const binSize = Math.max(1, Math.floor(samples.length / safeBins));
  const waveform: number[] = [];
  let maxPeak = 0.0001;

  for (let b = 0; b < safeBins; b++) {
    const start = b * binSize;
    const end = Math.min(samples.length, start + binSize);
    let peak = 0;
    for (let i = start; i < end; i++) {
      const v = Math.abs(samples[i]);
      if (v > peak) peak = v;
    }
    if (peak > maxPeak) maxPeak = peak;
    waveform.push(peak);
  }
  const normalizedWaveform = waveform.map((v) => Number((v / maxPeak).toFixed(3)));

  // Energy envelope in ~23ms windows (43 fps resolution) for beat onset detection
  const hop = Math.max(256, Math.round(sampleRate / 43));
  const energies: number[] = [];
  for (let i = 0; i < samples.length; i += hop) {
    const end = Math.min(samples.length, i + hop);
    let sumSq = 0;
    for (let j = i; j < end; j++) {
      sumSq += samples[j] * samples[j];
    }
    energies.push(Math.sqrt(sumSq / Math.max(1, end - i)));
  }

  // Local average comparison for sharp percussive/beat peaks
  const beats: number[] = [];
  const energyDrops: number[] = [];
  const win = 8; // ~185ms neighborhood each side
  const minBeatGapSec = 0.28; // max ~214 BPM
  let lastBeatTime = -1;

  for (let idx = 1; idx < energies.length - 1; idx++) {
    const current = energies[idx];
    if (current < 0.03) continue;

    let localSum = 0;
    let count = 0;
    for (let k = Math.max(0, idx - win); k <= Math.min(energies.length - 1, idx + win); k++) {
      localSum += energies[k];
      count++;
    }
    const localAvg = localSum / Math.max(1, count);
    const isPeak = current >= energies[idx - 1] && current >= energies[idx + 1];
    const timeSec = Number(((idx * hop) / sampleRate).toFixed(2));

    if (isPeak && current > localAvg * 1.42 && timeSec - lastBeatTime >= minBeatGapSec) {
      beats.push(timeSec);
      lastBeatTime = timeSec;
      if (current > localAvg * 1.95) {
        energyDrops.push(timeSec);
      }
    }
  }

  // Estimate BPM from median inter-beat interval
  let bpm = 120;
  if (beats.length >= 3) {
    const intervals: number[] = [];
    for (let i = 1; i < beats.length; i++) {
      const dt = beats[i] - beats[i - 1];
      if (dt >= 0.25 && dt <= 1.5) intervals.push(dt);
    }
    if (intervals.length > 0) {
      intervals.sort((a, b) => a - b);
      const medianDt = intervals[Math.floor(intervals.length / 2)];
      let est = Math.round(60 / medianDt);
      while (est < 70) est *= 2;
      while (est > 180) est = Math.round(est / 2);
      bpm = est;
    }
  }

  return {
    duration,
    bpm,
    beats,
    energyDrops,
    waveform: normalizedWaveform,
  };
}

/**
 * Decodes an audio or video object/HTTP URL in the browser and extracts BPM, beat timestamps, and waveform bars.
 */
export async function analyzeMediaAudioUrl(srcUrl: string): Promise<AudioAnalysisResult> {
  if (!srcUrl || typeof window === "undefined") {
    return { duration: 0, bpm: 120, beats: [], energyDrops: [], waveform: [] };
  }
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) {
    return { duration: 0, bpm: 120, beats: [], energyDrops: [], waveform: [] };
  }

  const ctx = new AudioCtx();
  try {
    const resp = await fetch(srcUrl);
    const buf = await resp.arrayBuffer();
    const decoded = await ctx.decodeAudioData(buf.slice(0));
    // Downmix channels to mono
    const length = decoded.length;
    const mono = new Float32Array(length);
    const numCh = decoded.numberOfChannels;
    for (let ch = 0; ch < numCh; ch++) {
      const data = decoded.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        mono[i] += data[i] / numCh;
      }
    }
    return analyzePcmForBeats(mono, decoded.sampleRate, 140);
  } catch {
    return { duration: 0, bpm: 120, beats: [], energyDrops: [], waveform: [] };
  } finally {
    try {
      await ctx.close();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Snap clip durations cleanly onto detected music beat intervals so cuts land right on rhythm.
 */
export function alignClipsToBeats(
  clips: VideoClip[],
  beats: number[],
  fallbackBpm = 120,
): VideoClip[] {
  if (clips.length === 0) return clips;

  const beatIntervals: number[] = [];
  if (beats.length >= 2) {
    for (let i = 1; i < beats.length; i++) {
      const span = beats[i] - beats[i - 1];
      if (span >= 0.45 && span <= 4.0) beatIntervals.push(Number(span.toFixed(2)));
    }
  }
  const defaultBar = Number(((60 / Math.max(60, Math.min(180, fallbackBpm))) * 2).toFixed(2));

  return clips.map((clip, idx) => {
    const targetSpan = beatIntervals.length > 0
      ? Math.max(0.8, beatIntervals[idx % beatIntervals.length] * (beatIntervals[idx % beatIntervals.length] < 0.85 ? 2 : 1))
      : defaultBar;

    const maxAvailable = Math.max(0.5, clip.duration - clip.trimStart);
    const effectiveNeeded = Math.min(maxAvailable, Math.max(0.6, targetSpan * (clip.speed || 1)));
    const nextEnd = Math.min(clip.duration, Number((clip.trimStart + effectiveNeeded).toFixed(2)));
    const clamped = clampClipTrim(clip, clip.trimStart, nextEnd);
    return {
      ...clamped,
      transition: idx === 0 ? "fade" : "flash",
    };
  });
}
