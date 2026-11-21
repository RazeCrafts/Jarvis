import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { syncMemoryIndex, searchMemorySqlite, type MemorySearchDoc } from "./sqliteMemory";
import type { PersonalMemory, PersonalNote, WorkspaceVaultFile } from "../src/types";

export type RetrievalBackend = "sqlite_markdown" | "hybrid_bm25_vector" | "holographic_hrr";

export interface AgentProfileMeta {
  id: string;
  name: string;
  description: string;
  retrievalBackend: RetrievalBackend;
  maxContextBytes: number;
  fileReadLimitBytes: number;
}

export const BUILTIN_PROFILES: AgentProfileMeta[] = [
  {
    id: "personal",
    name: "Personal Butler",
    description: "Balanced daily executive assistant tuned for crisp spoken responses.",
    retrievalBackend: "hybrid_bm25_vector",
    maxContextBytes: 28_000,
    fileReadLimitBytes: 64_000,
  },
  {
    id: "coding",
    name: "Coding / Workshop",
    description: "Repo-aware software engineering profile prioritizing exact code diffs and test healing.",
    retrievalBackend: "sqlite_markdown",
    maxContextBytes: 64_000,
    fileReadLimitBytes: 120_000,
  },
  {
    id: "study",
    name: "Study & Deep Research",
    description: "Academic tutor built for multi-page essays, Mermaid flowcharts, and MCQ practice.",
    retrievalBackend: "holographic_hrr",
    maxContextBytes: 56_000,
    fileReadLimitBytes: 96_000,
  },
];

const PROFILES_ROOT = path.resolve(process.cwd(), "data", "profiles");

function safeProfileId(raw: string): string {
  return (raw || "personal").toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || "personal";
}

function profileDir(profileId: string): string {
  const safe = safeProfileId(profileId);
  const resolved = path.resolve(PROFILES_ROOT, safe);
  if (!resolved.startsWith(PROFILES_ROOT + path.sep)) {
    throw new Error("Invalid profile path");
  }
  return resolved;
}

const DEFAULT_SOUL_MD = `# JARVIS System Contract (SOUL.md)

Identity: You are JARVIS, a refined, pragmatic personal butler and autonomous cross-platform AI workstation.
Core Rules:
1. Butler Mode default: answer quick questions in 1-3 crisp, human sentences. Never lecture unless Full Text Agent Mode is active or depth is requested.
2. Evidence over guesswork: inspect real files, test outputs, and stack traces before claiming completion.
3. Safety boundaries: respect the 3-dimensional App / Folder / Task permission posture at all times.
4. Self-improvement: when you solve a multi-step engineering problem or discover an API quirk, propose saving or patching a reusable SKILL.md entry.
`;

export async function ensureProfileWorkspace(profileId: string): Promise<{
  dir: string;
  soulMd: string;
  memoryMd: string;
  userMd: string;
}> {
  const dir = profileDir(profileId);
  await fs.mkdir(dir, { recursive: true });
  const soulPath = path.join(dir, "SOUL.md");
  const memPath = path.join(dir, "MEMORY.md");
  const userPath = path.join(dir, "USER.md");

  let soulMd = DEFAULT_SOUL_MD;
  try {
    soulMd = await fs.readFile(soulPath, "utf8");
  } catch {
    await fs.writeFile(soulPath, soulMd, "utf8");
  }

  let memoryMd = `# MEMORY (${profileId})\n\n_Self-editing durable memory ledger._\n`;
  try {
    memoryMd = await fs.readFile(memPath, "utf8");
  } catch {
    await fs.writeFile(memPath, memoryMd, "utf8");
  }

  let userMd = `# USER MODEL (${profileId})\n\n- Communication style: crisp butler by default, deep essays/code on toggle\n- Primary goal: Desktop-first autonomous workstation\n`;
  try {
    userMd = await fs.readFile(userPath, "utf8");
  } catch {
    await fs.writeFile(userPath, userMd, "utf8");
  }

  return { dir, soulMd, memoryMd, userMd };
}

export async function saveProfileContract(
  profileId: string,
  kind: "SOUL.md" | "MEMORY.md" | "USER.md",
  content: string,
): Promise<void> {
  const { dir } = await ensureProfileWorkspace(profileId);
  await fs.writeFile(path.join(dir, kind), content, "utf8");
}

export async function syncProfileMarkdown(
  profileId: string,
  memories: PersonalMemory[],
  notes: PersonalNote[],
  vaultFiles: WorkspaceVaultFile[],
): Promise<number> {
  const { dir } = await ensureProfileWorkspace(profileId);
  const memLines = memories.slice(0, 60).map(
    (m) => `- [${m.pinned ? "PINNED" : m.category}] **${m.title}**: ${m.content}`,
  );
  const mdBody = `# MEMORY (${profileId})\n\nLast synced: ${new Date().toISOString()}\n\n${memLines.join("\n") || "_No entries yet._"}\n`;
  await fs.writeFile(path.join(dir, "MEMORY.md"), mdBody, "utf8");

  const docs: MemorySearchDoc[] = [
    ...memories.map((m) => ({
      id: `mem:${m.id}`,
      kind: "memory" as const,
      title: m.title,
      content: m.content,
      tags: [m.category, m.pinned ? "pinned" : ""],
    })),
    ...notes.map((n) => ({
      id: `note:${n.id}`,
      kind: "note" as const,
      title: n.title,
      content: n.body,
      tags: n.tags || [],
    })),
    ...vaultFiles.map((f) => ({
      id: `file:${f.id}`,
      kind: "file" as const,
      title: f.name,
      content: f.textPreview || f.name,
      tags: f.tags || [f.category],
    })),
  ];
  return syncMemoryIndex(safeProfileId(profileId), docs);
}

/** Deterministic trigram embedding (128-dim) for zero-API hybrid & holographic retrieval. */
function trigramVector(text: string, dims = 128): Float32Array {
  const vec = new Float32Array(dims);
  const norm = text.toLowerCase().replace(/\s+/g, " ").trim();
  for (let i = 0; i < Math.max(0, norm.length - 2); i += 1) {
    const tri = norm.slice(i, i + 3);
    let h = 2166136261;
    for (let j = 0; j < tri.length; j += 1) {
      h ^= tri.charCodeAt(j);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % dims;
    const sign = (h & 1) === 0 ? 1 : -1;
    vec[idx] += sign;
  }
  let mag = 0;
  for (let i = 0; i < dims; i += 1) mag += vec[i] * vec[i];
  const inv = mag > 0 ? 1 / Math.sqrt(mag) : 1;
  for (let i = 0; i < dims; i += 1) vec[i] *= inv;
  return vec;
}

function cosineSim(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];
  return dot;
}

/** Holographic Reduced Representation circular correlation similarity */
function hrrResonance(a: Float32Array, b: Float32Array): number {
  const n = a.length;
  let peak = 0;
  for (let shift = -2; shift <= 2; shift += 1) {
    let acc = 0;
    for (let i = 0; i < n; i += 1) {
      acc += a[i] * b[(i + shift + n) % n];
    }
    if (acc > peak) peak = acc;
  }
  return peak;
}

export function retrieveMemoryContext(
  profileId: string,
  query: string,
  backend: RetrievalBackend,
  docs: Array<{ id: string; title: string; content: string; kind: string }>,
  limit = 5,
): Array<{ id: string; title: string; content: string; kind: string; score: number }> {
  const safeId = safeProfileId(profileId);
  const ftsHits = searchMemorySqlite(safeId, query, limit * 2);

  if (backend === "sqlite_markdown" && ftsHits.length > 0) {
    return ftsHits.slice(0, limit).map((h) => ({
      id: h.id,
      title: h.title,
      content: h.content,
      kind: h.kind,
      score: Math.abs(h.rank) + 1,
    }));
  }

  const qVec = trigramVector(query);
  const poolMap = new Map<string, { id: string; title: string; content: string; kind: string; bm25: number }>();
  for (const h of ftsHits) {
    poolMap.set(h.id, { id: h.id, title: h.title, content: h.content, kind: h.kind, bm25: 1 / (1 + Math.abs(h.rank)) });
  }
  for (const d of docs.slice(0, 60)) {
    if (!poolMap.has(d.id)) {
      poolMap.set(d.id, { ...d, bm25: 0 });
    }
  }

  const scored = Array.from(poolMap.values()).map((item) => {
    const dVec = trigramVector(`${item.title} ${item.content.slice(0, 400)}`);
    const sim = backend === "holographic_hrr" ? hrrResonance(qVec, dVec) : cosineSim(qVec, dVec);
    return {
      id: item.id,
      title: item.title,
      content: item.content,
      kind: item.kind,
      score: Number((sim * 0.7 + item.bm25 * 0.3).toFixed(3)),
    };
  });

  return scored
    .filter((s) => s.score > 0.08)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function compressContextWindow(
  history: Array<{ role: string; content: string }>,
  maxBytes = 28_000,
): Array<{ role: string; content: string }> {
  const clean = history.filter((m) => m.content && (m.role === "user" || m.role === "assistant"));
  let total = 0;
  const keptReversed: Array<{ role: string; content: string }> = [];
  for (let i = clean.length - 1; i >= 0; i -= 1) {
    const msg = clean[i];
    const clipped = msg.content.length > 6000 ? `${msg.content.slice(0, 5600)}\n...[compressed]` : msg.content;
    const size = Buffer.byteLength(clipped, "utf8");
    if (total + size > maxBytes && keptReversed.length >= 2) break;
    keptReversed.push({ role: msg.role, content: clipped });
    total += size;
  }
  return keptReversed.reverse();
}

export function createSnapshotId(): string {
  return `chk-${Date.now().toString(36)}-${crypto.randomBytes(2).toString("hex")}`;
}
