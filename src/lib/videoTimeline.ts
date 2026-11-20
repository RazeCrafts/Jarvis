export type MotionPreset = "none" | "zoom-in" | "zoom-out" | "pan-left" | "pan-right";

export interface VideoClip {
  id: string;
  name: string;
  src: string;
  duration: number;
  trimStart: number;
  trimEnd: number;
  speed: number;
  filterPreset: "none" | "cinematic" | "noir" | "vivid" | "warm" | "cool";
  motionPreset?: MotionPreset;
  brightness: number;
  contrast: number;
  saturate: number;
  overlayText: string;
  volume: number;
}

export interface TimedCaptionCue {
  id: string;
  start: number;
  end: number;
  text: string;
}

export function createDefaultClip(partial: {
  id?: string;
  name: string;
  src: string;
  duration: number;
}): VideoClip {
  const safeDuration = Math.max(0.5, Number.isFinite(partial.duration) ? partial.duration : 5);
  return {
    id: partial.id || Math.random().toString(36).slice(2, 10),
    name: partial.name,
    src: partial.src,
    duration: safeDuration,
    trimStart: 0,
    trimEnd: safeDuration,
    speed: 1,
    filterPreset: "none",
    motionPreset: "none",
    brightness: 100,
    contrast: 100,
    saturate: 100,
    overlayText: "",
    volume: 1,
  };
}

export function clipEffectiveDuration(clip: VideoClip): number {
  const span = Math.max(0.1, clip.trimEnd - clip.trimStart);
  const speed = Math.max(0.25, Math.min(4, clip.speed || 1));
  return span / speed;
}

export function totalTimelineDuration(clips: VideoClip[]): number {
  return clips.reduce((sum, c) => sum + clipEffectiveDuration(c), 0);
}

export function clampClipTrim(clip: VideoClip, nextStart: number, nextEnd: number): VideoClip {
  const minSpan = 0.25;
  const start = Math.max(0, Math.min(nextStart, clip.duration - minSpan));
  const end = Math.min(clip.duration, Math.max(nextEnd, start + minSpan));
  return {
    ...clip,
    trimStart: Number(start.toFixed(2)),
    trimEnd: Number(end.toFixed(2)),
  };
}

export function splitClipAtSourceTime(clips: VideoClip[], clipId: string, sourceTime: number): VideoClip[] {
  const index = clips.findIndex((c) => c.id === clipId);
  if (index === -1) return clips;
  const target = clips[index];
  if (sourceTime <= target.trimStart + 0.2 || sourceTime >= target.trimEnd - 0.2) {
    return clips;
  }

  const splitPoint = Number(sourceTime.toFixed(2));
  const firstHalf: VideoClip = {
    ...target,
    trimEnd: splitPoint,
  };
  const secondHalf: VideoClip = {
    ...target,
    id: `${target.id}-b-${Math.random().toString(36).slice(2, 6)}`,
    name: `${target.name} (Part 2)`,
    trimStart: splitPoint,
  };

  return [...clips.slice(0, index), firstHalf, secondHalf, ...clips.slice(index + 1)];
}

export function moveClip(clips: VideoClip[], clipId: string, direction: -1 | 1): VideoClip[] {
  const index = clips.findIndex((c) => c.id === clipId);
  if (index === -1) return clips;
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= clips.length) return clips;
  const next = [...clips];
  const [moved] = next.splice(index, 1);
  next.splice(targetIndex, 0, moved);
  return next;
}

export function computeKenBurnsTransform(
  motionPreset: MotionPreset | undefined,
  progress01: number,
): { scale: number; translateXPercent: number } {
  const t = Math.max(0, Math.min(1, Number.isFinite(progress01) ? progress01 : 0));
  switch (motionPreset) {
    case "zoom-in":
      return { scale: Number((1 + t * 0.16).toFixed(3)), translateXPercent: 0 };
    case "zoom-out":
      return { scale: Number((1.16 - t * 0.16).toFixed(3)), translateXPercent: 0 };
    case "pan-left":
      return { scale: 1.12, translateXPercent: Number((4 - t * 8).toFixed(2)) };
    case "pan-right":
      return { scale: 1.12, translateXPercent: Number((-4 + t * 8).toFixed(2)) };
    default:
      return { scale: 1, translateXPercent: 0 };
  }
}

export function generateTimedCaptions(scriptText: string, durationSeconds: number): TimedCaptionCue[] {
  const clean = scriptText.trim().replace(/\s+/g, " ");
  if (!clean) return [];
  const total = Math.max(1, Number.isFinite(durationSeconds) ? durationSeconds : 4);
  const rawParts = clean
    .split(/(?<=[.!?,;])\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const phrases = rawParts.length > 0 ? rawParts : [clean];
  const slice = total / phrases.length;
  return phrases.map((text, idx) => ({
    id: `cap-${idx + 1}`,
    start: Number((idx * slice).toFixed(2)),
    end: Number(((idx + 1) * slice).toFixed(2)),
    text,
  }));
}

export function buildCssFilter(clip: VideoClip): string {
  const b = clip.brightness;
  let c = clip.contrast;
  let s = clip.saturate;
  let extra = "";

  switch (clip.filterPreset) {
    case "cinematic":
      c = Math.round(c * 1.12);
      s = Math.round(s * 0.92);
      break;
    case "noir":
      s = 0;
      c = Math.round(c * 1.2);
      break;
    case "vivid":
      s = Math.round(s * 1.35);
      c = Math.round(c * 1.06);
      break;
    case "warm":
      extra = " sepia(18%)";
      break;
    case "cool":
      extra = " hue-rotate(12deg)";
      break;
  }

  return `brightness(${b}%) contrast(${c}%) saturate(${s}%)${extra}`;
}

export function formatTimecode(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const tenths = Math.floor((safe % 1) * 10);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${tenths}`;
}
