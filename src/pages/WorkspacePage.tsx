import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Box,
  Eraser,
  ImagePlus,
  Maximize2,
  Minimize2,
  Receipt,
  Sparkles,
} from "lucide-react";
import { ArtifactRenderer } from "@/components/workspace/ArtifactRenderer";
import { agentApi } from "@/lib/agentApi";
import { agentService } from "@/lib/agentService";
import type { Artifact } from "@/lib/artifacts";
import type { ApiCostEntry } from "@/lib/workshopProtocol";
import { useUiStore, useWorkspaceStore } from "@/store";

const LOCAL_3D_STARTER_DRONE = `//@title Orbital Recon Drone
//@part chassis | Carbon monocoque core
const core = JARVIS.at(JARVIS.box(1.4, 0.28, 0.9, W.metal("titanium")), [0, 0.55, 0]);
W.add(core, { name: "chassis", label: "Carbon Core", explode: [0, -0.5, 0] });
//@part optics | Gimbal thermal lens
const lens = JARVIS.at(JARVIS.cylinder(0.18, 0.22, 0.34, W.metal("chrome")), [0, 0.42, 0.55], { rotation: [Math.PI / 2, 0, 0] });
const iris = JARVIS.at(JARVIS.sphere(0.14, W.emissive("#38bdf8", 2.4)), [0, 0.42, 0.72]);
W.add(JARVIS.group(lens, iris), { name: "optics", label: "Thermal Gimbal", explode: [0, -0.2, 1.3] });
//@part rotors | Quad brushless booms
const boomOffsets = [
  [-0.95, 0.65, -0.75, "Rear-Left Rotor"],
  [0.95, 0.65, -0.75, "Rear-Right Rotor"],
  [-0.95, 0.65, 0.75, "Front-Left Rotor"],
  [0.95, 0.65, 0.75, "Front-Right Rotor"],
];
const blades = [];
for (const [x, y, z, rotorLabel] of boomOffsets) {
  const motor = JARVIS.at(JARVIS.cylinder(0.14, 0.14, 0.18, W.metal("copper")), [x, y, z]);
  const prop = JARVIS.at(JARVIS.cylinder(0.42, 0.42, 0.02, W.glass("#94a3b8")), [x, y + 0.11, z]);
  blades.push(prop);
  W.add(JARVIS.group(motor, prop), { name: "rotor-" + x + "-" + z, label: rotorLabel, explode: [x * 0.9, 0.9, z * 0.9] });
}
W.onTick((_s, delta) => { for (const b of blades) b.rotation.y += delta * 18; });
W.frame();
//@end`;

const LOCAL_3D_ARCHITECT_LOFT = `//@title Modern Studio Floor Plan
//@part floorplan | Multi-room interior layout
const plan = W.floorplan([
  { name: "Living & Studio", x: -1.8, z: 0, w: 4.2, d: 5.2, wallColor: "#e2e8f0" },
  { name: "Kitchenette", x: 1.9, z: -1.2, w: 3.1, d: 2.8, floorColor: "#94a3b8" },
  { name: "Bedroom Suite", x: 1.9, z: 1.4, w: 3.1, d: 2.4 },
]);
W.add(plan, { name: "floorplan", label: "Walls & Flooring", explode: [0, 0, 0] });
//@part furniture | Lounge sofa, island & bed
const sofa = W.furniture("sofa", [-2.2, 0.05, 0.4]);
const island = W.furniture("island", [1.9, 0.05, -1.2]);
const bed = W.furniture("bed", [1.9, 0.05, 1.4]);
W.add(JARVIS.group(sofa, island, bed), { name: "furniture", label: "Interior Furnishings", explode: [0, 0.8, 0] });
//@part roof | Toggleable studio roof assembly
W.roof({ width: 7.4, depth: 5.3, y: 2.65 });
W.frame();
//@end`;

const EXAMPLES: { label: string; hint: string; prompt?: string; localThree?: { title: string; code: string } }[] = [
  {
    label: "3D Orbital Drone",
    hint: "W Kit · Pull It Apart · STL",
    localThree: { title: "Orbital Recon Drone", code: LOCAL_3D_STARTER_DRONE },
  },
  {
    label: "Architect Floor Plan",
    hint: "Rooms · Furniture · Roof Toggle",
    localThree: { title: "Modern Studio Floor Plan", code: LOCAL_3D_ARCHITECT_LOFT },
  },
  { label: "3D Satellite", hint: "AI generated build", prompt: "build a 3D orbital satellite with gold solar panels and telemetry dish" },
  { label: "Physics Sandbox", hint: "canvas gravity", prompt: "make a bouncing ball simulation in an HTML canvas with gravity" },
];

export default function WorkspacePage() {
  const artifacts = useWorkspaceStore((s) => s.artifacts);
  const activeId = useWorkspaceStore((s) => s.activeId);
  const setActive = useWorkspaceStore((s) => s.setActive);
  const upsertArtifact = useWorkspaceStore((s) => s.upsertArtifact);
  const clear = useWorkspaceStore((s) => s.clear);
  const replaceArtifacts = useWorkspaceStore((s) => s.replaceArtifacts);
  const setActiveTab = useUiStore((s) => s.setActiveTab);

  const [fullscreen, setFullscreen] = useState(false);
  const [syncing, setSyncing] = useState(true);
  const [bridgeStatus, setBridgeStatus] = useState("");
  const [visionHint, setVisionHint] = useState("");
  const [visionBusy, setVisionBusy] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptData, setReceiptData] = useState<{
    summary: { formattedTotal: string; callCount: number; totalInputTokens: number; totalOutputTokens: number; imageCount: number };
    entries: ApiCostEntry[];
  } | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  const openReceipt = async () => {
    setReceiptOpen((v) => !v);
    try {
      const res = await agentApi.getWorkshopReceipt();
      setReceiptData(res);
    } catch {
      /* ignore */
    }
  };

  const handleVisionFile = async (file: File | undefined) => {
    if (!file) return;
    setVisionBusy(true);
    setBridgeStatus("");
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Could not read image"));
        reader.readAsDataURL(file);
      });
      const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
      const res = await agentApi.workshopVisionTo3D({
        imageBase64: base64,
        mimeType: file.type || "image/png",
        hint: visionHint.trim() || file.name,
      });
      if (res.ok && res.artifact) {
        upsertArtifact({ ...(res.artifact as unknown as Artifact), remote: true });
        setBridgeStatus(`Vision-to-3D built "${res.artifact.title}"${res.isFloorPlan ? " (Floor Plan mode)" : ""}.`);
        setVisionHint("");
      } else {
        setBridgeStatus(res.error || "Vision-to-3D requires a connected Gemini key.");
      }
    } catch (err) {
      setBridgeStatus(String(err));
    } finally {
      setVisionBusy(false);
    }
  };

  const launchExample = (example: (typeof EXAMPLES)[number]) => {
    if (example.localThree) {
      const art: Artifact = {
        id: `local-${slugifyId(example.label)}`,
        kind: "three",
        title: example.localThree.title,
        language: "javascript",
        content: example.localThree.code,
        createdAt: Date.now(),
        version: 1,
        versionCount: 1,
        versions: [1],
      };
      upsertArtifact(art);
      setActive(art.id);
      return;
    }
    if (example.prompt) {
      setActiveTab("home");
      agentService.send(example.prompt);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
        <div className="flex items-baseline gap-2.5">
          <h1 className="font-display text-base font-semibold tracking-tight text-fg">Sealed 3D Workshop</h1>
          <span className="text-xs text-fg-muted">W Kit · STL Print · Vision-to-3D · Studio Finish</span>
          {active?.version && active.version > 1 && (
            <span className="font-mono text-[11px] text-accent">
              {active.title} · v{active.version}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => void openReceipt()}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-elevated px-2.5 py-1.5 text-xs text-fg transition-colors hover:border-accent"
          >
            <Receipt size={13} className="text-accent" /> Cost Receipt
          </button>
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

      {receiptOpen && receiptData && (
        <div className="border-b border-border bg-surface px-5 py-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-semibold text-fg">API Cost Receipt: </span>
              <span className="font-mono font-semibold text-accent tabular-nums">
                {receiptData.summary.formattedTotal}
              </span>
              <span className="ml-2 text-fg-muted font-mono tabular-nums">
                ({receiptData.summary.callCount} calls · {receiptData.summary.totalInputTokens.toLocaleString()} in / {receiptData.summary.totalOutputTokens.toLocaleString()} out · {receiptData.summary.imageCount} imgs)
              </span>
            </div>
            <button type="button" onClick={() => setReceiptOpen(false)} className="text-fg-muted hover:text-fg">
              Close
            </button>
          </div>
          {receiptData.entries.length > 0 && (
            <div className="mt-2 max-h-28 space-y-1 overflow-y-auto font-mono text-[11px] text-fg-muted">
              {receiptData.entries.slice(0, 8).map((e) => (
                <div key={e.id} className="flex justify-between">
                  <span>{e.kind} · {e.model}</span>
                  <span className="tabular-nums">${e.estimatedUsd.toFixed(4)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-3 p-4">
        <div className="hud-panel flex w-[32%] min-w-[260px] flex-col overflow-hidden">
          <div className="border-b border-border px-4 py-2.5">
            <p className="text-[11px] font-medium uppercase tracking-wider text-fg-muted">Workshop Bench & Builds</p>
          </div>

          {/* Prompt 11/12 Vision-to-3D & Floor Plan Uploader */}
          <div className="space-y-2 border-b border-border bg-elevated/40 p-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[11px] font-semibold text-fg">
                <ImagePlus size={13} className="text-accent" /> Vision-to-3D / Floor Plan
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => void handleVisionFile(e.target.files?.[0])}
              />
              <button
                type="button"
                disabled={visionBusy}
                onClick={() => fileInputRef.current?.click()}
                className="rounded-lg bg-accent px-2.5 py-1 text-[11px] font-medium text-background disabled:opacity-50"
              >
                {visionBusy ? "Analyzing…" : "Upload Photo / Plan"}
              </button>
            </div>
            <input
              value={visionHint}
              onChange={(e) => setVisionHint(e.target.value)}
              placeholder="Optional build note (e.g. convert sketch to brushed aluminum)..."
              className="w-full rounded-lg border border-border bg-surface px-2.5 py-1 text-[11px] text-fg outline-none focus:border-accent"
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
            {artifacts.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-3 text-center">
                <Sparkles size={22} strokeWidth={1.5} className="text-accent" />
                <div>
                  <p className="text-sm font-medium text-fg">{syncing ? "Loading workshop…" : "Workshop Bench Ready"}</p>
                  <p className="mt-1 text-xs leading-relaxed text-fg-muted">
                    Launch an instant 3D assembly, upload a sketch/floor plan, or describe any build to JARVIS.
                  </p>
                </div>
                <div className="grid w-full grid-cols-1 gap-1.5">
                  {EXAMPLES.map((example) => (
                    <button
                      key={example.label}
                      type="button"
                      onClick={() => launchExample(example)}
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
                <div className="mt-2 grid grid-cols-2 gap-1.5 border-t border-border pt-2">
                  {EXAMPLES.slice(0, 2).map((example) => (
                    <button
                      key={example.label}
                      type="button"
                      onClick={() => launchExample(example)}
                      className="hud-elevated p-2 text-left text-[11px] hover:border-accent"
                    >
                      + {example.label}
                    </button>
                  ))}
                </div>
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
              Select a starter assembly on the left or upload a reference sketch
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function slugifyId(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
