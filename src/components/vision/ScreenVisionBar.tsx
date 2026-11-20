import { useEffect, useRef, useState } from "react";
import { Eye, Loader2, MonitorUp, Radio, X } from "lucide-react";
import { agentApi } from "@/lib/agentApi";
import { useChatStore } from "@/store";
import { cn } from "@/lib/cn";

export function ScreenVisionBar({ onClose }: { onClose?: () => void }) {
  const [sharing, setSharing] = useState(false);
  const [autoWatch, setAutoWatch] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [question, setQuestion] = useState("");
  const [lastNote, setLastNote] = useState("");
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const stopCapture = () => {
    setAutoWatch(false);
    setSharing(false);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  useEffect(() => () => stopCapture(), []);

  const startCapture = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      stream.getVideoTracks()[0]?.addEventListener("ended", () => stopCapture());
      setSharing(true);
      setLastNote("Screen capture active. Ready to read your screen.");
    } catch (err) {
      setLastNote(err instanceof Error ? err.message : "Screen capture cancelled.");
    }
  };

  const scanFrame = async () => {
    const video = videoRef.current;
    if (!video || !sharing || video.videoWidth === 0) return;
    setAnalyzing(true);
    try {
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 1280 / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/png");
      const res = await agentApi.analyzeScreenFrame(dataUrl, question);
      if (res.ok && res.description) {
        setLastNote(res.description);
        useChatStore.getState().addMessage("assistant", `Screen Vision:\n${res.description}`);
      } else if (res.error) {
        setLastNote(res.error);
      }
    } catch (err) {
      setLastNote(err instanceof Error ? err.message : "Vision scan failed");
    } finally {
      setAnalyzing(false);
    }
  };

  useEffect(() => {
    if (!autoWatch || !sharing) return;
    const timer = window.setInterval(() => {
      void scanFrame();
    }, 8000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoWatch, sharing, question]);

  return (
    <div className="hud-panel mb-2 flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
      <video ref={videoRef} muted playsInline className="hidden" />
      <span className="flex items-center gap-1.5 font-medium text-accent">
        <Eye size={14} /> Screen Vision
      </span>

      {!sharing ? (
        <button
          type="button"
          onClick={() => void startCapture()}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-background transition-opacity hover:opacity-90"
        >
          <MonitorUp size={13} /> Share Screen / Window
        </button>
      ) : (
        <>
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Optional question about screen..."
            className="min-w-44 flex-1 rounded-lg border border-border bg-elevated px-2.5 py-1 text-xs text-fg outline-none placeholder:text-fg-muted focus:border-accent"
          />
          <button
            type="button"
            disabled={analyzing}
            onClick={() => void scanFrame()}
            className="flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-background disabled:opacity-50"
          >
            {analyzing ? <Loader2 size={12} className="animate-spin" /> : <Eye size={12} />}
            Read Now
          </button>
          <button
            type="button"
            onClick={() => setAutoWatch((v) => !v)}
            className={cn(
              "flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
              autoWatch
                ? "border-accent bg-accent/15 text-accent"
                : "border-border bg-elevated text-fg-muted hover:text-fg",
            )}
          >
            <Radio size={12} /> {autoWatch ? "Live Watch On" : "Live Watch (8s)"}
          </button>
          <button
            type="button"
            onClick={stopCapture}
            className="rounded-lg border border-border px-2 py-1 text-xs text-fg-muted hover:text-fg"
          >
            Stop
          </button>
        </>
      )}

      {lastNote && (
        <span className="max-w-xs truncate text-[11px] text-fg-muted" title={lastNote}>
          {lastNote}
        </span>
      )}

      {onClose && (
        <button
          type="button"
          onClick={() => {
            stopCapture();
            onClose();
          }}
          aria-label="Close Screen Vision bar"
          className="ml-auto rounded p-1 text-fg-muted hover:text-fg"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}
