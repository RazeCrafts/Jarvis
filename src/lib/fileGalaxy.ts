import type { PersonalMemory, PersonalNote } from "@/lib/memoryAndCalendar";

export type GalaxyFileCategory = "document" | "code" | "image" | "video" | "audio" | "data" | "other";

export interface WorkspaceVaultFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  category: GalaxyFileCategory;
  tags: string[];
  textPreview: string;
  dataUrl?: string;
  createdAt: number;
  updatedAt: number;
}

export type GalaxyNodeKind = "note" | "memory" | "file";

export interface GalaxyNode {
  id: string;
  sourceId: string;
  kind: GalaxyNodeKind;
  subKind: string;
  title: string;
  excerpt: string;
  tags: string[];
  wikilinks: string[];
  keywords: string[];
  x: number;
  y: number;
  z: number;
  radius: number;
  color: string;
  updatedAt: number;
  sizeBytes?: number;
  mimeType?: string;
  dataUrl?: string;
}

export interface GalaxyEdge {
  from: string;
  to: string;
  weight: number;
  reason: "wikilink" | "tag" | "keyword";
}

export interface GalaxyGraph {
  nodes: GalaxyNode[];
  edges: GalaxyEdge[];
}

export type BrainCameraAction = "still" | "fly" | "cluster";

export interface BrainQueryResult {
  cameraAction: BrainCameraAction;
  focusNodeId: string | null;
  litNodeIds: string[];
  neighborNodeIds: string[];
  matches: Array<{ node: GalaxyNode; score: number }>;
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "are", "was", "were", "have", "has",
  "had", "not", "but", "you", "your", "can", "will", "just", "into", "about", "what", "when",
  "where", "which", "how", "why", "who", "all", "one", "two", "use", "using", "used", "sir",
  "jarvis", "please", "note", "file", "memory",
]);

export function classifyFileCategory(name: string, mimeType: string): GalaxyFileCategory {
  const mime = (mimeType || "").toLowerCase();
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (mime.startsWith("image/") || /^(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/.test(ext)) return "image";
  if (mime.startsWith("video/") || /^(mp4|webm|mov|mkv|avi|m4v)$/.test(ext)) return "video";
  if (mime.startsWith("audio/") || /^(mp3|wav|ogg|m4a|flac|aac)$/.test(ext)) return "audio";
  if (/^(ts|tsx|js|jsx|py|rs|go|java|cpp|c|h|css|html|sh|yaml|yml|toml|sql)$/.test(ext)) return "code";
  if (/^(json|csv|tsv|xml|xlsx|xls|parquet)$/.test(ext) || mime.includes("json") || mime.includes("csv")) return "data";
  if (/^(md|txt|pdf|doc|docx|rtf|org|tex|log)$/.test(ext) || mime.startsWith("text/")) return "document";
  return "other";
}

export function extractWikilinks(text: string): string[] {
  const links: string[] = [];
  const re = /\[\[([^\]]{1,80})\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const clean = m[1].trim();
    if (clean && !links.includes(clean)) links.push(clean);
  }
  return links;
}

export function extractKeywords(text: string): string[] {
  const counts = new Map<string, number>();
  const words = text.toLowerCase().match(/[a-z0-9]{3,24}/g) || [];
  for (const w of words) {
    if (STOPWORDS.has(w) || /^\d+$/.test(w)) continue;
    counts.set(w, (counts.get(w) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([w]) => w);
}

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

function nodeColor(kind: GalaxyNodeKind, subKind: string): string {
  if (kind === "note") return "#f5b85c";
  if (kind === "memory") return "#a78bfa";
  switch (subKind) {
    case "video":
      return "#38bdf8";
    case "audio":
      return "#34d399";
    case "image":
      return "#fb7185";
    case "code":
      return "#22d3ee";
    case "data":
      return "#818cf8";
    default:
      return "#5ce1e6";
  }
}

export function buildGalaxyGraph(input: {
  notes: PersonalNote[];
  memories: PersonalMemory[];
  files: WorkspaceVaultFile[];
}): GalaxyGraph {
  const rawNodes: Omit<GalaxyNode, "x" | "y" | "z" | "radius">[] = [];

  for (const note of input.notes) {
    const combined = `${note.title}\n${note.body}\n${note.tags.join(" ")}`;
    rawNodes.push({
      id: `note:${note.id}`,
      sourceId: note.id,
      kind: "note",
      subKind: "markdown",
      title: note.title || "Untitled Note",
      excerpt: note.body.slice(0, 260),
      tags: note.tags.map((t) => t.toLowerCase()),
      wikilinks: extractWikilinks(note.body),
      keywords: extractKeywords(combined),
      color: nodeColor("note", "markdown"),
      updatedAt: note.updatedAt,
    });
  }

  for (const mem of input.memories) {
    const combined = `${mem.title}\n${mem.content}\n${mem.category}`;
    rawNodes.push({
      id: `memory:${mem.id}`,
      sourceId: mem.id,
      kind: "memory",
      subKind: mem.category,
      title: mem.title,
      excerpt: mem.content.slice(0, 260),
      tags: [mem.category.toLowerCase(), ...(mem.pinned ? ["pinned"] : [])],
      wikilinks: extractWikilinks(mem.content),
      keywords: extractKeywords(combined),
      color: nodeColor("memory", mem.category),
      updatedAt: mem.updatedAt,
    });
  }

  for (const file of input.files) {
    const combined = `${file.name}\n${file.textPreview}\n${file.tags.join(" ")}\n${file.category}`;
    rawNodes.push({
      id: `file:${file.id}`,
      sourceId: file.id,
      kind: "file",
      subKind: file.category,
      title: file.name,
      excerpt: file.textPreview.slice(0, 260) || `${file.mimeType || "binary"} (${Math.max(1, Math.round(file.sizeBytes / 1024))} KB)`,
      tags: [file.category, ...file.tags.map((t) => t.toLowerCase())],
      wikilinks: extractWikilinks(file.textPreview),
      keywords: extractKeywords(combined),
      color: nodeColor("file", file.category),
      updatedAt: file.updatedAt,
      sizeBytes: file.sizeBytes,
      mimeType: file.mimeType,
      dataUrl: file.dataUrl,
    });
  }

  const total = Math.max(1, rawNodes.length);
  const sectorAngle: Record<GalaxyNodeKind, number> = {
    note: 0,
    memory: (Math.PI * 2) / 3,
    file: (Math.PI * 4) / 3,
  };

  const nodes: GalaxyNode[] = rawNodes.map((n, index) => {
    const phi = Math.acos(1 - (2 * (index + 0.5)) / total);
    const theta = Math.PI * (1 + Math.sqrt(5)) * index + sectorAngle[n.kind];
    const jitter = (hashSeed(n.id) - 0.5) * 4.2;
    const armOffsetX = Math.cos(sectorAngle[n.kind]) * 4.5;
    const armOffsetZ = Math.sin(sectorAngle[n.kind]) * 4.5;
    const dist = 10 + (index % 5) * 2.1 + jitter;

    return {
      ...n,
      x: Number((dist * Math.sin(phi) * Math.cos(theta) + armOffsetX).toFixed(3)),
      y: Number((dist * Math.cos(phi) * 0.72 + (hashSeed(`${n.id}:y`) - 0.5) * 3.5).toFixed(3)),
      z: Number((dist * Math.sin(phi) * Math.sin(theta) + armOffsetZ).toFixed(3)),
      radius: n.kind === "file" ? 0.52 : n.tags.includes("pinned") ? 0.56 : 0.44,
    };
  });

  const titleIndex = new Map<string, string>();
  for (const n of nodes) {
    titleIndex.set(n.title.toLowerCase(), n.id);
  }

  const edges: GalaxyEdge[] = [];
  const seenEdge = new Set<string>();
  const addEdge = (a: string, b: string, weight: number, reason: GalaxyEdge["reason"]) => {
    if (a === b) return;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seenEdge.has(key)) return;
    seenEdge.add(key);
    edges.push({ from: a, to: b, weight, reason });
  };

  for (let i = 0; i < nodes.length; i += 1) {
    const a = nodes[i];
    for (const link of a.wikilinks) {
      const targetId = titleIndex.get(link.toLowerCase());
      if (targetId) addEdge(a.id, targetId, 1.0, "wikilink");
    }
    for (let j = i + 1; j < nodes.length; j += 1) {
      const b = nodes[j];
      const sharedTags = a.tags.filter((t) => t !== "pinned" && b.tags.includes(t));
      if (sharedTags.length > 0) {
        addEdge(a.id, b.id, Math.min(1, 0.45 + sharedTags.length * 0.2), "tag");
        continue;
      }
      const sharedKw = a.keywords.filter((k) => b.keywords.includes(k));
      if (sharedKw.length >= 2) {
        addEdge(a.id, b.id, Math.min(0.85, 0.25 + sharedKw.length * 0.15), "keyword");
      }
    }
  }

  return { nodes, edges };
}

const SMALL_TALK_RE =
  /^(?:hi|hello|hey|good\s+(?:morning|afternoon|evening)|how\s+are\s+you|thanks|thank\s+you|who\s+are\s+you)[!?.\s]*$/i;

export function queryGalaxyBrain(graph: GalaxyGraph, question: string): BrainQueryResult {
  const q = question.trim();
  if (!q || SMALL_TALK_RE.test(q)) {
    return {
      cameraAction: "still",
      focusNodeId: null,
      litNodeIds: [],
      neighborNodeIds: [],
      matches: [],
    };
  }

  const terms = extractKeywords(q);
  const rawTerms = q.toLowerCase().split(/\s+/).filter((t) => t.length >= 2);
  const searchTerms = terms.length > 0 ? terms : rawTerms;

  const scored = graph.nodes
    .map((node) => {
      const haystack = `${node.title} ${node.excerpt} ${node.tags.join(" ")} ${node.subKind}`.toLowerCase();
      let score = 0;
      if (haystack.includes(q.toLowerCase())) score += 6;
      for (const term of searchTerms) {
        if (node.title.toLowerCase().includes(term)) score += 3.2;
        if (node.tags.includes(term)) score += 2.6;
        if (node.keywords.includes(term)) score += 1.8;
        else if (haystack.includes(term)) score += 1.1;
      }
      return { node, score };
    })
    .filter((entry) => entry.score >= 1.5)
    .sort((a, b) => b.score - a.score || b.node.updatedAt - a.node.updatedAt);

  if (scored.length === 0) {
    return {
      cameraAction: "still",
      focusNodeId: null,
      litNodeIds: [],
      neighborNodeIds: [],
      matches: [],
    };
  }

  const topMatches = scored.slice(0, 8);
  const litNodeIds = topMatches.map((m) => m.node.id);
  const neighborSet = new Set<string>();
  for (const edge of graph.edges) {
    if (litNodeIds.includes(edge.from) && !litNodeIds.includes(edge.to)) neighborSet.add(edge.to);
    if (litNodeIds.includes(edge.to) && !litNodeIds.includes(edge.from)) neighborSet.add(edge.from);
  }

  // Prompt 03: 1..3 matching sources -> dive camera to top node; 4+ sources -> light cluster without jumping
  const cameraAction: BrainCameraAction = topMatches.length <= 3 ? "fly" : "cluster";
  return {
    cameraAction,
    focusNodeId: cameraAction === "fly" ? topMatches[0].node.id : null,
    litNodeIds,
    neighborNodeIds: [...neighborSet],
    matches: topMatches,
  };
}

export function extractRememberIntent(text: string): {
  title: string;
  body: string;
  tags: string[];
} | null {
  const clean = text.trim();
  const match = clean.match(
    /^(?:remember\s+(?:that\s+)?|note\s+to\s+self[:\s]+|don'?t\s+let\s+me\s+forget\s+(?:that\s+)?|log\s+this[:\s]+)(.+)/i,
  );
  if (!match) return null;
  const body = match[1].trim();
  if (body.length < 4) return null;
  const words = body.replace(/[.!?]+$/, "").split(/\s+/).slice(0, 6).join(" ");
  const title = words.charAt(0).toUpperCase() + words.slice(1);
  const kws = extractKeywords(body).slice(0, 3);
  return {
    title,
    body,
    tags: ["live-recall", ...kws],
  };
}
