import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Eraser, Maximize2, Minimize2, Sparkles } from "lucide-react";
import { ArtifactRenderer } from "@/components/workspace/ArtifactRenderer";
import { agentApi } from "@/lib/agentApi";
import { agentService } from "@/lib/agentService";
import type { Artifact } from "@/lib/artifacts";
import { useUiStore, useWorkspaceStore } from "@/store";

/**
 * Workspace: JARVIS builds one live artifact at a time (3D scene, HTML app or
 * SVG). Follow-up requests edit the same artifact with version history, and a
 * broken render asks the model for one repair pass.
 */

const EXAMPLES: { label: string; hint: string; prompt: string }[] = [
  { label: "3D car", hint: "glossy red paint", prompt: "build me a 3D car with glossy red paint and chrome wheels" },
  { label: "Solar system", hint: "orbiting planets", prompt: "build an animated solar system with orbiting planets around a glowing sun" },
  { label: "To-do app", hint: "add · complete · delete", prompt: "create a to-do app with add, complete and delete" },
  { label: "SVG logo", hint: "hexagon + glow", prompt: "design an SVG logo for JARVIS: a hexagon with a glowing core" },
  { label: "Bouncing ball", hint: "canvas physics", prompt: "make a bouncing ball simulation in an HTML canvas with gravity" },
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
  const panelRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);

  const active = artifacts.find((a) => a.id === activeId) ?? artifacts[artifacts.length - 1] ?? null;

  /* Pull the backend's workspace store on open so versions survive restarts. */
  useEffect(() => {
    mounted.current = true;
    agentApi
      .listArtifacts()
      .then((result) => {
        if (!mounted.current) return;
        replaceArtifacts(
          result.artifacts.map((raw) => ({ ...(raw as unknown as Artifact), remote: true })),
        );
      })
      .catch(() => {
        /* backend offline — keep whatever is in memory */
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
      /* fullscreen may be blocked; non-critical */
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
      /* local clear is enough if the backend is offline */
    }
  };

  const build = (prompt: string) => {
    setActiveTab("home");
    agentService.send(prompt);
  };

  return (
    <div className="flex h-full flex-col">
      {/* header */}
      <div className="flex items-center justify-between px-5 pb-2 pt-4">
        <div className="flex items-baseline gap-2">
          <h1 className="text-base font-medium tracking-tight">Workspace</h1>
          {active?.version && active.version > 1 && (
            <span className="rounded-md border border-white/10 bg-black/30 px-1.5 py-0.5 font-mono text-[10px] text-fg-muted">
              {active.title} · v{active.version}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void clearAll()}
            disabled={artifacts.length === 0}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-fg-muted transition-colors hover:bg-white/5 hover:text-fg disabled:opacity-40"
          >
            <Eraser size={13} /> Clear
          </button>
          <button
            type="button"
            onClick={() => void toggleFullscreen()}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-fg-muted transition-colors hover:bg-white/5 hover:text-fg"
          >
            {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            {fullscreen ? "Exit" : "Fullscreen"}
          </button>
        </div>
      </div>

      {/* split layout */}
      <div className="flex min-h-0 flex-1 gap-3 px-4 pb-4">
        {/* left: artifacts list */}
        <div className="glass flex w-[36%] flex-col overflow-hidden rounded-2xl">
          <div className="border-b border-white/10 px-4 py-2.5">
            <p className="text-[11px] uppercase tracking-wider text-fg-muted">Generated by JARVIS</p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
            {artifacts.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
                <Sparkles size={22} strokeWidth={1.4} className="text-fg-muted" />
                <div>
                  <p className="text-sm text-fg/80">{syncing ? "Loading workspace…" : "Nothing here yet"}</p>
                  <p className="mt-1 text-xs leading-relaxed text-fg-muted">
                    Ask JARVIS to build something, or start with an example. Follow-up edits update the same artifact.
                  </p>
                </div>
                <div className="grid w-full grid-cols-2 gap-1.5">
                  {EXAMPLES.map((example) => (
                    <button
                      key={example.label}
                      type="button"
                      onClick={() => build(example.prompt)}
                      className="rounded-xl border border-white/10 bg-white/[0.03] p-2 text-left transition-all hover:border-accent/40 hover:bg-accent/[0.06]"
                    >
                      <span className="block text-[11px] font-medium text-fg/90">{example.label}</span>
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
                    className={`rounded-xl border p-2.5 text-left transition-all ${
                      artifact.id === activeId
                        ? "border-accent/40 bg-accent/10"
                        : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="rounded-md bg-black/30 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-accent/90">
                        {artifact.kind}
                      </span>
                      <span className="truncate text-xs text-fg/90">{artifact.title}</span>
                      {artifact.version && artifact.version > 1 && (
                        <span className="ml-auto shrink-0 font-mono text-[9px] text-fg-muted">v{artifact.version}</span>
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

        {/* right: live render */}
        <div ref={panelRef} className="glass relative min-w-0 flex-1 overflow-hidden rounded-2xl">
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
              Select an artifact to render it
            </div>
          )}
        </div>
      </div>

      {/* history strip: last 5 */}
      {artifacts.length > 0 && (
        <div className="flex gap-2 overflow-x-auto px-4 pb-4">
          {artifacts.slice(-5).map((artifact) => (
            <button
              key={artifact.id}
              type="button"
              onClick={() => setActive(artifact.id)}
              className={`flex h-14 w-28 shrink-0 flex-col justify-between rounded-xl border p-2 text-left transition-all ${
                artifact.id === activeId
                  ? "border-accent/50 bg-accent/10 glow-blue"
                  : "border-white/10 bg-white/[0.03] hover:border-white/20"
              }`}
            >
              <span className="truncate text-[10px] text-fg/90">{artifact.title}</span>
              <span className="font-mono text-[9px] uppercase text-accent/70">
                {artifact.kind}
                {artifact.version && artifact.version > 1 ? ` · v${artifact.version}` : ""}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
