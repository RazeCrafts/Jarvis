import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/cn";

type BackendPhase =
  | { phase: "starting"; message: string }
  | { phase: "ready" }
  | { phase: "failed"; message: string; detail: string };

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Small arc-reactor mark: glowing ring with radial ticks. */
function ArcReactorIcon({ size = 64 }: { size?: number }) {
  const ticks = Array.from({ length: 12 }, (_, i) => i * 30);
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9.5" stroke="#00d4ff" strokeWidth="1" opacity="0.9" />
      <circle cx="12" cy="12" r="5.5" stroke="#00d4ff" strokeWidth="0.9" opacity="0.65" />
      <circle cx="12" cy="12" r="1.8" fill="#00d4ff" opacity="0.95" />
      {ticks.map((deg) => {
        const rad = ((deg + 90) * Math.PI) / 180;
        const inner = 7.1;
        const outer = 9.4;
        return (
          <line
            key={deg}
            x1={12 + inner * Math.cos(rad)}
            y1={12 + inner * Math.sin(rad)}
            x2={12 + outer * Math.cos(rad)}
            y2={12 + outer * Math.sin(rad)}
            stroke="#00d4ff"
            strokeWidth="0.8"
            opacity="0.7"
          />
        );
      })}
    </svg>
  );
}

function Splash({ message }: { message: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 bg-[#0a0a0f]">
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 6, ease: "linear", repeat: Infinity }}
        className="drop-shadow-[0_0_18px_rgb(0_212_255/0.45)]"
      >
        <ArcReactorIcon />
      </motion.div>
      <div className="text-center">
        <p className="text-sm font-medium tracking-[0.24em] text-fg">JARVIS</p>
        <p className="mt-2 text-xs text-fg/50">{message}</p>
      </div>
      <div className="h-[3px] w-44 overflow-hidden rounded-full bg-white/10">
        <div className="h-full w-1/3 animate-pulse rounded-full bg-[#00d4ff]" />
      </div>
    </div>
  );
}

function StartupError({ failure, onRetry }: { failure: BackendPhase & { phase: "failed" }; onRetry: () => void }) {
  const [copied, setCopied] = useState(false);

  const copyLogs = async () => {
    const text = [
      "JARVIS startup failed",
      `Time: ${new Date().toLocaleString()}`,
      `Message: ${failure.message}`,
      `Detail: ${failure.detail}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 bg-[#0a0a0f] px-10">
      <ArcReactorIcon size={48} />
      <div className="max-w-md text-center">
        <p className="text-sm font-semibold text-fg">{failure.message}</p>
        <p className="mt-2 text-xs leading-relaxed text-fg/55">{failure.detail}</p>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={copyLogs}
          className="rounded-lg border border-white/10 px-4 py-2 text-xs text-fg/80 transition hover:border-[#00d4ff]/50 hover:text-fg"
        >
          {copied ? "Logs copied ✓" : "Copy logs"}
        </button>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg bg-[#00d4ff]/90 px-4 py-2 text-xs font-medium text-[#0a0a0f] transition hover:bg-[#00d4ff]"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

/**
 * In the Tauri window, gate the UI on backend readiness: splash while the
 * core boots, error screen (with copy logs) if it never comes up, and the
 * app itself once /health answers. In the browser (dev-only) there is no
 * Tauri event system, so the app renders directly.
 */
export function StartupGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<BackendPhase>(
    isTauri
      ? { phase: "starting", message: "Booting the JARVIS core…" }
      : { phase: "ready" },
  );
  const retrying = useRef(false);

  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const { listen } = await import("@tauri-apps/api/event");
      try {
        const current = await invoke<BackendPhase>("backend_phase");
        if (!cancelled) setPhase(current);
      } catch {
        // Command not ready yet; the splash stays until an event arrives.
      }
      const off = await listen<BackendPhase>("backend://phase", (event) => {
        if (!cancelled) {
          retrying.current = false;
          setPhase(event.payload);
        }
      });
      if (cancelled) off();
      else unlisten = off;
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const retry = () => {
    if (retrying.current) return;
    retrying.current = true;
    setPhase({ phase: "starting", message: "Restarting the JARVIS core…" });
    void import("@tauri-apps/api/core").then(({ invoke }) => invoke("restart_backend"));
  };

  if (!isTauri) return <>{children}</>;

  return (
    <div className={cn("h-full w-full", phase.phase === "ready" ? "contents" : "absolute inset-0")}>
      {phase.phase === "ready" ? (
        children
      ) : phase.phase === "failed" ? (
        <StartupError failure={phase} onRetry={retry} />
      ) : (
        <Splash message={phase.message} />
      )}
    </div>
  );
}
