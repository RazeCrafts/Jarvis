import { useRef, useState } from "react";
import { Maximize2, Mic, MicOff, ScanSearch, Send } from "lucide-react";
import { useChatStore, useHudStore, useUiStore } from "@/store";
import { agentService } from "@/lib/agentService";
import { toggleMic } from "@/lib/voiceController";
import { cn } from "@/lib/cn";

export function FloatingBlob() {
  const minimizedToBlob = useUiStore((s) => s.minimizedToBlob);
  const setMinimizedToBlob = useUiStore((s) => s.setMinimizedToBlob);
  const setCircleToSearchOpen = useUiStore((s) => s.setCircleToSearchOpen);
  const blobPos = useHudStore((s) => s.blobPos);
  const setBlobPos = useHudStore((s) => s.setBlobPos);
  const assistantName = useHudStore((s) => s.persona.assistantName || "JARVIS");

  const messages = useChatStore((s) => s.messages);
  const isListening = useChatStore((s) => s.isListening);
  const latestReply = [...messages].reverse().find((m) => m.role === "assistant");

  const [panelOpen, setPanelOpen] = useState(true);
  const [quickInput, setQuickInput] = useState("");
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(
    null,
  );

  if (!minimizedToBlob) return null;

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: blobPos.x,
      origY: blobPos.y,
      moved: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = dragRef.current.startX - e.clientX;
    const dy = dragRef.current.startY - e.clientY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragRef.current.moved = true;
    const maxX = Math.max(24, window.innerWidth - 92);
    const maxY = Math.max(24, window.innerHeight - 92);
    setBlobPos({
      x: Math.max(12, Math.min(maxX, dragRef.current.origX + dx)),
      y: Math.max(12, Math.min(maxY, dragRef.current.origY + dy)),
    });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const wasMoved = dragRef.current.moved;
    dragRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (!wasMoved) setPanelOpen((v) => !v);
  };

  const submitQuick = (e: React.FormEvent) => {
    e.preventDefault();
    const q = quickInput.trim();
    if (!q) return;
    agentService.send(q);
    setQuickInput("");
  };

  return (
    <div
      data-testid="floating-blob-root"
      className="fixed z-50 flex flex-col items-end gap-2.5"
      style={{ right: `${blobPos.x}px`, bottom: `${blobPos.y}px` }}
    >
      {panelOpen && (
        <div className="hud-elevated w-[356px] max-w-[calc(100vw-2rem)] p-3 shadow-2xl">
          <div className="mb-2 flex items-center justify-between gap-2 border-b border-border pb-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />
              <span className="truncate whitespace-nowrap font-display text-xs font-semibold tracking-wider text-fg">
                {assistantName} BLOB
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => setCircleToSearchOpen(true)}
                className="flex items-center gap-1 whitespace-nowrap rounded border border-border bg-background/60 px-2 py-1 text-[11px] text-fg hover:border-accent"
                title="Circle part of screen"
              >
                <ScanSearch size={12} className="text-accent" />
                Circle
              </button>
              <button
                type="button"
                onClick={() => setMinimizedToBlob(false)}
                className="flex items-center gap-1 whitespace-nowrap rounded border border-accent bg-accent/15 px-2 py-1 text-[11px] font-medium text-accent hover:bg-accent hover:text-background"
              >
                <Maximize2 size={11} />
                Restore HUD
              </button>
            </div>
          </div>

          <div className="mb-2.5 max-h-28 overflow-y-auto rounded-lg border border-border/70 bg-background/55 px-2.5 py-2 text-xs text-fg-muted">
            {latestReply?.content
              ? latestReply.content.slice(0, 220) + (latestReply.content.length > 220 ? "…" : "")
              : "Minimized to compact tray mode. Ask anything, drag me anywhere, or circle the screen."}
          </div>

          <form onSubmit={submitQuick} className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void toggleMic("manual")}
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border",
                isListening
                  ? "border-accent bg-accent text-background"
                  : "border-border bg-surface text-fg hover:border-accent",
              )}
              title="Voice Input"
            >
              {isListening ? <MicOff size={13} /> : <Mic size={13} />}
            </button>
            <input
              type="text"
              value={quickInput}
              onChange={(e) => setQuickInput(e.target.value)}
              placeholder={`Message ${assistantName}...`}
              className="min-w-0 flex-1 rounded-lg border border-border bg-background/80 px-2.5 py-1.5 text-xs text-fg outline-none focus:border-accent"
            />
            <button
              type="submit"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-background hover:opacity-90"
              title="Send"
            >
              <Send size={13} />
            </button>
          </form>
        </div>
      )}

      {/* Draggable Reactor Blob Handle */}
      <button
        type="button"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        aria-label="JARVIS Floating Blob"
        title="Drag to move · Click to toggle quick command bar"
        className="group relative flex h-14 w-14 cursor-grab items-center justify-center rounded-full border-2 border-accent bg-surface shadow-[0_0_24px_var(--color-accent-glow)] active:cursor-grabbing"
      >
        <svg viewBox="0 0 48 48" className="h-9 w-9" aria-hidden>
          <circle cx="24" cy="24" r="18" fill="none" stroke="var(--color-accent)" strokeWidth="1.5" strokeDasharray="5 3" />
          <circle cx="24" cy="24" r="10" fill="none" stroke="var(--color-accent)" strokeWidth="1.5" opacity="0.7" />
          <circle cx="24" cy="24" r="4.5" fill="var(--color-accent)" />
        </svg>
      </button>
    </div>
  );
}
