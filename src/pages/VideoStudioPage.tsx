import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Captions,
  Download,
  Film,
  Image as ImageIcon,
  Mic,
  MicOff,
  Move,
  Music,
  Pause,
  Play,
  Plus,
  Redo2,
  Scissors,
  SkipBack,
  Sparkles,
  Trash2,
  Type,
  Undo2,
  Upload,
  Wand2,
} from "lucide-react";
import { agentApi } from "@/lib/agentApi";
import {
  analyzeMediaAudioUrl,
  analyzePcmForBeats,
} from "@/lib/audioBeatAnalyzer";
import {
  extractMediaKeyframes,
  prepareFileAttachment,
} from "@/lib/fileAttachment";
import {
  buildCssFilter,
  clipEffectiveDuration,
  computeKenBurnsTransform,
  createDefaultClip,
  formatTimecode,
  generateTimedCaptions,
  resolveTimelineClipAt,
  totalTimelineDuration,
  type MotionPreset,
  type TransitionPreset,
  type VideoClip,
} from "@/lib/videoTimeline";
import { speak } from "@/lib/voiceEngine";
import { useVideoStore, type AiEditPlanPayload, type AspectRatio } from "@/store/videoStore";
import { cn } from "@/lib/cn";

const FILTER_PRESETS: Array<{
  id: VideoClip["filterPreset"];
  label: string;
  brightness: number;
  contrast: number;
  saturate: number;
}> = [
  { id: "none", label: "Natural", brightness: 100, contrast: 100, saturate: 100 },
  { id: "cinematic", label: "Stark Cinema", brightness: 106, contrast: 118, saturate: 112 },
  { id: "vivid", label: "Arc Vivid", brightness: 104, contrast: 110, saturate: 130 },
  { id: "warm", label: "Warm Gold", brightness: 102, contrast: 112, saturate: 114 },
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

const TRANSITIONS: Array<{ id: TransitionPreset; label: string }> = [
  { id: "none", label: "Cut" },
  { id: "fade", label: "Fade" },
  { id: "flash", label: "Beat Flash" },
  { id: "slide", label: "Whip Slide" },
];

async function generateDemoVideoBlob(): Promise<{ url: string; duration: number }> {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 360;
  const ctx = canvas.getContext("2d")!;

  const drawFrame = (progress: number) => {
    ctx.fillStyle = "#080c14";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = "rgba(34, 211, 238, 0.16)";
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
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 70, angle, angle + Math.PI * 1.45);
    ctx.stroke();

    ctx.strokeStyle = "#f59e0b";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 46, -angle * 1.5, -angle * 1.5 + Math.PI * 1.25);
    ctx.stroke();

    ctx.fillStyle = "#eef4ff";
    ctx.font = "600 20px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("JARVIS TELEMETRY REEL", cx, 56);

    ctx.fillStyle = "#94a3b8";
    ctx.font = "13px monospace";
    ctx.fillText(`TIMELINE ${(progress * 100).toFixed(0)}% · 640x360`, cx, 316);
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
      drawFrame(0);
      recorder.start();
      const totalFrames = 40;
      for (let i = 0; i < totalFrames; i++) {
        drawFrame(i / totalFrames);
        await new Promise((r) => setTimeout(r, 45));
      }
      recorder.stop();
      const url = await done;
      return { url, duration: 1.8 };
    } catch {
      /* fallback */
    }
  }

  drawFrame(0.35);
  return { url: "", duration: 2.5 };
}

/**
 * Generates a real playable 120 BPM WAV synth beat track so beat detection & playback work offline immediately.
 */
function generateDemoBeatTrackWav(): {
  url: string;
  samples: Float32Array;
  sampleRate: number;
} {
  const sampleRate = 16000;
  const durationSec = 6;
  const totalSamples = sampleRate * durationSec;
  const samples = new Float32Array(totalSamples);

  for (let beatIdx = 0; beatIdx < 12; beatIdx++) {
    const startSample = Math.round(beatIdx * 0.5 * sampleRate);
    for (let k = 0; k < 2200 && startSample + k < totalSamples; k++) {
      const env = Math.exp(-k / 420);
      const freq = 130 * Math.exp(-k / 900) + 48;
      samples[startSample + k] += 0.72 * env * Math.sin((2 * Math.PI * freq * k) / sampleRate);
    }
  }

  const buffer = new ArrayBuffer(44 + totalSamples * 2);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + totalSamples * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, totalSamples * 2, true);
  for (let i = 0; i < totalSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s * 0x7fff, true);
  }
  const blob = new Blob([buffer], { type: "audio/wav" });
  return { url: URL.createObjectURL(blob), samples, sampleRate };
}

type InspectorTab = "clip" | "color" | "text" | "voice";

export default function VideoStudioPage() {
  const clips = useVideoStore((s) => s.clips);
  const selectedId = useVideoStore((s) => s.selectedId);
  const historyPast = useVideoStore((s) => s.historyPast);
  const historyFuture = useVideoStore((s) => s.historyFuture);
  const aspectRatio = useVideoStore((s) => s.aspectRatio);
  const timelineZoom = useVideoStore((s) => s.timelineZoom);
  const musicUrl = useVideoStore((s) => s.musicUrl);
  const musicName = useVideoStore((s) => s.musicName);
  const bpm = useVideoStore((s) => s.bpm);
  const beats = useVideoStore((s) => s.beats);
  const waveform = useVideoStore((s) => s.waveform);
  const captions = useVideoStore((s) => s.captions);
  const lastAutoEditSummary = useVideoStore((s) => s.lastAutoEditSummary);

  const addClips = useVideoStore((s) => s.addClips);
  const updateClip = useVideoStore((s) => s.updateClip);
  const splitClip = useVideoStore((s) => s.splitClip);
  const moveClipStep = useVideoStore((s) => s.moveClipStep);
  const deleteClip = useVideoStore((s) => s.deleteClip);
  const undo = useVideoStore((s) => s.undo);
  const redo = useVideoStore((s) => s.redo);
  const setSelectedId = useVideoStore((s) => s.setSelectedId);
  const setAspectRatio = useVideoStore((s) => s.setAspectRatio);
  const setTimelineZoom = useVideoStore((s) => s.setTimelineZoom);
  const setMusicTrack = useVideoStore((s) => s.setMusicTrack);
  const clearMusicTrack = useVideoStore((s) => s.clearMusicTrack);
  const setCaptions = useVideoStore((s) => s.setCaptions);
  const syncClipsToBeats = useVideoStore((s) => s.syncClipsToBeats);
  const applyAiEditPlan = useVideoStore((s) => s.applyAiEditPlan);
  const clearAutoEditSummary = useVideoStore((s) => s.clearAutoEditSummary);

  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("clip");
  const [overlayPositions, setOverlayPositions] = useState<Record<string, "top" | "center" | "bottom">>({});
  const [playing, setPlaying] = useState(false);
  const [timelineTime, setTimelineTime] = useState(0);
  const [aiPrompt, setAiPrompt] = useState("");
  const [analyzingAi, setAnalyzingAi] = useState(false);
  const [frameInsights, setFrameInsights] = useState("");
  const [exportStatus, setExportStatus] = useState("");
  const [loadingDemo, setLoadingDemo] = useState(false);
  const [draggingMedia, setDraggingMedia] = useState(false);

  // Voiceover + Live Voice Director
  const [narrationText, setNarrationText] = useState("");
  const [voiceoverAudioUrl, setVoiceoverAudioUrl] = useState("");
  const [generatingVoiceover, setGeneratingVoiceover] = useState(false);
  const [liveVoiceActive, setLiveVoiceActive] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");

  const videoRef = useRef<HTMLVideoElement>(null);
  const voiceAudioRef = useRef<HTMLAudioElement>(null);
  const musicAudioRef = useRef<HTMLAudioElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const musicInputRef = useRef<HTMLInputElement>(null);
  const timelineBarRef = useRef<HTMLDivElement>(null);
  const scrubbingRef = useRef(false);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const playStateRef = useRef({ playing: false, timelineTime: 0 });
  playStateRef.current = { playing, timelineTime };

  const totalEffectiveDuration = useMemo(() => totalTimelineDuration(clips), [clips]);

  // Clamp timeline playhead when clips shrink/delete
  useEffect(() => {
    if (timelineTime > totalEffectiveDuration) {
      setTimelineTime(Math.max(0, totalEffectiveDuration));
    }
  }, [totalEffectiveDuration, timelineTime]);

  const activeMapping = useMemo(
    () => resolveTimelineClipAt(clips, timelineTime),
    [clips, timelineTime],
  );

  const selected = useMemo(
    () => clips.find((c) => c.id === selectedId) ?? activeMapping.clip ?? clips[0] ?? null,
    [clips, selectedId, activeMapping.clip],
  );

  const displayClip = activeMapping.clip ?? selected;

  const activeCaption = useMemo(() => {
    if (captions.length === 0) return "";
    return (
      captions.find((c) => timelineTime >= c.start && timelineTime <= c.end)?.text || ""
    );
  }, [captions, timelineTime]);

  const kenBurns = useMemo(() => {
    if (!displayClip) return { scale: 1, translateXPercent: 0 };
    return computeKenBurnsTransform(displayClip.motionPreset, activeMapping.progress01);
  }, [displayClip, activeMapping.progress01]);

  // Continuous CapCut-style Master Playhead RAF Loop
  useEffect(() => {
    if (!playing || clips.length === 0 || totalEffectiveDuration <= 0) return;

    let rafId = 0;
    let lastTs = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - lastTs) / 1000);
      lastTs = now;

      const nextT = playStateRef.current.timelineTime + dt;
      if (nextT >= totalEffectiveDuration) {
        setTimelineTime(0);
        setPlaying(false);
        videoRef.current?.pause();
        musicAudioRef.current?.pause();
        voiceAudioRef.current?.pause();
        return;
      }
      setTimelineTime(nextT);
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [playing, clips.length, totalEffectiveDuration]);

  // Keep <video> element synchronized with activeMapping (multi-clip transition without glitching!)
  useEffect(() => {
    const vid = videoRef.current;
    const active = activeMapping.clip;
    if (!vid || !active || active.mediaType === "image" || !active.src) return;

    vid.playbackRate = active.speed || 1;
    vid.volume = Math.max(0, Math.min(1, active.volume ?? 1));

    const drift = Math.abs(vid.currentTime - activeMapping.sourceTime);
    if (drift > 0.28 || !playing) {
      try {
        vid.currentTime = Math.min(active.duration - 0.02, Math.max(0, activeMapping.sourceTime));
      } catch {
        /* ignore seeking before metadata */
      }
    }

    if (playing && vid.paused) {
      void vid.play().catch(() => undefined);
    } else if (!playing && !vid.paused) {
      vid.pause();
    }
  }, [activeMapping.clip?.id, activeMapping.sourceTime, playing]);

  // Keep Music & Voiceover Audio synced with master playback
  useEffect(() => {
    const mus = musicAudioRef.current;
    if (mus && musicUrl) {
      mus.volume = 0.32;
      if (Math.abs(mus.currentTime - timelineTime) > 0.4) {
        try {
          mus.currentTime = timelineTime % Math.max(1, mus.duration || 30);
        } catch {
          /* ignore */
        }
      }
      if (playing && mus.paused) void mus.play().catch(() => undefined);
      else if (!playing && !mus.paused) mus.pause();
    }

    const vox = voiceAudioRef.current;
    if (vox && voiceoverAudioUrl) {
      if (playing && vox.paused && timelineTime < (vox.duration || 60)) {
        try {
          vox.currentTime = timelineTime;
        } catch {
          /* ignore */
        }
        void vox.play().catch(() => undefined);
      } else if (!playing && !vox.paused) {
        vox.pause();
      }
    }
  }, [playing, timelineTime, musicUrl, voiceoverAudioUrl]);

  const ingestMediaFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const addedClips: VideoClip[] = [];
    for (const file of files) {
      const prepared = await prepareFileAttachment(file);
      if (prepared.kind === "audio" && prepared.objectUrl) {
        const beatRes = await analyzeMediaAudioUrl(prepared.objectUrl);
        setMusicTrack({
          url: prepared.objectUrl,
          name: prepared.name,
          bpm: beatRes.bpm,
          beats: beatRes.beats,
          waveform: beatRes.waveform,
        });
        setExportStatus(
          `Loaded audio "${prepared.name}" · Detected ${beatRes.bpm} BPM & ${beatRes.beats.length} beat markers.`,
        );
      } else if (prepared.kind === "video" || prepared.kind === "image") {
        const clip = createDefaultClip({
          name: prepared.name,
          src: prepared.objectUrl || "",
          mediaType: prepared.kind,
          duration: prepared.duration || (prepared.kind === "image" ? 4 : 6),
        });
        addedClips.push(clip);
      }
    }
    if (addedClips.length > 0) {
      addClips(addedClips);
      setSelectedId(addedClips[0].id);
      if (clips.length === 0) setTimelineTime(0);
    }
  };

  const handleMediaUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    void ingestMediaFiles(files);
    e.target.value = "";
  };

  const handleMusicUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await ingestMediaFiles([file]);
    e.target.value = "";
  };

  const handleDropMedia = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDraggingMedia(false);
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length > 0) void ingestMediaFiles(files);
  };

  const loadSampleProject = async () => {
    setLoadingDemo(true);
    try {
      const { url, duration } = await generateDemoVideoBlob();
      const beatWav = generateDemoBeatTrackWav();
      const beatAnalysis = analyzePcmForBeats(beatWav.samples, beatWav.sampleRate, 120);

      const c1: VideoClip = {
        ...createDefaultClip({
          name: "Orbital Telemetry Reel.webm",
          src: url,
          mediaType: "video",
          duration,
        }),
        overlayText: "JARVIS STUDIO CUT",
        motionPreset: "zoom-in",
        filterPreset: "cinematic",
        transition: "fade",
      };
      const c2: VideoClip = {
        ...createDefaultClip({
          name: "Reactor Core B-Roll",
          src: "",
          mediaType: "video",
          duration: 2.2,
        }),
        motionPreset: "pan-right",
        filterPreset: "vivid",
        transition: "flash",
      };
      addClips([c1, c2]);
      setSelectedId(c1.id);
      setMusicTrack({
        url: beatWav.url,
        name: "Stark Synth 120BPM.wav",
        bpm: beatAnalysis.bpm,
        beats: beatAnalysis.beats,
        waveform: beatAnalysis.waveform,
      });
      setCaptions(
        generateTimedCaptions(
          "Initializing orbital telemetry. Reactor output nominal.",
          duration + 2.2,
        ),
      );
      setTimelineTime(0.4);
      setExportStatus(
        `Loaded 2-clip demo project + ${beatAnalysis.bpm} BPM beat track (${beatAnalysis.beats.length} beat markers).`,
      );
    } finally {
      setLoadingDemo(false);
    }
  };

  const handleSplitAtPlayhead = useCallback(() => {
    const active = resolveTimelineClipAt(clips, timelineTime);
    if (!active.clip) return;
    const splitPoint = Math.max(
      active.clip.trimStart + 0.25,
      Math.min(active.clip.trimEnd - 0.25, active.sourceTime),
    );
    const createdId = splitClip(active.clip.id, splitPoint);
    if (createdId) {
      setExportStatus(`Split "${active.clip.name}" cleanly at ${formatTimecode(timelineTime)}.`);
    } else {
      setExportStatus("Move the playhead at least 0.25s inside a clip to split it.");
    }
  }, [clips, timelineTime, splitClip]);

  const togglePlay = () => {
    if (clips.length === 0) return;
    if (playing) {
      setPlaying(false);
      videoRef.current?.pause();
      musicAudioRef.current?.pause();
      voiceAudioRef.current?.pause();
    } else {
      if (timelineTime >= totalEffectiveDuration - 0.05) {
        setTimelineTime(0);
      }
      setPlaying(true);
    }
  };

  /**
   * Real Frame + Audio Beat Multimodal AI Analysis & Auto-Editing!
   */
  const runAiAnalyzeAndEdit = useCallback(
    async (instructionText: string, speakReply = false) => {
      const currentClips = useVideoStore.getState().clips;
      if (currentClips.length === 0) {
        setExportStatus("Import video/photo clips or click Load Demo first so JARVIS has footage to analyze.");
        return;
      }

      setAnalyzingAi(true);
      setExportStatus("Sampling real video keyframes & analyzing audio beats…");
      try {
        // 1. Sample real visual frames across timeline clips
        const allFrames: Array<{ clipIndex: number; timestampSec: number; imageBase64: string }> = [];
        for (let idx = 0; idx < Math.min(currentClips.length, 4); idx++) {
          const clip = currentClips[idx];
          if (clip.src) {
            const sampled = await extractMediaKeyframes(
              clip.src,
              clip.mediaType || "video",
              clip.duration,
              currentClips.length > 2 ? 1 : 2,
            );
            for (const f of sampled) {
              allFrames.push({
                clipIndex: idx,
                timestampSec: f.timestampSec,
                imageBase64: f.imageBase64,
              });
            }
          }
        }

        // 2. If no external music loaded, try analyzing audio directly from Clip 1's video track
        const store = useVideoStore.getState();
        let activeBpm = store.bpm;
        let activeBeats = store.beats;
        if (activeBeats.length === 0 && currentClips[0]?.src && currentClips[0].mediaType !== "image") {
          const embedded = await analyzeMediaAudioUrl(currentClips[0].src);
          if (embedded.beats.length > 0) {
            activeBpm = embedded.bpm;
            activeBeats = embedded.beats;
            store.setMusicTrack({
              url: "",
              name: `${currentClips[0].name} (Video Audio)`,
              bpm: embedded.bpm,
              beats: embedded.beats,
              waveform: embedded.waveform,
            });
          }
        }

        // 3. Call Gemini multimodal AI Video Director backend
        const res = await agentApi.aiAnalyzeVideoEdit({
          instruction: instructionText || "Analyze frames and audio beats and create an engaging CapCut cut.",
          clips: currentClips.map((c, idx) => ({
            index: idx,
            name: c.name,
            duration: c.duration,
            trimStart: c.trimStart,
            trimEnd: c.trimEnd,
            speed: c.speed,
            mediaType: c.mediaType,
          })),
          frames: allFrames,
          beatInfo: {
            bpm: activeBpm,
            beats: activeBeats,
            musicName: store.musicName || undefined,
          },
        });

        setFrameInsights(res.frameInsights);
        const summary = applyAiEditPlan(res.plan as AiEditPlanPayload);
        setExportStatus(`${summary} (${res.via})`);
        if (speakReply) {
          void speak(summary);
        }
      } catch (err) {
        setExportStatus(err instanceof Error ? err.message : "AI analysis failed.");
      } finally {
        setAnalyzingAi(false);
        setAiPrompt("");
      }
    },
    [applyAiEditPlan],
  );

  /**
   * Executes live spoken voice instructions inside the editor!
   */
  const executeVoiceEditCommand = useCallback(
    async (spoken: string) => {
      const q = spoken.trim().toLowerCase();
      if (!q) return;
      setLiveTranscript(spoken);

      if (/^(play|start playback|resume)\b/.test(q)) {
        setPlaying(true);
        void speak("Playing timeline.");
        return;
      }
      if (/^(pause|stop playing|halt)\b/.test(q)) {
        setPlaying(false);
        void speak("Paused.");
        return;
      }
      if (/\bundo\b/.test(q)) {
        const ok = undo();
        void speak(ok ? "Undid the last edit." : "Nothing to undo.");
        return;
      }
      if (/\bredo\b/.test(q)) {
        const ok = redo();
        void speak(ok ? "Redid edit." : "Nothing to redo.");
        return;
      }
      if (/\b(split|cut here|chop here)\b/.test(q)) {
        handleSplitAtPlayhead();
        void speak("Split clip at playhead.");
        return;
      }
      if (/\b(sync.*beat|beat.*sync|on the beat)\b/.test(q) && q.length < 32) {
        const msg = syncClipsToBeats();
        setExportStatus(msg);
        void speak(msg);
        return;
      }

      // Full AI multimodal frame + audio edit for natural creative voice directions!
      await runAiAnalyzeAndEdit(spoken, true);
    },
    [undo, redo, handleSplitAtPlayhead, syncClipsToBeats, runAiAnalyzeAndEdit],
  );

  const toggleLiveVoiceDirector = () => {
    if (liveVoiceActive) {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      setLiveVoiceActive(false);
      return;
    }

    const SpeechRec =
      (window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition;

    if (!SpeechRec) {
      setExportStatus("Live SpeechRecognition unavailable in this headless browser — type your AI voice direction below.");
      return;
    }

    try {
      const rec = new SpeechRec() as {
        continuous: boolean;
        interimResults: boolean;
        lang: string;
        onresult: (ev: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void;
        onerror: () => void;
        onend: () => void;
        start: () => void;
        stop: () => void;
      };
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = "en-US";
      rec.onresult = (ev) => {
        const last = ev.results[ev.results.length - 1];
        const text = last?.[0]?.transcript || "";
        setLiveTranscript(text);
        if (last?.isFinal && text.trim()) {
          void executeVoiceEditCommand(text.trim());
        }
      };
      rec.onerror = () => setLiveVoiceActive(false);
      rec.onend = () => setLiveVoiceActive(false);
      rec.start();
      recognitionRef.current = rec;
      setLiveVoiceActive(true);
      setExportStatus("Live Voice Director active — speak cuts, beat sync, grades, or scene edits naturally.");
    } catch {
      setLiveVoiceActive(false);
    }
  };

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  const generateVoiceAndCaptions = async () => {
    if (!narrationText.trim()) return;
    setGeneratingVoiceover(true);
    const cues = generateTimedCaptions(narrationText, Math.max(2, totalEffectiveDuration || 4));
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
        setExportStatus(`Generated ${cues.length} timed caption cue(s).`);
      }
    } catch {
      setExportStatus(`Generated ${cues.length} timed caption cue(s).`);
    } finally {
      setGeneratingVoiceover(false);
    }
  };

  const scrubTimelineFromPointer = (clientX: number) => {
    const bar = timelineBarRef.current;
    if (!bar || totalEffectiveDuration <= 0) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
    const nextT = Number((ratio * totalEffectiveDuration).toFixed(2));
    setTimelineTime(nextT);
    const resolved = resolveTimelineClipAt(clips, nextT);
    if (resolved.clip) setSelectedId(resolved.clip.id);
  };

  const exportFullTimelineWebm = async () => {
    if (clips.length === 0) return;
    setExportStatus("Rendering full multi-clip timeline to WebM…");
    try {
      const canvas = document.createElement("canvas");
      canvas.width = aspectRatio === "9:16" ? 540 : aspectRatio === "1:1" ? 720 : 960;
      canvas.height = aspectRatio === "9:16" ? 960 : aspectRatio === "1:1" ? 720 : 540;
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

      const totalSteps = Math.max(24, Math.min(96, Math.round(totalEffectiveDuration * 12)));
      for (let f = 0; f < totalSteps; f++) {
        const t = (f / Math.max(1, totalSteps - 1)) * totalEffectiveDuration;
        const m = resolveTimelineClipAt(clips, t);
        const clip = m.clip;
        if (!clip) continue;

        const kb = computeKenBurnsTransform(clip.motionPreset, m.progress01);
        ctx.save();
        ctx.filter = buildCssFilter(clip);
        ctx.fillStyle = "#080c14";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.translate(canvas.width / 2 + (kb.translateXPercent / 100) * canvas.width, canvas.height / 2);
        ctx.scale(kb.scale, kb.scale);
        ctx.translate(-canvas.width / 2, -canvas.height / 2);

        const vid = videoRef.current;
        if (vid && clip.src && clip.mediaType !== "image" && vid.readyState >= 2) {
          ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);
        } else {
          ctx.fillStyle = "#22d3ee";
          ctx.font = "600 24px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(clip.name, canvas.width / 2, canvas.height / 2);
        }
        ctx.restore();

        if (clip.overlayText) {
          ctx.fillStyle = "rgba(8, 12, 20, 0.72)";
          ctx.fillRect(40, canvas.height - 86, canvas.width - 80, 44);
          ctx.fillStyle = "#ffffff";
          ctx.font = "600 20px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(clip.overlayText, canvas.width / 2, canvas.height - 56);
        }

        const cap = captions.find((c) => t >= c.start && t <= c.end)?.text;
        if (cap) {
          ctx.fillStyle = "rgba(8, 12, 20, 0.8)";
          ctx.fillRect(60, canvas.height - 52, canvas.width - 120, 32);
          ctx.fillStyle = "#e2e8f0";
          ctx.font = "500 15px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(cap, canvas.width / 2, canvas.height - 31);
        }

        await new Promise((r) => setTimeout(r, 32));
      }

      rec.stop();
      const blob = await done;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `jarvis-capcut-export.webm`;
      a.click();
      URL.revokeObjectURL(url);
      setExportStatus(`Exported full ${formatTimecode(totalEffectiveDuration)} timeline (${aspectRatio}) as WebM.`);
    } catch (err) {
      setExportStatus(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Compute transition flash / fade opacity cleanly when entering a clip
  const transitionOverlayAlpha =
    displayClip?.transition === "flash" && activeMapping.progress01 < 0.14
      ? Math.max(0, 0.75 * (1 - activeMapping.progress01 / 0.14))
      : 0;
  const fadeClipOpacity =
    displayClip?.transition === "fade" && activeMapping.progress01 < 0.18
      ? Math.min(1, activeMapping.progress01 / 0.18)
      : 1;

  return (
    <div
      className="flex h-full flex-col"
      onDragOver={(e) => {
        e.preventDefault();
        setDraggingMedia(true);
      }}
      onDragLeave={() => setDraggingMedia(false)}
      onDrop={handleDropMedia}
    >
      {/* CapCut Studio Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="font-display text-sm font-semibold text-fg">JARVIS CapCut AI Studio</h1>
            <p className="text-[11px] text-fg-muted">
              Voice-Directed NLE · Audio Beat Sync · Frame Vision · All Media Formats
            </p>
          </div>
          <div className="hidden items-center gap-1 rounded-lg border border-border bg-elevated p-0.5 sm:flex">
            {(["16:9", "9:16", "1:1"] as AspectRatio[]).map((ratio) => (
              <button
                key={ratio}
                type="button"
                onClick={() => setAspectRatio(ratio)}
                className={cn(
                  "rounded px-2 py-0.5 font-mono text-[10px] font-medium transition-colors",
                  aspectRatio === ratio ? "bg-accent text-background" : "text-fg-muted hover:text-fg",
                )}
              >
                {ratio}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <input
            ref={mediaInputRef}
            type="file"
            multiple
            accept="video/*,image/*,audio/*,.mkv,.mov,.avi,.flv,.wmv,.webm,.mp4,.heic,.avif"
            onChange={handleMediaUpload}
            className="hidden"
          />
          <input
            ref={musicInputRef}
            type="file"
            accept="audio/*"
            onChange={(e) => void handleMusicUpload(e)}
            className="hidden"
          />

          <button
            type="button"
            disabled={historyPast.length === 0}
            onClick={() => undo()}
            title="Undo last edit"
            className="rounded-lg border border-border bg-elevated p-1.5 text-fg-muted hover:text-fg disabled:opacity-35"
          >
            <Undo2 size={13} />
          </button>
          <button
            type="button"
            disabled={historyFuture.length === 0}
            onClick={() => redo()}
            title="Redo edit"
            className="rounded-lg border border-border bg-elevated p-1.5 text-fg-muted hover:text-fg disabled:opacity-35"
          >
            <Redo2 size={13} />
          </button>

          <button
            type="button"
            onClick={() => void loadSampleProject()}
            disabled={loadingDemo}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-elevated px-2.5 py-1.5 text-xs font-medium text-fg transition-colors hover:border-accent"
          >
            <Plus size={12} /> {loadingDemo ? "Loading…" : "Load Sample Clip"}
          </button>
          <button
            type="button"
            onClick={() => mediaInputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-elevated px-2.5 py-1.5 text-xs font-medium text-fg transition-colors hover:border-accent"
          >
            <Upload size={12} /> Import Media
          </button>
          <button
            type="button"
            onClick={() => musicInputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-elevated px-2.5 py-1.5 text-xs font-medium text-fg transition-colors hover:border-accent"
          >
            <Music size={12} /> {musicName ? "Change Audio" : "Add Audio"}
          </button>
          <button
            type="button"
            disabled={clips.length === 0}
            onClick={() => void exportFullTimelineWebm()}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-background disabled:opacity-40"
          >
            <Download size={12} /> Export WebM
          </button>
        </div>
      </div>

      {/* Live Voice & AI Multimodal Director Bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-background/55 px-4 py-2">
        <button
          type="button"
          onClick={toggleLiveVoiceDirector}
          className={cn(
            "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
            liveVoiceActive
              ? "border-red-500 bg-red-500/20 text-red-400"
              : "border-accent bg-accent/15 text-accent hover:bg-accent hover:text-background",
          )}
        >
          {liveVoiceActive ? <MicOff size={13} /> : <Mic size={13} />}
          {liveVoiceActive ? "Listening Live (Tap to Stop)" : "Live Talk & Edit"}
        </button>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (aiPrompt.trim()) void executeVoiceEditCommand(aiPrompt.trim());
          }}
          className="flex min-w-60 flex-1 items-center gap-1.5"
        >
          <input
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            placeholder="Tell JARVIS how to edit: e.g. 'analyze frames & sync cuts to beats, make it cinematic 9:16'"
            className="min-w-0 flex-1 rounded-lg border border-border bg-elevated px-3 py-1.5 text-xs text-fg outline-none focus:border-accent"
          />
          <button
            type="button"
            disabled={analyzingAi || clips.length === 0}
            onClick={() => void runAiAnalyzeAndEdit(aiPrompt.trim(), false)}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-background disabled:opacity-40"
          >
            <Sparkles size={12} />
            {analyzingAi ? "Analyzing…" : "AI Analyze Frames & Beats"}
          </button>
        </form>

        <button
          type="button"
          disabled={clips.length === 0}
          onClick={() => setExportStatus(syncClipsToBeats())}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-elevated px-2.5 py-1.5 text-xs font-medium text-fg hover:border-accent disabled:opacity-40"
        >
          <Activity size={12} className="text-accent" />
          Beat Sync ({bpm} BPM)
        </button>
      </div>

      {(exportStatus || lastAutoEditSummary || frameInsights || liveTranscript) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-elevated/80 px-4 py-1.5 text-[11px]">
          <div className="flex flex-wrap items-center gap-2 text-accent">
            <Wand2 size={12} />
            <span>{frameInsights || lastAutoEditSummary || exportStatus}</span>
            {liveTranscript && <span className="text-fg-muted">Voice: &ldquo;{liveTranscript}&rdquo;</span>}
          </div>
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
      {musicUrl && <audio ref={musicAudioRef} src={musicUrl} loop className="hidden" />}

      {/* Main 3-Panel Studio Stage */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 lg:grid-cols-12">
        {/* Left: Quick AI Presets & Media Pool */}
        <div className="hud-panel flex flex-col gap-3 p-3 lg:col-span-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
            One-Tap AI Cuts & Styles
          </p>
          <div className="grid grid-cols-1 gap-1.5">
            {[
              {
                label: "Beat-Sync Hype Montage",
                cmd: "Analyze video frames & sync tight flash cuts to audio beats with vivid grade",
              },
              {
                label: "9:16 TikTok / Reels Cut",
                cmd: "Switch to 9:16 vertical, zoom in motion, punchy hook title",
              },
              {
                label: "Cinematic Film Grade",
                cmd: "Apply Stark Cinematic color grade with smooth fade transitions",
              },
              {
                label: "Noir Trailer Cut",
                cmd: "Make it Noir B&W high contrast slow cinematic trailer",
              },
            ].map((preset) => (
              <button
                key={preset.label}
                type="button"
                disabled={clips.length === 0 || analyzingAi}
                onClick={() => void runAiAnalyzeAndEdit(preset.cmd, false)}
                className="hud-elevated flex items-center justify-between px-2.5 py-2 text-left text-xs text-fg transition-colors hover:border-accent disabled:opacity-40"
              >
                <span>{preset.label}</span>
                <Sparkles size={11} className="text-accent" />
              </button>
            ))}
          </div>

          <div className="border-t border-border pt-2.5">
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                Audio & Beat Track
              </p>
              {musicName && (
                <button
                  type="button"
                  onClick={clearMusicTrack}
                  className="text-[10px] text-fg-muted hover:text-red-400"
                >
                  Clear
                </button>
              )}
            </div>
            {musicName ? (
              <div className="hud-elevated space-y-1 p-2.5 text-xs">
                <p className="truncate font-medium text-fg">{musicName}</p>
                <p className="font-mono text-[10px] text-accent">
                  {bpm} BPM · {beats.length} beat markers
                </p>
              </div>
            ) : (
              <p className="text-[11px] text-fg-muted">
                Drop any audio or video track to detect BPM & beat drops automatically.
              </p>
            )}
          </div>
        </div>

        {/* Center: Aspect-Locked Monitor & Transport */}
        <div className="flex flex-col gap-2.5 lg:col-span-6">
          <div
            className={cn(
              "hud-panel relative flex flex-1 items-center justify-center overflow-hidden bg-[#060910] p-2",
              draggingMedia && "border-accent bg-accent/10",
            )}
          >
            <div
              className={cn(
                "relative flex items-center justify-center overflow-hidden rounded-lg bg-black shadow-2xl",
                aspectRatio === "9:16"
                  ? "aspect-[9/16] h-full max-h-[360px]"
                  : aspectRatio === "1:1"
                    ? "aspect-square h-full max-h-[340px]"
                    : "aspect-video w-full",
              )}
            >
              {displayClip ? (
                <>
                  {displayClip.src && displayClip.mediaType === "image" ? (
                    <img
                      src={displayClip.src}
                      alt={displayClip.name}
                      className="h-full w-full object-contain transition-transform duration-100"
                      style={{
                        opacity: fadeClipOpacity,
                        filter: buildCssFilter(displayClip),
                        transform: `scale(${kenBurns.scale}) translateX(${kenBurns.translateXPercent}%)`,
                      }}
                    />
                  ) : displayClip.src ? (
                    <video
                      ref={videoRef}
                      src={displayClip.src}
                      preload="auto"
                      playsInline
                      className="h-full w-full object-contain transition-transform duration-100"
                      style={{
                        opacity: fadeClipOpacity,
                        filter: buildCssFilter(displayClip),
                        transform: `scale(${kenBurns.scale}) translateX(${kenBurns.translateXPercent}%)`,
                      }}
                    />
                  ) : (
                    <div
                      className="flex h-full w-full flex-col items-center justify-center gap-2 text-center"
                      style={{
                        opacity: fadeClipOpacity,
                        filter: buildCssFilter(displayClip),
                        transform: `scale(${kenBurns.scale}) translateX(${kenBurns.translateXPercent}%)`,
                      }}
                    >
                      {displayClip.mediaType === "image" ? (
                        <ImageIcon size={30} className="text-accent" />
                      ) : (
                        <Film size={30} className="text-accent" />
                      )}
                      <p className="font-display text-sm font-semibold text-white">{displayClip.name}</p>
                      <p className="font-mono text-[11px] text-slate-400">
                        {formatTimecode(activeMapping.sourceTime)} / {formatTimecode(displayClip.trimEnd)}
                      </p>
                    </div>
                  )}

                  {transitionOverlayAlpha > 0 && (
                    <div
                      className="pointer-events-none absolute inset-0 bg-white"
                      style={{ opacity: transitionOverlayAlpha }}
                    />
                  )}

                  {displayClip.overlayText && (
                    <div
                      className={cn(
                        "pointer-events-none absolute inset-x-6 rounded bg-black/70 px-3 py-1.5 text-center font-display text-base font-semibold text-white",
                        (overlayPositions[displayClip.id] ?? "bottom") === "top"
                          ? "top-4"
                          : (overlayPositions[displayClip.id] ?? "bottom") === "center"
                            ? "top-1/2 -translate-y-1/2"
                            : "bottom-10",
                      )}
                    >
                      {displayClip.overlayText}
                    </div>
                  )}

                  {activeCaption && (
                    <div className="pointer-events-none absolute bottom-2.5 inset-x-8 rounded bg-black/85 px-3 py-1 text-center text-xs font-medium text-slate-100">
                      {activeCaption}
                    </div>
                  )}
                </>
              ) : (
                <div className="px-6 text-center">
                  <Film size={30} className="mx-auto text-fg-muted" />
                  <p className="mt-2 text-sm font-medium text-slate-200">Drop clips, images, or audio here</p>
                  <p className="mt-1 text-xs text-slate-400">
                    Or click Load Sample Clip to test voice editing, frame vision, and beat sync.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Transport Bar */}
          <div className="hud-panel flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={clips.length === 0}
                onClick={() => {
                  setPlaying(false);
                  setTimelineTime(0);
                }}
                title="Jump to start"
                className="rounded-lg border border-border bg-elevated p-1.5 text-fg-muted hover:text-fg disabled:opacity-40"
              >
                <SkipBack size={13} />
              </button>
              <button
                type="button"
                disabled={clips.length === 0}
                onClick={togglePlay}
                className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-background disabled:opacity-40"
              >
                {playing ? <Pause size={13} /> : <Play size={13} />}
                {playing ? "Pause" : "Play"}
              </button>
              <button
                type="button"
                disabled={clips.length === 0}
                onClick={handleSplitAtPlayhead}
                className="flex items-center gap-1 rounded-lg border border-border bg-elevated px-2.5 py-1.5 text-xs font-medium text-fg hover:border-accent disabled:opacity-40"
              >
                <Scissors size={12} /> Split
              </button>
            </div>

            <div className="font-mono text-xs text-fg tabular-nums">
              {formatTimecode(timelineTime)} <span className="text-fg-muted">/ {formatTimecode(totalEffectiveDuration)}</span>
            </div>
          </div>
        </div>

        {/* Right: Tabbed CapCut Inspector */}
        <div className="hud-panel flex flex-col overflow-hidden lg:col-span-3">
          <div className="grid grid-cols-4 border-b border-border bg-elevated/60 text-[11px] font-medium">
            {(
              [
                ["clip", "Clip"],
                ["color", "Color"],
                ["text", "Text"],
                ["voice", "Voice"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setInspectorTab(id)}
                className={cn(
                  "py-2 text-center transition-colors",
                  inspectorTab === id
                    ? "border-b-2 border-accent text-accent"
                    : "text-fg-muted hover:text-fg",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-3.5">
            {inspectorTab === "clip" &&
              (selected ? (
                <>
                  <div>
                    <p className="truncate text-xs font-semibold text-fg">{selected.name}</p>
                    <p className="font-mono text-[10px] text-fg-muted">
                      Effective: {formatTimecode(clipEffectiveDuration(selected))}
                    </p>
                  </div>
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
                      onChange={(e) => updateClip(selected.id, { trimStart: Number(e.target.value) })}
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
                      onChange={(e) => updateClip(selected.id, { trimEnd: Number(e.target.value) })}
                      className="w-full accent-[var(--color-accent)]"
                    />
                  </div>
                  <div>
                    <span className="mb-1 flex items-center gap-1 text-xs text-fg">
                      <Move size={11} /> Motion Keyframe
                    </span>
                    <div className="grid grid-cols-3 gap-1">
                      {MOTION_PRESETS.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => updateClip(selected.id, { motionPreset: m.id })}
                          className={cn(
                            "rounded border px-1.5 py-1 text-[10.5px]",
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
                    <span className="mb-1 block text-xs text-fg">Entry Transition</span>
                    <div className="grid grid-cols-2 gap-1">
                      {TRANSITIONS.map((tr) => (
                        <button
                          key={tr.id}
                          type="button"
                          onClick={() => updateClip(selected.id, { transition: tr.id })}
                          className={cn(
                            "rounded border px-2 py-1 text-[10.5px]",
                            (selected.transition || "none") === tr.id
                              ? "border-accent bg-elevated text-accent"
                              : "border-border bg-surface text-fg-muted",
                          )}
                        >
                          {tr.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <span className="mb-1 block text-xs text-fg">Speed</span>
                    <div className="grid grid-cols-5 gap-1">
                      {[0.5, 0.75, 1, 1.5, 2].map((sp) => (
                        <button
                          key={sp}
                          type="button"
                          onClick={() => updateClip(selected.id, { speed: sp })}
                          className={cn(
                            "rounded border py-1 font-mono text-[10.5px]",
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
                <p className="text-xs text-fg-muted">Select or drop a clip to inspect trim, speed, and transitions.</p>
              ))}

            {inspectorTab === "color" &&
              (selected ? (
                <div className="grid grid-cols-2 gap-1.5">
                  {FILTER_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() =>
                        updateClip(selected.id, {
                          filterPreset: p.id,
                          brightness: p.brightness,
                          contrast: p.contrast,
                          saturate: p.saturate,
                        })
                      }
                      className={cn(
                        "rounded-lg border px-2.5 py-2 text-left text-xs transition-colors",
                        selected.filterPreset === p.id
                          ? "border-accent bg-elevated text-accent"
                          : "border-border text-fg hover:border-accent/50",
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-fg-muted">Add a clip to apply CapCut color grades.</p>
              ))}

            {inspectorTab === "text" &&
              (selected ? (
                <div className="space-y-3">
                  <label className="block text-xs text-fg">
                    <span className="mb-1 flex items-center gap-1">
                      <Type size={12} /> Overlay Title
                    </span>
                    <input
                      value={selected.overlayText}
                      onChange={(e) => updateClip(selected.id, { overlayText: e.target.value }, false)}
                      placeholder="Enter punchy hook or title..."
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
                          "rounded border py-1 text-[11px] capitalize",
                          (overlayPositions[selected.id] ?? "bottom") === pos
                            ? "border-accent bg-elevated text-accent"
                            : "border-border text-fg-muted",
                        )}
                      >
                        {pos}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-fg-muted">Select a clip to attach a title card.</p>
              ))}

            {inspectorTab === "voice" && (
              <div className="space-y-2.5">
                <p className="text-xs text-fg-muted">
                  Generate AI narration audio + auto-synced timeline captions.
                </p>
                <textarea
                  rows={3}
                  value={narrationText}
                  onChange={(e) => setNarrationText(e.target.value)}
                  placeholder="Write script for JARVIS voiceover & timed captions..."
                  className="w-full rounded-lg border border-border bg-elevated px-2.5 py-1.5 text-xs text-fg outline-none focus:border-accent"
                />
                <button
                  type="button"
                  disabled={generatingVoiceover || !narrationText.trim()}
                  onClick={() => void generateVoiceAndCaptions()}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-background disabled:opacity-40"
                >
                  <Captions size={12} />
                  {generatingVoiceover ? "Generating…" : "Generate Voice & Captions"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom CapCut Multi-Track Magnetic Timeline */}
      <div className="shrink-0 border-t border-border bg-background/85 px-4 py-2.5">
        <div className="mb-1.5 flex items-center justify-between text-[11px] text-fg-muted">
          <div className="flex items-center gap-3">
            <span className="font-semibold uppercase tracking-wider">Magnetic Timeline</span>
            <span className="font-mono text-[10px]">
              {clips.length} clip{clips.length === 1 ? "" : "s"} · {captions.length} caption{captions.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span>Zoom</span>
            <input
              type="range"
              min={0.7}
              max={2.2}
              step={0.1}
              value={timelineZoom}
              onChange={(e) => setTimelineZoom(Number(e.target.value))}
              className="w-24 accent-[var(--color-accent)]"
            />
          </div>
        </div>

        {/* Scrollable Multi-Track Canvas with Interactive Scrubber */}
        <div className="overflow-x-auto pb-1">
          <div
            ref={timelineBarRef}
            onPointerDown={(e) => {
              scrubbingRef.current = true;
              scrubTimelineFromPointer(e.clientX);
            }}
            onPointerMove={(e) => {
              if (scrubbingRef.current) scrubTimelineFromPointer(e.clientX);
            }}
            onPointerUp={() => {
              scrubbingRef.current = false;
            }}
            style={{ width: `${Math.max(100, timelineZoom * 100)}%` }}
            className="relative min-w-full cursor-pointer select-none space-y-1.5 rounded-lg border border-border bg-surface/60 p-2"
          >
            {/* Master Playhead Needle */}
            {totalEffectiveDuration > 0 && (
              <div
                className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-accent"
                style={{
                  left: `${Math.max(0, Math.min(100, (timelineTime / totalEffectiveDuration) * 100))}%`,
                }}
              >
                <div className="-ml-1.5 -mt-0.5 h-3 w-3 rotate-45 bg-accent" />
              </div>
            )}

            {/* Track V1: Video & Image Clips */}
            <div className="flex min-h-12 items-stretch gap-1">
              {clips.length === 0 ? (
                <div className="flex flex-1 items-center justify-center rounded border border-dashed border-border text-[11px] text-fg-muted">
                  V1 Video / Photo Track (empty)
                </div>
              ) : (
                clips.map((clip, i) => {
                  const eff = clipEffectiveDuration(clip);
                  const pct = Math.max(8, (eff / Math.max(0.1, totalEffectiveDuration)) * 100);
                  const isSel = clip.id === selected?.id;
                  return (
                    <div
                      key={clip.id}
                      style={{ width: `${pct}%` }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedId(clip.id);
                      }}
                      className={cn(
                        "group relative flex min-w-28 flex-col justify-between rounded border px-2 py-1 text-[11px] transition-colors",
                        isSel
                          ? "border-accent bg-elevated text-fg"
                          : "border-border bg-background/70 text-fg-muted hover:border-accent/50",
                      )}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="truncate font-medium text-fg">
                          {i + 1}. {clip.name}
                        </span>
                        <div className="flex shrink-0 items-center gap-0.5 opacity-80 group-hover:opacity-100">
                          <button
                            type="button"
                            disabled={i === 0}
                            onClick={(e) => {
                              e.stopPropagation();
                              moveClipStep(clip.id, -1);
                            }}
                            className="rounded p-0.5 hover:text-accent disabled:opacity-25"
                            title="Move left"
                          >
                            <ArrowLeft size={10} />
                          </button>
                          <button
                            type="button"
                            disabled={i === clips.length - 1}
                            onClick={(e) => {
                              e.stopPropagation();
                              moveClipStep(clip.id, 1);
                            }}
                            className="rounded p-0.5 hover:text-accent disabled:opacity-25"
                            title="Move right"
                          >
                            <ArrowRight size={10} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteClip(clip.id);
                            }}
                            className="rounded p-0.5 hover:text-red-400"
                            title="Delete clip"
                          >
                            <Trash2 size={10} />
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center justify-between font-mono text-[9.5px] text-fg-muted">
                        <span>{formatTimecode(eff)}</span>
                        <span>
                          {clip.speed}x {clip.filterPreset !== "none" ? `· ${clip.filterPreset}` : ""}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Track A1: Real Waveform & Audio Beat Markers */}
            <div className="relative flex h-9 items-center overflow-hidden rounded border border-border/80 bg-background/60 px-2">
              {waveform.length > 0 ? (
                <div className="flex h-full w-full items-center gap-[2px]">
                  {waveform.map((amp, idx) => (
                    <div
                      key={idx}
                      className="flex-1 rounded-sm bg-accent/55"
                      style={{ height: `${Math.max(14, Math.round(amp * 92))}%` }}
                    />
                  ))}
                </div>
              ) : (
                <span className="text-[10px] text-fg-muted">
                  A1 Audio & Beat Grid {musicName ? `· ${musicName}` : "(Drop audio to analyze waveform & beats)"}
                </span>
              )}

              {/* Beat Transient Diamonds */}
              {totalEffectiveDuration > 0 &&
                beats
                  .filter((b) => b <= totalEffectiveDuration)
                  .map((b, idx) => (
                    <span
                      key={`${b}-${idx}`}
                      title={`Beat @ ${b.toFixed(2)}s`}
                      className="pointer-events-none absolute top-0.5 h-2 w-2 -translate-x-1 rotate-45 bg-amber-400"
                      style={{ left: `${(b / totalEffectiveDuration) * 100}%` }}
                    />
                  ))}
            </div>

            {/* Track T1: Captions / Titles */}
            {captions.length > 0 && (
              <div className="relative flex h-6 items-center rounded border border-border/70 bg-background/50 px-1 text-[10px]">
                {captions.map((cue) => {
                  const dur = Math.max(0.2, totalEffectiveDuration || 4);
                  const leftPct = Math.min(95, (cue.start / dur) * 100);
                  const widthPct = Math.max(6, ((cue.end - cue.start) / dur) * 100);
                  return (
                    <div
                      key={cue.id}
                      style={{ left: `${leftPct}%`, width: `${Math.min(100 - leftPct, widthPct)}%` }}
                      className="absolute truncate rounded border border-accent/40 bg-accent/15 px-1.5 py-0.5 text-fg"
                    >
                      {cue.text}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
