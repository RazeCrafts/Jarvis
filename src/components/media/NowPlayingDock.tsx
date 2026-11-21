import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Film,
  FolderOpen,
  Music,
  Play,
  X,
} from "lucide-react";
import { agentApi } from "@/lib/agentApi";
import { buildDedicatedAppTargets, isDirectMediaUrl } from "@/lib/mediaIntent";
import { useAudioControlStore, usePlayerStore } from "@/store";
import type { MediaDeckItem } from "@/store";

export function NowPlayingDock() {
  const queue = usePlayerStore((s) => s.queue);
  const activeId = usePlayerStore((s) => s.activeId);
  const dockOpen = usePlayerStore((s) => s.dockOpen);
  const minimized = usePlayerStore((s) => s.minimized);
  const openItem = usePlayerStore((s) => s.openItem);
  const setActiveId = usePlayerStore((s) => s.setActiveId);
  const setDockOpen = usePlayerStore((s) => s.setDockOpen);
  const setMinimized = usePlayerStore((s) => s.setMinimized);

  const masterVolume = useAudioControlStore((s) => s.masterVolume);
  const mediaVolume = useAudioControlStore((s) => s.mediaVolume);
  const muted = useAudioControlStore((s) => s.muted);

  const mediaRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [statusMsg, setStatusMsg] = useState("");

  const active: MediaDeckItem | null =
    queue.find((x) => x.id === activeId) ?? queue[0] ?? null;

  useEffect(() => {
    const vol = muted ? 0 : Math.min(1, masterVolume * mediaVolume);
    if (mediaRef.current) {
      mediaRef.current.volume = vol;
      mediaRef.current.muted = muted;
    }
    if (audioRef.current) {
      audioRef.current.volume = vol;
      audioRef.current.muted = muted;
    }
  }, [masterVolume, mediaVolume, muted, active?.id]);

  if (!dockOpen || !active) return null;

  const isLocalOrDirect = Boolean(
    active.localSrc || (active.watchUrl && isDirectMediaUrl(active.watchUrl)),
  );
  const directSrc = active.localSrc || active.watchUrl || "";
  const isAudioOnly = active.kind === "audio" || (active.mimeType || "").startsWith("audio/");

  const appTargets =
    active.targets && active.targets.length > 0
      ? active.targets
      : buildDedicatedAppTargets(
          active.title,
          active.kind === "movie" ? "movie" : active.kind === "song" || active.kind === "audio" ? "song" : "video",
          active.watchUrl,
        );

  const handleLocalFilePick = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const f = files[0];
    const url = URL.createObjectURL(f);
    const isAudio = f.type.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(f.name);
    openItem({
      id: `local-${f.name}-${Date.now()}`,
      title: f.name,
      kind: isAudio ? "audio" : "video",
      source: "local",
      localSrc: url,
      mimeType: f.type || (isAudio ? "audio/mpeg" : "video/mp4"),
      targets: buildDedicatedAppTargets(f.name.replace(/\.[^.]+$/, ""), isAudio ? "song" : "movie"),
    });
    setStatusMsg(`Playing local file: ${f.name}`);
  };

  const launchViaDesktopBridge = async (appName: string) => {
    try {
      const res = await agentApi.launchApp(appName);
      setStatusMsg(res.ok ? `Opened ${appName} via Desktop Bridge.` : res.error || `Launched ${appName} link.`);
    } catch {
      /* browser link handles opening */
    }
  };

  return (
    <div
      data-testid="now-playing-dock"
      className="hud-panel fixed bottom-4 right-4 z-40 flex w-[430px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden border border-accent/40 shadow-2xl"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border bg-elevated/90 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {active.kind === "song" || active.kind === "audio" ? (
            <Music size={14} className="shrink-0 text-accent" />
          ) : (
            <Film size={14} className="shrink-0 text-accent" />
          )}
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-fg">{active.title}</p>
            <p className="truncate font-mono text-[10px] text-fg-muted">
              {active.source === "local" ? "Local Playback" : active.channel || "Online Stream"} ·{" "}
              {active.kind}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*,audio/*,.mp4,.mkv,.webm,.mp3,.wav,.flac,.m4a,.ogg"
            className="hidden"
            onChange={(e) => handleLocalFilePick(e.target.files)}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Play a local video or song file"
            className="rounded-lg border border-border bg-surface px-2 py-1 text-[10px] text-fg hover:border-accent"
          >
            <FolderOpen size={12} />
          </button>
          <button
            type="button"
            onClick={() => setMinimized(!minimized)}
            title={minimized ? "Expand player" : "Minimize player"}
            className="rounded-lg border border-border bg-surface px-2 py-1 text-[10px] text-fg hover:border-accent"
          >
            {minimized ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          <button
            type="button"
            onClick={() => setDockOpen(false)}
            aria-label="Close Now Playing Dock"
            className="rounded-lg border border-border bg-surface px-2 py-1 text-[10px] text-fg-muted hover:text-fg"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {!minimized && (
        <div className="space-y-2.5 bg-background/95 p-3">
          {isLocalOrDirect ? (
            isAudioOnly ? (
              <audio
                ref={audioRef}
                key={directSrc}
                src={directSrc}
                controls
                autoPlay
                className="w-full"
              />
            ) : (
              <video
                ref={mediaRef}
                key={directSrc}
                src={directSrc}
                controls
                autoPlay
                className="aspect-video w-full rounded-lg border border-border bg-black"
              />
            )
          ) : active.embedUrl ? (
            <div className="aspect-video w-full overflow-hidden rounded-lg border border-border bg-black">
              <iframe
                key={active.embedUrl}
                title={active.title}
                src={active.embedUrl}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="h-full w-full border-0"
              />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-surface/60 px-4 py-6 text-center">
              <Play size={18} className="text-accent" />
              <p className="text-xs text-fg-muted">
                No inline embed URL returned for this title—launch in a streaming site or dedicated app below, or pick a local file.
              </p>
              {active.watchUrl && (
                <a
                  href={active.watchUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-background"
                >
                  Open Source Page <ExternalLink size={12} />
                </a>
              )}
            </div>
          )}

          {statusMsg && (
            <p className="text-[11px] text-accent">{statusMsg}</p>
          )}

          {/* Dedicated App & Streaming Launchers */}
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
              Open in Dedicated App or Site
            </p>
            <div className="flex flex-wrap gap-1.5">
              {appTargets.map((t) => (
                <a
                  key={t.id}
                  href={t.protocolUri || t.webUrl}
                  target={t.protocolUri ? undefined : "_blank"}
                  rel={t.protocolUri ? undefined : "noreferrer"}
                  onClick={() => {
                    if (t.bridgeAppName) void launchViaDesktopBridge(t.bridgeAppName);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-border bg-elevated px-2 py-1 text-[11px] text-fg transition-colors hover:border-accent hover:text-accent"
                >
                  {t.label} <ExternalLink size={10} />
                </a>
              ))}
            </div>
          </div>

          {queue.length > 1 && (
            <div className="flex gap-1.5 overflow-x-auto border-t border-border pt-2">
              {queue.slice(0, 5).map((q) => (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => setActiveId(q.id)}
                  className={`max-w-[140px] shrink-0 truncate rounded-lg border px-2 py-1 text-[10px] ${
                    q.id === active.id
                      ? "border-accent bg-elevated text-accent"
                      : "border-border text-fg-muted hover:text-fg"
                  }`}
                >
                  {q.title}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
