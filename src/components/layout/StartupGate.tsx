import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/cn";

type BackendPhase =
  | { phase: "starting"; message: string }
  | { phase: "ready" }
  | { phase: "failed"; message: string; detail: string };

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function ArcReactorIcon({ size = 64 }: { size?: number }) {
  const ticks = Array.from({ length: 12 }, (_, i) => i * 30);
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9.5" stroke="var(--color-accent)" strokeWidth="1" opacity="0.9" />
      <circle cx="12" cy="12" r="5.5" stroke="var(--color-accent)" strokeWidth="0.9" opacity="0.65" />
      <circle cx="12" cy="12" r="1.8" fill="var(--color-accent)" opacity="0.95" />
      {ticks.map((deg) => {
        const rad = ((deg + 90) * Math.PI) / 180;
        return (
          <line
            key={deg}
            x1={12 + 7.1 * Math.cos(rad)}
            y1={12 + 7.1 * Math.sin(rad)}
            x2={12 + 9.4 * Math.cos(rad)}
            y2={12 + 9.4 * Math.sin(rad)}
            stroke="var(--color-accent)"
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
    <div className="flex h-full flex-col items-center justify-center gap-5 bg-background">
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 6, ease: "linear", repeat: Infinity }}
      >
        <ArcReactorIcon />
      </motion.div>
      <div className="text-center">
        <p className="font-display text-sm font-semibold tracking-[0.24em] text-fg">JARVIS</p>
        <p className="mt-2 text-xs text-fg-muted">{message}</p>
      </div>
    </div>
  );
}

function StartupError({ failure, onRetry }: { failure: BackendPhase & { phase: "failed" }; onRetry: () => void }) {
  const [copied, setCopied] = useState(false);

  const copyLogs = async () => {
    const text = `JARVIS startup failed\n${failure.message}\n${failure.detail}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 bg-background px-10">
      <ArcReactorIcon size={48} />
      <div className="max-w-md text-center">
        <p className="text-sm font-semibold text-fg">{failure.message}</p>
        <p className="mt-2 text-xs leading-relaxed text-fg-muted">{failure.detail}</p>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={copyLogs}
          className="rounded-lg border border-border px-4 py-2 text-xs text-fg transition hover:border-accent"
        >
          {copied ? "Logs copied" : "Copy logs"}
        </button>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg bg-accent px-4 py-2 text-xs font-medium text-background"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

export function StartupGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<BackendPhase>(
    isTauri ? { phase: "starting", message: "Booting the JARVIS core…" } : { phase: "ready" },
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
        /* wait for event */
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
