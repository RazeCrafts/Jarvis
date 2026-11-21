import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  Disc3,
  File as FileIcon,
  FilePlus2,
  Network,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { agentApi } from "@/lib/agentApi";
import type { BrainCameraAction, GalaxyGraph, GalaxyNode, WorkspaceVaultFile } from "@/lib/fileGalaxy";
import { usePlayerStore } from "@/store";
import { cn } from "@/lib/cn";

export default function GalaxyPage() {
  const [graph, setGraph] = useState<GalaxyGraph>({ nodes: [], edges: [] });
  const [vaultFiles, setVaultFiles] = useState<WorkspaceVaultFile[]>([]);
  const [stats, setStats] = useState({ notes: 0, memories: 0, files: 0, totalNodes: 0, edges: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [rememberText, setRememberText] = useState("");
  const [rememberBusy, setRememberBusy] = useState(false);

  const [question, setQuestion] = useState("");
  const [askBusy, setAskBusy] = useState(false);
  const [brainAnswer, setBrainAnswer] = useState("");
  const [cameraAction, setCameraAction] = useState<BrainCameraAction>("still");
  const [litIds, setLitIds] = useState<string[]>([]);
  const [neighborIds, setNeighborIds] = useState<string[]>([]);
  const [sources, setSources] = useState<Array<{ id: string; title: string; kind: string; score: number }>>([]);
  const [statusNotice, setStatusNotice] = useState("");

  const openPlayerItem = usePlayerStore((s) => s.openItem);

  const mountRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sceneDataRef = useRef<{
    graph: GalaxyGraph;
    selectedId: string | null;
    litIds: string[];
    neighborIds: string[];
    flyTarget: { pos: THREE.Vector3; look: THREE.Vector3 } | null;
  }>({
    graph: { nodes: [], edges: [] },
    selectedId: null,
    litIds: [],
    neighborIds: [],
    flyTarget: null,
  });

  const rebuildSceneRef = useRef<(() => void) | null>(null);

  const loadGalaxy = useCallback(async (focusId?: string) => {
    try {
      const res = await agentApi.getGalaxy();
      setGraph(res.graph);
      setVaultFiles(res.vaultFiles);
      setStats(res.stats);
      sceneDataRef.current.graph = res.graph;
      if (focusId) {
        setSelectedId(focusId);
        sceneDataRef.current.selectedId = focusId;
        const hit = res.graph.nodes.find((n) => n.id === focusId);
        if (hit) {
          sceneDataRef.current.flyTarget = {
            look: new THREE.Vector3(hit.x, hit.y, hit.z),
            pos: new THREE.Vector3(hit.x + 5.5, hit.y + 3.2, hit.z + 6.5),
          };
        }
      }
      rebuildSceneRef.current?.();
    } catch {
      /* offline tolerance */
    }
  }, []);

  useEffect(() => {
    void loadGalaxy();
    const onBirth = (e: Event) => {
      const detail = (e as CustomEvent<{ nodeId?: string }>).detail;
      void loadGalaxy(detail?.nodeId);
    };
    window.addEventListener("jarvis-galaxy-birth", onBirth);
    return () => window.removeEventListener("jarvis-galaxy-birth", onBirth);
  }, [loadGalaxy]);

  // Mount Three.js 3D Knowledge & File Galaxy once
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    let renderer: THREE.WebGLRenderer | null = null;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "default" });
    } catch {
      return;
    }

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 540;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.setClearColor(0x060a13, 1);
    container.innerHTML = "";
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x060a13, 0.018);

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 400);
    camera.position.set(0, 12, 27);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.35;

    // Deep starfield dust
    const starPositions = new Float32Array(700 * 3);
    for (let i = 0; i < 700; i += 1) {
      starPositions[i * 3] = (Math.random() - 0.5) * 140;
      starPositions[i * 3 + 1] = (Math.random() - 0.5) * 90;
      starPositions[i * 3 + 2] = (Math.random() - 0.5) * 140;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x64748b, size: 0.18, transparent: true, opacity: 0.55 })));

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const coreLight = new THREE.PointLight(0x38bdf8, 2.5, 60);
    scene.add(coreLight);

    const nodeGroup = new THREE.Group();
    const edgeGroup = new THREE.Group();
    scene.add(edgeGroup, nodeGroup);

    const meshById = new Map<string, THREE.Mesh>();

    const rebuild = () => {
      nodeGroup.clear();
      edgeGroup.clear();
      meshById.clear();

      const { graph: g, selectedId: sel, litIds: lit, neighborIds: nbr } = sceneDataRef.current;
      const nodeMap = new Map(g.nodes.map((n) => [n.id, n]));

      for (const n of g.nodes) {
        const isLit = lit.includes(n.id) || sel === n.id;
        const isNbr = nbr.includes(n.id);
        const geo =
          n.kind === "file"
            ? new THREE.OctahedronGeometry(n.radius * (isLit ? 1.38 : 1), 0)
            : n.kind === "memory"
              ? new THREE.DodecahedronGeometry(n.radius * (isLit ? 1.35 : 1), 0)
              : new THREE.SphereGeometry(n.radius * (isLit ? 1.35 : 1), 16, 16);

        const emissiveIntensity = isLit ? 1.55 : isNbr ? 0.95 : lit.length > 0 ? 0.18 : 0.45;
        const opacity = lit.length > 0 && !isLit && !isNbr ? 0.35 : 0.95;

        const mat = new THREE.MeshStandardMaterial({
          color: n.color,
          emissive: n.color,
          emissiveIntensity,
          metalness: 0.25,
          roughness: 0.3,
          transparent: true,
          opacity,
        });
        const m = new THREE.Mesh(geo, mat);
        m.position.set(n.x, n.y, n.z);
        m.userData.nodeId = n.id;
        nodeGroup.add(m);
        meshById.set(n.id, m);
      }

      for (const e of g.edges) {
        const a = nodeMap.get(e.from);
        const b = nodeMap.get(e.to);
        if (!a || !b) continue;
        const highlighted =
          (lit.includes(a.id) && (lit.includes(b.id) || nbr.includes(b.id))) ||
          (lit.includes(b.id) && (lit.includes(a.id) || nbr.includes(a.id)));
        const pts = [new THREE.Vector3(a.x, a.y, a.z), new THREE.Vector3(b.x, b.y, b.z)];
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const mat = new THREE.LineBasicMaterial({
          color: e.reason === "wikilink" ? 0xf5b85c : highlighted ? 0x38bdf8 : 0x334155,
          transparent: true,
          opacity: highlighted ? 0.85 : 0.28,
        });
        edgeGroup.add(new THREE.Line(geo, mat));
      }
    };

    rebuildSceneRef.current = rebuild;
    rebuild();

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const onPointerDown = (ev: PointerEvent) => {
      if (!renderer) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(nodeGroup.children, false);
      if (hits.length > 0) {
        const id = hits[0].object.userData.nodeId as string | undefined;
        if (id) {
          setSelectedId(id);
          sceneDataRef.current.selectedId = id;
          const node = sceneDataRef.current.graph.nodes.find((n) => n.id === id);
          if (node) {
            sceneDataRef.current.flyTarget = {
              look: new THREE.Vector3(node.x, node.y, node.z),
              pos: new THREE.Vector3(node.x + 5.2, node.y + 3.0, node.z + 6.2),
            };
          }
          rebuild();
        }
      }
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);

    const onResize = () => {
      if (!renderer || !container) return;
      const w = container.clientWidth || 800;
      const h = container.clientHeight || 540;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    let animId = 0;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      const target = sceneDataRef.current.flyTarget;
      if (target) {
        camera.position.lerp(target.pos, 0.08);
        controls.target.lerp(target.look, 0.08);
        if (camera.position.distanceTo(target.pos) < 0.12) {
          sceneDataRef.current.flyTarget = null;
        }
      }
      controls.update();
      renderer?.render(scene, camera);
    };
    animId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", onResize);
      renderer?.domElement.removeEventListener("pointerdown", onPointerDown);
      controls.dispose();
      renderer?.dispose();
    };
  }, []);

  useEffect(() => {
    sceneDataRef.current.selectedId = selectedId;
    sceneDataRef.current.litIds = litIds;
    sceneDataRef.current.neighborIds = neighborIds;
    rebuildSceneRef.current?.();
  }, [selectedId, litIds, neighborIds]);

  const focusNode = (nodeId: string, shouldFly = true) => {
    setSelectedId(nodeId);
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (node && shouldFly) {
      sceneDataRef.current.flyTarget = {
        look: new THREE.Vector3(node.x, node.y, node.z),
        pos: new THREE.Vector3(node.x + 5.5, node.y + 3.0, node.z + 6.5),
      };
    }
  };

  const handleRemember = async () => {
    if (!rememberText.trim()) return;
    setRememberBusy(true);
    setStatusNotice("");
    try {
      const res = await agentApi.rememberInGalaxy(rememberText.trim());
      setRememberText("");
      setGraph(res.graph);
      sceneDataRef.current.graph = res.graph;
      setStats((prev) => ({
        ...prev,
        notes: res.graph.nodes.filter((n) => n.kind === "note").length,
        memories: res.graph.nodes.filter((n) => n.kind === "memory").length,
        files: res.graph.nodes.filter((n) => n.kind === "file").length,
        totalNodes: res.graph.nodes.length,
        edges: res.graph.edges.length,
      }));
      setLitIds([res.nodeId]);
      focusNode(res.nodeId, true);
      setStatusNotice(`Live Recall saved as star node "${res.note.title}".`);
      rebuildSceneRef.current?.();
    } catch (err) {
      setStatusNotice(String(err));
    } finally {
      setRememberBusy(false);
    }
  };

  const handleAsk = async () => {
    if (!question.trim()) return;
    setAskBusy(true);
    setBrainAnswer("");
    setSources([]);
    try {
      const res = await agentApi.askGalaxyBrain(question.trim());
      setBrainAnswer(res.answer);
      setCameraAction(res.cameraAction);
      setLitIds(res.litNodeIds);
      setNeighborIds(res.neighborNodeIds);
      setSources(res.sources);
      if (res.cameraAction === "fly" && res.focusNodeId) {
        focusNode(res.focusNodeId, true);
      } else if (res.cameraAction === "still") {
        setSelectedId(null);
      }
    } catch (err) {
      setBrainAnswer(String(err));
    } finally {
      setAskBusy(false);
    }
  };

  const handleUploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setStatusNotice("");
    let lastNodeId = "";
    for (const file of Array.from(files)) {
      const isTextLike =
        file.type.startsWith("text/") ||
        /\.(md|txt|json|csv|ts|tsx|js|jsx|py|yaml|yml|xml|log|html|css)$/i.test(file.name);
      let textPreview = "";
      let dataUrl: string | undefined;

      if (isTextLike && file.size <= 300_000) {
        textPreview = await file.text().catch(() => "");
      } else if (file.size <= 3_500_000) {
        dataUrl = await new Promise<string | undefined>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : undefined);
          reader.onerror = () => resolve(undefined);
          reader.readAsDataURL(file);
        });
      }

      const res = await agentApi.uploadGalaxyFile({
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        textPreview,
        dataUrl,
      });
      lastNodeId = res.nodeId;
    }
    await loadGalaxy(lastNodeId || undefined);
    setStatusNotice(`Indexed ${files.length} file(s) into the 3D File Galaxy.`);
  };

  const selectedNode: GalaxyNode | null = useMemo(
    () => graph.nodes.find((n) => n.id === selectedId) ?? null,
    [graph.nodes, selectedId],
  );

  const playVaultMediaHere = (node: GalaxyNode) => {
    if (!node.dataUrl) return;
    openPlayerItem({
      id: node.id,
      title: node.title,
      localSrc: node.dataUrl,
      mimeType: node.mimeType || (node.subKind === "audio" ? "audio/mpeg" : "video/mp4"),
      kind: node.subKind === "audio" ? "audio" : "video",
      source: "galaxy",
    });
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header + Stats + Upload + Remember */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
        <div>
          <h1 className="flex items-center gap-2 font-display text-base font-semibold text-fg">
            <Network size={16} className="text-accent" /> File Galaxy &amp; Butler Brain
          </h1>
          <p className="text-xs text-fg-muted font-mono tabular-nums">
            {stats.totalNodes} stars · {stats.edges} connections · {stats.notes} notes · {stats.memories} memories · {stats.files} files
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => void handleUploadFiles(e.target.files)}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-background"
          >
            <FilePlus2 size={13} /> Add Any File
          </button>
        </div>
      </div>

      {/* Live Recall + Grounded Brain Q&A Bars */}
      <div className="grid grid-cols-1 gap-2 border-b border-border bg-elevated/40 px-5 py-2.5 lg:grid-cols-2">
        <div className="flex gap-1.5">
          <input
            value={rememberText}
            onChange={(e) => setRememberText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleRemember();
            }}
            placeholder="Remember that... (live-spawns a glowing star node)"
            className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-fg outline-none focus:border-accent"
          />
          <button
            type="button"
            disabled={rememberBusy || !rememberText.trim()}
            onClick={() => void handleRemember()}
            className="flex items-center gap-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-fg hover:border-accent disabled:opacity-50"
          >
            <Sparkles size={12} className="text-accent" /> Remember
          </button>
        </div>

        <div className="flex gap-1.5">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleAsk();
            }}
            placeholder="Ask your Brain (1–3 sources dive camera · 4+ lights cluster · hello stays still)"
            className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-fg outline-none focus:border-accent"
          />
          <button
            type="button"
            disabled={askBusy || !question.trim()}
            onClick={() => void handleAsk()}
            className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-background disabled:opacity-50"
          >
            <Search size={12} /> {askBusy ? "Thinking…" : "Ask Brain"}
          </button>
        </div>
      </div>

      {statusNotice && (
        <div className="border-b border-border bg-elevated px-5 py-1.5 text-xs text-accent">
          {statusNotice}
        </div>
      )}

      {/* Main 3D Canvas + Right Node/Vault Inspector */}
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-12">
        <div
          className="relative min-h-[360px] lg:col-span-8"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void handleUploadFiles(e.dataTransfer.files);
          }}
        >
          <div
            ref={mountRef}
            data-testid="galaxy-canvas"
            data-node-count={graph.nodes.length}
            data-camera-action={cameraAction}
            className="h-full w-full"
          />
          {/* Subtle bottom-left legend & camera behavior state */}
          <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg border border-border/70 bg-background/80 px-3 py-1.5 text-[11px] text-fg-muted backdrop-blur">
            <span className="text-[#f5b85c]">Notes</span> ·{" "}
            <span className="text-[#a78bfa]">Memories</span> ·{" "}
            <span className="text-[#38bdf8]">Files</span> · Camera:{" "}
            <span className="font-mono text-fg">{cameraAction}</span>
          </div>
        </div>

        {/* Right Inspector: Brain Answer, Selected Node, and File Vault list */}
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto border-t border-border bg-surface/50 p-4 lg:col-span-4 lg:border-l lg:border-t-0">
          {brainAnswer && (
            <div className="hud-panel space-y-2 p-3 text-xs">
              <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-accent">
                <span>Grounded Answer</span>
                <span className="font-mono text-fg-muted">{cameraAction}</span>
              </div>
              <p className="leading-relaxed text-fg">{brainAnswer}</p>
              {sources.length > 0 && (
                <div className="flex flex-wrap gap-1.5 border-t border-border pt-2">
                  {sources.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => focusNode(s.id, true)}
                      className="rounded border border-border bg-elevated px-2 py-0.5 text-[11px] text-accent hover:border-accent"
                    >
                      {s.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {selectedNode ? (
            <div className="hud-panel space-y-2 p-3.5 text-xs">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-accent">
                    {selectedNode.kind} · {selectedNode.subKind}
                  </span>
                  <h2 className="text-sm font-semibold text-fg">{selectedNode.title}</h2>
                </div>
                {selectedNode.kind === "file" && (
                  <button
                    type="button"
                    onClick={() =>
                      void agentApi.deleteGalaxyFile(selectedNode.sourceId).then(() => {
                        setSelectedId(null);
                        return loadGalaxy();
                      })
                    }
                    className="text-fg-muted hover:text-red-500"
                    title="Delete indexed file"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
              <p className="whitespace-pre-wrap leading-relaxed text-fg-muted">{selectedNode.excerpt}</p>
              {selectedNode.tags.length > 0 && (
                <p className="font-mono text-[11px] text-accent">
                  {selectedNode.tags.map((t) => `#${t}`).join("  ")}
                </p>
              )}
              {selectedNode.subKind === "image" && selectedNode.dataUrl && (
                <img
                  src={selectedNode.dataUrl}
                  alt={selectedNode.title}
                  className="max-h-40 w-full rounded-lg border border-border object-contain"
                />
              )}
              {(selectedNode.subKind === "video" || selectedNode.subKind === "audio") &&
                selectedNode.dataUrl && (
                  <button
                    type="button"
                    onClick={() => playVaultMediaHere(selectedNode)}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-background"
                  >
                    <Disc3 size={13} /> Play Locally Here
                  </button>
                )}
            </div>
          ) : (
            <div className="hud-panel p-3.5 text-xs text-fg-muted">
              Click any star in the 3D Galaxy or ask the Brain to inspect its excerpt and connections.
            </div>
          )}

          {/* Indexed Any-Format File Vault */}
          <div className="hud-panel space-y-2 p-3.5">
            <div className="flex items-center justify-between">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                Indexed File Vault ({vaultFiles.length})
              </h3>
              <span className="text-[10px] text-fg-muted">Any format supported</span>
            </div>
            <div className="max-h-56 space-y-1.5 overflow-y-auto">
              {vaultFiles.map((f) => {
                const nid = `file:${f.id}`;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => focusNode(nid, true)}
                    className={cn(
                      "hud-elevated flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left text-xs transition-colors hover:border-accent",
                      selectedId === nid && "border-accent",
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <FileIcon size={13} className="shrink-0 text-accent" />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-fg">{f.name}</p>
                        <p className="font-mono text-[10px] text-fg-muted">
                          {f.category} · {Math.max(1, Math.round(f.sizeBytes / 1024))} KB
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
