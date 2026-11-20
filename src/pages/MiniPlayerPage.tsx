import { useEffect, useState } from "react";
import { X } from "lucide-react";
import JarvisOrb from "@/components/JarvisOrb";
import { audioLevel } from "@/lib/voiceEngine";
import { toggleMic } from "@/lib/voiceController";
import { useChatStore } from "@/store";
import { cn } from "@/lib/cn";

/**
 * Compact always-on-top companion window (Tauri "mini" window, #mini route).
 * Shows the orb + JARVIS's latest reply + push-to-talk mic. Reads persisted
 * chat state from localStorage (storage events) since Tauri windows have
 * separate JS contexts.
 */

function useSyncedMessages() {
  const [messages, setMessages] = useState(() => {
    try {
      const raw = localStorage.getItem("jarvis-chat");
      return raw ? (JSON.parse(raw).state?.messages ?? []) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== "jarvis-chat") return;
      try {
        const parsed = event.newValue ? JSON.parse(event.newValue) : null;
        setMessages(parsed?.state?.messages ?? []);
      } catch {
        /* ignore malformed payloads */
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return messages;
}

export default function MiniPlayerPage() {
  const messages = useSyncedMessages();
  const isListening = useChatStore((s) => s.isListening);
  const isSpeaking = useChatStore((s) => s.isSpeaking);
  const [level, setLevel] = useState(0);
  const lastReply = [...messages].reverse().find((m) => m.role === "assistant" && m.content.trim());

  // Real mic amplitude while listening; synthetic envelope while speaking.
  useEffect(() => {
    if (!isListening && !isSpeaking) {
      setLevel(0);
      return;
    }
    let raf = 0;
    const tick = () => {
      setLevel(audioLevel);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isListening, isSpeaking]);

  const handleMic = () => {
    // The backend records and transcribes; the main window sends the turn.
    void toggleMic("manual");
  };

  const hide = async () => {
    try {
      if ("__TAURI_INTERNALS__" in window) {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().hide();
      }
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="flex h-full select-none flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0a0a0f]/90 backdrop-blur-xl">
      {/* drag region */}
      <div data-tauri-drag-region className="flex h-8 shrink-0 items-center justify-between pl-3.5 pr-2">
        <span className="pointer-events-none text-[11px] font-medium tracking-[0.08em] text-fg/80">
          JARVIS
        </span>
        <button
          type="button"
          onClick={() => void hide()}
          aria-label="Hide mini player"
          className="flex h-5 w-5 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-white/10 hover:text-fg"
        >
          <X size={12} />
        </button>
      </div>

      {/* orb */}
      <div className="h-44 shrink-0">
        <JarvisOrb audioLevel={level} />
      </div>

      {/* latest reply */}
      <div className="glass mx-3 mb-2 min-h-14 flex-1 overflow-y-auto rounded-xl px-3 py-2">
        {lastReply ? (
          <p className="text-[11px] leading-relaxed text-fg/85">{lastReply.content}</p>
        ) : (
          <p className="text-[11px] leading-relaxed text-fg-muted">
            Mini player ready. Say "hey JARVIS" or tap the mic.
          </p>
        )}
      </div>

      {/* mic */}
      <div className="flex shrink-0 items-center justify-center pb-3">
        <button
          type="button"
          onClick={handleMic}
          aria-label={isListening ? "Stop listening" : "Start voice input"}
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-full transition-all",
            isListening
              ? "bg-red-500/20 text-red-400 ring-1 ring-red-500/50"
              : "glass text-accent hover:bg-accent/15",
          )}
        >
          <span className={cn("h-2.5 w-2.5 rounded-full", isListening ? "animate-pulse bg-red-400" : "bg-accent shadow-[0_0_8px_rgb(0_212_255/0.8)]")} />
        </button>
      </div>
    </div>
  );
}
