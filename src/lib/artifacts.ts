/**
 * Artifact types + iframe document builders for the Workspace.
 *
 * Phase 6 artifacts come from the backend (`workspace.py`) as one live
 * artifact with version history. This module turns an artifact into a
 * self-contained, offline HTML document:
 * - `three`  → bundled Three.js runtime (no CDN) + the model's helper code
 * - `html`   → the model's page, with an error bridge injected
 * - `svg`    → the model's markup centered on a dark canvas
 *
 * Every document reports render errors back to the app via postMessage so the
 * backend can ask the model for one repair pass.
 */

import workspaceRuntime from "@/workspace/runtime.generated.js?raw";

export type ArtifactKind = "three" | "html" | "svg" | "code" | "markdown" | "image";

export interface Artifact {
  id: string;
  kind: ArtifactKind;
  title: string;
  language?: string;
  content: string;
  createdAt: number;
  updatedAt?: number;
  version?: number;
  versionCount?: number;
  versions?: number[];
  /** True when the artifact is stored in the backend workspace store. */
  remote?: boolean;
}

const FENCE_RE = /```(\w*)\n?([\s\S]*?)(?:```|$)/g;

export function detectKind(lang: string | undefined, content: string): {
  kind: ArtifactKind;
  language?: string;
} {
  const l = (lang ?? "").toLowerCase();
  if (l === "three") return { kind: "three", language: "javascript" };
  if (l === "svg" || (/<svg[\s>]/i.test(content) && !/<html[\s>]/i.test(content))) {
    return { kind: "svg", language: "svg" };
  }
  if (l === "html" || /<html[\s>]|<!doctype html/i.test(content)) {
    return { kind: "html", language: "html" };
  }
  if (l === "md" || l === "markdown") return { kind: "markdown", language: "markdown" };
  if (l === "js" || l === "javascript" || l === "ts" || l === "typescript") {
    if (/\bthree\b|\bTHREE\b|\bJARVIS\.|\bW\./.test(content)) {
      return { kind: "three", language: "javascript" };
    }
    return { kind: "code", language: l.startsWith("t") ? "typescript" : "javascript" };
  }
  if (l === "py" || l === "python") return { kind: "code", language: "python" };
  if (l) return { kind: "code", language: l };
  if (/\bJARVIS\.|\bTHREE\b|\bW\./.test(content)) return { kind: "three", language: "javascript" };
  return { kind: "code", language: undefined };
}

/** Fallback parser for replies that did not come through the artifact event. */
export function parseArtifacts(text: string): Artifact[] {
  const artifacts: Artifact[] = [];
  let match: RegExpExecArray | null;
  let index = 0;
  FENCE_RE.lastIndex = 0;
  while ((match = FENCE_RE.exec(text))) {
    const lang = match[1] || undefined;
    const content = match[2].replace(/\n$/, "");
    if (!content.trim()) continue;
    const { kind, language } = detectKind(lang, content);
    index += 1;
    artifacts.push({
      id: crypto.randomUUID(),
      kind,
      language,
      title: artifactTitle(kind, language, index),
      content,
      createdAt: Date.now(),
      version: 1,
      versionCount: 1,
    });
  }
  return artifacts;
}

function artifactTitle(kind: ArtifactKind, language: string | undefined, index: number): string {
  const names: Record<ArtifactKind, string> = {
    code: language ? `${language} snippet` : "code snippet",
    html: "web page",
    three: "3D scene",
    svg: "vector graphic",
    markdown: "document",
    image: "image",
  };
  return `${names[kind]} #${index}`;
}

/* ---------------------------------------------------------------- iframe docs */

const ERROR_BRIDGE = `<script>
(function () {
  function send(message) {
    try {
      message.source = "jarvis-artifact";
      parent.postMessage(message, "*");
    } catch (error) { /* detached */ }
  }
  window.addEventListener("error", function (event) {
    send({ type: "error", error: (event.error && event.error.stack) || event.message || "render error" });
  });
  window.addEventListener("unhandledrejection", function (event) {
    var reason = event.reason;
    send({ type: "error", error: String((reason && reason.stack) || reason || "unhandled rejection") });
  });
  requestAnimationFrame(function () { send({ type: "ready" }); });
})();
</script>`;

function escapeScript(source: string): string {
  return source.replace(/<\/script/gi, "<\\/script");
}

function injectBridge(source: string): string {
  if (/<head[^>]*>/i.test(source)) {
    return source.replace(/<\/head>/i, `${ERROR_BRIDGE}</head>`);
  }
  if (/<body[^>]*>/i.test(source)) {
    return source.replace(/<body[^>]*>/i, (match) => `${match}${ERROR_BRIDGE}`);
  }
  return `${ERROR_BRIDGE}${source}`;
}

/** Three.js artifact: bundled runtime + the model's helper code. */
export function threeHtml(userCode: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: #0a0a12; }
  canvas { display: block; }
</style>
</head>
<body>
<script>${escapeScript(workspaceRuntime)}</script>
<script>
${escapeScript(userCode)}
</script>
</body>
</html>`;
}

/** HTML artifact: add the error bridge without touching the model's markup. */
export function htmlHtml(source: string): string {
  return injectBridge(source);
}

/** SVG artifact: center the vector on the app's dark canvas. */
export function svgHtml(source: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  html, body {
    margin: 0;
    height: 100%;
    background: radial-gradient(circle at 50% 40%, #141422 0%, #07070c 70%);
    display: grid;
    place-items: center;
    overflow: hidden;
  }
  svg { max-width: min(86vw, 86vh); max-height: min(86vw, 86vh); height: auto; width: auto; filter: drop-shadow(0 12px 40px rgba(0,0,0,.55)); }
</style>
</head>
<body>
${ERROR_BRIDGE}
${source}
</body>
</html>`;
}

/** The srcDoc for an artifact kind, or null when it is not a live preview. */
export function artifactDocument(artifact: Artifact): string | null {
  switch (artifact.kind) {
    case "three":
      return threeHtml(artifact.content);
    case "html":
      return htmlHtml(artifact.content);
    case "svg":
      return svgHtml(artifact.content);
    default:
      return null;
  }
}

export function artifactExtension(artifact: Artifact): string {
  if (artifact.kind === "html") return "html";
  if (artifact.kind === "svg") return "svg";
  if (artifact.kind === "markdown") return "md";
  if (artifact.kind === "three") return "js";
  if (artifact.kind === "image") return "png";
  if (artifact.language === "python") return "py";
  if (artifact.language === "typescript") return "ts";
  if (artifact.language === "javascript") return "js";
  return "txt";
}
