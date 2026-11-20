import { useCallback, useEffect, useState } from "react";
import {
  Check,
  ExternalLink,
  Eye,
  EyeOff,
  Mic,
  Music2,
  PlugZap,
  Save,
  Settings as SettingsIcon,
  Trash2,
  Volume2,
} from "lucide-react";
import {
  agentApi,
  setBackendBaseUrl,
  backendBaseUrl,
  type AgentSettings,
  type FreeModel,
  type MicInfo,
  type SpotifyStatus,
  type VoiceSettings,
} from "@/lib/agentApi";
import { setTtsPrefs, getTtsPrefs, type TtsPrefs } from "@/lib/agentService";
import { setWakeWordEnabled, toggleMic } from "@/lib/voiceController";
import { speak } from "@/lib/voiceEngine";
import { websocketService } from "@/lib/websocketService";
import { cn } from "@/lib/cn";

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="glass rounded-2xl p-4">
      <h2 className="text-sm font-medium">{title}</h2>
      {subtitle && <p className="mb-3 mt-0.5 text-[11px] text-fg-muted">{subtitle}</p>}
      <div className={cn(subtitle ? "mt-1" : "mt-3")}>{children}</div>
    </section>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex w-full items-center justify-between">
      <span className="text-xs text-fg-muted">{label}</span>
      <span className={cn("relative h-5 w-9 rounded-full transition-colors", checked ? "bg-accent/40" : "bg-white/10")}>
        <span className={cn("absolute top-0.5 h-4 w-4 rounded-full transition-all", checked ? "left-4.5 bg-accent shadow-[0_0_8px_rgb(0_212_255/0.8)]" : "left-0.5 bg-white")} />
      </span>
    </button>
  );
}

function SavedBadge({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span className="flex items-center gap-1 text-[11px] text-emerald-300">
      <Check size={11} /> Saved
    </span>
  );
}

const BRAINS: Array<{ id: AgentSettings["brain"]; label: string; hint: string }> = [
  { id: "auto", label: "Auto", hint: "Hermes runtime, falls back to direct model" },
  { id: "hermes", label: "Hermes", hint: "Full agent runtime (tools, memory, skills)" },
  { id: "openrouter", label: "Direct", hint: "Plain OpenRouter chat, no tools" },
];

export default function SettingsPage() {
  const [backend, setBackend] = useState<AgentSettings | null>(null);
  const [freeModels, setFreeModels] = useState<FreeModel[]>([]);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [brain, setBrain] = useState<AgentSettings["brain"]>("auto");
  const [models, setModels] = useState({ default: "", fast: "", heavy: "" });
  const [tts, setTts] = useState<TtsPrefs>(getTtsPrefs());
  const [voice, setVoice] = useState<VoiceSettings | null>(null);
  const [mics, setMics] = useState<MicInfo[]>([]);
  const [micDevice, setMicDevice] = useState("");
  const [pttHotkey, setPttHotkey] = useState("");
  const [sttModel, setSttModel] = useState("tiny.en");
  const [spotify, setSpotify] = useState<SpotifyStatus | null>(null);
  const [spotifyClientId, setSpotifyClientId] = useState("");
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [backendUrl, setBackendUrlInput] = useState(backendBaseUrl());
  const [savedFlag, setSavedFlag] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const flash = (key: string) => {
    setSavedFlag((f) => ({ ...f, [key]: true }));
    window.setTimeout(() => setSavedFlag((f) => ({ ...f, [key]: false })), 2200);
  };

  const load = useCallback(async () => {
    setError(null);
    try {
      const settings = await agentApi.getSettings();
      const active = settings.provider || "openrouter";
      const [modelsData, micData] = await Promise.all([
        active === "openrouter"
          ? agentApi.getFreeModels().then((data) => data.free).catch(() => [] as FreeModel[])
          : agentApi.getProviderModels(active, true).then((data) => data.models).catch(() => [] as FreeModel[]),
        agentApi.getMics().catch(() => ({ mics: [] as MicInfo[] })),
      ]);
      setBackend(settings);
      setBrain(settings.brain);
      setModels(settings.models);
      setFreeModels(modelsData);
      setVoice(settings.voice ?? null);
      setSpotify(settings.spotify ?? null);
      setMicDevice(settings.voice?.micDevice ?? "");
      setPttHotkey(settings.voice?.pttHotkey ?? "");
      setSttModel(settings.voice?.sttModel ?? "tiny.en");
      setTts({
        enabled: settings.tts?.enabled ?? true,
        rate: settings.tts?.rate ?? 0.98,
        pitch: settings.tts?.pitch ?? 0.85,
      });
      setMics(micData.mics ?? []);
    } catch (exc) {
      setError(
        `Backend unreachable (${exc instanceof Error ? exc.message : exc}). Start it with backend\\start.bat — settings below still save locally where possible.`,
      );
      // No hardcoded fallback model list: if the backend is down we show the
      // error instead of stale slugs (Phase 2 — model lists come from the
      // backend's live fetch, never from constants in the UI).
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveApiKey = async () => {
    if (!apiKey.trim()) return;
    try {
      await agentApi.saveSettings({ openrouterApiKey: apiKey.trim() });
      setApiKey("");
      setTestResult(null);
      flash("key");
      await load();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    }
  };

  const removeKey = async () => {
    try {
      await agentApi.removeKey();
      setApiKey("");
      setTestResult(null);
      flash("key");
      await load();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    }
  };

  const runTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await agentApi.testConnection();
      setTestResult(result);
    } catch (exc) {
      setTestResult({
        ok: false,
        message: `Couldn't reach the JARVIS backend (${exc instanceof Error ? exc.message : exc}).`,
      });
    } finally {
      setTesting(false);
    }
  };

  const saveBrain = async (next: AgentSettings["brain"]) => {
    setBrain(next);
    try {
      await agentApi.setBrain(next);
      flash("brain");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    }
  };

  const saveModels = async () => {
    try {
      await agentApi.saveSettings({
        defaultModel: models.default,
        fastModel: models.fast,
        heavyModel: models.heavy,
      });
      flash("models");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    }
  };

  const saveTts = (next: TtsPrefs) => {
    setTts(next);
    setTtsPrefs(next);
    flash("tts");
    void agentApi.saveSettings({
      ttsEnabled: next.enabled,
      ttsRate: next.rate,
      ttsPitch: next.pitch,
    }).catch(() => { /* local-only is fine when backend is down */ });
  };

  const saveBackendUrl = () => {
    setBackendBaseUrl(backendUrl.trim());
    flash("url");
    websocketService.setUrl(backendUrl.trim().replace(/^http/, "ws") + "/ws/chat");
    void agentService_refresh();
  };

  const agentService_refresh = async () => {
    const { agentService } = await import("@/lib/agentService");
    await agentService.refreshStatus();
  };

  const testVoice = () => {
    void speak("All systems are operational. I am at your service, sir.", { rate: tts.rate, pitch: tts.pitch });
  };

  /** Save one voice field and refresh the live status (mic, models, hotkey). */
  const saveVoice = async (patch: Record<string, unknown>, flag = "voice") => {
    try {
      await agentApi.saveSettings(patch);
      const status = await agentApi.voiceStatus().catch(() => null);
      if (status) setVoice(status);
      flash(flag);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    }
  };

  const toggleWake = async (enabled: boolean) => {
    setVoiceBusy(true);
    const ok = await setWakeWordEnabled(enabled);
    if (ok) {
      setVoice((v) => (v ? { ...v, wakeEnabled: enabled } : v));
      flash("wake");
      const status = await agentApi.voiceStatus().catch(() => null);
      if (status) setVoice(status);
    }
    setVoiceBusy(false);
  };

  const testMicrophone = async () => {
    setVoiceBusy(true);
    try {
      await toggleMic("manual");
      flash("mic");
    } finally {
      setVoiceBusy(false);
    }
  };

  const connectSpotify = async () => {
    setVoiceBusy(true);
    try {
      if (spotifyClientId.trim()) {
        await agentApi.setSpotifyClientId(spotifyClientId.trim());
        setSpotifyClientId("");
      }
      const result = await agentApi.spotifyAuthUrl(true);
      if (!result.ok) {
        setError(result.error || "Spotify could not start the login.");
      } else {
        flash("spotify");
      }
      const status = await agentApi.spotifyStatus().catch(() => null);
      if (status) setSpotify(status);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setVoiceBusy(false);
    }
  };

  const disconnectSpotify = async () => {
    try {
      await agentApi.spotifyDisconnect();
      const status = await agentApi.spotifyStatus().catch(() => null);
      if (status) setSpotify(status);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    }
  };

  const modelOptions = (current: string) => {
    const ids = new Set<string>([current, ...freeModels.map((m) => m.id)].filter(Boolean));
    return [...ids];
  };

  return (
    <div className="h-full overflow-y-auto px-6 pb-6 pt-4">
      <div className="mx-auto max-w-2xl space-y-3">
        <div className="flex items-center gap-2 pb-1">
          <SettingsIcon size={17} className="text-accent" />
          <h1 className="text-base font-medium tracking-tight">Settings</h1>
        </div>

        {error && (
          <div className="rounded-xl border border-amber-400/25 bg-amber-400/10 px-3.5 py-2 text-xs leading-relaxed text-amber-200">
            {error}
          </div>
        )}

        {/* API keys */}
        <Section title="API Keys" subtitle="Keys live in Windows Credential Manager — never in files, never shown in full. This field is the OpenRouter key; every other provider is managed on the Providers tab.">
          <div className="flex items-center gap-2">
            <div className="glass flex flex-1 items-center gap-2 rounded-full px-3.5 py-2">
              <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-fg-muted">OpenRouter</span>
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void saveApiKey();
                  }
                }}
                placeholder={backend?.openrouterApiKeyMasked || "sk-or-v1-… (Enter saves)"}
                className="w-full bg-transparent font-mono text-xs outline-none placeholder:text-fg-muted"
              />
              <button type="button" onClick={() => setShowKey((v) => !v)} aria-label={showKey ? "Hide key" : "Show key"} className="text-fg-muted hover:text-fg">
                {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
            <button
              type="button"
              onClick={() => void saveApiKey()}
              disabled={!apiKey.trim()}
              className="flex items-center gap-1.5 rounded-full bg-accent/15 px-3.5 py-2 text-xs font-medium text-accent transition-colors hover:bg-accent/25 disabled:opacity-40"
            >
              <Save size={12} /> Save
            </button>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-fg-muted">
              {backend?.hasKey ? `Saved: ${backend.openrouterApiKeyMasked || "••••"}` : "No key configured yet."}
            </span>
            {backend?.hasKey && (
              <button
                type="button"
                onClick={() => void removeKey()}
                className="flex items-center gap-1 text-[11px] text-red-300/80 transition-colors hover:text-red-300"
              >
                <Trash2 size={11} /> Remove
              </button>
            )}
            <button
              type="button"
              onClick={() => void runTestConnection()}
              disabled={testing}
              className="flex items-center gap-1 rounded-full bg-white/5 px-2.5 py-1 text-[11px] text-fg transition-colors hover:bg-white/10 disabled:opacity-40"
            >
              <PlugZap size={11} className={cn(testing && "animate-pulse")} /> {testing ? "Testing…" : "Test connection"}
            </button>
            <SavedBadge show={Boolean(savedFlag["key"])} />
          </div>
          {testResult && (
            <p className={cn("mt-2 rounded-lg px-2.5 py-1.5 text-[11px] leading-relaxed", testResult.ok ? "bg-emerald-400/10 text-emerald-200" : "bg-amber-400/10 text-amber-200")}>
              {testResult.ok ? "✓ " : "✗ "}
              {testResult.message}
            </p>
          )}
        </Section>

        {/* Brain */}
        <Section title="Brain" subtitle="Which runtime answers your messages.">
          <div className="grid grid-cols-3 gap-2">
            {BRAINS.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => void saveBrain(b.id)}
                className={cn(
                  "rounded-xl border px-3 py-2.5 text-left transition-all",
                  brain === b.id ? "border-accent/50 bg-accent/10" : "border-white/10 bg-white/[0.03] hover:border-white/20",
                )}
              >
                <span className={cn("block text-xs font-medium", brain === b.id ? "text-accent" : "text-fg")}>{b.label}</span>
                <span className="mt-0.5 block text-[10px] leading-snug text-fg-muted">{b.hint}</span>
              </button>
            ))}
          </div>
          <div className="mt-1.5 flex justify-end">
            <SavedBadge show={Boolean(savedFlag["brain"])} />
          </div>
        </Section>

        {/* Models */}
        <Section title="Model Selection" subtitle={`Models from ${backend?.provider || "the active provider"}. Switching provider picks a valid model automatically.`}>
          <div className="space-y-2.5">
            {(["default", "fast", "heavy"] as const).map((tier) => (
              <label key={tier} className="flex items-center gap-3">
                <span className="w-14 text-xs capitalize text-fg-muted">{tier}</span>
                <select
                  value={models[tier]}
                  onChange={(e) => setModels((m) => ({ ...m, [tier]: e.target.value }))}
                  className="glass w-full rounded-xl bg-surface px-3 py-2 font-mono text-xs text-fg outline-none"
                >
                  {modelOptions(models[tier]).map((id) => (
                    <option key={id} value={id} className="bg-surface">
                      {id}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className="mt-2.5 flex items-center justify-between">
            <span className="text-[11px] text-fg-muted">{freeModels.length > 0 ? `${freeModels.length} free models available` : "Could not load the live model list."}</span>
            <div className="flex items-center gap-2">
              <SavedBadge show={Boolean(savedFlag["models"])} />
              <button type="button" onClick={() => void saveModels()} className="rounded-full bg-accent/15 px-3.5 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/25">
                Apply
              </button>
            </div>
          </div>
        </Section>

        {/* Voice */}
        <Section
          title="Voice"
          subtitle="Listening runs in the local Python backend (WebView2 speech recognition is unusable in Tauri). Replies are spoken here with system voices."
        >
          <div className="space-y-3">
            <Toggle
              checked={voice?.wakeEnabled ?? false}
              onChange={(v) => void toggleWake(v)}
              label={voiceBusy ? '"Hey JARVIS" wake word (working…)' : '"Hey JARVIS" wake word (listens in the background)'}
            />

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fg-muted">
              <span>
                State: <span className="font-mono text-fg/80">{voice?.state ?? "unknown"}</span>
              </span>
              <span>Mic: {voice?.streamOpen ? "open" : "closed"}</span>
              <span>Wake model: {voice?.wakeModelReady ? "ready" : "not loaded"}</span>
              <span>STT: {voice?.sttModel ?? "—"}{voice?.sttReady ? " (ready)" : ""}</span>
            </div>
            {(voice?.wakeError || voice?.sttError) && (
              <p className="rounded-lg bg-amber-400/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-200">
                {voice?.wakeError || voice?.sttError}
              </p>
            )}

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs text-fg-muted">Microphone</span>
                <select
                  value={micDevice}
                  onChange={(e) => {
                    setMicDevice(e.target.value);
                    void saveVoice({ micDevice: e.target.value }, "mic");
                  }}
                  className="glass mt-1 w-full rounded-xl bg-surface px-3 py-2 text-xs text-fg outline-none"
                >
                  <option value="" className="bg-surface">
                    System default
                  </option>
                  {mics.map((m) => (
                    <option key={m.id} value={m.id} className="bg-surface">
                      {m.name}
                      {m.default ? " (default)" : ""}
                    </option>
                  ))}
                </select>
                {mics.length === 0 && (
                  <span className="mt-1 block text-[10px] text-fg-muted">No input devices reported by the backend.</span>
                )}
              </label>

              <label className="block">
                <span className="text-xs text-fg-muted">Speech-to-text model</span>
                <select
                  value={sttModel}
                  onChange={(e) => {
                    setSttModel(e.target.value);
                    void saveVoice({ sttModel: e.target.value }, "stt");
                  }}
                  className="glass mt-1 w-full rounded-xl bg-surface px-3 py-2 text-xs text-fg outline-none"
                >
                  {["tiny.en", "base.en", "small.en", "medium.en"].map((m) => (
                    <option key={m} value={m} className="bg-surface">
                      {m}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-[10px] text-fg-muted">
                  Larger models are more accurate but download once and use more CPU.
                </span>
              </label>
            </div>

            <div className="flex items-end gap-2">
              <label className="block flex-1">
                <span className="text-xs text-fg-muted">Push-to-talk hotkey (toggle listening)</span>
                <input
                  value={pttHotkey}
                  onChange={(e) => setPttHotkey(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void saveVoice({ pttHotkey: pttHotkey.trim() }, "ptt");
                    }
                  }}
                  spellCheck={false}
                  placeholder="ctrl+alt+j"
                  className="glass mt-1 w-full rounded-full px-3.5 py-2 font-mono text-xs outline-none"
                />
              </label>
              <button
                type="button"
                onClick={() => void saveVoice({ pttHotkey: pttHotkey.trim() }, "ptt")}
                className="shrink-0 rounded-full bg-accent/15 px-3.5 py-2 text-xs font-medium text-accent transition-colors hover:bg-accent/25"
              >
                Apply
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void testMicrophone()}
                disabled={voiceBusy}
                className="flex items-center gap-1.5 rounded-full bg-white/5 px-3.5 py-1.5 text-xs text-fg transition-colors hover:bg-white/10 disabled:opacity-40"
              >
                <Mic size={12} /> {voice?.state === "listening" ? "Stop listening" : "Test microphone"}
              </button>
              <SavedBadge show={Boolean(savedFlag["mic"])} />
              <SavedBadge show={Boolean(savedFlag["ptt"])} />
              <SavedBadge show={Boolean(savedFlag["stt"])} />
              <SavedBadge show={Boolean(savedFlag["wake"])} />
            </div>

            <div className="border-t border-white/10 pt-3">
              <Toggle checked={tts.enabled} onChange={(v) => saveTts({ ...tts, enabled: v })} label="Speak replies aloud" />
              <label className="mt-2 block">
                <span className="flex items-center justify-between text-xs text-fg-muted">
                  Speech rate <span className="font-mono text-[10px] text-fg/70">{tts.rate.toFixed(2)}×</span>
                </span>
                <input type="range" min={0.6} max={1.4} step={0.02} value={tts.rate} onChange={(e) => saveTts({ ...tts, rate: Number(e.target.value) })} className="mt-1 w-full accent-[#00d4ff]" />
              </label>
              <label className="mt-1 block">
                <span className="flex items-center justify-between text-xs text-fg-muted">
                  Pitch <span className="font-mono text-[10px] text-fg/70">{tts.pitch.toFixed(2)}</span>
                </span>
                <input type="range" min={0.5} max={1.3} step={0.02} value={tts.pitch} onChange={(e) => saveTts({ ...tts, pitch: Number(e.target.value) })} className="mt-1 w-full accent-[#00d4ff]" />
              </label>
              <button
                type="button"
                onClick={testVoice}
                disabled={!tts.enabled}
                className="mt-2 flex items-center gap-1.5 rounded-full bg-white/5 px-3.5 py-1.5 text-xs text-fg transition-colors hover:bg-white/10 disabled:opacity-40"
              >
                <Volume2 size={12} /> Test voice
              </button>
            </div>
          </div>
          <div className="mt-2 flex justify-end">
            <SavedBadge show={Boolean(savedFlag["tts"])} />
          </div>
        </Section>

        {/* Music */}
        <Section
          title="Music"
          subtitle="Spotify runs at three levels: open a search, media keys for play/pause, and precise playback through the Web API with your own developer client ID."
        >
          <div className="space-y-2.5">
            <div className="flex items-center gap-2">
              <div className="glass flex flex-1 items-center gap-2 rounded-full px-3.5 py-2">
                <Music2 size={13} className="shrink-0 text-fg-muted" />
                <input
                  value={spotifyClientId}
                  onChange={(e) => setSpotifyClientId(e.target.value)}
                  placeholder={spotify?.clientIdMasked || "Spotify developer client ID"}
                  spellCheck={false}
                  className="w-full bg-transparent font-mono text-xs outline-none placeholder:text-fg-muted"
                />
              </div>
              <button
                type="button"
                onClick={() => void connectSpotify()}
                disabled={voiceBusy || (!spotify?.configured && !spotifyClientId.trim())}
                className="flex shrink-0 items-center gap-1.5 rounded-full bg-accent/15 px-3.5 py-2 text-xs font-medium text-accent transition-colors hover:bg-accent/25 disabled:opacity-40"
              >
                <ExternalLink size={12} /> {spotify?.authorized ? "Reconnect" : "Connect"}
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fg-muted">
              <span>Client ID: {spotify?.configured ? "configured" : "not set"}</span>
              <span>Account: {spotify?.authorized ? spotify?.displayName || "connected" : "not connected"}</span>
              <span>Plan: {spotify?.product ?? "unknown"}</span>
              {spotify?.authorized && (
                <button
                  type="button"
                  onClick={() => void disconnectSpotify()}
                  className="flex items-center gap-1 text-[11px] text-red-300/80 transition-colors hover:text-red-300"
                >
                  <Trash2 size={11} /> Disconnect
                </button>
              )}
            </div>
            <p className="text-[11px] leading-relaxed text-fg-muted">
              Create an app at{" "}
              <a
                href="https://developer.spotify.com/dashboard"
                target="_blank"
                rel="noreferrer"
                className="text-accent underline underline-offset-2"
              >
                developer.spotify.com
              </a>{" "}
              and add the redirect URI{" "}
              <span className="font-mono text-fg/70">{spotify?.redirectUri || agentApi.spotifyRedirectUri()}</span>. Precise
              playback control requires Spotify Premium; without it JARVIS opens a search and uses media keys.
            </p>
            {spotify?.error && (
              <p className="rounded-lg bg-amber-400/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-200">{spotify.error}</p>
            )}
            {spotify?.authorized && spotify.premium === false && (
              <p className="rounded-lg bg-amber-400/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-200">
                This Spotify account is not Premium, so exact track playback through the API is unavailable.
              </p>
            )}
            <div className="flex justify-end">
              <SavedBadge show={Boolean(savedFlag["spotify"])} />
            </div>
          </div>
        </Section>

        {/* Safety */}
        <Section title="Safety" subtitle="Guardrails for actions that can affect your system.">
          <Toggle
            checked={backend?.confirmDangerousTools ?? true}
            onChange={async (v) => {
              try {
                await agentApi.saveSettings({ confirmDangerousTools: v });
                setBackend((b) => (b ? { ...b, confirmDangerousTools: v } : b));
                flash("safety");
              } catch (exc) {
                setError(exc instanceof Error ? exc.message : String(exc));
              }
            }}
            label="Ask before running dangerous tools (terminal, desktop control)"
          />
          <div className="mt-2 flex justify-end">
            <SavedBadge show={Boolean(savedFlag["safety"])} />
          </div>
        </Section>

        {/* Backend */}
        <Section title="Backend" subtitle="Where the JARVIS backend listens. Restart the backend if you change the port.">
          <div className="flex items-center gap-2">
            <input
              value={backendUrl}
              onChange={(e) => setBackendUrlInput(e.target.value)}
              className="glass w-full rounded-full px-3.5 py-2 font-mono text-xs outline-none"
              spellCheck={false}
            />
            <button type="button" onClick={saveBackendUrl} className="shrink-0 rounded-full bg-accent/15 px-3.5 py-2 text-xs font-medium text-accent transition-colors hover:bg-accent/25">
              Apply
            </button>
          </div>
          <div className="mt-1.5 flex justify-end">
            <SavedBadge show={Boolean(savedFlag["url"])} />
          </div>
        </Section>

        {/* About */}
        <Section title="About">
          <div className="space-y-1.5 text-xs text-fg-muted">
            <p className="text-fg/85">JARVIS v0.1.0 — personal AI assistant</p>
            <p>
              Brain:{" "}
              <a href="https://github.com/NousResearch/hermes-agent" target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">
                Hermes Agent
              </a>{" "}
              (Nous Research, MIT) · Models:{" "}
              <a href="https://openrouter.ai" target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">
                OpenRouter
              </a>
            </p>
            <p>Shell: Tauri 2 · Interface: React 18 + Three.js</p>
          </div>
        </Section>
      </div>
    </div>
  );
}
