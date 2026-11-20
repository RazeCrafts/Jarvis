import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Captions,
  Download,
  Film,
  Mic,
  Move,
  Music,
  Pause,
  Play,
  Plus,
  Scissors,
  Sparkles,
  Trash2,
  Type,
  Upload,
} from "lucide-react";
import { agentApi } from "@/lib/agentApi";
import {
  buildCssFilter,
  clampClipTrim,
  clipEffectiveDuration,
  computeKenBurnsTransform,
  createDefaultClip,
  formatTimecode,
  generateTimedCaptions,
  moveClip,
  splitClipAtSourceTime,
  totalTimelineDuration,
  type MotionPreset,
  type TimedCaptionCue,
  type VideoClip,
} from "@/lib/videoTimeline";
import { useVideoStore } from "@/store";
import { cn } from "@/lib/cn";

const FILTER_PRESETS: Array<{
  id: VideoClip["filterPreset"];
  label: string;
  brightness: number;
  contrast: number;
  saturate: number;
}> = [
  { id: "none", label: "Natural", brightness: 100, contrast: 100, saturate: 100 },
  { id: "cinematic", label: "Stark Cinematic", brightness: 106, contrast: 118, saturate: 112 },
  { id: "vivid", label: "Arc Vivid", brightness: 104, contrast: 110, saturate: 130 },
  { id: "warm", label: "Cinema Warm", brightness: 102, contrast: 112, saturate: 114 },
  { id: "cool", label: "Orbital Cool", brightness: 103, contrast: 114, saturate: 108 },
  { id: "noir", label: "Noir B&W", brightness: 100, contrast: 128, saturate: 0 },
];

const MOTION_PRESETS: Array<{ id: MotionPreset; label: string }> = [
  { id: "none", label: "Static" },
  { id: "zoom-in", label: "Zoom In" },
  { id: "zoom-out", label: "Zoom Out" },
  { id: "pan-left", label: "Pan Left" },
  { id: "pan-right", label: "Pan Right" },
];

async function generateDemoVideoBlob(): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 360;
  const ctx = canvas.getContext("2d")!;

  const drawFrame = (progress: number) => {
    ctx.fillStyle = "#080c14";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = "rgba(34, 211, 238, 0.14)";
    ctx.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    const cx = 320;
    const cy = 175;
    const angle = progress * Math.PI * 2;
    ctx.strokeStyle = "#22d3ee";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, 68, angle, angle + Math.PI * 1.4);
    ctx.stroke();

    ctx.strokeStyle = "#f59e0b";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 46, -angle * 1.5, -angle * 1.5 + Math.PI * 1.2);
    ctx.stroke();

    ctx.fillStyle = "#eef4ff";
    ctx.font = "600 20px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("JARVIS TELEMETRY DEMO REEL", cx, 56);

    ctx.fillStyle = "#8ba0be";
    ctx.font = "14px monospace";
    ctx.fillText(`FRAME ${(progress * 100).toFixed(0)}% · 640x360`, cx, 315);
  };

  if (typeof canvas.captureStream === "function" && typeof MediaRecorder !== "undefined") {
    try {
      const stream = canvas.captureStream(24);
      const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp8")
        ? "video/webm;codecs=vp8"
        : "video/webm";
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      const done = new Promise<string>((resolve) => {
        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: "video/webm" });
          resolve(URL.createObjectURL(blob));
        };
      });
      drawFrame(0.25);
      recorder.start();
      const totalFrames = 30;
      for (let i = 0; i < totalFrames; i++) {
        drawFrame(0.25 + (i / totalFrames) * 0.75);
        await new Promise((r) => setTimeout(r, 30));
      }
      recorder.stop();
      return await done;
    } catch {
      /* fallback below */
    }
  }

  drawFrame(0.35);
  return "";
}

export default function VideoStudioPage() {
  const clips = useVideoStore((s) => s.clips);
  const selectedId = useVideoStore((s) => s.selectedId);
  const lastAutoEditSummary = useVideoStore((s) => s.lastAutoEditSummary);
  const addClips = useVideoStore((s) => s.addClips);
  const setStoreClips = useVideoStore((s) => s.setClips);
  const setSelectedId = useVideoStore((s) => s.setSelectedId);
  const clearAutoEditSummary = useVideoStore((s) => s.clearAutoEditSummary);

  const [overlayPositions, setOverlayPositions] = useState<Record<string, "top" | "center" | "bottom">>({});
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [aiDirectorPrompt, setAiDirectorPrompt] = useState("");
  const [directorNote, setDirectorNote] = useState("");
  const [exportStatus, setExportStatus] = useState("");
  const [loadingDemo, setLoadingDemo] = useState(false);

  const setClips = (updater: VideoClip[] | ((prev: VideoClip[]) => VideoClip[])) => {
    if (typeof updater === "function") {
      setStoreClips(updater(useVideoStore.getState().clips));
    } else {
      setStoreClips(updater);
    }
  };

  // Voiceover, Auto-Captions & Music Track
  const [narrationText, setNarrationText] = useState("");
  const [voiceoverAudioUrl, setVoiceoverAudioUrl] = useState("");
  const [captions, setCaptions] = useState<TimedCaptionCue[]>([]);
  const [generatingVoiceover, setGeneratingVoiceover] = useState(false);
  const [bgMusicName, setBgMusicName] = useState("");
  const [bgMusicUrl, setBgMusicUrl] = useState("");

  const videoRef = useRef<HTMLVideoElement>(null);
  const voiceAudioRef = useRef<HTMLAudioElement>(null);
  const musicAudioRef = useRef<HTMLAudioElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const musicInputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(
    () => clips.find((c) => c.id === selectedId) ?? clips[0] ?? null,
    [clips, selectedId],
  );

  const totalEffectiveDuration = useMemo(
    () => totalTimelineDuration(clips),
    [clips],
  );

  const activeCaption = useMemo(() => {
    if (captions.length === 0) return "";
    const normalizedTime = Math.max(0, playhead - (selected?.trimStart ?? 0));
    return (
      captions.find((c) => normalizedTime >= c.start && normalizedTime <= c.end)?.text ||
      captions[0]?.text ||
      ""
    );
  }, [captions, playhead, selected?.trimStart]);

  const kenBurns = useMemo(() => {
    if (!selected) return { scale: 1, translateXPercent: 0 };
    const dur = Math.max(0.1, clipEffectiveDuration(selected));
    const progress = (playhead - selected.trimStart) / dur;
    return computeKenBurnsTransform(selected.motionPreset, progress);
  }, [selected, playhead]);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !selected) return;
    vid.playbackRate = selected.speed;
  }, [selected]);

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    files.forEach((file, idx) => {
      const url = URL.createObjectURL(file);
      const probe = document.createElement("video");
      probe.src = url;
      probe.onloadedmetadata = () => {
        const clip = createDefaultClip({
          name: file.name,
          src: url,
          duration: Number.isFinite(probe.duration) && probe.duration > 0 ? probe.duration : 10,
        });
        addClips([clip]);
        if (idx === 0) {
          setSelectedId(clip.id);
          setPlayhead(0);
        }
      };
      probe.onerror = () => {
        const clip = createDefaultClip({ name: file.name, src: url, duration: 8 });
        addClips([clip]);
        if (idx === 0) setSelectedId(clip.id);
      };
    });
    e.target.value = "";
  };

  const handleMusicUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setBgMusicUrl(url);
    setBgMusicName(file.name);
    e.target.value = "";
  };

  const loadSampleClip = async () => {
    setLoadingDemo(true);
    try {
      const url = await generateDemoVideoBlob();
      const clip: VideoClip = {
        ...createDefaultClip({
          name: "Orbital Telemetry Reel.webm",
          src: url,
          duration: 4.0,
        }),
        overlayText: "JARVIS STUDIO CUT",
        motionPreset: "zoom-in",
      };
      setClips((prev) => [...prev, clip]);
      setSelectedId(clip.id);
      setPlayhead(0.8);
    } finally {
      setLoadingDemo(false);
    }
  };

  const updateSelected = (patch: Partial<VideoClip>) => {
    if (!selected) return;
    setClips((prev) =>
      prev.map((c) => {
        if (c.id !== selected.id) return c;
        const merged = { ...c, ...patch };
        return clampClipTrim(merged, merged.trimStart, merged.trimEnd);
      }),
    );
  };

  const handleReorder = (id: string, dir: -1 | 1) => {
    setClips((prev) => moveClip(prev, id, dir));
  };

  const handleSplit = () => {
    if (!selected) return;
    const splitPoint = Math.max(
      selected.trimStart + 0.25,
      Math.min(
        selected.trimEnd - 0.25,
        playhead > selected.trimStart && playhead < selected.trimEnd
          ? playhead
          : (selected.trimStart + selected.trimEnd) / 2,
      ),
    );
    const nextClips = splitClipAtSourceTime(clips, selected.id, splitPoint);
    if (nextClips.length === clips.length) return;
    const idx = clips.findIndex((c) => c.id === selected.id);
    setClips(nextClips);
    if (idx >= 0 && nextClips[idx + 1]) {
      setSelectedId(nextClips[idx + 1].id);
    }
  };

  const handleDeleteClip = (id: string) => {
    setClips((prev) => prev.filter((c) => c.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const togglePlay = () => {
    const vid = videoRef.current;
    if (!vid || !selected?.src) {
      setPlaying((v) => !v);
      return;
    }
    if (vid.paused) {
      if (vid.currentTime < selected.trimStart || vid.currentTime >= selected.trimEnd) {
        vid.currentTime = selected.trimStart;
      }
      void vid.play();
      if (voiceAudioRef.current && voiceoverAudioUrl) {
        voiceAudioRef.current.currentTime = 0;
        void voiceAudioRef.current.play().catch(() => undefined);
      }
      if (musicAudioRef.current && bgMusicUrl) {
        musicAudioRef.current.volume = 0.25;
        void musicAudioRef.current.play().catch(() => undefined);
      }
      setPlaying(true);
    } else {
      vid.pause();
      voiceAudioRef.current?.pause();
      musicAudioRef.current?.pause();
      setPlaying(false);
    }
  };

  const generateVoiceAndCaptions = async () => {
    if (!narrationText.trim()) return;
    setGeneratingVoiceover(true);
    const cues = generateTimedCaptions(
      narrationText,
      Math.max(2, totalEffectiveDuration || 4),
    );
    setCaptions(cues);

    try {
      const res = await agentApi.generateVoiceover({
        text: narrationText.trim(),
        voiceName: "Charon",
      });
      if (res.ok && res.audioBase64) {
        const mime = res.mimeType || "audio/wav";
        setVoiceoverAudioUrl(`data:${mime};base64,${res.audioBase64}`);
        setExportStatus(`Generated JARVIS narration WAV & ${cues.length} timed caption cue(s).`);
      } else {
        setExportStatus(
          `Generated ${cues.length} timed caption cue(s). (${res.error || "TTS audio unavailable in offline mode"})`,
        );
      }
    } catch {
      setExportStatus(`Generated ${cues.length} timed caption cue(s).`);
    } finally {
      setGeneratingVoiceover(false);
    }
  };

  const applyAiDirection = () => {
    if (!selected) return;
    const q = aiDirectorPrompt.toLowerCase();
    if (q.includes("noir") || q.includes("black") || q.includes("monochrome")) {
      updateSelected({ filterPreset: "noir", brightness: 100, contrast: 128, saturate: 0 });
      setDirectorNote("Applied Noir B&W grade with +28% contrast.");
    } else if (q.includes("fast") || q.includes("speed") || q.includes("1.5")) {
      updateSelected({ speed: 1.5 });
      setDirectorNote("Increased playback pacing to 1.5x.");
    } else if (q.includes("zoom")) {
      updateSelected({ motionPreset: "zoom-in" });
      setDirectorNote("Enabled Ken Burns Zoom-In keyframe motion.");
    } else if (q.includes("title") || q.includes("caption") || q.includes("text")) {
      updateSelected({ overlayText: aiDirectorPrompt.replace(/add\s+(a\s+)?(title|caption)\s*/i, "").trim() || "JARVIS FEATURE CUT" });
      setDirectorNote("Added crisp title overlay to the active clip.");
    } else {
      updateSelected({
        filterPreset: "cinematic",
        motionPreset: "zoom-in",
        brightness: 106,
        contrast: 118,
        saturate: 112,
        trimStart: Math.min(selected.trimEnd - 0.5, Number((selected.trimStart + 0.25).toFixed(2))),
      });
      setDirectorNote("Tightened intro trim (+0.25s), enabled Zoom-In motion, and applied Stark Cinematic grade.");
    }
    setAiDirectorPrompt("");
  };

  const exportWebm = async () => {
    if (!selected) return;
    setExportStatus("Rendering WebM export with color grade, motion & captions…");
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 960;
      canvas.height = 540;
      const ctx = canvas.getContext("2d")!;
      const stream = canvas.captureStream(24);
      const rec = new MediaRecorder(stream, { mimeType: "video/webm" });
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      const done = new Promise<Blob>((resolve) => {
        rec.onstop = () => resolve(new Blob(chunks, { type: "video/webm" }));
      });
      rec.start();

      const vid = videoRef.current;
      const filterStr = buildCssFilter(selected);
      for (let f = 0; f < 30; f++) {
        const kb = computeKenBurnsTransform(selected.motionPreset, f / 29);
        ctx.save();
        ctx.filter = filterStr;
        ctx.fillStyle = "#080c14";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.translate(canvas.width / 2 + (kb.translateXPercent / 100) * canvas.width, canvas.height / 2);
        ctx.scale(kb.scale, kb.scale);
        ctx.translate(-canvas.width / 2, -canvas.height / 2);

        if (vid && vid.readyState >= 2) {
          ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);
        } else {
          ctx.fillStyle = "#22d3ee";
          ctx.font = "600 28px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(selected.name, canvas.width / 2, canvas.height / 2);
        }
        ctx.restore();

        if (selected.overlayText) {
          ctx.fillStyle = "rgba(8, 12, 20, 0.72)";
          ctx.fillRect(80, canvas.height - 90, canvas.width - 160, 48);
          ctx.fillStyle = "#ffffff";
          ctx.font = "600 22px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(selected.overlayText, canvas.width / 2, canvas.height - 58);
        } else if (activeCaption) {
          ctx.fillStyle = "rgba(8, 12, 20, 0.78)";
          ctx.fillRect(100, canvas.height - 64, canvas.width - 200, 36);
          ctx.fillStyle = "#e2e8f0";
          ctx.font = "500 17px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(activeCaption, canvas.width / 2, canvas.height - 40);
        }
        await new Promise((r) => setTimeout(r, 35));
      }
      rec.stop();
      const blob = await done;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${selected.name.replace(/\.[^.]+$/, "")}-edited.webm`;
      a.click();
      URL.revokeObjectURL(url);
      setExportStatus("Exported WebM video.");
    } catch (err) {
      setExportStatus(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
        <div>
          <h1 className="font-display text-base font-semibold text-fg">Video Studio</h1>
          <p className="text-xs text-fg-muted">
            Multi-clip reorder · Trim & split · Ken Burns motion · JARVIS AI voiceover & captions · WebM export
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileInputRef} type="file" multiple accept="video/*" onChange={handleFileUpload} className="hidden" />
          <input ref={musicInputRef} type="file" accept="audio/*" onChange={handleMusicUpload} className="hidden" />
          <button
            type="button"
            onClick={() => void loadSampleClip()}
            disabled={loadingDemo}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-elevated px-3 py-1.5 text-xs font-medium text-fg transition-colors hover:border-accent"
          >
            <Plus size={13} /> {loadingDemo ? "Generating…" : "Load Sample Clip"}
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-elevated px-3 py-1.5 text-xs font-medium text-fg transition-colors hover:border-accent"
          >
            <Upload size={13} /> Import Video
          </button>
          <button
            type="button"
            onClick={() => musicInputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-elevated px-3 py-1.5 text-xs font-medium text-fg transition-colors hover:border-accent"
          >
            <Music size={13} /> {bgMusicName ? "Change Audio" : "Add Audio"}
          </button>
          <button
            type="button"
            disabled={!selected}
            onClick={() => void exportWebm()}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-background disabled:opacity-40"
          >
            <Download size={13} /> Export WebM
          </button>
        </div>
      </div>

      {(exportStatus || lastAutoEditSummary) && (
        <div className="flex items-center justify-between gap-2 border-b border-border bg-elevated px-5 py-1.5 text-xs text-accent">
          <span>{lastAutoEditSummary || exportStatus}</span>
          {lastAutoEditSummary && (
            <button
              type="button"
              onClick={clearAutoEditSummary}
              className="text-[11px] text-fg-muted hover:text-fg"
            >
              Dismiss
            </button>
          )}
        </div>
      )}

      {voiceoverAudioUrl && <audio ref={voiceAudioRef} src={voiceoverAudioUrl} className="hidden" />}
      {bgMusicUrl && <audio ref={musicAudioRef} src={bgMusicUrl} loop className="hidden" />}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 lg:grid-cols-12">
        {/* Preview Monitor + Timeline */}
        <div className="flex flex-col gap-3 lg:col-span-8">
          <div className="hud-panel relative flex aspect-video w-full items-center justify-center overflow-hidden bg-[#060910]">
            {selected ? (
              <>
                {selected.src ? (
                  <video
                    ref={videoRef}
                    src={selected.src}
                    preload="auto"
                    playsInline
                    className="h-full w-full object-contain transition-transform duration-150"
                    style={{
                      filter: buildCssFilter(selected),
                      transform: `scale(${kenBurns.scale}) translateX(${kenBurns.translateXPercent}%)`,
                    }}
                    onLoadedData={(e) => {
                      const targetTime = Math.max(0.1, selected.trimStart);
                      if (Math.abs(e.currentTarget.currentTime - targetTime) > 0.1) {
                        e.currentTarget.currentTime = targetTime;
                      }
                    }}
                    onTimeUpdate={(e) => {
                      const t = e.currentTarget.currentTime;
                      setPlayhead(t);
                      if (t >= selected.trimEnd) {
                        e.currentTarget.pause();
                        voiceAudioRef.current?.pause();
                        musicAudioRef.current?.pause();
                        setPlaying(false);
                      }
                    }}
                    onEnded={() => {
                      voiceAudioRef.current?.pause();
                      musicAudioRef.current?.pause();
                      setPlaying(false);
                    }}
                  />
                ) : (
                  <div
                    className="flex h-full w-full flex-col items-center justify-center gap-2 text-center"
                    style={{
                      filter: buildCssFilter(selected),
                      transform: `scale(${kenBurns.scale}) translateX(${kenBurns.translateXPercent}%)`,
                    }}
                  >
                    <Film size={34} className="text-accent" />
                    <p className="font-display text-base font-semibold text-white">{selected.name}</p>
                    <p className="font-mono text-xs text-slate-400">
                      Preview Frame · {formatTimecode(playhead)}
                    </p>
                  </div>
                )}

                {selected.overlayText && (
                  <div
                    className={cn(
                      "pointer-events-none absolute inset-x-8 rounded-lg bg-black/65 px-4 py-2 text-center font-display text-lg font-semibold text-white",
                      (overlayPositions[selected.id] ?? "bottom") === "top"
                        ? "top-5"
                        : (overlayPositions[selected.id] ?? "bottom") === "center"
                          ? "top-1/2 -translate-y-1/2"
                          : "bottom-12",
                    )}
                  >
                    {selected.overlayText}
                  </div>
                )}

                {activeCaption && (
                  <div className="pointer-events-none absolute bottom-3 inset-x-12 rounded-md bg-black/80 px-3 py-1 text-center text-xs font-medium text-slate-100">
                    {activeCaption}
                  </div>
                )}
              </>
            ) : (
              <div className="px-6 text-center">
                <Film size={32} className="mx-auto text-fg-muted" />
                <p className="mt-2 text-sm font-medium text-slate-200">No clip on timeline</p>
                <p className="mt-1 text-xs text-slate-400">
                  Import a local video file or click Load Sample Clip above to start editing.
                </p>
              </div>
            )}
          </div>

          {/* Transport Bar */}
          <div className="hud-panel flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!selected}
                onClick={togglePlay}
                className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-background disabled:opacity-40"
              >
                {playing ? <Pause size={13} /> : <Play size={13} />}
                {playing ? "Pause" : "Play"}
              </button>
              <button
                type="button"
                disabled={!selected}
                onClick={handleSplit}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-elevated px-3 py-1.5 text-xs font-medium text-fg hover:border-accent disabled:opacity-40"
              >
                <Scissors size={13} /> Split at Playhead
              </button>
            </div>
            <div className="font-mono text-xs text-fg-muted tabular-nums">
              Playhead {formatTimecode(playhead)} · Timeline {formatTimecode(totalEffectiveDuration)}
              {bgMusicName ? ` · Track: ${bgMusicName}` : ""}
            </div>
          </div>

          {/* Multi-Clip Timeline Track */}
          <div className="hud-panel p-3.5">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-fg-muted">
              Video & Audio Tracks ({clips.length} clip{clips.length === 1 ? "" : "s"})
            </p>
            {clips.length === 0 ? (
              <p className="py-4 text-center text-xs text-fg-muted">
                Timeline is empty. Add a clip to unlock reorder, motion keyframes, captions, and export.
              </p>
            ) : (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {clips.map((clip, i) => (
                  <div
                    key={clip.id}
                    onClick={() => {
                      setSelectedId(clip.id);
                      setPlayhead(clip.trimStart);
                    }}
                    className={cn(
                      "flex min-w-48 cursor-pointer flex-col justify-between rounded-xl border p-2.5 transition-colors",
                      clip.id === selected?.id
                        ? "border-accent bg-elevated"
                        : "border-border bg-background/40 hover:border-accent/50",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium text-fg">
                        {i + 1}. {clip.name}
                      </span>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          disabled={i === 0}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleReorder(clip.id, -1);
                          }}
                          title="Move Left"
                          className="rounded p-0.5 text-fg-muted hover:text-fg disabled:opacity-30"
                        >
                          <ArrowLeft size={11} />
                        </button>
                        <button
                          type="button"
                          disabled={i === clips.length - 1}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleReorder(clip.id, 1);
                          }}
                          title="Move Right"
                          className="rounded p-0.5 text-fg-muted hover:text-fg disabled:opacity-30"
                        >
                          <ArrowRight size={11} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteClip(clip.id);
                          }}
                          className="text-fg-muted hover:text-red-500"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-fg-muted tabular-nums">
                      <span>
                        {formatTimecode(clip.trimStart)}–{formatTimecode(clip.trimEnd)}
                      </span>
                      <span>
                        {clip.speed}x {clip.motionPreset && clip.motionPreset !== "none" ? `· ${clip.motionPreset}` : ""}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Inspector: Trim, Motion, Color, Voiceover & AI Director */}
        <div className="flex flex-col gap-3 lg:col-span-4">
          <div className="hud-panel space-y-3 p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Clip Controls & Motion</h2>
            {selected ? (
              <>
                <div>
                  <div className="mb-1 flex justify-between text-xs text-fg">
                    <span>Trim Start</span>
                    <span className="font-mono tabular-nums">{formatTimecode(selected.trimStart)}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0.2, selected.trimEnd - 0.25)}
                    step={0.1}
                    value={selected.trimStart}
                    onChange={(e) => updateSelected({ trimStart: Number(e.target.value) })}
                    className="w-full accent-[var(--color-accent)]"
                  />
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-xs text-fg">
                    <span>Trim End</span>
                    <span className="font-mono tabular-nums">{formatTimecode(selected.trimEnd)}</span>
                  </div>
                  <input
                    type="range"
                    min={Math.min(selected.duration, selected.trimStart + 0.25)}
                    max={selected.duration}
                    step={0.1}
                    value={selected.trimEnd}
                    onChange={(e) => updateSelected({ trimEnd: Number(e.target.value) })}
                    className="w-full accent-[var(--color-accent)]"
                  />
                </div>
                <div>
                  <span className="mb-1.5 flex items-center gap-1 text-xs text-fg">
                    <Move size={11} /> Keyframe Motion
                  </span>
                  <div className="grid grid-cols-3 gap-1">
                    {MOTION_PRESETS.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => updateSelected({ motionPreset: m.id })}
                        className={cn(
                          "rounded-md border px-2 py-1 text-[11px]",
                          (selected.motionPreset || "none") === m.id
                            ? "border-accent bg-elevated text-accent"
                            : "border-border bg-surface text-fg-muted",
                        )}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="mb-1.5 block text-xs text-fg">Playback Speed</span>
                  <div className="grid grid-cols-5 gap-1">
                    {[0.25, 0.5, 1, 1.5, 2].map((sp) => (
                      <button
                        key={sp}
                        type="button"
                        onClick={() => updateSelected({ speed: sp })}
                        className={cn(
                          "rounded-md border py-1 font-mono text-[11px]",
                          selected.speed === sp
                            ? "border-accent bg-accent text-background"
                            : "border-border bg-elevated text-fg",
                        )}
                      >
                        {sp}x
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <p className="text-xs text-fg-muted">Select a clip to adjust trim, motion keyframes, and speed.</p>
            )}
          </div>

          <div className="hud-panel space-y-2.5 p-4">
            <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-fg-muted">
              <Mic size={12} className="text-accent" /> AI Voiceover & Auto-Captions
            </h2>
            <textarea
              rows={2}
              value={narrationText}
              onChange={(e) => setNarrationText(e.target.value)}
              placeholder="Write narration script for JARVIS to voice & caption automatically..."
              className="w-full rounded-lg border border-border bg-elevated px-2.5 py-1.5 text-xs text-fg outline-none focus:border-accent"
            />
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                disabled={generatingVoiceover || !narrationText.trim()}
                onClick={() => void generateVoiceAndCaptions()}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-background disabled:opacity-40"
              >
                <Captions size={12} />
                {generatingVoiceover ? "Generating Voiceover…" : "Generate Narration & Captions"}
              </button>
              {voiceoverAudioUrl && (
                <button
                  type="button"
                  onClick={() => void voiceAudioRef.current?.play()}
                  className="rounded-lg border border-border bg-elevated px-2.5 py-1.5 text-xs text-fg hover:border-accent"
                >
                  Preview Voice
                </button>
              )}
            </div>
          </div>

          <div className="hud-panel space-y-3 p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Color & Title Overlay</h2>
            {selected ? (
              <>
                <div className="grid grid-cols-2 gap-1.5">
                  {FILTER_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() =>
                        updateSelected({
                          filterPreset: p.id,
                          brightness: p.brightness,
                          contrast: p.contrast,
                          saturate: p.saturate,
                        })
                      }
                      className={cn(
                        "rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors",
                        selected.filterPreset === p.id
                          ? "border-accent bg-elevated text-accent"
                          : "border-border text-fg hover:border-accent/50",
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <label className="block text-xs text-fg">
                  <span className="mb-1 flex items-center gap-1">
                    <Type size={12} /> Overlay Title
                  </span>
                  <input
                    value={selected.overlayText}
                    onChange={(e) => updateSelected({ overlayText: e.target.value })}
                    placeholder="Enter caption or title card..."
                    className="w-full rounded-lg border border-border bg-elevated px-2.5 py-1.5 text-xs text-fg outline-none focus:border-accent"
                  />
                </label>
                <div className="grid grid-cols-3 gap-1">
                  {(["top", "center", "bottom"] as const).map((pos) => (
                    <button
                      key={pos}
                      type="button"
                      onClick={() =>
                        setOverlayPositions((prev) => ({ ...prev, [selected.id]: pos }))
                      }
                      className={cn(
                        "rounded-md border py-1 text-[11px] capitalize",
                        (overlayPositions[selected.id] ?? "bottom") === pos
                          ? "border-accent bg-elevated text-accent"
                          : "border-border text-fg-muted",
                      )}
                    >
                      {pos}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-xs text-fg-muted">Add a clip to grade color and titles.</p>
            )}
          </div>

          <div className="hud-panel space-y-2.5 p-4">
            <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-fg-muted">
              <Sparkles size={13} className="text-accent" /> AI Edit Director
            </h2>
            <div className="flex gap-1.5">
              <input
                value={aiDirectorPrompt}
                onChange={(e) => setAiDirectorPrompt(e.target.value)}
                placeholder="e.g. Make it Noir B&W or zoom..."
                className="min-w-0 flex-1 rounded-lg border border-border bg-elevated px-2.5 py-1.5 text-xs text-fg outline-none focus:border-accent"
              />
              <button
                type="button"
                disabled={!selected || !aiDirectorPrompt.trim()}
                onClick={applyAiDirection}
                className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-background disabled:opacity-40"
              >
                Apply
              </button>
            </div>
            {directorNote && <p className="text-[11px] text-accent">{directorNote}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
