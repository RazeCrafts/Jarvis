import { useEffect, useRef, useState } from "react";
import { MonitorUp, ScanSearch, Sparkles, X } from "lucide-react";
import { agentApi } from "@/lib/agentApi";
import { useChatStore, useUiStore } from "@/store";
import { cn } from "@/lib/cn";

interface Point {
  x: number;
  y: number;
}

export function CircleToSearchOverlay() {
  const open = useUiStore((s) => s.circleToSearchOpen);
  const setOpen = useUiStore((s) => s.setCircleToSearchOpen);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bgSnapshotRef = useRef<HTMLImageElement | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [points, setPoints] = useState<Point[]>([]);
  const [bounds, setBounds] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [capturedScreenUrl, setCapturedScreenUrl] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      setPoints([]);
      setBounds(null);
      setResult("");
      setError("");
      setQuery("");
      setCapturedScreenUrl(null);
      bgSnapshotRef.current = null;
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (bgSnapshotRef.current) {
      ctx.drawImage(bgSnapshotRef.current, 0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "rgba(4, 9, 18, 0.25)";
    } else {
      ctx.fillStyle = "rgba(4, 9, 18, 0.42)";
    }
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (bounds && bounds.w > 8 && bounds.h > 8) {
      ctx.clearRect(bounds.x, bounds.y, bounds.w, bounds.h);
      if (bgSnapshotRef.current) {
        ctx.drawImage(
          bgSnapshotRef.current,
          (bounds.x / canvas.width) * bgSnapshotRef.current.naturalWidth,
          (bounds.y / canvas.height) * bgSnapshotRef.current.naturalHeight,
          (bounds.w / canvas.width) * bgSnapshotRef.current.naturalWidth,
          (bounds.h / canvas.height) * bgSnapshotRef.current.naturalHeight,
          bounds.x,
          bounds.y,
          bounds.w,
          bounds.h,
        );
      }
      ctx.fillStyle = "rgba(34, 211, 238, 0.08)";
      ctx.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);
      ctx.strokeStyle = "#22d3ee";
      ctx.lineWidth = 2;
      ctx.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h);
    }

    if (points.length > 1) {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    }
  }, [open, points, bounds, capturedScreenUrl]);

  if (!open) return null;

  const computeBounds = (pts: Point[]) => {
    if (pts.length < 2) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    return {
      x: Math.max(0, minX - 8),
      y: Math.max(0, minY - 8),
      w: Math.max(24, maxX - minX + 16),
      h: Math.max(24, maxY - minY + 16),
    };
  };

  const captureDisplayFrame = async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const video = document.createElement("video");
      video.srcObject = stream;
      await video.play();
      const c = document.createElement("canvas");
      c.width = video.videoWidth || 1280;
      c.height = video.videoHeight || 720;
      c.getContext("2d")?.drawImage(video, 0, 0, c.width, c.height);
      stream.getTracks().forEach((t) => t.stop());
      const dataUrl = c.toDataURL("image/png");
      const img = new Image();
      img.onload = () => {
        bgSnapshotRef.current = img;
        setCapturedScreenUrl(dataUrl);
      };
      img.src = dataUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Screen capture cancelled.");
    }
  };

  const buildSelectionCropDataUrl = (): string => {
    const out = document.createElement("canvas");
    const box = bounds || { x: 40, y: 40, w: Math.min(640, window.innerWidth - 80), h: Math.min(360, window.innerHeight - 80) };
    out.width = Math.max(120, Math.round(box.w));
    out.height = Math.max(90, Math.round(box.h));
    const ctx = out.getContext("2d");
    if (!ctx) return "";

    if (bgSnapshotRef.current) {
      const sx = (box.x / window.innerWidth) * bgSnapshotRef.current.naturalWidth;
      const sy = (box.y / window.innerHeight) * bgSnapshotRef.current.naturalHeight;
      const sw = (box.w / window.innerWidth) * bgSnapshotRef.current.naturalWidth;
      const sh = (box.h / window.innerHeight) * bgSnapshotRef.current.naturalHeight;
      ctx.drawImage(bgSnapshotRef.current, sx, sy, sw, sh, 0, 0, out.width, out.height);
    } else {
      // Fallback: summarize DOM elements intersecting the circled region cleanly onto a raster snapshot
      ctx.fillStyle = "#0b1220";
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.strokeStyle = "#22d3ee";
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, out.width - 2, out.height - 2);
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "13px sans-serif";
      const centerX = box.x + box.w / 2;
      const centerY = box.y + box.h / 2;
      const targetEl = document.elementsFromPoint(centerX, centerY).find(
        (el) => !el.closest("[data-testid='circle-search-overlay']"),
      );
      const text = (targetEl?.textContent || "Selected viewport region").replace(/\s+/g, " ").trim().slice(0, 240);
      ctx.fillText(`JARVIS Circle Selection (${Math.round(box.w)}x${Math.round(box.h)})`, 14, 26);
      ctx.fillStyle = "#94a3b8";
      const words = text.split(" ");
      let line = "";
      let y = 54;
      for (const w of words) {
        if ((line + " " + w).length > 52) {
          ctx.fillText(line, 14, y);
          line = w;
          y += 18;
          if (y > out.height - 16) break;
        } else {
          line = line ? `${line} ${w}` : w;
        }
      }
      if (line && y <= out.height - 16) ctx.fillText(line, 14, y);
    }

    return out.toDataURL("image/png");
  };

  const analyzeSelection = async () => {
    setAnalyzing(true);
    setError("");
    setResult("");
    try {
      const box = bounds || { x: 40, y: 40, w: Math.min(640, window.innerWidth - 80), h: Math.min(360, window.innerHeight - 80) };
      const centerEl = document
        .elementsFromPoint(box.x + box.w / 2, box.y + box.h / 2)
        .find((el) => !el.closest("[data-testid='circle-search-overlay']"));
      const domSnippet = (centerEl?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 400);

      const imageData = buildSelectionCropDataUrl();
      const prompt = [
        query.trim() || "Identify and explain what I circled on the screen, including actionable steps.",
        domSnippet ? `Visible UI text near selection: "${domSnippet}"` : "",
      ]
        .filter(Boolean)
        .join("\n");

      const res = await agentApi.analyzeScreenFrame(imageData, prompt);
      if (res.ok && res.description) {
        setResult(res.description);
        useChatStore.getState().addMessage("assistant", `**Circle-to-Search Result:**\n${res.description}`);
      } else {
        setError(res.error || "Could not analyze circled region.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div
      data-testid="circle-search-overlay"
      className="fixed inset-0 z-[60] select-none"
    >
      <canvas
        ref={canvasRef}
        onPointerDown={(e) => {
          setDrawing(true);
          const pt = { x: e.clientX, y: e.clientY };
          setPoints([pt]);
          setBounds(null);
        }}
        onPointerMove={(e) => {
          if (!drawing) return;
          const pt = { x: e.clientX, y: e.clientY };
          setPoints((prev) => {
            const next = [...prev, pt];
            setBounds(computeBounds(next));
            return next;
          });
        }}
        onPointerUp={() => {
          setDrawing(false);
        }}
        className="h-full w-full cursor-crosshair"
      />

      {/* Top instruction bar */}
      <div className="hud-elevated absolute left-1/2 top-4 flex w-[min(92vw,720px)] -translate-x-1/2 flex-wrap items-center justify-between gap-2 px-4 py-2.5 shadow-2xl">
        <div className="flex items-center gap-2">
          <ScanSearch size={16} className="text-accent" />
          <div>
            <p className="text-xs font-semibold text-fg">Circle-to-Search</p>
            <p className="text-[11px] text-fg-muted">
              Draw a circle anywhere on screen, or freeze an external app window first.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void captureDisplayFrame()}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-background/80 px-2.5 py-1.5 text-xs text-fg hover:border-accent"
          >
            <MonitorUp size={13} className="text-accent" />
            Capture Window
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex items-center gap-1 rounded-lg border border-border bg-background/80 px-2.5 py-1.5 text-xs text-fg-muted hover:text-fg"
          >
            <X size={13} />
            Close
          </button>
        </div>
      </div>

      {/* Bottom query & action dock */}
      <div className="hud-elevated absolute bottom-5 left-1/2 w-[min(92vw,680px)] -translate-x-1/2 p-3 shadow-2xl">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask about what you circled (optional)..."
            className="min-w-0 flex-1 rounded-lg border border-border bg-background/85 px-3 py-1.5 text-xs text-fg outline-none focus:border-accent"
          />
          <button
            type="button"
            disabled={analyzing}
            onClick={() => void analyzeSelection()}
            className={cn(
              "flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-background hover:opacity-90",
              analyzing && "opacity-60",
            )}
          >
            <Sparkles size={13} />
            {analyzing ? "Analyzing…" : bounds ? "Analyze Circled Area" : "Analyze View"}
          </button>
        </div>

        {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
        {result && (
          <div className="mt-2.5 max-h-40 overflow-y-auto rounded-lg border border-border bg-background/70 p-2.5 text-xs text-fg whitespace-pre-wrap">
            {result}
          </div>
        )}
      </div>
    </div>
  );
}
