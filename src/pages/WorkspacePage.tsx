import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Box, Eraser, Maximize2, Minimize2, Sparkles } from "lucide-react";
import { ArtifactRenderer } from "@/components/workspace/ArtifactRenderer";
import { agentApi } from "@/lib/agentApi";
import { agentService } from "@/lib/agentService";
import type { Artifact } from "@/lib/artifacts";
import { useUiStore, useWorkspaceStore } from "@/store";

const EXAMPLES: { label: string; hint: string; prompt: string }[] = [
  { label: "3D Satellite", hint: "solar panels + orbit", prompt: "build a 3D orbital satellite with gold solar panels and telemetry dish" },
  { label: "Solar System", hint: "orbiting planets", prompt: "build an animated solar system with orbiting planets around a glowing sun" },
  { label: "To-do App", hint: "add · complete · delete", prompt: "create a to-do app with add, complete and delete" },
  { label: "SVG Emblem", hint: "arc reactor vector", prompt: "design an SVG logo for JARVIS: a geometric arc core emblem" },
  { label: "Physics Sandbox", hint: "canvas gravity", prompt: "make a bouncing ball simulation in an HTML canvas with gravity" },
];

export default function WorkspacePage() {
  const artifacts = useWorkspaceStore((s) => s.artifacts);
  const activeId = useWorkspaceStore((s) => s.activeId);
  const setActive = useWorkspaceStore((s) => s.setActive);
  const clear = useWorkspaceStore((s) => s.clear);
  const replaceArtifacts = useWorkspaceStore((s) => s.replaceArtifacts);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const [fullscreen, setFullscreen] = useState(false);
  const [syncing, setSyncing] = useState(true);
  const [bridgeStatus, setBridgeStatus] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);

  const active = artifacts.find((a) => a.id === activeId) ?? artifacts[artifacts.length - 1] ?? null;

  useEffect(() => {
    mounted.current = true;
    agentApi
      .listArtifacts()
      .then((result) => {
        if (!mounted.current) return;
        if (result.artifacts.length > 0) {
          replaceArtifacts(
            result.artifacts.map((raw) => ({ ...(raw as unknown as Artifact), remote: true })),
          );
        }
      })
      .catch(() => {
        /* offline tolerance */
      })
      .finally(() => {
        if (mounted.current) setSyncing(false);
      });
    return () => {
      mounted.current = false;
    };
  }, [replaceArtifacts]);

  const toggleFullscreen = async () => {
    const el = panelRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        setFullscreen(false);
      } else {
        await el.requestFullscreen();
        setFullscreen(true);
      }
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const clearAll = async () => {
    clear();
    try {
      await agentApi.clearArtifacts();
    } catch {
      /* ignore */
    }
  };

  const sendToBlender = async () => {
    if (!active) return;
    const pyScript = `import bpy\n# JARVIS Workshop -> Blender Bridge: ${active.title}\nbpy.ops.mesh.primitive_cube_add(size=2)\nprint("Loaded Workshop concept: ${active.title}")`;
    const res = await agentApi.sendBlenderScript(pyScript).catch(() => ({ ok: false, error: "Desktop Bridge unavailable." }));
    setBridgeStatus(res.ok ? `Sent "${active.title}" to Blender Bridge.` : res.error || "Requires Desktop Bridge.");
  };

  const build = (prompt: string) => {
    setActiveTab("home");
    agentService.send(prompt);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-baseline gap-2.5">
          <h1 className="font-display text-base font-semibold tracking-tight text-fg">Workshop</h1>
          <span className="text-xs text-fg-muted">3D Models · Interactive Apps · SVG Schematics</span>
          {active?.version && active.version > 1 && (
            <span className="font-mono text-[11px] text-accent">
              {active.title} · v{active.version}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {active?.kind === "three" && (
            <button
              type="button"
              onClick={() => void sendToBlender()}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-elevated px-2.5 py-1.5 text-xs text-fg transition-colors hover:border-accent"
            >
              <Box size={13} className="text-accent" /> Blender Bridge
            </button>
          )}
          <button
            type="button"
            onClick={() => void clearAll()}
            disabled={artifacts.length === 0}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-fg-muted transition-colors hover:bg-elevated hover:text-fg disabled:opacity-40"
          >
            <Eraser size={13} /> Clear
          </button>
          <button
            type="button"
            onClick={() => void toggleFullscreen()}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-fg-muted transition-colors hover:bg-elevated hover:text-fg"
          >
            {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            {fullscreen ? "Exit" : "Fullscreen"}
          </button>
        </div>
      </div>

      {bridgeStatus && (
        <div className="border-b border-border bg-elevated px-5 py-1.5 text-xs text-accent">
          {bridgeStatus}
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-3 p-4">
        <div className="hud-panel flex w-[34%] flex-col overflow-hidden">
          <div className="border-b border-border px-4 py-2.5">
            <p className="text-[11px] font-medium uppercase tracking-wider text-fg-muted">Builds & Diagrams</p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
            {artifacts.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
                <Sparkles size={22} strokeWidth={1.5} className="text-accent" />
                <div>
                  <p className="text-sm font-medium text-fg">{syncing ? "Loading workshop…" : "Workshop Bench Ready"}</p>
                  <p className="mt-1 text-xs leading-relaxed text-fg-muted">
                    Ask JARVIS to design 3D models, interactive web tools, or expand any live chart here.
                  </p>
                </div>
                <div className="grid w-full grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {EXAMPLES.map((example) => (
                    <button
                      key={example.label}
                      type="button"
                      onClick={() => build(example.prompt)}
                      className="hud-elevated p-2.5 text-left transition-colors hover:border-accent"
                    >
                      <span className="block text-xs font-medium text-fg">{example.label}</span>
                      <span className="block truncate text-[10px] text-fg-muted">{example.hint}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {[...artifacts].reverse().map((artifact) => (
                  <button
                    key={artifact.id}
                    type="button"
                    onClick={() => setActive(artifact.id)}
                    className={`rounded-xl border p-2.5 text-left transition-colors ${
                      artifact.id === active?.id
                        ? "border-accent bg-elevated"
                        : "border-border bg-background/40 hover:border-accent/50"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-accent">
                        {artifact.kind}
                      </span>
                      <span className="truncate text-xs font-medium text-fg">{artifact.title}</span>
                      {artifact.version && artifact.version > 1 && (
                        <span className="ml-auto shrink-0 font-mono text-[10px] text-fg-muted">v{artifact.version}</span>
                      )}
                    </div>
                    <p className="mt-1 truncate font-mono text-[10px] text-fg-muted">
                      {artifact.content.slice(0, 60).replace(/\n/g, " ")}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div ref={panelRef} className="hud-panel relative min-w-0 flex-1 overflow-hidden">
          {active ? (
            <motion.div
              key={active.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.15 }}
              className="absolute inset-0"
            >
              <ArtifactRenderer artifact={active} />
            </motion.div>
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-fg-muted">
              Select a build or create one from the Command HUD
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
