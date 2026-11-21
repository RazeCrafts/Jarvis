import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const DATA_DIR = path.resolve(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "jarvis-memory.sqlite");

let dbInstance: DatabaseSync | null = null;

function getDb(): DatabaseSync {
  if (dbInstance) return dbInstance;
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const db = new DatabaseSync(DB_PATH);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      id UNINDEXED,
      profile_id UNINDEXED,
      kind UNINDEXED,
      title,
      content,
      tags,
      tokenize='porter unicode61'
    );
    CREATE TABLE IF NOT EXISTS session_checkpoints (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      label TEXT NOT NULL,
      paused_prompt TEXT NOT NULL,
      paused_plan TEXT NOT NULL,
      context_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'paused',
      created_at INTEGER NOT NULL
    );
  `);
  dbInstance = db;
  return db;
}

export interface MemorySearchDoc {
  id: string;
  kind: "memory" | "note" | "file" | "turn";
  title: string;
  content: string;
  tags?: string[];
}

export function syncMemoryIndex(profileId: string, docs: MemorySearchDoc[]): number {
  const db = getDb();
  const del = db.prepare("DELETE FROM memory_fts WHERE profile_id = ?");
  del.run(profileId);
  const ins = db.prepare(
    "INSERT INTO memory_fts (id, profile_id, kind, title, content, tags) VALUES (?, ?, ?, ?, ?, ?)",
  );
  for (const doc of docs) {
    ins.run(
      doc.id,
      profileId,
      doc.kind,
      doc.title.slice(0, 240),
      doc.content.slice(0, 12_000),
      (doc.tags || []).join(" "),
    );
  }
  return docs.length;
}

export interface SqliteMemoryHit {
  id: string;
  kind: string;
  title: string;
  content: string;
  tags: string;
  rank: number;
}

export function searchMemorySqlite(profileId: string, query: string, limit = 8): SqliteMemoryHit[] {
  const db = getDb();
  const tokens = (query || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .slice(0, 8);
  if (tokens.length === 0) return [];
  const ftsQuery = tokens.map((t) => `"${t}"*`).join(" OR ");
  try {
    const stmt = db.prepare(`
      SELECT id, kind, title, content, tags, bm25(memory_fts) AS rank
      FROM memory_fts
      WHERE profile_id = ? AND memory_fts MATCH ?
      ORDER BY rank ASC
      LIMIT ?
    `);
    return stmt.all(profileId, ftsQuery, Math.max(1, Math.min(25, limit))) as unknown as SqliteMemoryHit[];
  } catch {
    return [];
  }
}

export interface SessionCheckpoint {
  id: string;
  profileId: string;
  sessionId: string;
  label: string;
  pausedPrompt: string;
  pausedPlan: string;
  contextJson: string;
  status: "paused" | "resumed";
  createdAt: number;
}

export function saveSessionCheckpoint(input: {
  id: string;
  profileId: string;
  sessionId: string;
  label: string;
  pausedPrompt: string;
  pausedPlan?: string;
  context?: Record<string, unknown>;
}): SessionCheckpoint {
  const db = getDb();
  const createdAt = Date.now();
  const contextJson = JSON.stringify(input.context || {});
  const pausedPlan = input.pausedPlan || "";
  db.prepare(
    `INSERT OR REPLACE INTO session_checkpoints
     (id, profile_id, session_id, label, paused_prompt, paused_plan, context_json, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'paused', ?)`,
  ).run(
    input.id,
    input.profileId,
    input.sessionId,
    input.label.slice(0, 140),
    input.pausedPrompt.slice(0, 4000),
    pausedPlan.slice(0, 4000),
    contextJson,
    createdAt,
  );
  return {
    id: input.id,
    profileId: input.profileId,
    sessionId: input.sessionId,
    label: input.label,
    pausedPrompt: input.pausedPrompt,
    pausedPlan,
    contextJson,
    status: "paused",
    createdAt,
  };
}

export function getActivePausedCheckpoint(profileId: string, sessionId = "default"): SessionCheckpoint | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, profile_id as profileId, session_id as sessionId, label, paused_prompt as pausedPrompt,
              paused_plan as pausedPlan, context_json as contextJson, status, created_at as createdAt
       FROM session_checkpoints
       WHERE profile_id = ? AND session_id = ? AND status = 'paused'
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(profileId, sessionId) as unknown as SessionCheckpoint | undefined;
  return row || null;
}

export function markCheckpointResumed(id: string): void {
  const db = getDb();
  db.prepare("UPDATE session_checkpoints SET status = 'resumed' WHERE id = ?").run(id);
}
