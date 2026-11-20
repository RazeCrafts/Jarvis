import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, Monitor, PhoneCall, PhoneOff, Radio } from "lucide-react";
import { backendBaseUrl } from "@/lib/agentApi";
import { useChatStore } from "@/store";
import { cn } from "@/lib/cn";

function liveWsUrl(): string {
  const base = backendBaseUrl();
  if (base) {
    return `${base.replace(/^http/, "ws").replace(/\/+$/, "")}/ws/live`;
  }
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws/live`;
}

function encodeFloat32ToPcm16Base64(float32: Float32Array): string {
  const pcm = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i += 1) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(pcm.buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 1) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

function decodeBase64Pcm16ToFloat32(base64: string): Float32Array {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.charCodeAt(i);
  }
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i += 1) {
    float32[i] = int16[i] / 32768;
  }
  return float32;
}

export function LiveCallPanel({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<"idle" | "connecting" | "live" | "error">("idle");
  const [statusText, setStatusText] = useState("Ready for duplex voice & optional 1 FPS screen vision.");
  const [muted, setMuted] = useState(false);
  const [screenActive, setScreenActive] = useState(false);
  const [transcript, setTranscript] = useState<Array<{ who: "You" | "JARVIS"; text: string }>>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const frameTimerRef = useRef<number | null>(null);
  const nextStartTimeRef = useRef(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const mutedRef = useRef(false);

  mutedRef.current = muted;

  const setChatListening = useChatStore((s) => s.setListening);
  const setChatSpeaking = useChatStore((s) => s.setSpeaking);

  const flushPlayback = useCallback(() => {
    for (const src of activeSourcesRef.current) {
      try {
        src.stop();
      } catch {
        /* ignore */
      }
    }
    activeSourcesRef.current.clear();
    if (outputCtxRef.current) {
      nextStartTimeRef.current = outputCtxRef.current.currentTime;
    }
    setChatSpeaking(false);
  }, [setChatSpeaking]);

  const stopScreenShare = useCallback(() => {
    if (frameTimerRef.current !== null) {
      window.clearInterval(frameTimerRef.current);
      frameTimerRef.current = null;
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }
    setScreenActive(false);
  }, []);

  const disconnect = useCallback(() => {
    stopScreenShare();
    flushPlayback();
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    if (inputCtxRef.current) {
      void inputCtxRef.current.close().catch(() => undefined);
      inputCtxRef.current = null;
    }
    if (outputCtxRef.current) {
      void outputCtxRef.current.close().catch(() => undefined);
      outputCtxRef.current = null;
    }
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        /* ignore */
      }
      wsRef.current = null;
    }
    setChatListening(false);
    setChatSpeaking(false);
    setStatus("idle");
    setStatusText("Live Call ended.");
  }, [flushPlayback, setChatListening, setChatSpeaking, stopScreenShare]);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  const playPcmChunk = useCallback(
    (base64Data: string) => {
      const ctx = outputCtxRef.current;
      if (!ctx) return;
      if (ctx.state === "suspended") {
        void ctx.resume();
      }
      const samples = decodeBase64Pcm16ToFloat32(base64Data);
      const buffer = ctx.createBuffer(1, samples.length, 24000);
      buffer.getChannelData(0).set(samples);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);

      const now = ctx.currentTime;
      const startAt = Math.max(now, nextStartTimeRef.current);
      nextStartTimeRef.current = startAt + buffer.duration;
      activeSourcesRef.current.add(source);
      setChatSpeaking(true);

      source.onended = () => {
        activeSourcesRef.current.delete(source);
        if (activeSourcesRef.current.size === 0) {
          setChatSpeaking(false);
        }
      };
      source.start(startAt);
    },
    [setChatSpeaking],
  );

  const startCall = async () => {
    disconnect();
    setStatus("connecting");
    setStatusText("Opening Live Duplex Voice link…");

    try {
      const outputCtx = new AudioContext({ sampleRate: 24000 });
      outputCtxRef.current = outputCtx;
      nextStartTimeRef.current = outputCtx.currentTime;

      const ws = new WebSocket(liveWsUrl());
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as {
            type?: string;
            data?: string;
            text?: string;
            message?: string;
          };
          if (msg.type === "ready") {
            setStatus("live");
            setStatusText("Duplex Live Voice online — speak naturally or interrupt anytime.");
            setChatListening(true);
          } else if (msg.type === "audio" && msg.data) {
            playPcmChunk(msg.data);
          } else if (msg.type === "interrupted") {
            flushPlayback();
          } else if (msg.type === "input_transcript" && msg.text) {
            setTranscript((prev) => [...prev.slice(-14), { who: "You", text: msg.text! }]);
          } else if (msg.type === "output_transcript" && msg.text) {
            setTranscript((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.who === "JARVIS") {
                return [...prev.slice(0, -1), { who: "JARVIS", text: `${last.text}${msg.text}` }];
              }
              return [...prev.slice(-14), { who: "JARVIS", text: msg.text! }];
            });
          } else if (msg.type === "error") {
            setStatus("error");
            setStatusText(msg.message || "Live stream error.");
          }
        } catch {
          /* ignore */
        }
      };

      ws.onclose = () => {
        setChatListening(false);
        setChatSpeaking(false);
        setStatus((prev) => (prev === "error" ? "error" : "idle"));
      };

      if (navigator.mediaDevices?.getUserMedia) {
        const micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            sampleRate: 16000,
            echoCancellation: true,
            noiseSuppression: true,
          },
        });
        micStreamRef.current = micStream;
        const inputCtx = new AudioContext({ sampleRate: 16000 });
        inputCtxRef.current = inputCtx;
        const source = inputCtx.createMediaStreamSource(micStream);
        const processor = inputCtx.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (ev) => {
          if (mutedRef.current || ws.readyState !== WebSocket.OPEN) return;
          const samples = ev.inputBuffer.getChannelData(0);
          const b64 = encodeFloat32ToPcm16Base64(samples);
          ws.send(JSON.stringify({ type: "audio", data: b64, mimeType: "audio/pcm;rate=16000" }));
        };

        source.connect(processor);
        processor.connect(inputCtx.destination);
      }
    } catch (err) {
      setStatus("error");
      setStatusText(err instanceof Error ? err.message : "Could not initialize Live Call microphone.");
    }
  };

  const toggleScreenStream = async () => {
    if (screenActive) {
      stopScreenShare();
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setStatusText("Screen sharing is unavailable in this browser context.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 2 }, audio: false });
      screenStreamRef.current = stream;
      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      await video.play();
      const canvas = document.createElement("canvas");
      canvas.width = 768;
      canvas.height = 432;
      const ctx = canvas.getContext("2d");

      stream.getVideoTracks()[0]?.addEventListener("ended", stopScreenShare);

      frameTimerRef.current = window.setInterval(() => {
        if (!ctx || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.72);
        const b64 = dataUrl.replace(/^data:image\/jpeg;base64,/, "");
        wsRef.current.send(JSON.stringify({ type: "video", data: b64, mimeType: "image/jpeg" }));
      }, 1000);

      setScreenActive(true);
      setStatusText("Streaming screen co-pilot at 1 FPS alongside voice.");
    } catch (err) {
      setStatusText(err instanceof Error ? err.message : "Screen share cancelled.");
    }
  };

  return (
    <div className="hud-panel space-y-2.5 border-accent/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Radio
            size={13}
            className={cn(status === "live" ? "animate-pulse text-emerald-400" : "text-accent")}
          />
          <span className="font-display text-xs font-semibold text-fg">Live Duplex Voice</span>
        </div>
        <button
          type="button"
          onClick={() => {
            disconnect();
            onClose();
          }}
          className="text-[11px] text-fg-muted hover:text-fg"
        >
          Hide
        </button>
      </div>

      <p className="text-[11px] leading-snug text-fg-muted">{statusText}</p>

      <div className="flex flex-wrap gap-1.5">
        {status !== "live" && status !== "connecting" ? (
          <button
            type="button"
            onClick={() => void startCall()}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-medium text-background"
          >
            <PhoneCall size={12} /> Start Live Call
          </button>
        ) : (
          <button
            type="button"
            onClick={disconnect}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-red-500 px-2.5 py-1.5 text-xs font-medium text-white"
          >
            <PhoneOff size={12} /> End Call
          </button>
        )}

        <button
          type="button"
          onClick={() => setMuted((m) => !m)}
          disabled={status !== "live"}
          title={muted ? "Unmute mic" : "Mute mic"}
          className="rounded-lg border border-border bg-elevated px-2.5 py-1.5 text-xs text-fg disabled:opacity-40"
        >
          {muted ? <MicOff size={12} className="text-red-400" /> : <Mic size={12} />}
        </button>

        <button
          type="button"
          onClick={() => void toggleScreenStream()}
          disabled={status !== "live"}
          title="Share Screen (1 FPS Co-Pilot)"
          className={cn(
            "rounded-lg border px-2.5 py-1.5 text-xs disabled:opacity-40",
            screenActive
              ? "border-accent bg-accent/15 text-accent"
              : "border-border bg-elevated text-fg",
          )}
        >
          <Monitor size={12} />
        </button>
      </div>

      {transcript.length > 0 && (
        <div className="max-h-28 space-y-1 overflow-y-auto rounded-lg border border-border bg-background/60 p-2 text-[11px]">
          {transcript.map((item, idx) => (
            <p key={idx} className="leading-snug">
              <span className={cn("font-semibold", item.who === "JARVIS" ? "text-accent" : "text-fg")}>
                {item.who}:{" "}
              </span>
              <span className="text-fg-muted">{item.text}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
