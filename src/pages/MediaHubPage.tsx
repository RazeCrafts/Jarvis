import { useEffect, useRef, useState } from "react";
import { ExternalLink, Film, FolderOpen, Music, Play, Search } from "lucide-react";
import { agentApi } from "@/lib/agentApi";
import { buildDedicatedAppTargets, toEmbedUrl, type DedicatedAppTarget } from "@/lib/mediaIntent";
import { useLifeStore, usePlayerStore } from "@/store";
import { cn } from "@/lib/cn";

export default function MediaHubPage() {
  const mediaHistory = useLifeStore((s) => s.mediaHistory);
  const refreshDomain = useLifeStore((s) => s.refreshDomain);
  const openPlayerItem = usePlayerStore((s) => s.openItem);

  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"movie" | "video" | "music">("movie");
  const [searching, setSearching] = useState(false);
  const [activeEmbedUrl, setActiveEmbedUrl] = useState("");
  const [results, setResults] = useState<
    Array<{ title: string; channel: string; url: string; embedUrl?: string; snippet: string }>
  >([]);
  const [targets, setTargets] = useState<DedicatedAppTarget[]>([]);
  const [notice, setNotice] = useState("");
  const localFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void refreshDomain("media");
  }, [refreshDomain]);

  const handleSearch = async () => {
    const q = query.trim();
    if (!q || searching) return;
    setSearching(true);
    setNotice("");
    try {
      const res = await agentApi.searchMedia(q, kind);
      setResults(res.results || []);
      setTargets(
        res.targets && res.targets.length > 0
          ? (res.targets as DedicatedAppTarget[])
          : buildDedicatedAppTargets(q, kind === "music" ? "song" : kind, res.results?.[0]?.url),
      );
      const firstPlayable = res.results?.find((r) => Boolean(r.embedUrl)) ?? res.results?.[0];
      if (firstPlayable?.embedUrl) {
        setActiveEmbedUrl(firstPlayable.embedUrl);
      }
      await refreshDomain("media");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Media search failed.");
    } finally {
      setSearching(false);
    }
  };

  const playOnlineHere = (item: {
    id?: string;
    title: string;
    channel?: string;
    url: string;
    embedUrl?: string;
    kind?: "video" | "music";
  }) => {
    const resolvedEmbed = item.embedUrl || toEmbedUrl(item.url);
    if (resolvedEmbed) setActiveEmbedUrl(resolvedEmbed);
    openPlayerItem({
      id: item.id || `online-${Date.now()}`,
      title: item.title,
      kind: item.kind === "music" || kind === "music" ? "song" : kind === "movie" ? "movie" : "video",
      source: "online",
      watchUrl: item.url,
      embedUrl: resolvedEmbed,
      channel: item.channel,
      targets: targets.length > 0 ? targets : buildDedicatedAppTargets(item.title, "video", item.url),
    });
  };

  const handleLocalPick = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const f = files[0];
    const isAudio = f.type.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(f.name);
    openPlayerItem({
      id: `local-${f.name}-${Date.now()}`,
      title: f.name,
      kind: isAudio ? "audio" : "video",
      source: "local",
      localSrc: URL.createObjectURL(f),
      mimeType: f.type || (isAudio ? "audio/mpeg" : "video/mp4"),
    });
    setNotice(`Playing local file "${f.name}" in the dock player.`);
  };

  const fallbackTargets =
    targets.length > 0
      ? targets
      : buildDedicatedAppTargets(query.trim() || "featured music", kind === "music" ? "song" : kind);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
        <div>
          <h1 className="flex items-center gap-2 font-display text-base font-semibold text-fg">
            <Film size={16} className="text-accent" /> Online Movies &amp; Music Hub
          </h1>
          <p className="text-xs text-fg-muted">
            Find movies, videos, and music online, stream in-site, play local media files, or launch dedicated desktop/web apps.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <input
            ref={localFileRef}
            type="file"
            accept="video/*,audio/*,.mp4,.mkv,.webm,.mp3,.wav,.flac,.m4a,.ogg"
            className="hidden"
            onChange={(e) => handleLocalPick(e.target.files)}
          />
          <button
            type="button"
            onClick={() => localFileRef.current?.click()}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-elevated px-3 py-1.5 text-xs font-medium text-fg hover:border-accent"
          >
            <FolderOpen size={13} className="text-accent" /> Play Local Video / Song
          </button>
        </div>
      </div>

      {notice && (
        <div className="border-b border-border bg-elevated px-5 py-1.5 text-xs text-accent">
          {notice}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-5 lg:grid-cols-12">
        {/* Search & Stream Stage */}
        <section className="hud-panel flex flex-col gap-3 p-4 lg:col-span-7">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-lg border border-border bg-elevated p-0.5 text-xs">
              {(["movie", "video", "music"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={cn(
                    "rounded-md px-2.5 py-1 font-medium capitalize transition-colors",
                    kind === k ? "bg-accent text-background" : "text-fg-muted hover:text-fg",
                  )}
                >
                  {k === "music" ? "Song / Music" : k}
                </button>
              ))}
            </div>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSearch();
              }}
              placeholder="Search movie, song, live concert, or documentary..."
              className="min-w-44 flex-1 rounded-lg border border-border bg-elevated px-3 py-1.5 text-xs text-fg outline-none focus:border-accent"
            />
            <button
              type="button"
              disabled={searching || !query.trim()}
              onClick={() => void handleSearch()}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-xs font-medium text-background disabled:opacity-40"
            >
              <Search size={13} /> {searching ? "Searching…" : "Find Media"}
            </button>
          </div>

          {activeEmbedUrl ? (
            <div className="aspect-video w-full overflow-hidden rounded-xl border border-border bg-black">
              <iframe
                src={activeEmbedUrl}
                title="Online Media Stream"
                className="h-full w-full"
                allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
              />
            </div>
          ) : (
            <div className="flex aspect-video w-full flex-col items-center justify-center rounded-xl border border-border bg-elevated/40 p-6 text-center">
              <Music size={28} className="mb-2 text-accent/70" />
              <p className="text-sm font-medium text-fg">In-Site Playback &amp; Streaming Stage</p>
              <p className="mt-1 max-w-md text-xs text-fg-muted">
                Search for any movie or song above—or ask JARVIS directly in Command HUD—to stream right here or open in Spotify, YouTube Music, Netflix, Stremio, or VLC Desktop.
              </p>
            </div>
          )}

          {results.length > 0 && (
            <div className="space-y-1.5 border-t border-border pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                Search Results
              </p>
              {results.map((r) => (
                <div key={r.url} className="hud-elevated flex items-center justify-between gap-3 px-3 py-2 text-xs">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-fg">{r.title}</p>
                    <p className="font-mono text-[10px] text-fg-muted">{r.channel}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => playOnlineHere(r)}
                      className="inline-flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1 text-[11px] font-medium text-background"
                    >
                      <Play size={11} /> Play Here
                    </button>
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg border border-border bg-surface p-1.5 text-fg-muted hover:border-accent hover:text-fg"
                      title="Open Source URL"
                    >
                      <ExternalLink size={12} />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Dedicated App Launchers + Recent History */}
        <section className="flex flex-col gap-4 lg:col-span-5">
          <div className="hud-panel space-y-2.5 p-4">
            <h2 className="font-display text-sm font-semibold text-fg">Dedicated Apps &amp; Streaming Portals</h2>
            <p className="text-xs text-fg-muted">
              Open the current title directly inside its native desktop app or official web player.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {fallbackTargets.map((t) => (
                <a
                  key={t.id}
                  href={t.protocolUri || t.webUrl}
                  target={t.protocolUri ? undefined : "_blank"}
                  rel={t.protocolUri ? undefined : "noreferrer"}
                  onClick={() => {
                    if (t.bridgeAppName) void agentApi.launchApp(t.bridgeAppName).catch(() => undefined);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-border bg-elevated px-2.5 py-1.5 text-xs text-fg transition-colors hover:border-accent hover:text-accent"
                >
                  {t.label} <ExternalLink size={11} />
                </a>
              ))}
            </div>
          </div>

          <div className="hud-panel flex-1 space-y-2.5 p-4">
            <h2 className="font-display text-sm font-semibold text-fg">Recent Media History ({mediaHistory.length})</h2>
            {mediaHistory.length === 0 ? (
              <p className="text-xs text-fg-muted">No recent online movies or tracks played yet.</p>
            ) : (
              <div className="space-y-1.5">
                {mediaHistory.map((m) => (
                  <div
                    key={m.id}
                    className="hud-elevated flex items-center justify-between gap-2 px-3 py-2 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-fg">{m.title}</p>
                      <p className="font-mono text-[10px] text-fg-muted">
                        {m.channel} · {m.kind.toUpperCase()}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => playOnlineHere(m)}
                        className="rounded-lg bg-accent px-2.5 py-1 text-[11px] font-medium text-background"
                      >
                        Play
                      </button>
                      <a
                        href={m.url}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded border border-border p-1 text-fg-muted hover:text-fg"
                      >
                        <ExternalLink size={11} />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
