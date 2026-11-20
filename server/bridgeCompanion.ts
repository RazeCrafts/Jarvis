import crypto from "node:crypto";
import type { WebSocket } from "ws";

export interface BridgeClient {
  id: string;
  machineName: string;
  platform: string;
  connectedAt: number;
  capabilities: string[];
  ws: WebSocket;
}

let pairingToken = crypto.randomBytes(12).toString("hex");
let activeBridge: BridgeClient | null = null;
const pendingCommands = new Map<
  string,
  { resolve: (val: Record<string, unknown>) => void; timer: NodeJS.Timeout }
>();

export function getBridgeStatus() {
  return {
    connected: Boolean(activeBridge && activeBridge.ws.readyState === 1),
    machineName: activeBridge?.machineName || null,
    platform: activeBridge?.platform || null,
    connectedAt: activeBridge?.connectedAt || null,
    capabilities: activeBridge?.capabilities || [],
    pairingToken,
  };
}

export function rotatePairingToken(): string {
  pairingToken = crypto.randomBytes(12).toString("hex");
  return pairingToken;
}

export function validatePairingToken(token: string): boolean {
  return Boolean(token && token === pairingToken);
}

export function registerBridgeSocket(
  ws: WebSocket,
  meta: { machineName?: string; platform?: string; capabilities?: string[] },
): void {
  if (activeBridge && activeBridge.ws !== ws) {
    try {
      activeBridge.ws.close();
    } catch {
      /* ignore */
    }
  }
  activeBridge = {
    id: crypto.randomUUID().slice(0, 8),
    machineName: meta.machineName || "Personal Workstation",
    platform: meta.platform || "desktop",
    connectedAt: Date.now(),
    capabilities: Array.isArray(meta.capabilities)
      ? meta.capabilities
      : ["apps", "windows", "vision", "claude_cli", "blender_exec"],
    ws,
  };

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(String(raw)) as { requestId?: string; result?: Record<string, unknown> };
      if (msg.requestId && pendingCommands.has(msg.requestId)) {
        const pending = pendingCommands.get(msg.requestId)!;
        clearTimeout(pending.timer);
        pendingCommands.delete(msg.requestId);
        pending.resolve(msg.result || { ok: true });
      }
    } catch {
      /* ignore malformed frame */
    }
  });

  ws.on("close", () => {
    if (activeBridge?.ws === ws) activeBridge = null;
  });
}

export async function dispatchBridgeCommand(
  command: string,
  payload: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  if (!activeBridge || activeBridge.ws.readyState !== 1) {
    return {
      ok: false,
      error: "Desktop Bridge is not paired. Download and run the companion script in Models & Bridge to enable OS control, Blender rendering, and local CLI plugins.",
    };
  }
  const requestId = crypto.randomUUID().slice(0, 10);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingCommands.delete(requestId);
      resolve({ ok: false, error: "Desktop Bridge timed out responding to command." });
    }, 15000);
    pendingCommands.set(requestId, { resolve, timer });
    activeBridge!.ws.send(JSON.stringify({ type: "command", requestId, command, payload }));
  });
}

export function generateBridgeCompanionScript(origin: string): string {
  const wsUrl = `${origin.replace(/^http/, "ws")}/ws/bridge?token=${pairingToken}`;
  return `#!/usr/bin/env node
// JARVIS Optional Desktop Bridge Companion
// Connects your local computer (app launcher, Blender creative bridge, local claude CLI) to JARVIS.
// Usage: npm install ws && node jarvis-bridge.mjs

import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { exec } from "node:child_process";
import WebSocket from "ws";

const WS_URL = process.env.JARVIS_BRIDGE_URL || ${JSON.stringify(wsUrl)};
const ws = new WebSocket(WS_URL);

ws.on("open", () => {
  console.log("[JARVIS Bridge] Connected to", WS_URL);
  ws.send(JSON.stringify({
    type: "hello",
    machineName: os.hostname(),
    platform: os.platform(),
    capabilities: ["apps", "windows", "vision", "claude_cli", "blender_exec"],
  }));
});

ws.on("message", async (raw) => {
  const msg = JSON.parse(String(raw));
  if (msg.type !== "command") return;
  const reply = (result) => ws.send(JSON.stringify({ requestId: msg.requestId, result }));

  if (msg.command === "launch_app") {
    const app = String(msg.payload?.name || "").replace(/[^a-zA-Z0-9 ._-]/g, "");
    const cmd = os.platform() === "win32" ? \`start "" "\${app}"\` : os.platform() === "darwin" ? \`open -a "\${app}"\` : \`\${app} &\`;
    exec(cmd, (err) => reply(err ? { ok: false, error: err.message } : { ok: true, app }));
    return;
  }

  if (msg.command === "claude_cli") {
    const prompt = String(msg.payload?.prompt || "");
    exec(\`claude -p \${JSON.stringify(prompt)}\`, { timeout: 60000 }, (err, stdout, stderr) => {
      reply(err ? { ok: false, error: stderr || err.message } : { ok: true, output: stdout });
    });
    return;
  }

  if (msg.command === "blender_exec") {
    const script = String(msg.payload?.script || "import bpy\\nprint('Blender Bridge ready')");
    const tmpScript = path.join(os.tmpdir(), "jarvis_blender_bridge.py");
    await fs.writeFile(tmpScript, script, "utf8");
    exec(\`blender --background --python \${JSON.stringify(tmpScript)}\`, { timeout: 60000 }, (err, stdout, stderr) => {
      reply(err ? { ok: false, error: stderr || err.message } : { ok: true, output: stdout || "Blender scene script executed." });
    });
    return;
  }

  if (msg.command === "mcp_artcraft_call") {
    const appCli = String(msg.payload?.cli || "designcraft-cli").replace(/[^a-z0-9-]/gi, "");
    const connectAddr = String(msg.payload?.connect || "127.0.0.1:4311").replace(/[^a-zA-Z0-9.:_-]/g, "");
    const instruction = String(msg.payload?.instruction || "");
    const rpcPayload = JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name: "edit_document", arguments: { instruction } },
    });
    const url = connectAddr.startsWith("http") ? connectAddr : \`http://\${connectAddr}/mcp\`;
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: rpcPayload,
        signal: AbortSignal.timeout(12000),
      });
      if (r.ok) {
        const text = await r.text();
        reply({ ok: true, output: text.slice(0, 1500) });
        return;
      }
    } catch {
      /* fallback to stdio CLI invocation */
    }
    exec(\`\${appCli} mcp --connect \${connectAddr}\`, { timeout: 30000 }, (err, stdout, stderr) => {
      reply(err ? { ok: false, error: stderr || err.message } : { ok: true, output: stdout || \`Executed via \${appCli} MCP.\` });
    });
    return;
  }

  reply({ ok: false, error: "Unsupported bridge command: " + msg.command });
});

ws.on("close", () => console.log("[JARVIS Bridge] Disconnected."));
`;
}
