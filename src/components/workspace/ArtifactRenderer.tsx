import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Check,
  Copy,
  Download,
  Image as ImageIcon,
  Loader2,
  Play,
  Save,
  Square,
  Undo2,
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
import { useWorkspaceStore } from "@/store";

/* ---------------- minimal markdown -> html ---------------- */

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderMarkdown(source: string): string {
  const blocks: string[] = [];
  // Pull out fenced code first so inline transforms can't touch it.
  const withPlaceholders = source.replace(/```(\w*)\n?([\s\S]*?)(?:```|$)/g, (_m, _lang, code) => {
    const html = `<pre class="rounded-lg bg-black/40 p-3 my-2 overflow-x-auto font-mono text-xs leading-relaxed">${escapeHtml(code.replace(/\n$/, ""))}</pre>`;
    blocks.push(html);
    return `\u0000${blocks.length - 1}\u0000`;
  });

  const inline = escapeHtml(withPlaceholders)
    .replace(/^###### (.*)$/gm, '<h6 class="text-xs font-semibold mt-3 mb-1">$1</h6>')
    .replace(/^##### (.*)$/gm, '<h5 class="text-xs font-semibold mt-3 mb-1">$1</h5>')
    .replace(/^#### (.*)$/gm, '<h4 class="text-sm font-semibold mt-3 mb-1">$1</h4>')
    .replace(/^### (.*)$/gm, '<h3 class="text-sm font-semibold mt-4 mb-1.5">$1</h3>')
    .replace(/^## (.*)$/gm, '<h2 class="text-base font-semibold mt-4 mb-2">$1</h2>')
    .replace(/^# (.*)$/gm, '<h1 class="text-lg font-semibold mt-4 mb-2">$1</h1>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-fg">$1</strong>')
    .replace(/(^|\W)\*([^*\n]+)\*(?=\W|$)/g, '$1<em class="italic">$2</em>')
    .replace(/`([^`\n]+)`/g, '<code class="rounded bg-black/40 px-1 py-0.5 font-mono text-xs text-accent/90">$1</code>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer" class="text-accent underline underline-offset-2">$1</a>')
    .replace(/^\s*[-*] (.*)$/gm, '<li class="ml-4 list-disc">$1</li>')
    .replace(/(<li[\s\S]*?<\/li>)(?!\s*<li)/g, "<ul class=\"my-1.5 space-y-0.5\">$1</ul>")
    .replace(/^(?!<[uhl]|<pre|<h\d|<p|$)(.+)$/gm, '<p class="my-1.5 leading-relaxed">$1</p>');

  return inline.replace(/\u0000(\d+)\u0000/g, (_m, i) => blocks[Number(i)] ?? "");
}

/* ---------------- helpers ---------------- */

const RUN_OUTPUT_STYLE =
  "mt-2 rounded-xl border border-white/10 bg-black/40 p-3 font-mono text-[11px] leading-relaxed";

function RunOutput({ output }: { output: { ok: boolean; stdout?: string; stderr?: string; error?: string } | null }) {
  if (!output) return null;
  const text = output.error ?? output.stdout ?? "";
  const err = output.stderr ?? "";
  return (
    <div className={RUN_OUTPUT_STYLE}>
      <p className="mb-1 text-[10px] uppercase tracking-wider text-fg-muted">Output</p>
      {text && <pre className="whitespace-pre-wrap text-fg/85">{text || "(no output)"}</pre>}
      {err && <pre className="mt-1 whitespace-pre-wrap text-red-300">{err}</pre>}
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
}

const toolbarButton =
  "flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-fg-muted transition-colors hover:bg-white/5 hover:text-fg disabled:opacity-40";

/* ---------------- renderer ---------------- */

export function ArtifactRenderer({ artifact }: { artifact: Artifact }) {
  const [output, setOutput] = useState<{ ok: boolean; stdout?: string; stderr?: string; error?: string } | null>(null);
  const [running, setRunning] = useState(false);
  const [confirmRun, setConfirmRun] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<"save" | "undo" | "version" | "png" | "glb" | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const reported = useRef(false);
  const pendingExport = useRef<"png" | "glb" | null>(null);

  const remote = Boolean(artifact.remote);
  const version = artifact.version ?? 1;
  const versions = artifact.versions ?? [];

  const highlighted = useMemo(() => {
    if (artifact.kind !== "code") return "";
    const lang = artifact.language ?? "clike";
    const grammar = (Prism.languages as Record<string, Prism.Grammar>)[lang] ?? Prism.languages.clike;
    return Prism.highlight(artifact.content, grammar, lang);
  }, [artifact]);

  const srcDoc = useMemo(() => artifactDocument(artifact), [artifact]);

  /* Reset the error banner when a new version arrives. */
  useEffect(() => {
    setError(null);
    reported.current = false;
  }, [artifact.id, artifact.version]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 8000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  /* Messages from the sandboxed artifact document. */
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as BridgeMessage | null;
      if (!data || typeof data !== "object" || data.source !== "jarvis-artifact") return;

      if (data.type === "ready") {
        setError(null);
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
        if (!pendingExport.current) return;
        pendingExport.current = null;
        setBusy(null);
        if (data.error) {
          setNotice(`Export failed: ${data.error}`);
          return;
        }
        if (data.format === "png" && typeof data.data === "string") {
          downloadBlob(
            // data URL -> bytes
            Uint8Array.from(atob(data.data.split(",")[1] ?? ""), (c) => c.charCodeAt(0)),
            "image/png",
            `${slugify(artifact.title)}_v${version}.png`,
          );
          setNotice("PNG exported.");
        } else if (data.format === "glb" && data.data instanceof ArrayBuffer) {
          downloadBlob(data.data, "model/gltf-binary", `${slugify(artifact.title)}_v${version}.glb`);
          setNotice("GLB exported.");
        }
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [artifact.id, artifact.title, remote, version]);

  /* Voice/Host stage commands (explode, assemble, camera, export) */
  useEffect(() => {
    const onStageCmd = (event: Event) => {
      const customEvent = event as CustomEvent<string>;
      const cmd = customEvent.detail;
      if (cmd === "export_png") {
        requestExport("png");
      } else if (cmd === "export_glb") {
        requestExport("glb");
      } else if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage(
          { source: "jarvis-host", type: "stage_command", command: cmd },
          "*",
        );
      }
    };
    window.addEventListener("jarvis-stage-command", onStageCmd);
    return () => window.removeEventListener("jarvis-stage-command", onStageCmd);
  }, [artifact.kind]);

  const copy = async () => {
    await navigator.clipboard?.writeText(artifact.content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  const download = () => {
    const ext = artifactExtension(artifact);
    const text = artifact.kind === "three" ? `// JARVIS Workspace artifact\n${artifact.content}\n` : artifact.content;
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
      setNotice(`Restored v${number} as the latest version.`);
    } catch (err) {
      setNotice(String(err));
    } finally {
      setBusy(null);
    }
  };

  const saveToFolder = async () => {
    if (!remote) return;
    setBusy("save");
    try {
      const picked = await agentApi.pickFolder();
      if (!picked.ok || !picked.folder) {
        if (picked.error) setNotice(`Folder picker: ${picked.error}`);
        return;
      }
      const saved = await agentApi.saveArtifactToFolder(artifact.id, picked.folder);
      setNotice(saved.path ? `Saved to ${saved.path}` : "Saved.");
    } catch (err) {
      setNotice(String(err));
    } finally {
      setBusy(null);
    }
  };

  const requestExport = (format: "png" | "glb") => {
    if (artifact.kind !== "three") {
      setNotice("PNG and GLB export are available for 3D artifacts.");
      return;
    }
    const target = iframeRef.current?.contentWindow;
    if (!target) return;
    pendingExport.current = format;
    setBusy(format);
    target.postMessage({ source: "jarvis-host", type: "export", format }, "*");
    window.setTimeout(() => {
      if (pendingExport.current !== format) return;
      pendingExport.current = null;
      setBusy(null);
      setNotice("Export timed out — try again once the scene is visible.");
    }, 20_000);
  };

  const doRun = async () => {
    if (artifact.kind !== "code") return;
    setRunning(true);
    setOutput(null);
    try {
      const language = artifact.language === "typescript" ? "javascript" : (artifact.language ?? "python");
      const result = await agentApi.runCode(language, artifact.content);
      setOutput(result as typeof output);
    } catch (error) {
      setOutput({ ok: false, error: String(error) });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="relative flex h-full flex-col">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-white/10 px-3 py-2">
        <span className="mr-auto flex min-w-0 items-center gap-2 text-xs text-fg-muted">
          <span className="rounded-md bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent">
            {artifact.kind}
          </span>
          <span className="truncate text-fg/90">{artifact.title}</span>
          {remote && (
            <span className="rounded-md border border-white/10 bg-black/30 px-1.5 py-0.5 font-mono text-[10px] text-fg-muted">
              v{version}
            </span>
          )}
        </span>

        {remote && versions.length > 1 && (
          <select
            value={version}
            onChange={(event) => void activate(Number(event.target.value))}
            disabled={busy !== null}
            aria-label="Artifact version"
            className="rounded-lg border border-white/10 bg-black/30 px-1.5 py-1 text-[11px] text-fg-muted outline-none focus:border-accent/40"
          >
            {[...versions].reverse().map((number) => (
              <option key={number} value={number}>
                v{number}
              </option>
            ))}
          </select>
        )}

        <button type="button" onClick={() => void copy()} aria-label="Copy" className={toolbarButton}>
          {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" onClick={download} aria-label="Download" className={toolbarButton}>
          <Download size={12} /> Download
        </button>

        {remote && (
          <>
            <button type="button" onClick={() => void saveToFolder()} disabled={busy !== null} className={toolbarButton}>
              {busy === "save" ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save
            </button>
            <button
              type="button"
              onClick={() => void undo()}
              disabled={busy !== null || version <= 1}
              aria-label="Undo last version"
              className={toolbarButton}
            >
              {busy === "undo" ? <Loader2 size={12} className="animate-spin" /> : <Undo2 size={12} />} Undo
            </button>
          </>
        )}

        {artifact.kind === "three" && (
          <>
            <button
              type="button"
              onClick={() => requestExport("png")}
              disabled={busy !== null}
              aria-label="Export PNG"
              className={toolbarButton}
            >
              {busy === "png" ? <Loader2 size={12} className="animate-spin" /> : <ImageIcon size={12} />} PNG
            </button>
            <button
              type="button"
              onClick={() => requestExport("glb")}
              disabled={busy !== null}
              aria-label="Export GLB"
              className={toolbarButton}
            >
              {busy === "glb" ? <Loader2 size={12} className="animate-spin" /> : <Box size={12} />} GLB
            </button>
          </>
        )}

        {artifact.kind === "code" && (
          <button
            type="button"
            onClick={() => setConfirmRun(true)}
            disabled={running}
            className="flex items-center gap-1 rounded-lg bg-accent/15 px-2.5 py-1 text-[11px] font-medium text-accent transition-colors hover:bg-accent/25 disabled:opacity-50"
          >
            {running ? <Square size={12} /> : <Play size={12} />} Run
          </button>
        )}
      </div>

      {notice && (
        <div className="border-b border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] text-fg-muted">
          <span className="break-all">{notice}</span>
        </div>
      )}

      {error && (
        <div className="border-b border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">
          <p className="font-medium">
            This artifact hit a render error
            {remote ? " — asking JARVIS to repair it…" : "."}
          </p>
          <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-red-200/80">
            {error.slice(0, 900)}
          </pre>
        </div>
      )}

      {/* run confirmation */}
      {confirmRun && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="glass w-[340px] rounded-2xl p-4 shadow-2xl">
            <h3 className="text-sm font-medium">Run this code?</h3>
            <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
              It executes on your machine via the backend with a 15s timeout.
            </p>
            <pre className="mt-2.5 max-h-28 overflow-auto rounded-lg bg-black/40 p-2 font-mono text-[10px] leading-relaxed text-fg-muted">
              {artifact.content.slice(0, 300)}
              {artifact.content.length > 300 ? "\n…" : ""}
            </pre>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setConfirmRun(false);
                  void doRun();
                }}
                className="flex-1 rounded-lg bg-accent/15 px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/25"
              >
                Run
              </button>
              <button
                type="button"
                onClick={() => setConfirmRun(false)}
                className="flex-1 rounded-lg bg-white/5 px-3 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-white/10 hover:text-fg"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* canvas */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {artifact.kind === "code" && (
          <div className="h-full overflow-auto p-4">
            <pre className="overflow-x-auto rounded-xl border border-white/10 bg-black/40 p-3.5">
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
            className="absolute inset-0 h-full w-full border-0 bg-black/30"
          />
        )}

        {artifact.kind === "three" && !error && (
          <p className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-2.5 py-1 text-[10px] text-fg-muted backdrop-blur-sm">
            drag to orbit · scroll to zoom
          </p>
        )}

        {artifact.kind === "markdown" && (
          <div className="h-full overflow-auto p-4">
            <div
              className="mx-auto max-w-2xl text-sm text-fg/85"
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
