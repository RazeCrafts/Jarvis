import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  Eraser,
  MessageSquare,
  Volume2,
  Mic,
  Layers,
  Box,
  Compass,
} from "lucide-react";
import JarvisOrb from "@/components/JarvisOrb";
import { InputBar } from "@/components/home/InputBar";
import { OrbCustomizer } from "@/components/home/OrbCustomizer";
import { ArtifactRenderer } from "@/components/workspace/ArtifactRenderer";
import { ChatWindow } from "@/components/home/ChatWindow";
import { audioLevel, warmUpVoices } from "@/lib/voiceEngine";
import { agentService } from "@/lib/agentService";
import { agentApi } from "@/lib/agentApi";
import type { Artifact } from "@/lib/artifacts";
import {
  useAgentStore,
  useChatStore,
  useUiStore,
  useWorkspaceStore,
} from "@/store";

const BLUEPRINT_PRESETS = [
  {
    title: "Mechanical Watch",
    desc: "Layered gears, escapement & balance wheel",
    prompt: "build me a mechanical watch movement with brass gears and escapement",
  },
  {
    title: "3D Spaceship",
    desc: "Futuristic hull with glowing blue ion engines",
    prompt: "build me a 3D spaceship with sleek wings and glowing blue engines",
  },
  {
    title: "Gaming PC Rig",
    desc: "Chassis, liquid cooling block & GPU fans",
    prompt: "build me a 3D gaming PC with liquid cooling pipes and cooling fans",
  },
  {
    title: "Solar System",
    desc: "Orbital simulation around a glowing star",
    prompt: "build an animated solar system with orbiting planets around a glowing sun",
  },
];

export default function HomePage() {
  const isSpeaking = useChatStore((s) => s.isSpeaking);
  const isListening = useChatStore((s) => s.isListening);
  const isThinking = useAgentStore((s) => s.isThinking);
  const currentModel = useAgentStore((s) => s.currentModel);
  const messages = useChatStore((s) => s.messages);
  const setActiveTab = useUiStore((s) => s.setActiveTab);

  const artifacts = useWorkspaceStore((s) => s.artifacts);
  const activeId = useWorkspaceStore((s) => s.activeId);
  const clear = useWorkspaceStore((s) => s.clear);
  const replaceArtifacts = useWorkspaceStore((s) => s.replaceArtifacts);

  const [level, setLevel] = useState(0);
  const [showFullChat, setShowFullChat] = useState(false);
  const stageContainerRef = useRef<HTMLDivElement>(null);

  const active = useMemo(
    () =>
      artifacts.find((a) => a.id === activeId) ??
      artifacts[artifacts.length - 1] ??
      null,
    [artifacts, activeId]
  );

  // Load voices early
  useEffect(() => {
    warmUpVoices();
  }, []);

  // Sync workspace artifacts from backend on load
  useEffect(() => {
    agentApi
      .listArtifacts()
      .then((result) => {
        if (result.artifacts?.length) {
          replaceArtifacts(
            result.artifacts.map((raw) => ({
              ...(raw as unknown as Artifact),
              remote: true,
            }))
          );
        }
      })
      .catch(() => {
        /* offline fallback */
      });
  }, [replaceArtifacts]);

  // Audio level tracking for the orb
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

  // Latest spoken line for the HUD subtitles: prefer JARVIS, fall back to you.
  const latestMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return messages[i];
    }
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") return messages[i];
    }
    return null;
  }, [messages]);

  const clearWorkbench = async () => {
    if (!window.confirm("Clear the workshop? This removes every saved artifact version.")) {
      return;
    }
    clear();
    try {
      await agentApi.clearArtifacts();
    } catch {
      /* ignore */
    }
  };

  const handlePrompt = (prompt: string) => {
    agentService.send(prompt);
  };

  return (
    <div className="relative flex h-full w-full select-none overflow-hidden bg-black/60">
      {/* ---------------- LEFT: HUD Column (Compact Companion Orb & Speech) ---------------- */}
      <aside className="relative flex w-[370px] shrink-0 flex-col border-r border-white/10 bg-black/50 backdrop-blur-xl">
        {/* Top HUD Telemetry Bar */}
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
            </span>
            <span className="font-mono text-[11px] font-semibold tracking-wider text-fg-muted uppercase">
              JARVIS HUD
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-0.5 font-mono text-[9px] text-accent">
              {currentModel ? currentModel.split("/").pop() : "ONLINE"}
            </span>
            <button
              type="button"
              onClick={() => setShowFullChat(!showFullChat)}
              title={showFullChat ? "Hide Chat Log" : "Show Chat Log"}
              className={`rounded-lg p-1.5 transition-colors ${
                showFullChat
                  ? "bg-accent/20 text-accent"
                  : "text-fg-muted hover:bg-white/5 hover:text-fg"
              }`}
            >
              <MessageSquare size={14} />
            </button>
          </div>
        </div>

        {/* Scrollable middle: orb + subtitles + starters. Keeps the input pinned. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {/* Companion Orb Section */}
        <div className="relative flex shrink-0 flex-col items-center justify-center p-3">
          <div className="relative h-[180px] w-full max-w-[250px] overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-transparent shadow-[0_0_30px_rgba(0,212,255,0.06)]">
            <JarvisOrb audioLevel={level} />

            {/* Glowing state badge over orb */}
            <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2">
              <span
                className={`rounded-full border px-2.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
                  isSpeaking
                    ? "border-accent/40 bg-accent/20 text-accent glow-blue"
                    : isListening
                    ? "border-red-500/40 bg-red-500/20 text-red-300"
                    : isThinking
                    ? "border-amber-500/40 bg-amber-500/20 text-amber-300"
                    : "border-white/10 bg-black/40 text-fg-muted"
                }`}
              >
                {isSpeaking
                  ? "Speaking"
                  : isListening
                  ? "Listening"
                  : isThinking
                  ? "Synthesizing"
                  : "Standby"}
              </span>
            </div>
          </div>
        </div>

        {/* Holographic Speech Subtitles / Dialogue Banner */}
        <div className="flex min-h-[90px] max-h-[140px] flex-col justify-center px-4 py-2">
          {latestMessage ? (
            <motion.div
              key={latestMessage.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-xl border border-accent/20 bg-accent/[0.05] p-2.5 shadow-[0_0_15px_rgba(0,212,255,0.05)]"
            >
              <div className="flex items-center gap-1.5 pb-1">
                {latestMessage.role === "assistant" ? (
                  <>
                    <Volume2 size={12} className="text-accent" />
                    <span className="font-mono text-[9px] font-semibold text-accent uppercase">
                      JARVIS Spoken
                    </span>
                  </>
                ) : (
                  <>
                    <Mic size={12} className="text-fg-muted" />
                    <span className="font-mono text-[9px] text-fg-muted uppercase">
                      You
                    </span>
                  </>
                )}
              </div>
              <p className="line-clamp-3 text-xs leading-relaxed text-fg/90">
                {latestMessage.content.replace(/```[\s\S]*?```/g, "").trim() ||
                  "On the bench, sir."}
              </p>
            </motion.div>
          ) : (
            <div className="flex items-center justify-center rounded-xl border border-dashed border-white/10 p-3 text-center">
              <p className="text-[11px] text-fg-muted">
                Voice active · Say &quot;Hey JARVIS&quot; or speak a command
              </p>
            </div>
          )}
        </div>

        {/* Quick Voice Blueprint Starters */}
        <div className="mt-auto px-4 pb-2">
          <p className="pb-1.5 font-mono text-[10px] tracking-wider text-fg-muted uppercase">
            Quick Workshop Blueprints
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {BLUEPRINT_PRESETS.map((bp) => (
              <button
                key={bp.title}
                type="button"
                onClick={() => handlePrompt(bp.prompt)}
                className="group flex flex-col rounded-lg border border-white/10 bg-white/[0.02] p-1.5 text-left transition-all hover:border-accent/40 hover:bg-accent/[0.06]"
              >
                <span className="text-[11px] font-medium text-fg/85 group-hover:text-accent">
                  {bp.title}
                </span>
                <span className="truncate text-[9px] text-fg-muted">
                  {bp.desc}
                </span>
              </button>
            ))}
          </div>
        </div>

        </div>

        {/* Discreet Input & Voice Bar (InputBar floats, so reserve its height) */}
        <div className="relative h-[78px] shrink-0 border-t border-white/10">
          <InputBar onSend={(text, model) => agentService.send(text, model)} />
        </div>
      </aside>

      {/* Chat transcript overlays the stage so long answers stay readable. */}
      <AnimatePresence>
        {showFullChat && (
          <motion.div
            initial={{ opacity: 0, x: -24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            className="absolute inset-y-0 left-0 z-40 flex w-[560px] max-w-[85vw] flex-col border-r border-accent/20 bg-black/95 p-4 backdrop-blur-2xl"
          >
            <div className="flex items-center justify-between pb-2">
              <span className="font-mono text-xs text-accent">CHAT TRANSCRIPT</span>
              <button
                type="button"
                onClick={() => setShowFullChat(false)}
                className="rounded px-2 py-0.5 text-xs text-fg-muted hover:text-fg"
              >
                ✕ Close
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <ChatWindow />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------------- RIGHT: The Live Workshop Stage ---------------- */}
      <section
        ref={stageContainerRef}
        className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-black/40"
      >
        {/* Workshop Stage Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-2.5">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <Box size={16} className="text-accent" />
              <h2 className="font-mono text-xs font-semibold tracking-wider text-fg uppercase">
                Live Workshop Bench
              </h2>
            </div>
            {active && (
              <span className="flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] text-fg-muted">
                <span className="text-accent uppercase">{active.kind}</span>
                <span>·</span>
                <span className="max-w-[200px] truncate text-fg/90">
                  {active.title}
                </span>
                {active.version && active.version > 1 && (
                  <span className="text-fg-muted">v{active.version}</span>
                )}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {active && (
              <button
                type="button"
                onClick={() => void clearWorkbench()}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-fg-muted transition-colors hover:bg-white/5 hover:text-fg"
              >
                <Eraser size={13} /> Clear
              </button>
            )}
            <button
              type="button"
              onClick={() => setActiveTab("workspace")}
              title="Open full expanded workspace with history and tabs"
              className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-fg-muted transition-colors hover:border-accent/40 hover:text-fg"
            >
              <Layers size={13} /> Full Workspace
            </button>
          </div>
        </div>

        {/* Live Stage Body */}
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {active ? (
            <div className="h-full w-full">
              <ArtifactRenderer artifact={active} />
            </div>
          ) : (
            <div className="relative flex h-full flex-col items-center justify-center p-8 text-center">
              {/* Futuristic Blueprint Ambient Grid */}
              <div
                className="pointer-events-none absolute inset-0 opacity-20"
                style={{
                  backgroundImage:
                    "linear-gradient(to right, rgba(0, 212, 255, 0.15) 1px, transparent 1px), linear-gradient(to bottom, rgba(0, 212, 255, 0.15) 1px, transparent 1px)",
                  backgroundSize: "32px 32px",
                }}
              />

              <div className="relative z-10 flex max-w-lg flex-col items-center gap-4">
                <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-accent/30 bg-accent/10 shadow-[0_0_25px_rgba(0,212,255,0.15)]">
                  <Compass size={32} className="text-accent animate-pulse" />
                </div>
                <div>
                  <h3 className="text-base font-medium tracking-tight text-fg">
                    Workshop Stage Ready
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-fg-muted">
                    Speak or type a build instruction (e.g. &quot;build me a
                    mechanical watch&quot; or &quot;build a 3D spaceship&quot;).
                    JARVIS will assemble the components live right here on the
                    bench.
                  </p>
                </div>

                <div className="grid w-full grid-cols-2 gap-2 pt-2">
                  {BLUEPRINT_PRESETS.map((bp) => (
                    <button
                      key={bp.title}
                      type="button"
                      onClick={() => handlePrompt(bp.prompt)}
                      className="flex flex-col rounded-xl border border-white/10 bg-white/[0.02] p-2.5 text-left transition-all hover:border-accent/40 hover:bg-accent/[0.05]"
                    >
                      <span className="flex items-center gap-1.5 text-xs font-medium text-fg">
                        <Sparkles size={12} className="text-accent" />
                        {bp.title}
                      </span>
                      <span className="mt-1 text-[10px] text-fg-muted">
                        {bp.desc}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      <OrbCustomizer />
    </div>
  );
}
