import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Camera,
  Check,
  Copy,
  Download,
  Expand,
  Home,
  Image as ImageIcon,
  Layers,
  Loader2,
  Play,
  Printer,
  RotateCw,
  Sparkles,
  Square,
  Sun,
  Undo2,
  Wrench,
} from "lucide-react";
import Prism from "prismjs";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-python";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-json";
import "prismjs/components/prism-css";
import "prismjs/components/prism-markup";
import { agentApi, type WorkspaceArtifact } from "@/lib/agentApi";
import { agentService } from "@/lib/agentService";
import { artifactDocument, artifactExtension, type Artifact } from "@/lib/artifacts";
import { parseWorkshopParts } from "@/lib/workshopProtocol";
import { useWorkspaceStore } from "@/store";
import { cn } from "@/lib/cn";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderMarkdown(source: string): string {
  const blocks: string[] = [];
  const withPlaceholders = source.replace(/```(\w*)\n?([\s\S]*?)(?:```|$)/g, (_m, _lang, code) => {
    const html = `<pre class="rounded-lg bg-[#0b101b] text-slate-100 p-3 my-2 overflow-x-auto font-mono text-xs leading-relaxed">${escapeHtml(code.replace(/\n$/, ""))}</pre>`;
    blocks.push(html);
    return `\u0000${blocks.length - 1}\u0000`;
  });

  const inline = escapeHtml(withPlaceholders)
    .replace(/^### (.*)$/gm, '<h3 class="text-sm font-semibold mt-4 mb-1.5">$1</h3>')
    .replace(/^## (.*)$/gm, '<h2 class="text-base font-semibold mt-4 mb-2">$1</h2>')
    .replace(/^# (.*)$/gm, '<h1 class="text-lg font-semibold mt-4 mb-2">$1</h1>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-fg">$1</strong>')
    .replace(/`([^`\n]+)`/g, '<code class="rounded bg-elevated px-1 py-0.5 font-mono text-xs text-accent">$1</code>')
    .replace(/^\s*[-*] (.*)$/gm, '<li class="ml-4 list-disc">$1</li>')
    .replace(/^(?!<[ul]|<pre|<h\d|$)(.+)$/gm, '<p class="my-1.5 leading-relaxed">$1</p>');

  return inline.replace(/\u0000(\d+)\u0000/g, (_m, i) => blocks[Number(i)] ?? "");
}

function RunOutput({ output }: { output: { ok: boolean; stdout?: string; stderr?: string; error?: string } | null }) {
  if (!output) return null;
  const text = output.error ?? output.stdout ?? "";
  const err = output.stderr ?? "";
  return (
    <div className="mt-2 rounded-xl border border-border bg-elevated p-3 font-mono text-[11px] leading-relaxed">
      <p className="mb-1 text-[10px] uppercase tracking-wider text-fg-muted">Output</p>
      {text && <pre className="whitespace-pre-wrap text-fg">{text || "(no output)"}</pre>}
      {err && <pre className="mt-1 whitespace-pre-wrap text-red-500 dark:text-red-300">{err}</pre>}
    </div>
  );
}

function slugify(title: string): string {
  return title.replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "") || "artifact";
}

function downloadBlob(data: BlobPart, type: string, filename: string): void {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function toArtifact(raw: WorkspaceArtifact): Artifact {
  return { ...(raw as unknown as Artifact), remote: true };
}

interface BridgeMessage {
  source?: string;
  type?: string;
  format?: string;
  error?: string;
  data?: string | ArrayBuffer;
  command?: string;
  ok?: boolean;
}

const toolbarButton =
  "flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-fg-muted transition-colors hover:bg-elevated hover:text-fg disabled:opacity-40";

export function ArtifactRenderer({ artifact }: { artifact: Artifact }) {
  const [output, setOutput] = useState<{ ok: boolean; stdout?: string; stderr?: string; error?: string } | null>(null);
  const [running, setRunning] = useState(false);
  const [confirmRun, setConfirmRun] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<"undo" | "version" | "png" | "glb" | "stl" | "finish" | "part" | null>(null);

  // Workshop 3D Stage states
  const [exploded, setExploded] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [roofVisible, setRoofVisible] = useState(true);
  const [lightingMood, setLightingMood] = useState<"studio" | "day" | "sunset" | "night">("studio");
  const [finishViewMode, setFinishViewMode] = useState<"3d" | "finish">("3d");
  const [finishImageUrl, setFinishImageUrl] = useState<string | null>(null);
  const [finishPendingOverlay, setFinishPendingOverlay] = useState(false);
  const [partEditOpen, setPartEditOpen] = useState(false);
  const [selectedPart, setSelectedPart] = useState("");
  const [partInstruction, setPartInstruction] = useState("");

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const reported = useRef(false);
  const pendingExport = useRef<"png" | "glb" | "stl" | "finish_snap" | null>(null);
  const pendingFinishMode = useRef<"photograph" | "miniature">("photograph");
  const userInteractedDuringFinish = useRef(false);

  const remote = Boolean(artifact.remote);
  const version = artifact.version ?? 1;
  const versions = artifact.versions ?? [];

  const parsedParts = useMemo(
    () => (artifact.kind === "three" ? parseWorkshopParts(artifact.content) : null),
    [artifact.kind, artifact.content],
  );
  const hasRoofLayer = useMemo(
    () => artifact.kind === "three" && /\bW\.roof\b|layer:\s*["']roof["']/.test(artifact.content),
    [artifact.kind, artifact.content],
  );

  useEffect(() => {
    if (parsedParts?.parts.length && !selectedPart) {
      setSelectedPart(parsedParts.parts[0].name);
    }
  }, [parsedParts, selectedPart]);

  const highlighted = useMemo(() => {
    if (artifact.kind !== "code") return "";
    const lang = artifact.language ?? "clike";
    const grammar = (Prism.languages as Record<string, Prism.Grammar>)[lang] ?? Prism.languages.clike;
    return Prism.highlight(artifact.content, grammar, lang);
  }, [artifact]);

  const srcDoc = useMemo(() => artifactDocument(artifact), [artifact]);

  useEffect(() => {
    setError(null);
    reported.current = false;
    setExploded(false);
    setSpinning(false);
    setRoofVisible(true);
    setFinishViewMode("3d");
    setFinishImageUrl(null);
    setFinishPendingOverlay(false);
  }, [artifact.id, artifact.version]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 7000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const sendStageCommand = useCallback(
    (command: string) => {
      if (artifact.kind !== "three") return;
      const target = iframeRef.current?.contentWindow;
      if (!target) return;
      target.postMessage({ source: "jarvis-host", type: "stage_command", command }, "*");
      if (command === "explode") setExploded(true);
      else if (command === "assemble") setExploded(false);
      else if (command === "spin_on") setSpinning(true);
      else if (command === "spin_off") setSpinning(false);
      else if (command === "roof_on") setRoofVisible(true);
      else if (command === "roof_off") setRoofVisible(false);
      else if (command.startsWith("light_")) {
        const mood = command.replace("light_", "") as "studio" | "day" | "sunset" | "night";
        setLightingMood(mood);
      }
    },
    [artifact.kind],
  );

  const requestExport = useCallback(
    (format: "png" | "glb" | "stl" | "finish_snap") => {
      if (artifact.kind !== "three") return;
      const target = iframeRef.current?.contentWindow;
      if (!target) return;
      pendingExport.current = format;
      if (format !== "finish_snap") setBusy(format);
      target.postMessage(
        { source: "jarvis-host", type: "export", format: format === "finish_snap" ? "png" : format },
        "*",
      );
    },
    [artifact.kind],
  );

  const triggerFinish = useCallback(
    (mode: "photograph" | "miniature") => {
      if (artifact.kind !== "three") return;
      pendingFinishMode.current = mode;
      userInteractedDuringFinish.current = false;
      setFinishPendingOverlay(false);
      setBusy("finish");
      requestExport("finish_snap");
    },
    [artifact.kind, requestExport],
  );

  useEffect(() => {
    const onStageEvent = (evt: Event) => {
      const cmd = (evt as CustomEvent<string>).detail;
      if (!cmd || artifact.kind !== "three") return;
      if (cmd === "export_stl") requestExport("stl");
      else if (cmd === "export_glb") requestExport("glb");
      else if (cmd === "finish_photograph") triggerFinish("photograph");
      else if (cmd === "finish_miniature") triggerFinish("miniature");
      else sendStageCommand(cmd);
    };
    window.addEventListener("jarvis-stage-command", onStageEvent);
    return () => window.removeEventListener("jarvis-stage-command", onStageEvent);
  }, [artifact.kind, requestExport, sendStageCommand, triggerFinish]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as BridgeMessage | null;
      if (!data || typeof data !== "object" || data.source !== "jarvis-artifact") return;

      if (data.type === "ready") {
        setError(null);
        return;
      }

      if (data.type === "user_interacted") {
        userInteractedDuringFinish.current = true;
        return;
      }

      if (data.type === "error") {
        const message = String(data.error ?? "render error").slice(0, 4000);
        setError(message);
        if (!reported.current && remote) {
          reported.current = true;
          agentService.reportWorkspaceError(artifact.id, version, message);
        }
        return;
      }

      if (data.type === "export") {
        const mode = pendingExport.current;
        if (!mode) return;
        pendingExport.current = null;
        if (data.error) {
          setBusy(null);
          setNotice(`Export failed: ${data.error}`);
          return;
        }
        if (mode === "finish_snap" && typeof data.data === "string") {
          const snapUrl = data.data;
          const finishKind = pendingFinishMode.current;
          void agentApi
            .workshopFinish({
              imageDataUrl: snapUrl,
              mode: finishKind,
              title: artifact.title,
              exploded,
            })
            .then((res) => {
              if (!res.ok || !res.imageDataUrl) {
                setNotice(res.error || "Studio Finish unavailable — check API key or export PNG.");
                return;
              }
              setFinishImageUrl(res.imageDataUrl);
              // Prompt 13 "never over my hands": if user orbited while rendering, show non-intrusive ready banner instead of hijacking stage
              if (userInteractedDuringFinish.current) {
                setFinishPendingOverlay(true);
                setNotice("Studio Finish ready (preserved your active camera orbit).");
              } else {
                setFinishViewMode("finish");
                setNotice(`${finishKind === "miniature" ? "Miniature" : "Studio Photograph"} ready.`);
              }
            })
            .catch((err) => setNotice(String(err)))
            .finally(() => setBusy(null));
          return;
        }

        setBusy(null);
        if (mode === "png" && typeof data.data === "string") {
          downloadBlob(
            Uint8Array.from(atob(data.data.split(",")[1] ?? ""), (c) => c.charCodeAt(0)),
            "image/png",
            `${slugify(artifact.title)}_v${version}.png`,
          );
          setNotice("PNG exported.");
        } else if (mode === "glb" && data.data instanceof ArrayBuffer) {
          downloadBlob(data.data, "model/gltf-binary", `${slugify(artifact.title)}_v${version}.glb`);
          setNotice("GLB exported.");
        } else if (mode === "stl" && data.data instanceof ArrayBuffer) {
          downloadBlob(data.data, "model/stl", `${slugify(artifact.title)}_v${version}.stl`);
          setNotice("3D-Printable STL exported.");
        }
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [artifact.id, artifact.title, exploded, remote, version]);

  const copy = async () => {
    await navigator.clipboard?.writeText(artifact.content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  const download = () => {
    const ext = artifactExtension(artifact);
    const text = artifact.kind === "three" ? `// JARVIS Workshop artifact\n${artifact.content}\n` : artifact.content;
    downloadBlob(text, "text/plain;charset=utf-8", `${slugify(artifact.title)}_v${version}.${ext}`);
  };

  const updateArtifact = (raw: WorkspaceArtifact) => {
    useWorkspaceStore.getState().upsertArtifact(toArtifact(raw));
  };

  const undo = async () => {
    if (!remote || version <= 1) return;
    setBusy("undo");
    try {
      const result = await agentApi.undoArtifact(artifact.id);
      updateArtifact(result.artifact);
      setNotice("Reverted to the previous version.");
    } catch (err) {
      setNotice(String(err));
    } finally {
      setBusy(null);
    }
  };

  const activate = async (number: number) => {
    if (!remote || number === version) return;
    setBusy("version");
    try {
      const result = await agentApi.activateVersion(artifact.id, number);
      updateArtifact(result.artifact);
      setNotice(`Restored v${number}.`);
    } catch (err) {
      setNotice(String(err));
    } finally {
      setBusy(null);
    }
  };

  const submitPartEdit = async () => {
    if (!selectedPart || !partInstruction.trim()) return;
    setBusy("part");
    try {
      const res = await agentApi.workshopPartEdit({
        artifactId: artifact.id,
        partName: selectedPart,
        instruction: partInstruction.trim(),
      });
      if (res.ok && res.artifact) {
        updateArtifact(res.artifact);
        setPartInstruction("");
        setNotice(`Surgically updated part "${selectedPart}".`);
      } else {
        setNotice(res.error || "Part edit failed.");
      }
    } catch (err) {
      setNotice(String(err));
    } finally {
      setBusy(null);
    }
  };

  const doRun = async () => {
    if (artifact.kind !== "code") return;
    setRunning(true);
    setOutput(null);
    try {
      const language = artifact.language === "typescript" ? "javascript" : (artifact.language ?? "javascript");
      const result = await agentApi.runCode(language, artifact.content);
      setOutput(result as typeof output);
    } catch (err) {
      setOutput({ ok: false, error: String(err) });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
        <span className="mr-auto flex min-w-0 items-center gap-2 text-xs">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-accent">
            {artifact.kind}
          </span>
          <span className="truncate font-medium text-fg">{artifact.title}</span>
          {remote && <span className="font-mono text-[10px] text-fg-muted">v{version}</span>}
        </span>

        {remote && versions.length > 1 && (
          <select
            value={version}
            onChange={(event) => void activate(Number(event.target.value))}
            disabled={busy !== null}
            aria-label="Artifact version"
            className="rounded-lg border border-border bg-elevated px-1.5 py-1 text-[11px] text-fg outline-none"
          >
            {[...versions].reverse().map((number) => (
              <option key={number} value={number}>
                v{number}
              </option>
            ))}
          </select>
        )}

        <button type="button" onClick={() => void copy()} className={toolbarButton}>
          {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" onClick={download} className={toolbarButton}>
          <Download size={12} /> Code
        </button>

        {remote && (
          <button
            type="button"
            onClick={() => void undo()}
            disabled={busy !== null || version <= 1}
            className={toolbarButton}
          >
            {busy === "undo" ? <Loader2 size={12} className="animate-spin" /> : <Undo2 size={12} />} Undo
          </button>
        )}

        {artifact.kind === "three" && (
          <>
            <button type="button" onClick={() => requestExport("png")} disabled={busy !== null} className={toolbarButton}>
              <ImageIcon size={12} /> PNG
            </button>
            <button type="button" onClick={() => requestExport("glb")} disabled={busy !== null} className={toolbarButton}>
              <Box size={12} /> GLB
            </button>
            <button type="button" onClick={() => requestExport("stl")} disabled={busy !== null} className={toolbarButton}>
              <Printer size={12} /> STL
            </button>
          </>
        )}

        {artifact.kind === "code" && (
          <button
            type="button"
            onClick={() => setConfirmRun(true)}
            disabled={running}
            className="flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1 text-[11px] font-medium text-background disabled:opacity-50"
          >
            {running ? <Square size={12} /> : <Play size={12} />} Run
          </button>
        )}
      </div>

      {/* Prompt 07-15 Workshop 3D Stage Controls Strip */}
      {artifact.kind === "three" && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-elevated/60 px-3 py-1.5 text-[11px]">
          <button
            type="button"
            onClick={() => sendStageCommand(exploded ? "assemble" : "explode")}
            className={cn(
              "flex items-center gap-1 rounded-lg border px-2 py-1 font-medium transition-colors",
              exploded
                ? "border-accent bg-accent text-background"
                : "border-border bg-surface text-fg hover:border-accent",
            )}
          >
            <Expand size={11} /> {exploded ? "Reassemble" : "Pull It Apart"}
          </button>

          <div className="flex items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5">
            {(["top", "front", "side"] as const).map((view) => (
              <button
                key={view}
                type="button"
                onClick={() => sendStageCommand(`camera_${view}`)}
                className="rounded px-1.5 py-0.5 capitalize text-fg-muted hover:bg-elevated hover:text-fg"
              >
                {view}
              </button>
            ))}
            <button
              type="button"
              onClick={() => sendStageCommand(spinning ? "spin_off" : "spin_on")}
              title="Toggle turntable auto-spin"
              className={cn(
                "flex items-center gap-1 rounded px-1.5 py-0.5",
                spinning ? "bg-accent text-background" : "text-fg-muted hover:text-fg",
              )}
            >
              <RotateCw size={11} /> Spin
            </button>
          </div>

          <div className="flex items-center gap-1 rounded-lg border border-border bg-surface px-2 py-0.5">
            <Sun size={11} className="text-accent" />
            <select
              aria-label="Workshop lighting mood"
              value={lightingMood}
              onChange={(e) => sendStageCommand(`light_${e.target.value}`)}
              className="bg-transparent text-[11px] text-fg outline-none"
            >
              <option value="studio">Studio Softbox</option>
              <option value="day">Daylight</option>
              <option value="sunset">Golden Sunset</option>
              <option value="night">Night Lab</option>
            </select>
          </div>

          {hasRoofLayer && (
            <button
              type="button"
              onClick={() => sendStageCommand(roofVisible ? "roof_off" : "roof_on")}
              className={cn(
                "flex items-center gap-1 rounded-lg border px-2 py-1",
                roofVisible ? "border-border bg-surface text-fg" : "border-accent bg-accent/15 text-accent",
              )}
            >
              <Home size={11} /> {roofVisible ? "Hide Roof" : "Show Roof"}
            </button>
          )}

          {parsedParts && parsedParts.parts.length > 0 && (
            <button
              type="button"
              onClick={() => setPartEditOpen((v) => !v)}
              className={cn(
                "flex items-center gap-1 rounded-lg border px-2 py-1",
                partEditOpen ? "border-accent bg-accent/15 text-accent" : "border-border bg-surface text-fg",
              )}
            >
              <Wrench size={11} /> Edit Part ({parsedParts.parts.length})
            </button>
          )}

          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => triggerFinish("photograph")}
              className="flex items-center gap-1 rounded-lg border border-border bg-surface px-2 py-1 text-fg hover:border-accent disabled:opacity-40"
            >
              {busy === "finish" ? <Loader2 size={11} className="animate-spin" /> : <Camera size={11} className="text-accent" />}
              Photograph It
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => triggerFinish("miniature")}
              className="flex items-center gap-1 rounded-lg border border-border bg-surface px-2 py-1 text-fg hover:border-accent disabled:opacity-40"
            >
              <Sparkles size={11} className="text-accent" /> Miniature
            </button>
          </div>
        </div>
      )}

      {/* Surgical Part Edit Bar */}
      {artifact.kind === "three" && partEditOpen && parsedParts && parsedParts.parts.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-2 text-xs">
          <Layers size={13} className="text-accent" />
          <select
            aria-label="Select workshop part"
            value={selectedPart}
            onChange={(e) => setSelectedPart(e.target.value)}
            className="rounded-lg border border-border bg-elevated px-2 py-1 text-xs text-fg outline-none"
          >
            {parsedParts.parts.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name} — {p.status}
              </option>
            ))}
          </select>
          <input
            value={partInstruction}
            onChange={(e) => setPartInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitPartEdit();
            }}
            placeholder="Surgical edit on this part (e.g. make matte black titanium, enlarge rotors 20%)..."
            className="min-w-0 flex-1 rounded-lg border border-border bg-elevated px-2.5 py-1 text-xs text-fg outline-none focus:border-accent"
          />
          <button
            type="button"
            disabled={busy === "part" || !partInstruction.trim()}
            onClick={() => void submitPartEdit()}
            className="rounded-lg bg-accent px-3 py-1 text-xs font-medium text-background disabled:opacity-50"
          >
            {busy === "part" ? "Updating…" : "Apply Part Edit"}
          </button>
        </div>
      )}

      {/* Studio Finish View Toggle & Never-Over-My-Hands Notification */}
      {artifact.kind === "three" && finishImageUrl && (
        <div className="flex items-center justify-between border-b border-border bg-surface px-3 py-1.5 text-[11px]">
          <div className="flex items-center gap-1 rounded-lg border border-border bg-elevated p-0.5">
            <button
              type="button"
              onClick={() => {
                setFinishViewMode("3d");
                setFinishPendingOverlay(false);
              }}
              className={cn(
                "rounded px-2 py-0.5 font-medium",
                finishViewMode === "3d" ? "bg-accent text-background" : "text-fg-muted hover:text-fg",
              )}
            >
              3D Model
            </button>
            <button
              type="button"
              onClick={() => {
                setFinishViewMode("finish");
                setFinishPendingOverlay(false);
              }}
              className={cn(
                "rounded px-2 py-0.5 font-medium",
                finishViewMode === "finish" ? "bg-accent text-background" : "text-fg-muted hover:text-fg",
              )}
            >
              Studio Finish
            </button>
          </div>
          {finishPendingOverlay && finishViewMode === "3d" && (
            <button
              type="button"
              onClick={() => {
                setFinishViewMode("finish");
                setFinishPendingOverlay(false);
              }}
              className="text-accent hover:underline"
            >
              Finish render ready — View Image
            </button>
          )}
          <a
            href={finishImageUrl}
            download={`${slugify(artifact.title)}_finish.png`}
            className="flex items-center gap-1 text-accent hover:underline"
          >
            <Download size={11} /> Save Picture
          </a>
        </div>
      )}

      {notice && (
        <div className="border-b border-border bg-elevated px-3 py-1.5 text-[11px] text-fg-muted">{notice}</div>
      )}

      {error && (
        <div className="border-b border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-500 dark:text-red-300">
          <p className="font-medium">Artifact hit a render error{remote ? " — requesting repair…" : "."}</p>
          <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap font-mono text-[10px]">
            {error.slice(0, 800)}
          </pre>
        </div>
      )}

      {confirmRun && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80">
          <div className="hud-panel w-[340px] p-4 shadow-2xl">
            <h3 className="text-sm font-medium text-fg">Run this code?</h3>
            <p className="mt-1 text-xs text-fg-muted">Executes in a sandboxed 15s Node process on the server.</p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setConfirmRun(false);
                  void doRun();
                }}
                className="flex-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-background"
              >
                Run
              </button>
              <button
                type="button"
                onClick={() => setConfirmRun(false)}
                className="flex-1 rounded-lg border border-border bg-elevated px-3 py-1.5 text-xs text-fg"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {artifact.kind === "code" && (
          <div className="h-full overflow-auto p-4">
            <pre className="overflow-x-auto rounded-xl border border-border bg-[#0b101b] p-3.5 text-slate-100">
              <code className="font-mono text-xs leading-relaxed" dangerouslySetInnerHTML={{ __html: highlighted }} />
            </pre>
            <RunOutput output={output} />
          </div>
        )}

        {srcDoc !== null && (
          <iframe
            key={`${artifact.id}:${version}`}
            ref={iframeRef}
            title={artifact.title}
            sandbox="allow-scripts allow-pointer-lock"
            srcDoc={srcDoc}
            className={cn(
              "absolute inset-0 h-full w-full border-0 bg-[#080c14]",
              finishViewMode === "finish" && finishImageUrl ? "pointer-events-none opacity-0" : "opacity-100",
            )}
          />
        )}

        {finishViewMode === "finish" && finishImageUrl && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#070b13] p-4">
            <img
              src={finishImageUrl}
              alt={`${artifact.title} Studio Finish`}
              className="max-h-full max-w-full rounded-xl border border-border object-contain shadow-2xl"
            />
          </div>
        )}

        {artifact.kind === "markdown" && (
          <div className="h-full overflow-auto p-4">
            <div
              className="mx-auto max-w-2xl text-sm text-fg"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(artifact.content) }}
            />
          </div>
        )}

        {artifact.kind === "image" && (
          <div className="flex h-full items-center justify-center overflow-auto p-4">
            <img src={artifact.content} alt={artifact.title} className="max-h-full rounded-xl" />
          </div>
        )}
      </div>
    </div>
  );
}
