import { useEffect, useState } from "react";
import {
  Activity,
  Download,
  ExternalLink,
  History,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Wrench,
} from "lucide-react";
import {
  agentApi,
  type CatalogPluginItem,
  type McpServerInfo,
  type NormalizedPluginItem,
  type PluginDoctorReportItem,
  type ToolsetInfo,
} from "@/lib/agentApi";
import { cn } from "@/lib/cn";

type SubTab = "installed" | "catalog" | "builder" | "toolsets";

export default function PluginsPage() {
  const [tab, setTab] = useState<SubTab>("installed");
  const [installed, setInstalled] = useState<NormalizedPluginItem[]>([]);
  const [catalog, setCatalog] = useState<CatalogPluginItem[]>([]);
  const [toolsets, setToolsets] = useState<ToolsetInfo[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServerInfo[]>([]);
  const [doctorReport, setDoctorReport] = useState<PluginDoctorReportItem | null>(null);

  const [githubUrl, setGithubUrl] = useState("");
  const [rawManifest, setRawManifest] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const [checkingUpdates, setCheckingUpdates] = useState(false);

  // No-Code Skill Builder
  const [skillName, setSkillName] = useState("");
  const [skillDesc, setSkillDesc] = useState("");
  const [skillTriggers, setSkillTriggers] = useState("");
  const [skillInstructions, setSkillInstructions] = useState("");
  const [skillWebhook, setSkillWebhook] = useState("");

  // Auto-Drafted Workflow Studio
  const [wfName, setWfName] = useState("");
  const [wfTriggers, setWfTriggers] = useState("");
  const [wfSteps, setWfSteps] = useState("");

  // MCP Add & Storytold ArtCraft MCP
  const [mcpName, setMcpName] = useState("");
  const [mcpUrl, setMcpUrl] = useState("");
  const [craftApp, setCraftApp] = useState<"designcraft" | "photocraft" | "vectorcraft" | "lightcraft">("designcraft");
  const [craftInstruction, setCraftInstruction] = useState("");
  const [craftBusy, setCraftBusy] = useState(false);

  const loadAll = async () => {
    try {
      const [plugRes, tsRes, mcpRes] = await Promise.all([
        agentApi.getPlugins(),
        agentApi.getToolsets(),
        agentApi.getMcpServers(),
      ]);
      setInstalled(plugRes.installed);
      setCatalog(plugRes.catalog);
      setToolsets(tsRes.toolsets);
      setMcpServers(mcpRes.servers);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  const installCatalog = async (id: string) => {
    const res = await agentApi.installCatalogPlugin(id);
    setStatusMsg(`Installed "${res.plugin.name}" (pinned@${res.plugin.pinnedSha || "verified"}).`);
    await loadAll();
  };

  const installUrl = async () => {
    if (!githubUrl.trim()) return;
    try {
      const res = await agentApi.installPluginUrl(githubUrl.trim());
      setStatusMsg(`Imported "${res.plugin.name}" (pinned@${res.plugin.pinnedSha || "verified"}).`);
      setGithubUrl("");
      await loadAll();
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : "Failed to import URL");
    }
  };

  const installRaw = async () => {
    if (!rawManifest.trim()) return;
    try {
      const res = await agentApi.installPluginManifest(rawManifest);
      setStatusMsg(`Installed manifest "${res.plugin.name}" (pinned@${res.plugin.pinnedSha || "verified"}).`);
      setRawManifest("");
      await loadAll();
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : "Invalid manifest");
    }
  };

  const checkUpdates = async () => {
    setCheckingUpdates(true);
    try {
      const res = await agentApi.checkPluginUpdates();
      setStatusMsg(
        res.updated.length > 0
          ? `Updated safely (rollback snapshot saved): ${res.updated.join(", ")}`
          : `Checked ${res.checked} upstream extensions — all compatible & pinned.`,
      );
      await loadAll();
    } finally {
      setCheckingUpdates(false);
    }
  };

  const runDoctor = async () => {
    const report = await agentApi.runPluginDoctor();
    setDoctorReport(report);
    setStatusMsg(
      report.ok
        ? `Plugin Doctor: ${report.healthyCount}/${report.total} healthy (${report.pinnedCount} pinned).`
        : `Plugin Doctor flagged ${report.issues.length} diagnostic item(s).`,
    );
  };

  const rollbackPlugin = async (id: string) => {
    try {
      const res = await agentApi.rollbackPlugin(id);
      setStatusMsg(`Rolled back "${res.plugin.name}" to v${res.plugin.version}.`);
      await loadAll();
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : "Rollback unavailable");
    }
  };

  const createNoCode = async () => {
    if (!skillName.trim() || !skillInstructions.trim()) return;
    const res = await agentApi.createNoCodeSkill({
      name: skillName.trim(),
      description: skillDesc.trim(),
      triggers: skillTriggers
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      instructions: skillInstructions.trim(),
      webhookUrl: skillWebhook.trim() || undefined,
    });
    setStatusMsg(`Created custom skill "${res.plugin.name}".`);
    setSkillName("");
    setSkillDesc("");
    setSkillTriggers("");
    setSkillInstructions("");
    setSkillWebhook("");
    setTab("installed");
    await loadAll();
  };

  const draftWorkflow = async () => {
    if (!wfName.trim() || !wfSteps.trim()) return;
    const res = await agentApi.draftWorkflowSkill({
      name: wfName.trim(),
      triggers: wfTriggers
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      stepsText: wfSteps,
    });
    setStatusMsg(`Auto-drafted skill "${res.plugin.name}" (pinned@${res.plugin.pinnedSha}).`);
    setWfName("");
    setWfTriggers("");
    setWfSteps("");
    setTab("installed");
    await loadAll();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
        <div>
          <h1 className="font-display text-base font-semibold text-fg">Plugins & Skills Ecosystem</h1>
          <p className="text-xs text-fg-muted">
            Pinned SHA manifest integrity · Plugin Doctor · Safe Rollback · Auto-drafted & No-Code Skills
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-border bg-elevated p-1">
          {([
            ["installed", `Installed (${installed.length})`],
            ["catalog", "Community & GitHub"],
            ["builder", "Skill Builder"],
            ["toolsets", "Toolsets & MCP"],
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
        {tab === "installed" && (
          <div className="mx-auto max-w-4xl space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-fg-muted">
                Every plugin parses into a pinned JARVIS contract with instant rollback if an upstream update drifts.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void runDoctor()}
                  className="flex items-center gap-1.5 rounded-lg border border-border bg-elevated px-3 py-1.5 text-xs font-medium text-fg hover:border-accent"
                >
                  <Activity size={12} className="text-accent" /> Plugin Doctor
                </button>
                <button
                  type="button"
                  disabled={checkingUpdates}
                  onClick={() => void checkUpdates()}
                  className="flex items-center gap-1.5 rounded-lg border border-border bg-elevated px-3 py-1.5 text-xs font-medium text-fg hover:border-accent"
                >
                  <RefreshCw size={12} className={cn(checkingUpdates && "animate-spin")} /> Check Upstream Updates
                </button>
              </div>
            </div>

            {doctorReport && (
              <div className="hud-panel space-y-2 border-accent/40 p-3.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-fg">
                    Plugin Doctor: {doctorReport.healthyCount}/{doctorReport.total} healthy ·{" "}
                    {doctorReport.pinnedCount} manifest digests pinned
                  </span>
                  <button
                    type="button"
                    onClick={() => setDoctorReport(null)}
                    className="text-[11px] text-fg-muted hover:text-fg"
                  >
                    Dismiss
                  </button>
                </div>
                {doctorReport.issues.length === 0 ? (
                  <p className="text-emerald-400">All installed plugins & skills passed schema and trigger checks.</p>
                ) : (
                  <div className="space-y-1">
                    {doctorReport.issues.map((issue, idx) => (
                      <p key={issue.pluginId + idx} className="text-fg-muted">
                        <span className={issue.severity === "warn" ? "text-amber-400" : "text-accent"}>
                          [{issue.severity.toUpperCase()}]
                        </span>{" "}
                        <strong className="text-fg">{issue.pluginName}:</strong> {issue.message}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {installed.map((plugin) => (
              <div key={plugin.id} className="hud-panel flex items-start justify-between gap-4 p-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-fg">{plugin.name}</span>
                    <span className="font-mono text-[11px] text-accent">v{plugin.version}</span>
                    {plugin.pinnedSha && (
                      <span className="rounded bg-elevated px-1.5 py-0.5 font-mono text-[10px] text-fg-muted">
                        pinned@{plugin.pinnedSha}
                      </span>
                    )}
                    {plugin.autoDrafted && (
                      <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                        Auto-Drafted
                      </span>
                    )}
                    <span className="text-[11px] text-fg-muted">
                      {plugin.sourceKind.replace("_", ".")}
                      {plugin.requiresBridge ? " · Requires Desktop Bridge" : ""}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-fg-muted">{plugin.description}</p>
                  {plugin.triggers.length > 0 && (
                    <p className="mt-1.5 font-mono text-[10px] text-fg-muted">
                      Triggers: {plugin.triggers.join(", ")}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {plugin.previousRawSource && (
                    <button
                      type="button"
                      onClick={() => void rollbackPlugin(plugin.id)}
                      title={`Roll back to v${plugin.previousVersion || "previous"}`}
                      className="flex items-center gap-1 rounded-lg border border-border bg-elevated px-2 py-1 text-[11px] text-fg hover:border-accent"
                    >
                      <History size={11} /> Rollback
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      void agentApi.togglePlugin(plugin.id, !plugin.enabled).then(loadAll)
                    }
                    className={cn(
                      "rounded-lg px-2.5 py-1 text-xs font-medium transition-colors",
                      plugin.enabled
                        ? "bg-accent text-background"
                        : "border border-border bg-elevated text-fg-muted",
                    )}
                  >
                    {plugin.enabled ? "Enabled" : "Disabled"}
                  </button>
                  {plugin.sourceKind !== "builtin" && (
                    <button
                      type="button"
                      onClick={() => void agentApi.deletePlugin(plugin.id).then(loadAll)}
                      className="rounded p-1.5 text-fg-muted hover:text-red-500"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === "catalog" && (
          <div className="mx-auto max-w-5xl space-y-5">
            <div className="hud-panel space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
                    Import Any GitHub Plugin or SKILL.md
                  </h2>
                  <p className="mt-0.5 text-xs text-fg-muted">
                    Supports official open-source plugin specs including{" "}
                    <a
                      href="https://github.com/NousResearch/hermes-official-plugins"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-accent hover:underline"
                    >
                      NousResearch/hermes-official-plugins <ExternalLink size={11} />
                    </a>{" "}
                    and AgentSkills manifests.
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <input
                  value={githubUrl}
                  onChange={(e) => setGithubUrl(e.target.value)}
                  placeholder="https://github.com/.../plugin.yaml or raw SKILL.md URL"
                  className="min-w-0 flex-1 rounded-lg border border-border bg-elevated px-3 py-2 text-xs text-fg outline-none focus:border-accent"
                />
                <button
                  type="button"
                  onClick={() => void installUrl()}
                  className="rounded-lg bg-accent px-4 py-2 text-xs font-medium text-background"
                >
                  Import URL
                </button>
              </div>
              <details className="text-xs">
                <summary className="cursor-pointer font-medium text-fg-muted hover:text-fg">
                  Or paste SKILL.md / plugin.yaml content directly
                </summary>
                <div className="mt-2 space-y-2">
                  <textarea
                    rows={5}
                    value={rawManifest}
                    onChange={(e) => setRawManifest(e.target.value)}
                    placeholder="Paste YAML or Markdown skill frontmatter here..."
                    className="w-full rounded-lg border border-border bg-elevated p-3 font-mono text-xs text-fg outline-none focus:border-accent"
                  />
                  <button
                    type="button"
                    onClick={() => void installRaw()}
                    className="rounded-lg border border-border bg-elevated px-3 py-1.5 text-xs font-medium text-fg hover:border-accent"
                  >
                    Parse & Install Manifest
                  </button>
                </div>
              </details>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {catalog.map((item) => {
                const isInstalled = installed.some((p) => p.id === item.id);
                return (
                  <div key={item.id} className="hud-panel flex flex-col justify-between gap-3 p-4">
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-fg">{item.name}</span>
                        <span className="font-mono text-[11px] text-accent">v{item.version}</span>
                      </div>
                      <p className="mt-1 text-[11px] text-fg-muted">
                        {item.category} · {item.sourceKind === "skill_md" ? "SKILL.md" : "plugin.yaml"}
                      </p>
                      <p className="mt-2 text-xs leading-relaxed text-fg-muted">{item.description}</p>
                    </div>
                    <div className="flex items-center justify-between pt-1">
                      <a
                        href={item.upstreamUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-fg-muted hover:text-accent"
                      >
                        Upstream Source <ExternalLink size={11} />
                      </a>
                      <button
                        type="button"
                        onClick={() => void installCatalog(item.id)}
                        className={cn(
                          "flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium",
                          isInstalled
                            ? "border border-border bg-elevated text-fg"
                            : "bg-accent text-background",
                        )}
                      >
                        <Download size={12} /> {isInstalled ? "Re-sync" : "Install"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {tab === "builder" && (
          <div className="mx-auto grid max-w-5xl grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="hud-panel space-y-3 p-5">
              <h2 className="font-display text-sm font-semibold text-fg">Create Custom Skill Without Coding</h2>
              <p className="text-xs text-fg-muted">
                Define trigger phrases and step-by-step instructions. JARVIS activates this skill automatically whenever you ask.
              </p>
              <input
                value={skillName}
                onChange={(e) => setSkillName(e.target.value)}
                placeholder="Skill Name (e.g. Morning Stock & Weather Briefing)"
                className="w-full rounded-lg border border-border bg-elevated px-3 py-2 text-xs text-fg outline-none focus:border-accent"
              />
              <input
                value={skillDesc}
                onChange={(e) => setSkillDesc(e.target.value)}
                placeholder="Short description..."
                className="w-full rounded-lg border border-border bg-elevated px-3 py-2 text-xs text-fg outline-none focus:border-accent"
              />
              <input
                value={skillTriggers}
                onChange={(e) => setSkillTriggers(e.target.value)}
                placeholder="Trigger phrases (comma separated, e.g. morning brief, market check)"
                className="w-full rounded-lg border border-border bg-elevated px-3 py-2 text-xs text-fg outline-none focus:border-accent"
              />
              <textarea
                rows={4}
                value={skillInstructions}
                onChange={(e) => setSkillInstructions(e.target.value)}
                placeholder="Plain-English instructions for JARVIS to follow when this skill runs..."
                className="w-full rounded-lg border border-border bg-elevated px-3 py-2 text-xs text-fg outline-none focus:border-accent"
              />
              <input
                value={skillWebhook}
                onChange={(e) => setSkillWebhook(e.target.value)}
                placeholder="Optional Webhook URL (Zapier / Home Assistant / n8n)"
                className="w-full rounded-lg border border-border bg-elevated px-3 py-2 text-xs text-fg outline-none focus:border-accent"
              />
              <button
                type="button"
                onClick={() => void createNoCode()}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs font-medium text-background"
              >
                <Plus size={14} /> Save & Activate Skill
              </button>
            </div>

            <div className="hud-panel space-y-3 p-5">
              <h2 className="flex items-center gap-1.5 font-display text-sm font-semibold text-fg">
                <Sparkles size={14} className="text-accent" /> Auto-Draft Skill From Repeated Workflow
              </h2>
              <p className="text-xs text-fg-muted">
                List repeatable steps (one per line). JARVIS compiles a pinned SKILL.md procedure automatically.
              </p>
              <input
                value={wfName}
                onChange={(e) => setWfName(e.target.value)}
                placeholder="Workflow Name (e.g. Studio Closing Checklist)"
                className="w-full rounded-lg border border-border bg-elevated px-3 py-2 text-xs text-fg outline-none focus:border-accent"
              />
              <input
                value={wfTriggers}
                onChange={(e) => setWfTriggers(e.target.value)}
                placeholder="Triggers (comma separated, e.g. close studio, wrap up)"
                className="w-full rounded-lg border border-border bg-elevated px-3 py-2 text-xs text-fg outline-none focus:border-accent"
              />
              <textarea
                rows={6}
                value={wfSteps}
                onChange={(e) => setWfSteps(e.target.value)}
                placeholder={"Lock front entry door\nDim workshop lights to 10%\nSave active notes summary"}
                className="w-full rounded-lg border border-border bg-elevated px-3 py-2 text-xs text-fg outline-none focus:border-accent"
              />
              <button
                type="button"
                onClick={() => void draftWorkflow()}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-accent bg-elevated px-4 py-2 text-xs font-medium text-accent hover:bg-accent hover:text-background"
              >
                <Sparkles size={14} /> Auto-Draft Pinned Skill
              </button>
            </div>
          </div>
        )}

        {tab === "toolsets" && (
          <div className="mx-auto grid max-w-5xl grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="hud-panel space-y-2.5 p-4">
              <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-fg-muted">
                <Wrench size={13} /> Built-In Capability Toolsets
              </h2>
              {toolsets.map((ts) => (
                <div key={ts.name} className="hud-elevated flex items-center justify-between gap-3 p-3">
                  <div>
                    <p className="text-xs font-semibold text-fg">{ts.label}</p>
                    <p className="text-[11px] text-fg-muted">{ts.description}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      void agentApi.toggleToolset(ts.name, !ts.enabled).then(loadAll)
                    }
                    className={cn(
                      "rounded-lg px-2.5 py-1 text-xs font-medium",
                      ts.enabled
                        ? "bg-accent text-background"
                        : "border border-border bg-surface text-fg-muted",
                    )}
                  >
                    {ts.enabled ? "On" : "Off"}
                  </button>
                </div>
              ))}
            </div>

            <div className="hud-panel space-y-3 p-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
                MCP Tool Servers
              </h2>
              <div className="flex gap-2">
                <input
                  value={mcpName}
                  onChange={(e) => setMcpName(e.target.value)}
                  placeholder="Server name"
                  className="w-32 rounded-lg border border-border bg-elevated px-2.5 py-1.5 text-xs text-fg outline-none focus:border-accent"
                />
                <input
                  value={mcpUrl}
                  onChange={(e) => setMcpUrl(e.target.value)}
                  placeholder="https://mcp-server.example/sse"
                  className="min-w-0 flex-1 rounded-lg border border-border bg-elevated px-2.5 py-1.5 text-xs text-fg outline-none focus:border-accent"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!mcpName.trim()) return;
                    void agentApi
                      .addMcpServer({ name: mcpName.trim(), url: mcpUrl.trim() || undefined })
                      .then(() => {
                        setMcpName("");
                        setMcpUrl("");
                        return loadAll();
                      });
                  }}
                  className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-background"
                >
                  Add
                </button>
              </div>
              {mcpServers.length === 0 ? (
                <p className="text-xs text-fg-muted">No external MCP servers added yet.</p>
              ) : (
                <div className="space-y-2">
                  {mcpServers.map((srv) => (
                    <div key={srv.name} className="hud-elevated flex items-center justify-between px-3 py-2 text-xs">
                      <div>
                        <p className="font-medium text-fg">{srv.name}</p>
                        <p className="font-mono text-[10px] text-fg-muted">{srv.url || srv.command}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void agentApi.removeMcpServer(srv.name).then(loadAll)}
                        className="text-fg-muted hover:text-red-500"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-4 space-y-2.5 border-t border-border pt-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-semibold text-fg">Storytold ArtCraft MCP Studio</h3>
                    <p className="text-[11px] text-fg-muted">
                      Connect DesignCraft, PhotoCraft, VectorCraft, and LightCraft via local MCP (--connect 127.0.0.1).
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      void agentApi.addArtCraftMcpPreset("all").then((r) => {
                        setStatusMsg(
                          r.added.length
                            ? `Registered Storytold ArtCraft MCP presets: ${r.added.join(", ")}`
                            : "All 4 Storytold ArtCraft MCP presets are already registered.",
                        );
                        return loadAll();
                      })
                    }
                    className="rounded-lg border border-accent/60 bg-accent/15 px-2.5 py-1 text-[11px] font-medium text-accent hover:bg-accent hover:text-background"
                  >
                    + Add ArtCraft Presets
                  </button>
                </div>

                <div className="flex flex-wrap gap-2">
                  <select
                    value={craftApp}
                    onChange={(e) => setCraftApp(e.target.value as typeof craftApp)}
                    className="rounded-lg border border-border bg-elevated px-2.5 py-1.5 text-xs text-fg outline-none"
                  >
                    <option value="designcraft">DesignCraft (:4311)</option>
                    <option value="photocraft">PhotoCraft (:4312)</option>
                    <option value="vectorcraft">VectorCraft (:4313)</option>
                    <option value="lightcraft">LightCraft (:4314)</option>
                  </select>
                  <input
                    value={craftInstruction}
                    onChange={(e) => setCraftInstruction(e.target.value)}
                    placeholder="e.g. Create geometric arc reactor badge with brushed titanium gradient"
                    className="min-w-44 flex-1 rounded-lg border border-border bg-elevated px-2.5 py-1.5 text-xs text-fg outline-none focus:border-accent"
                  />
                  <button
                    type="button"
                    disabled={craftBusy || !craftInstruction.trim()}
                    onClick={() => {
                      setCraftBusy(true);
                      void agentApi
                        .executeArtCraftMcp({ app: craftApp, instruction: craftInstruction.trim() })
                        .then((r) => {
                          setStatusMsg(
                            r.ok
                              ? `ArtCraft (${craftApp}) executed via ${r.via}.`
                              : r.error || "ArtCraft MCP command queued.",
                          );
                          setCraftInstruction("");
                        })
                        .finally(() => setCraftBusy(false));
                    }}
                    className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-background disabled:opacity-40"
                  >
                    {craftBusy ? "Sending…" : "Edit via MCP"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
