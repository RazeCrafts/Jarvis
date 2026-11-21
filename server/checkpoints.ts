import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export interface WorkspaceCheckpointEntry {
  id: string;
  label: string;
  createdAt: number;
  files: string[];
}

const CHECKPOINTS_ROOT = path.resolve(process.cwd(), "data", "checkpoints");
const WORKSPACE_ROOT = path.resolve(process.cwd());

function resolveWorkspaceFile(relPath: string): string {
  const cleaned = relPath.replace(/^[/\\]+/, "");
  const resolved = path.resolve(WORKSPACE_ROOT, cleaned);
  if (resolved !== WORKSPACE_ROOT && !resolved.startsWith(WORKSPACE_ROOT + path.sep)) {
    throw new Error(`Path escapes workspace root: ${relPath}`);
  }
  return resolved;
}

export async function createWorkspaceCheckpoint(
  label: string,
  relPaths: string[],
): Promise<WorkspaceCheckpointEntry> {
  const id = `cp-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const cpDir = path.join(CHECKPOINTS_ROOT, id);
  await fs.mkdir(cpDir, { recursive: true });

  const backedUp: Array<{ relPath: string; existed: boolean }> = [];
  for (const rawRel of relPaths.slice(0, 40)) {
    const abs = resolveWorkspaceFile(rawRel);
    const rel = path.relative(WORKSPACE_ROOT, abs);
    const dest = path.join(cpDir, "files", rel);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    try {
      const buf = await fs.readFile(abs);
      await fs.writeFile(dest, buf);
      backedUp.push({ relPath: rel, existed: true });
    } catch {
      backedUp.push({ relPath: rel, existed: false });
    }
  }

  const meta = {
    id,
    label,
    createdAt: Date.now(),
    entries: backedUp,
  };
  await fs.writeFile(path.join(cpDir, "manifest.json"), JSON.stringify(meta, null, 2), "utf8");

  return {
    id,
    label,
    createdAt: meta.createdAt,
    files: backedUp.map((b) => b.relPath),
  };
}

export async function listWorkspaceCheckpoints(limit = 20): Promise<WorkspaceCheckpointEntry[]> {
  try {
    const dirs = await fs.readdir(CHECKPOINTS_ROOT);
    const out: WorkspaceCheckpointEntry[] = [];
    for (const d of dirs.sort().reverse().slice(0, limit)) {
      try {
        const raw = await fs.readFile(path.join(CHECKPOINTS_ROOT, d, "manifest.json"), "utf8");
        const parsed = JSON.parse(raw) as {
          id: string;
          label: string;
          createdAt: number;
          entries: Array<{ relPath: string }>;
        };
        out.push({
          id: parsed.id,
          label: parsed.label,
          createdAt: parsed.createdAt,
          files: (parsed.entries || []).map((e) => e.relPath),
        });
      } catch {
        /* ignore malformed entry */
      }
    }
    return out;
  } catch {
    return [];
  }
}

export async function rollbackWorkspaceCheckpoint(checkpointId?: string): Promise<{
  ok: boolean;
  checkpointId?: string;
  restored: string[];
  removed: string[];
  error?: string;
}> {
  const list = await listWorkspaceCheckpoints(20);
  const targetId = checkpointId || list[0]?.id;
  if (!targetId) {
    return { ok: false, restored: [], removed: [], error: "No workspace checkpoints available to roll back." };
  }
  const cpDir = path.resolve(CHECKPOINTS_ROOT, targetId);
  if (!cpDir.startsWith(CHECKPOINTS_ROOT + path.sep)) {
    return { ok: false, restored: [], removed: [], error: "Invalid checkpoint ID." };
  }

  try {
    const raw = await fs.readFile(path.join(cpDir, "manifest.json"), "utf8");
    const manifest = JSON.parse(raw) as {
      id: string;
      entries: Array<{ relPath: string; existed: boolean }>;
    };
    const restored: string[] = [];
    const removed: string[] = [];

    for (const entry of manifest.entries) {
      const absTarget = resolveWorkspaceFile(entry.relPath);
      if (entry.existed) {
        const srcBackup = path.join(cpDir, "files", entry.relPath);
        const buf = await fs.readFile(srcBackup);
        await fs.mkdir(path.dirname(absTarget), { recursive: true });
        await fs.writeFile(absTarget, buf);
        restored.push(entry.relPath);
      } else {
        await fs.unlink(absTarget).catch(() => undefined);
        removed.push(entry.relPath);
      }
    }
    return { ok: true, checkpointId: manifest.id, restored, removed };
  } catch (err) {
    return {
      ok: false,
      restored: [],
      removed: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
