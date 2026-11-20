import { cn } from "@/lib/cn";

/**
 * In-app header. Window controls are native Windows decorations since
 * Phase 1 (decorations: true), so this only renders the brand mark.
 */
function ArcReactorIcon() {
  const ticks = Array.from({ length: 8 }, (_, i) => i * 45);
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className="drop-shadow-[0_0_6px_rgb(0_212_255/0.7)]"
    >
      <circle cx="12" cy="12" r="9.5" stroke="#00d4ff" strokeWidth="1.4" opacity="0.9" />
      <circle cx="12" cy="12" r="5.5" stroke="#00d4ff" strokeWidth="1.2" opacity="0.65" />
      <circle cx="12" cy="12" r="2" fill="#00d4ff" opacity="0.95" />
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
            strokeWidth="1.1"
            opacity="0.75"
          />
        );
      })}
    </svg>
  );
}

export function TitleBar({ className }: { className?: string }) {
  return (
    <header
      className={cn(
        "relative z-30 flex h-10 shrink-0 items-center justify-between pl-4 pr-3",
        className,
      )}
    >
      <span className="pointer-events-none flex items-center gap-2">
        <ArcReactorIcon />
        <span className="text-[13px] font-medium tracking-[0.08em] text-fg/90">JARVIS</span>
      </span>
    </header>
  );
}
