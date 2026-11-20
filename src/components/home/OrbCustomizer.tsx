import { RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useHudStore, useOrbStore } from "@/store";
import { ORB_STYLES } from "@/components/orb/styles";

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between"
    >
      <span className="text-xs text-fg-muted">{label}</span>
      <span
        className={cn(
          "relative h-5 w-9 rounded-full border border-border transition-colors",
          checked ? "bg-accent" : "bg-background",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all",
            checked ? "left-4.5 bg-background" : "left-0.5 bg-fg-muted",
          )}
        />
      </span>
    </button>
  );
}

function Slider({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
}) {
  return (
    <label className="block">
      <span className="flex items-center justify-between text-xs text-fg-muted">
        {label}
        <span className="font-mono text-[10px] text-fg tabular-nums">{value.toFixed(2)}x</span>
      </span>
      <input
        type="range"
        min={0.5}
        max={1.5}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-[var(--color-accent)]"
      />
    </label>
  );
}

export function OrbCustomizer({ open, onClose }: { open?: boolean; onClose?: () => void }) {
  const {
    style,
    ring,
    reticle,
    particleDensity,
    intensity,
    speed,
    setStyle,
    setRing,
    setReticle,
    setParticleDensity,
    setIntensity,
    setSpeed,
    reset,
  } = useOrbStore();

  const visualizerAbilities = useHudStore((s) => s.visualizerAbilities);
  const setVisualizerAbilities = useHudStore((s) => s.setVisualizerAbilities);

  if (open === false) return null;

  const activeStyle = ORB_STYLES.find((s) => s.id === style) ?? ORB_STYLES[0];

  return (
    <div className="hud-elevated p-3">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <h2 className="text-xs font-semibold text-fg">Core Visualizer Engine</h2>
          <p className="text-[10px] text-fg-muted">{activeStyle.description}</p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={reset}
            aria-label="Reset core customization"
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-fg-muted hover:text-fg"
          >
            <RotateCcw size={11} /> Reset
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close core customizer"
              className="rounded p-0.5 text-fg-muted hover:text-fg"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        {ORB_STYLES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setStyle(s.id)}
            aria-pressed={style === s.id}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-left transition-colors",
              style === s.id
                ? "border-accent bg-surface text-accent"
                : "border-border bg-background/40 text-fg hover:border-accent/50",
            )}
          >
            <span
              className="h-3.5 w-3.5 shrink-0 rounded-full border border-border"
              style={{ background: s.preview }}
            />
            <span className="truncate text-[10.5px] font-medium leading-tight">{s.label}</span>
          </button>
        ))}
      </div>

      <div className="mt-2.5 space-y-2 border-t border-border pt-2.5">
        <Toggle checked={ring} onChange={setRing} label="Gyroscopic Gimbal Rings" />
        <Toggle checked={reticle} onChange={setReticle} label="HUD Reticle Overlay" />
        <Toggle
          checked={visualizerAbilities}
          onChange={setVisualizerAbilities}
          label="Core Quick Abilities"
        />
        <Slider label="Energy Intensity" value={intensity} onChange={setIntensity} />
        <Slider label="Gyro Speed" value={speed} onChange={setSpeed} />
        <Slider label="Particle Density" value={particleDensity} onChange={setParticleDensity} />
      </div>
    </div>
  );
}
