export type MediaKind = "movie" | "song" | "video";

export type DedicatedAppId =
  | "spotify"
  | "youtube_music"
  | "apple_music"
  | "youtube"
  | "netflix"
  | "prime_video"
  | "disney_plus"
  | "stremio"
  | "archive"
  | "justwatch"
  | "vlc_desktop";

export interface DedicatedAppTarget {
  id: DedicatedAppId;
  label: string;
  category: "music" | "movie" | "video" | "desktop";
  webUrl: string;
  protocolUri?: string;
  bridgeAppName?: string;
}

export interface MediaPlayIntent {
  query: string;
  kind: MediaKind;
  playInSite: boolean;
  playLocal: boolean;
  preferredApp?: DedicatedAppId;
}

export interface MediaSearchCandidate {
  title: string;
  channel: string;
  url: string;
  embedUrl?: string;
  snippet?: string;
}

export interface MediaLaunchBundle {
  id: string;
  query: string;
  title: string;
  kind: MediaKind;
  channel?: string;
  watchUrl: string;
  embedUrl?: string;
  localDataUrl?: string;
  mimeType?: string;
  playableInSite: boolean;
  preferredApp?: DedicatedAppId;
  targets: DedicatedAppTarget[];
  alternates: MediaSearchCandidate[];
}

export function isDirectMediaUrl(url: string): boolean {
  return /\.(mp4|webm|mov|m4v|mp3|wav|ogg|m4a|flac|aac)(?:$|\?)/i.test(url.trim()) || url.startsWith("blob:") || url.startsWith("data:video/") || url.startsWith("data:audio/");
}

export function toEmbedUrl(rawUrl: string): string | undefined {
  const url = (rawUrl || "").trim();
  if (!url) return undefined;

  const ytMatch = url.match(/(?:youtube\.com\/(?:watch\?.*?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (ytMatch) {
    return `https://www.youtube.com/embed/${ytMatch[1]}?autoplay=1&rel=0`;
  }

  const archiveMatch = url.match(/archive\.org\/(?:details|embed)\/([a-zA-Z0-9._-]+)/i);
  if (archiveMatch) {
    return `https://archive.org/embed/${archiveMatch[1]}`;
  }

  const vimeoMatch = url.match(/vimeo\.com\/(?:video\/)?(\d{5,12})/);
  if (vimeoMatch) {
    return `https://player.vimeo.com/video/${vimeoMatch[1]}?autoplay=1`;
  }

  const spotifyMatch = url.match(/open\.spotify\.com\/(track|album|playlist|episode)\/([a-zA-Z0-9]+)/i);
  if (spotifyMatch) {
    return `https://open.spotify.com/embed/${spotifyMatch[1].toLowerCase()}/${spotifyMatch[2]}`;
  }

  return undefined;
}

export function detectPreferredApp(text: string): DedicatedAppId | undefined {
  const lower = text.toLowerCase();
  if (/\b(youtube\s+music|yt\s+music)\b/.test(lower)) return "youtube_music";
  if (/\bapple\s+music\b/.test(lower)) return "apple_music";
  if (/\bspotify\b/.test(lower)) return "spotify";
  if (/\bnetflix\b/.test(lower)) return "netflix";
  if (/\b(prime\s+video|amazon\s+prime)\b/.test(lower)) return "prime_video";
  if (/\bdisney\+?\b/.test(lower)) return "disney_plus";
  if (/\bstremio\b/.test(lower)) return "stremio";
  if (/\b(internet\s+archive|archive\.org)\b/.test(lower)) return "archive";
  if (/\bjustwatch\b/.test(lower)) return "justwatch";
  if (/\bvlc\b/.test(lower)) return "vlc_desktop";
  if (/\byoutube\b/.test(lower)) return "youtube";
  return undefined;
}

export function parseMediaPlayCommand(text: string): MediaPlayIntent | null {
  const clean = text.trim().replace(/\s+/g, " ");
  if (!clean) return null;
  const lower = clean.toLowerCase();

  // Defer explicit TV commands and Video Studio timeline editing commands
  if (/\b(on\s+(?:my\s+|the\s+)?(?:lg\s+)?tv|lg\s+tv|television)\b/.test(lower)) return null;
  if (/\b(video\s+studio|timeline|trim|ken\s+burns|montage|beat\s+sync)\b/.test(lower)) return null;

  const hasVerb =
    /^(?:play|listen\s+to|watch|stream|find(?:\s+me)?|search(?:\s+for)?|open|put\s+on)\b/i.test(clean) ||
    /\b(?:find\s+.+\s+and\s+play|play\s+.+\s+(?:song|movie|music|track|film|video)|play\s+.+\s+(?:locally|from\s+this\s+site|on\s+this\s+site|on\s+(?:spotify|youtube|netflix|apple\s+music|stremio|vlc)))\b/i.test(
      clean,
    );
  if (!hasVerb) return null;

  // Reject pure navigation commands like "open workshop", "open galaxy", "open settings"
  if (/^(?:open|show|go\s+to|switch\s+to)\s+(?:the\s+)?(?:hud|command\s+hud|workshop|workspace|galaxy|file\s+galaxy|brain|video\s+studio|smart\s+home|memory|calendar|notes|timers|reminders|stopwatch|plugins|skills|models|bridge|settings|customize|themes)[.!]?$/i.test(clean)) {
    return null;
  }

  const preferredApp = detectPreferredApp(clean);
  const playLocal = /\b(locally|local\s+file|from\s+(?:my\s+)?files?|on\s+my\s+pc|saved\s+file)\b/i.test(clean);
  const playInSite =
    /\b(from\s+this\s+site|on\s+this\s+site|right\s+here|in\s+jarvis|embed(?:ded)?)\b/i.test(clean) ||
    (!preferredApp && !playLocal);

  let kind: MediaKind = "video";
  if (
    /\b(movie|film|cinema|watch|netflix|prime\s+video|disney|stremio|justwatch|full\s+movie|trailer)\b/i.test(
      clean,
    )
  ) {
    kind = "movie";
  } else if (
    /\b(song|music|track|album|artist|listen|spotify|apple\s+music|youtube\s+music|lo-?fi|beats?|playlist)\b/i.test(
      clean,
    )
  ) {
    kind = "song";
  }

  // Require clear media cue when verb is generic ("find", "open", "search")
  if (
    /^(?:find|search|open)\b/i.test(clean) &&
    kind === "video" &&
    !/\b(video|youtube|vlc|play|watch|stream)\b/i.test(clean)
  ) {
    return null;
  }

  let query = clean
    .replace(/^(?:please\s+|jarvis\s+)?(?:find(?:\s+me)?|search(?:\s+for)?|play|watch|stream|listen\s+to|put\s+on|open)\s+/i, "")
    .replace(/\b(?:and\s+)?(?:play|watch|stream)\s+it\b/gi, "")
    .replace(/\b(?:from|on|in)\s+this\s+site\b/gi, "")
    .replace(/\b(?:on|in|via|using|with)\s+(?:spotify|youtube\s+music|apple\s+music|youtube|netflix|prime\s+video|amazon\s+prime|disney\+?|stremio|internet\s+archive|justwatch|vlc(?:\s+media\s+player)?)\b/gi, "")
    .replace(/\b(?:locally|online|right\s+here|for\s+me)\b/gi, "")
    .replace(/\b(?:the\s+movie|a\s+movie|movie|film|the\s+song|a\s+song|song|track|music\s+video)\b/gi, "")
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!query) query = clean;

  return {
    query,
    kind,
    playInSite,
    playLocal,
    preferredApp,
  };
}

export function buildDedicatedAppTargets(
  query: string,
  kind: MediaKind,
  directMediaUrl?: string,
): DedicatedAppTarget[] {
  const q = encodeURIComponent(query.trim() || "music");

  const musicTargets: DedicatedAppTarget[] = [
    {
      id: "spotify",
      label: "Open in Spotify",
      category: "music",
      webUrl: `https://open.spotify.com/search/${q}`,
      protocolUri: `spotify:search:${q}`,
      bridgeAppName: "spotify",
    },
    {
      id: "youtube_music",
      label: "YouTube Music",
      category: "music",
      webUrl: `https://music.youtube.com/search?q=${q}`,
    },
    {
      id: "apple_music",
      label: "Apple Music",
      category: "music",
      webUrl: `https://music.apple.com/us/search?term=${q}`,
    },
    {
      id: "youtube",
      label: "YouTube",
      category: "video",
      webUrl: `https://www.youtube.com/results?search_query=${q}`,
    },
  ];

  const movieTargets: DedicatedAppTarget[] = [
    {
      id: "archive",
      label: "Archive.org Movies",
      category: "movie",
      webUrl: `https://archive.org/search?query=${q}&and[]=mediatype:movies`,
    },
    {
      id: "justwatch",
      label: "JustWatch (Where to Stream)",
      category: "movie",
      webUrl: `https://www.justwatch.com/us/search?q=${q}`,
    },
    {
      id: "netflix",
      label: "Netflix",
      category: "movie",
      webUrl: `https://www.netflix.com/search?q=${q}`,
    },
    {
      id: "prime_video",
      label: "Prime Video",
      category: "movie",
      webUrl: `https://www.amazon.com/s?k=${q}&i=instant-video`,
    },
    {
      id: "stremio",
      label: "Open Stremio",
      category: "movie",
      webUrl: `https://web.stremio.com/#/search?search=${q}`,
      protocolUri: `stremio://search?search=${q}`,
    },
    {
      id: "youtube",
      label: "YouTube",
      category: "video",
      webUrl: `https://www.youtube.com/results?search_query=${q}`,
    },
  ];

  const vlcTarget: DedicatedAppTarget = {
    id: "vlc_desktop",
    label: "VLC Desktop App",
    category: "desktop",
    webUrl: directMediaUrl || `https://www.youtube.com/results?search_query=${q}`,
    protocolUri: directMediaUrl ? `vlc://${directMediaUrl}` : undefined,
    bridgeAppName: "vlc",
  };

  if (kind === "song") {
    return [...musicTargets, vlcTarget];
  }
  if (kind === "movie") {
    return [...movieTargets, vlcTarget];
  }
  return [
    {
      id: "youtube",
      label: "YouTube",
      category: "video",
      webUrl: `https://www.youtube.com/results?search_query=${q}`,
    },
    ...movieTargets.filter((t) => t.id === "archive" || t.id === "justwatch"),
    musicTargets[0],
    vlcTarget,
  ];
}
