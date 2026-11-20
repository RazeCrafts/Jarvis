import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Palette, RotateCcw } from "lucide-react";
import { cn } from "@/lib/cn";
import { useOrbStore } from "@/store";
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
          "relative h-5 w-9 rounded-full transition-colors",
          checked ? "bg-accent/40" : "bg-white/10",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all",
            checked ? "left-4.5 bg-accent shadow-[0_0_8px_rgb(0_212_255/0.8)]" : "left-0.5",
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
        <span className="font-mono text-[10px] text-fg/70">{value.toFixed(2)}×</span>
      </span>
      <input
        type="range"
        min={0.5}
        max={1.5}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-[#00d4ff]"
      />
    </label>
  );
}

/**
 * Floating customization panel for the orb: style picker, ring toggle and
 * intensity/speed sliders. Lives on the Home tab, bottom-right.
 */
export function OrbCustomizer() {
  const [open, setOpen] = useState(false);
  const { style, ring, intensity, speed, setStyle, setRing, setIntensity, setSpeed, reset } =
    useOrbStore();

  return (
    <div className="absolute bottom-4 right-4 z-20">
      <AnimatePresence>
        {open && (
          <>
            {/* Click-away layer */}
            <button
              type="button"
              aria-label="Close orb customizer"
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-10 cursor-default"
            />
            <motion.div
              initial={{ opacity: 0, y: 6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.97 }}
              transition={{ duration: 0.16, ease: "easeOut" }}
              className="glass absolute bottom-11 right-0 z-20 w-72 rounded-2xl p-3.5 shadow-2xl"
            >
              <div className="mb-2.5 flex items-center justify-between">
                <h2 className="text-[13px] font-medium tracking-wide">Orb Style</h2>
                <button
                  type="button"
                  onClick={reset}
                  aria-label="Reset orb customization"
                  className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-fg-muted transition-colors hover:bg-white/5 hover:text-fg"
                >
                  <RotateCcw size={11} />
                  Reset
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {ORB_STYLES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setStyle(s.id)}
                    aria-pressed={style === s.id}
                    className={cn(
                      "group flex items-center gap-2.5 rounded-xl border p-2 text-left transition-all",
                      style === s.id
                        ? "border-accent/50 bg-accent/10 shadow-[0_0_14px_rgb(0_212_255/0.15)]"
                        : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]",
                    )}
                  >
                    <span
                      className="h-8 w-8 shrink-0 rounded-full ring-1 ring-white/15"
                      style={{ background: s.preview }}
                    />
                    <span>
                      <span
                        className={cn(
                          "block text-xs font-medium",
                          style === s.id ? "text-accent" : "text-fg",
                        )}
                      >
                        {s.label}
                      </span>
                    </span>
                  </button>
                ))}
              </div>

              <p className="mt-2.5 min-h-8 rounded-lg bg-black/20 px-2.5 py-1.5 text-[11px] leading-relaxed text-fg-muted">
                {ORB_STYLES.find((s) => s.id === style)?.description}
              </p>

              <div className="mt-3 space-y-2.5 border-t border-white/10 pt-3">
                <Toggle checked={ring} onChange={setRing} label="Orbital ring" />
                <Slider label="Intensity" value={intensity} onChange={setIntensity} />
                <Slider label="Speed" value={speed} onChange={setSpeed} />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Customize orb"
        aria-expanded={open}
        className={cn(
          "glass relative z-20 flex h-9 w-9 items-center justify-center rounded-full transition-all",
          open ? "text-accent glow-blue" : "text-fg-muted hover:text-fg",
        )}
      >
        <Palette size={16} strokeWidth={1.7} />
      </button>
    </div>
  );
}
