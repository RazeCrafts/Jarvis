import { useEffect, useState } from "react";
import {
  Box,
  CheckCircle2,
  Cpu,
  Download,
  KeyRound,
  Laptop,
  MessageSquare,
  Play,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Terminal,
  Trash2,
} from "lucide-react";
import {
  agentApi,
  type AccountConnectorItem,
  type AgentSettings,
  type AuditEntry,
  type BridgeStatusInfo,
  type GatewayMessageItem,
  type GatewayStatus,
  type ProviderInfo,
  type StartMenuApp,
} from "@/lib/agentApi";
import { cn } from "@/lib/cn";

type SubTab = "builtin" | "accounts" | "keys" | "messaging" | "bridge";

export default function ProvidersBridgePage() {
  const [tab, setTab] = useState<SubTab>("builtin");
  const [settings, setSettings] = useState<AgentSettings | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [connectors, setConnectors] = useState<AccountConnectorItem[]>([]);
  const [bridge, setBridge] = useState<BridgeStatusInfo | null>(null);
  const [apps, setApps] = useState<StartMenuApp[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [gateway, setGateway] = useState<GatewayStatus | null>(null);
  const [gatewayFeed, setGatewayFeed] = useState<GatewayMessageItem[]>([]);

  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [accountDrafts, setAccountDrafts] = useState<Record<string, string>>({});
  const [gatewayDrafts, setGatewayDrafts] = useState<Record<string, string>>({});
  const [simPlatform, setSimPlatform] = useState<"telegram" | "discord" | "slack" | "whatsapp">("telegram");
  const [simText, setSimText] = useState("");
  const [sendingRemote, setSendingRemote] = useState(false);
  const [blenderScript, setBlenderScript] = useState(
    "import bpy\nbpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=1.2)\nprint('JARVIS Blender mesh created')",
  );
  const [craftApp, setCraftApp] = useState<"designcraft" | "photocraft" | "vectorcraft" | "lightcraft">("designcraft");
  const [craftPrompt, setCraftPrompt] = useState("");

  const [customName, setCustomName] = useState("");
  const [customUrl, setCustomUrl] = useState("");
  const [customKeyEnv, setCustomKeyEnv] = useState("");
  const [statusMsg, setStatusMsg] = useState("");

  const loadAll = async () => {
    try {
      const [sRes, pRes, aRes, bRes, appRes, audRes, gwRes, feedRes] = await Promise.all([
        agentApi.getSettings(),
        agentApi.getProviders(),
        agentApi.getAccountConnectors(),
        agentApi.getBridgeStatus(),
        agentApi.getApps(),
        agentApi.getAudit(25),
        agentApi.getGateway(),
        agentApi.getGatewayFeed(),
      ]);
      setSettings(sRes);
      setProviders(pRes.providers);
      setConnectors(aRes.connectors);
      setBridge(bRes);
      setApps(appRes.apps);
      setAudit(audRes.entries);
      setGateway(gwRes);
      setGatewayFeed(feedRes.messages);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  const activateProvider = async (slug: string) => {
    await agentApi.saveSettings({ provider: slug });
    setStatusMsg(`Active intelligence provider switched to ${slug}.`);
    await loadAll();
  };

  const saveKey = async (slug: string, envVar: string) => {
    const val = (keyDrafts[slug] || "").trim();
    if (!val) return;
    await agentApi.saveProviderKey(slug, val, envVar);
    setKeyDrafts((d) => ({ ...d, [slug]: "" }));
    setStatusMsg(`Saved credential for ${slug}.`);
    await loadAll();
  };

  const connectAccount = async (c: AccountConnectorItem) => {
    const token = (accountDrafts[c.id] || "").trim();
    try {
      const res = await agentApi.connectAccountConnector(c.id, {
        token: token || undefined,
        accountLabel: token ? "Connected Session" : "Paired via Desktop Bridge",
      });
      setStatusMsg(
        res.ok
          ? `${c.name} connected.`
          : res.message || `Could not connect ${c.name}.`,
      );
      setAccountDrafts((d) => ({ ...d, [c.id]: "" }));
      await loadAll();
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : "Connection failed");
    }
  };

  const addCustomEndpoint = async () => {
    if (!customName.trim() || !customUrl.trim()) return;
    await agentApi.addCustomProvider(customName.trim(), customUrl.trim(), customKeyEnv.trim() || undefined);
    setStatusMsg(`Added custom endpoint "${customName.trim()}".`);
    setCustomName("");
    setCustomUrl("");
    setCustomKeyEnv("");
    await loadAll();
  };

  const saveGatewayPlatform = async (id: string) => {
    const tok = (gatewayDrafts[id] || "").trim();
    if (!tok) return;
    await agentApi.setGatewayPlatform(id, tok);
    setGatewayDrafts((d) => ({ ...d, [id]: "" }));
    setStatusMsg(`Configured ${id} remote messaging webhook token.`);
    await loadAll();
  };

  const sendRemoteTest = async () => {
    if (!simText.trim() || sendingRemote) return;
    setSendingRemote(true);
    try {
      const res = await agentApi.sendGatewayInbound({
        platform: simPlatform,
        sender: "Mobile Owner",
        text: simText.trim(),
      });
      setGatewayFeed(res.feed);
      setSimText("");
      setStatusMsg(`Processed remote ${simPlatform} command.`);
    } finally {
      setSendingRemote(false);
    }
  };

  const toggleKillSwitch = async () => {
    if (!settings) return;
    await agentApi.setKillSwitch(!settings.killSwitch.engaged);
    await loadAll();
  };

  const keyProviders = providers.filter((p) => p.tab === "keys");
  const customEntries = Object.entries(settings?.customProviders || {});

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
        <div>
          <h1 className="font-display text-base font-semibold text-fg">Models, Messaging & Desktop Bridge</h1>
          <p className="text-xs text-fg-muted">
            Built-in Core · Account Connectors · OpenAI-Compatible Providers · Telegram/Discord/Slack/WhatsApp · Local PC & Blender Bridge
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1 rounded-xl border border-border bg-elevated p-1">
          {([
            ["builtin", "Built-In Core"],
            ["accounts", "Account Connectors"],
            ["keys", "All Providers"],
            ["messaging", "Messaging & Remote"],
            ["bridge", "Desktop Bridge & Safety"],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                "rounded-lg px-3 py-1 text-xs font-medium transition-colors",
                tab === id ? "bg-accent text-background" : "text-fg-muted hover:text-fg",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {statusMsg && (
        <div className="border-b border-border bg-elevated px-5 py-2 text-xs text-accent">
          {statusMsg}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {tab === "builtin" && (
          <div className="mx-auto max-w-3xl space-y-4">
            <div className="hud-panel space-y-3 p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-elevated text-accent">
                    <Cpu size={20} />
                  </span>
                  <div>
                    <h2 className="font-display text-sm font-semibold text-fg">
                      JARVIS Built-In Intelligence
                    </h2>
                    <p className="text-xs text-fg-muted">
                      Server-side multimodal engine with live web search, visual diagrams, duplex voice, and screen vision.
                    </p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-500">
                  <CheckCircle2 size={14} />
                  {settings?.hasGeminiBuiltin ? "Active & Managed" : "Awaiting Server Environment"}
                </span>
              </div>

              <div className="grid grid-cols-1 gap-3 pt-2 sm:grid-cols-3">
                <div className="hud-elevated p-3">
                  <p className="text-[11px] text-fg-muted">Primary Model</p>
                  <p className="mt-1 font-mono text-xs text-fg">{settings?.models.default || "gemini-4-hydrogen"}</p>
                </div>
                <div className="hud-elevated p-3">
                  <p className="text-[11px] text-fg-muted">Fast Tier</p>
                  <p className="mt-1 font-mono text-xs text-fg">{settings?.models.fast || "gemini-3.1-flash-lite"}</p>
                </div>
                <div className="hud-elevated p-3">
                  <p className="text-[11px] text-fg-muted">Active Route</p>
                  <p className="mt-1 font-mono text-xs text-accent">{settings?.provider || "gemini-builtin"}</p>
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => void activateProvider("gemini-builtin")}
                  className="rounded-lg bg-accent px-4 py-2 text-xs font-medium text-background"
                >
                  Use Built-In Core
                </button>
                <button
                  type="button"
                  onClick={() => void agentApi.testConnection().then((r) => setStatusMsg(r.message))}
                  className="rounded-lg border border-border bg-elevated px-4 py-2 text-xs font-medium text-fg hover:border-accent"
                >
                  Run Connection Check
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === "accounts" && (
          <div className="mx-auto max-w-4xl space-y-3">
            <p className="text-xs text-fg-muted">
              Connect subscriptions and OAuth gateways without raw developer API keys, inspired by official open-source plugin connectors.
            </p>
            {connectors.map((c) => (
              <div key={c.id} className="hud-panel space-y-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-fg">{c.name}</h3>
                    <p className="text-xs text-fg-muted">{c.notes}</p>
                  </div>
                  <span
                    className={cn(
                      "text-xs font-medium",
                      c.connected ? "text-emerald-500" : "text-fg-muted",
                    )}
                  >
                    {c.connected ? `Connected (${c.accountLabel})` : "Not connected"}
                  </span>
                </div>

                <div className="flex flex-wrap gap-2">
                  {c.authMode !== "local_cli_bridge" ? (
                    <input
                      type="password"
                      value={accountDrafts[c.id] || ""}
                      onChange={(e) => setAccountDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
                      placeholder="Paste OAuth session / portal access token..."
                      className="min-w-56 flex-1 rounded-lg border border-border bg-elevated px-3 py-1.5 text-xs text-fg outline-none focus:border-accent"
                    />
                  ) : (
                    <span className="flex flex-1 items-center gap-1.5 text-xs text-fg-muted">
                      <Terminal size={13} className="text-accent" />
                      {bridge?.connected
                        ? `Desktop Bridge paired (${bridge.machineName}) — ready to pair Claude CLI.`
                        : "Pair the Desktop Bridge tab first to route via your local Claude subscription CLI."}
                    </span>
                  )}

                  {c.connected ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void activateProvider(c.providerSlug)}
                        className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-background"
                      >
                        Set Active
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void agentApi.disconnectAccountConnector(c.id).then(loadAll)
                        }
                        className="rounded-lg border border-border px-3 py-1.5 text-xs text-fg-muted hover:text-fg"
                      >
                        Disconnect
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void connectAccount(c)}
                      className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-background"
                    >
                      Connect Account
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === "keys" && (
          <div className="mx-auto max-w-5xl space-y-5">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {keyProviders.map((p) => {
                const envVar = p.envVars[0];
                const isActive = settings?.provider === p.slug;
                return (
                  <div key={p.slug} className="hud-panel space-y-2.5 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-fg">
                          <KeyRound size={14} className="text-accent" /> {p.label}
                        </h3>
                        <p className="mt-0.5 text-xs text-fg-muted">{p.description}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void activateProvider(p.slug)}
                        className={cn(
                          "rounded-lg px-2.5 py-1 text-xs font-medium",
                          isActive
                            ? "bg-accent text-background"
                            : "border border-border bg-elevated text-fg",
                        )}
                      >
                        {isActive ? "Active" : "Use"}
                      </button>
                    </div>
                    {envVar && (
                      <div className="flex gap-2">
                        <input
                          type="password"
                          value={keyDrafts[p.slug] || ""}
                          onChange={(e) => setKeyDrafts((d) => ({ ...d, [p.slug]: e.target.value }))}
                          placeholder={p.configured ? `Saved (${p.keys[envVar]?.masked})` : `Enter ${p.label} API key`}
                          className="min-w-0 flex-1 rounded-lg border border-border bg-elevated px-2.5 py-1.5 text-xs text-fg outline-none focus:border-accent"
                        />
                        <button
                          type="button"
                          onClick={() => void saveKey(p.slug, envVar)}
                          className="rounded-lg border border-border bg-elevated px-3 py-1.5 text-xs font-medium text-fg hover:border-accent"
                        >
                          Save
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="hud-panel space-y-3 p-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
                Custom Local / OpenAI-Compatible Endpoints (Ollama, LM Studio, vLLM)
              </h2>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                <input
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder="Name (e.g. local-ollama)"
                  className="rounded-lg border border-border bg-elevated px-3 py-1.5 text-xs text-fg outline-none focus:border-accent"
                />
                <input
                  value={customUrl}
                  onChange={(e) => setCustomUrl(e.target.value)}
                  placeholder="http://localhost:11434/v1"
                  className="rounded-lg border border-border bg-elevated px-3 py-1.5 text-xs text-fg outline-none focus:border-accent sm:col-span-2"
                />
                <button
                  type="button"
                  onClick={() => void addCustomEndpoint()}
                  className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-background"
                >
                  Add Endpoint
                </button>
              </div>
              {customEntries.map(([name, cfg]) => (
                <div key={name} className="hud-elevated flex items-center justify-between px-3 py-2 text-xs">
                  <span>
                    <strong className="text-fg">{name}</strong>{" "}
                    <span className="font-mono text-fg-muted">{cfg.api}</span>
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void activateProvider(`custom:${name}`)}
                      className="text-accent hover:underline"
                    >
                      Use
                    </button>
                    <button
                      type="button"
                      onClick={() => void agentApi.removeCustomProvider(name).then(loadAll)}
                      className="text-fg-muted hover:text-red-500"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "messaging" && (
          <div className="mx-auto grid max-w-5xl grid-cols-1 gap-4 lg:grid-cols-12">
            <div className="hud-panel space-y-3 p-4 lg:col-span-6">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-1.5 text-sm font-semibold text-fg">
                  <MessageSquare size={15} className="text-accent" /> Multi-Platform Messaging Bridges
                </h2>
                <button
                  type="button"
                  onClick={() =>
                    void (gateway?.running ? agentApi.stopGateway() : agentApi.startGateway()).then(loadAll)
                  }
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-xs font-medium",
                    gateway?.running ? "bg-emerald-500 text-black" : "bg-accent text-background",
                  )}
                >
                  {gateway?.running ? "Gateway Online" : "Start Gateway"}
                </button>
              </div>
              <p className="text-xs text-fg-muted">
                Pair Telegram, Discord, Slack, or WhatsApp webhooks so you can message JARVIS remotely from any device.
              </p>

              <div className="space-y-2.5">
                {(gateway?.platforms || []).map((plat) => (
                  <div key={plat.id} className="hud-elevated space-y-2 p-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-fg">{plat.label}</span>
                      <span className={plat.configured ? "text-emerald-400" : "text-fg-muted"}>
                        {plat.configured ? `Paired (${plat.masked})` : "Not paired"}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="password"
                        value={gatewayDrafts[plat.id] || ""}
                        onChange={(e) => setGatewayDrafts((d) => ({ ...d, [plat.id]: e.target.value }))}
                        placeholder={`Enter ${plat.envVar}`}
                        className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 py-1 text-xs text-fg outline-none focus:border-accent"
                      />
                      <button
                        type="button"
                        onClick={() => void saveGatewayPlatform(plat.id)}
                        className="rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-medium text-fg hover:border-accent"
                      >
                        Save
                      </button>
                      {plat.configured && (
                        <button
                          type="button"
                          onClick={() => void agentApi.removeGatewayPlatform(plat.id).then(loadAll)}
                          className="text-fg-muted hover:text-red-500"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="hud-panel flex flex-col gap-3 p-4 lg:col-span-6">
              <h2 className="text-sm font-semibold text-fg">Remote Command Feed & Webhook Tester</h2>
              <div className="flex gap-2">
                <select
                  value={simPlatform}
                  onChange={(e) => setSimPlatform(e.target.value as typeof simPlatform)}
                  className="rounded-lg border border-border bg-elevated px-2.5 py-1.5 text-xs text-fg outline-none"
                >
                  <option value="telegram">Telegram</option>
                  <option value="discord">Discord</option>
                  <option value="slack">Slack</option>
                  <option value="whatsapp">WhatsApp</option>
                </select>
                <input
                  value={simText}
                  onChange={(e) => setSimText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void sendRemoteTest();
                  }}
                  placeholder="Send remote command (e.g. Check schedule)..."
                  className="min-w-0 flex-1 rounded-lg border border-border bg-elevated px-3 py-1.5 text-xs text-fg outline-none focus:border-accent"
                />
                <button
                  type="button"
                  disabled={sendingRemote || !simText.trim()}
                  onClick={() => void sendRemoteTest()}
                  className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-background disabled:opacity-40"
                >
                  <Send size={12} /> Send
                </button>
              </div>

              <div className="max-h-72 flex-1 space-y-2 overflow-y-auto">
                {gatewayFeed.length === 0 ? (
                  <p className="text-xs text-fg-muted">
                    No remote messaging traffic yet. Send a test command above or POST to{" "}
                    <code className="font-mono text-accent">/api/gateway/inbound</code>.
                  </p>
                ) : (
                  gatewayFeed.map((msg) => (
                    <div key={msg.id} className="hud-elevated px-3 py-2 text-xs">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="font-mono uppercase text-accent">
                          {msg.platform} · {msg.direction === "inbound" ? msg.sender : "JARVIS"}
                        </span>
                        <span className="text-fg-muted">
                          {new Date(msg.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      <p className="mt-1 text-fg">{msg.text}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {tab === "bridge" && (
          <div className="mx-auto grid max-w-5xl grid-cols-1 gap-4 lg:grid-cols-12">
            <div className="hud-panel space-y-3 p-4 lg:col-span-6">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-1.5 text-sm font-semibold text-fg">
                  <Laptop size={15} className="text-accent" /> Optional Desktop Bridge
                </h2>
                <span className={cn("text-xs font-medium", bridge?.connected ? "text-emerald-500" : "text-fg-muted")}>
                  {bridge?.connected ? `Paired (${bridge.machineName})` : "Standby"}
                </span>
              </div>
              <p className="text-xs leading-relaxed text-fg-muted">
                Pair your Windows, macOS, or Linux machine to launch native apps, run Blender Python creative scripts, and route Claude Subscription DirectSDK via your local CLI.
              </p>
              <div className="hud-elevated space-y-1 p-3 font-mono text-[11px]">
                <p className="text-fg-muted">Pairing Token</p>
                <p className="break-all text-accent">{bridge?.pairingToken || "—"}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <a
                  href={agentApi.bridgeCompanionDownloadUrl()}
                  download="jarvis-bridge.mjs"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-background"
                >
                  <Download size={13} /> Download jarvis-bridge.mjs
                </a>
                <button
                  type="button"
                  onClick={() => void agentApi.rotateBridgeToken().then(loadAll)}
                  className="flex items-center gap-1 rounded-lg border border-border bg-elevated px-3 py-1.5 text-xs text-fg hover:border-accent"
                >
                  <RefreshCw size={12} /> Rotate Token
                </button>
              </div>

              <div className="border-t border-border pt-3">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">
                  Desktop App Launcher
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {apps.map((app) => (
                    <button
                      key={app.appId}
                      type="button"
                      onClick={() =>
                        void agentApi
                          .launchApp(app.name)
                          .then((r) => setStatusMsg(r.ok ? `Launched ${app.name}` : r.error || "Requires Desktop Bridge"))
                      }
                      className="flex items-center gap-1 rounded-lg border border-border bg-elevated px-2.5 py-1 text-xs text-fg hover:border-accent"
                    >
                      <Play size={10} /> {app.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2 border-t border-border pt-3">
                <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-fg-muted">
                  <Box size={12} className="text-accent" /> Blender Creative Bridge Hook
                </h3>
                <textarea
                  rows={3}
                  value={blenderScript}
                  onChange={(e) => setBlenderScript(e.target.value)}
                  className="w-full rounded-lg border border-border bg-elevated p-2 font-mono text-[11px] text-fg outline-none focus:border-accent"
                />
                <button
                  type="button"
                  onClick={() =>
                    void agentApi
                      .sendBlenderScript(blenderScript)
                      .then((r) => setStatusMsg(r.ok ? r.output || "Executed in Blender." : r.error || "Requires paired Desktop Bridge."))
                  }
                  className="rounded-lg border border-border bg-elevated px-3 py-1.5 text-xs font-medium text-fg hover:border-accent"
                >
                  Run in Local Blender Bridge
                </button>
              </div>

              <div className="space-y-2 border-t border-border pt-3">
                <div className="flex items-center justify-between">
                  <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-fg-muted">
                    <Sparkles size={12} className="text-accent" /> Storytold ArtCraft MCP Runner
                  </h3>
                  <button
                    type="button"
                    onClick={() =>
                      void agentApi.addArtCraftMcpPreset("all").then(() =>
                        setStatusMsg("Registered DesignCraft, PhotoCraft, VectorCraft & LightCraft MCP presets."),
                      )
                    }
                    className="text-[11px] text-accent hover:underline"
                  >
                    Register Presets
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <select
                    value={craftApp}
                    onChange={(e) => setCraftApp(e.target.value as typeof craftApp)}
                    className="rounded-lg border border-border bg-elevated px-2 py-1.5 text-xs text-fg outline-none"
                  >
                    <option value="designcraft">DesignCraft</option>
                    <option value="photocraft">PhotoCraft</option>
                    <option value="vectorcraft">VectorCraft</option>
                    <option value="lightcraft">LightCraft</option>
                  </select>
                  <input
                    value={craftPrompt}
                    onChange={(e) => setCraftPrompt(e.target.value)}
                    placeholder="Edit instruction for ArtCraft MCP..."
                    className="min-w-40 flex-1 rounded-lg border border-border bg-elevated px-2.5 py-1.5 text-xs text-fg outline-none focus:border-accent"
                  />
                  <button
                    type="button"
                    disabled={!craftPrompt.trim()}
                    onClick={() =>
                      void agentApi
                        .executeArtCraftMcp({ app: craftApp, instruction: craftPrompt.trim() })
                        .then((r) => {
                          setStatusMsg(r.ok ? `Sent to ${craftApp} via ${r.via}.` : r.error || "ArtCraft MCP failed.");
                          if (r.ok) setCraftPrompt("");
                        })
                    }
                    className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-background disabled:opacity-40"
                  >
                    Run MCP
                  </button>
                </div>
              </div>
            </div>

            <div className="hud-panel space-y-3 p-4 lg:col-span-6">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-1.5 text-sm font-semibold text-fg">
                  {settings?.killSwitch.engaged ? (
                    <ShieldAlert size={15} className="text-red-500" />
                  ) : (
                    <ShieldCheck size={15} className="text-emerald-500" />
                  )}
                  Safety Guardrails & Audit Log
                </h2>
                <button
                  type="button"
                  onClick={() => void toggleKillSwitch()}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-xs font-medium",
                    settings?.killSwitch.engaged
                      ? "bg-red-500 text-white"
                      : "border border-border bg-elevated text-fg hover:border-red-500",
                  )}
                >
                  {settings?.killSwitch.engaged ? "Release Kill Switch" : "Engage Kill Switch"}
                </button>
              </div>
              <p className="text-xs text-fg-muted">
                Every high-impact desktop command respects confirmation guardrails and logs below.
              </p>
              <div className="max-h-72 space-y-1.5 overflow-y-auto">
                {audit.length === 0 ? (
                  <p className="text-xs text-fg-muted">No desktop guardrail events recorded yet.</p>
                ) : (
                  audit.map((a, i) => (
                    <div key={a.ts + i} className="hud-elevated flex items-center justify-between px-3 py-2 font-mono text-[11px]">
                      <span className="text-fg">
                        {a.tool} · {a.detail}
                      </span>
                      <span className="text-accent">{a.decision}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
