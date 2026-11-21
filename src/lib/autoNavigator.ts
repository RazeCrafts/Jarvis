import type { TabId } from "@/types";
import type { MotionPreset, VideoClip } from "@/lib/videoTimeline";

export interface VideoEditDirective {
  filterPreset?: VideoClip["filterPreset"];
  motionPreset?: MotionPreset;
  speed?: number;
  overlayText?: string;
  trimStartDelta?: number;
  autoMontage?: boolean;
}

export interface DetectedIntent {
  tab?: TabId;
  videoEdit?: VideoEditDirective;
  artCraftApp?: "designcraft" | "photocraft" | "vectorcraft" | "lightcraft";
}

const TAB_PATTERNS: Array<{ tab: TabId; re: RegExp }> = [
  { tab: "video", re: /\b(video\s+(?:editing\s+)?studio|video\s+editor|edit(?:ing)?\s+(?:a\s+|the\s+|my\s+|these\s+)?(?:video|videos|clips?|footage|montage))\b/i },
  { tab: "galaxy", re: /\b(file\s+galaxy|knowledge\s+galaxy|galaxy|brain\s+graph|vault)\b/i },
  { tab: "workspace", re: /\b(workshop|3d\s+(?:studio|printer|bench)|artifact\s+studio)\b/i },
  { tab: "media", re: /\b(media\s+hub|movies?\s+and\s+music|music\s+hub|video\s+search|play\s+online)\b/i },
  { tab: "tasks", re: /\b(daily\s+tasks?|routines?|scheduled\s+jobs?|cron\s+jobs?)\b/i },
  { tab: "memory", re: /\b(memory\s+wiki|memories|calendar|schedule|notebook|notes|timers?|stopwatch|wb\s+remind(?:er)?s?)\b/i },
  { tab: "skills", re: /\b(skills?|plugins?|marketplace|mcp\s+servers?|toolsets?)\b/i },
  { tab: "providers", re: /\b(models?|providers?|desktop\s+bridge|messaging\s+bridge|gateway)\b/i },
  { tab: "settings", re: /\b(settings?|themes?|customize|layout\s+preferences?|connectors?|permissions?|keybinds?)\b/i },
  { tab: "home", re: /\b(command\s+hud|home\s+tab|main\s+hud)\b/i },
];

export function extractVideoEditDirective(message: string): VideoEditDirective | undefined {
  const q = message.toLowerCase();
  const hasVideoContext =
    /\b(clip|clips|video|footage|montage|reel|timeline|cut|noir|cinematic|vivid|zoom|speed|caption|title)\b/i.test(
      q,
    );
  if (!hasVideoContext) return undefined;

  const directive: VideoEditDirective = {};
  if (/\b(noir|black\s+and\s+white|b&w|monochrome)\b/.test(q)) {
    directive.filterPreset = "noir";
  } else if (/\b(cinematic|dramatic|film|stark)\b/.test(q)) {
    directive.filterPreset = "cinematic";
  } else if (/\b(vivid|vibrant|pop|punchy)\b/.test(q)) {
    directive.filterPreset = "vivid";
  } else if (/\b(warm|golden|vintage)\b/.test(q)) {
    directive.filterPreset = "warm";
  } else if (/\b(cool|blue|orbital)\b/.test(q)) {
    directive.filterPreset = "cool";
  }

  if (/\b(zoom\s*out|pull\s*back)\b/.test(q)) {
    directive.motionPreset = "zoom-out";
  } else if (/\b(pan\s*left)\b/.test(q)) {
    directive.motionPreset = "pan-left";
  } else if (/\b(pan\s*right)\b/.test(q)) {
    directive.motionPreset = "pan-right";
  } else if (/\b(zoom|ken\s*burns|dynamic|montage)\b/.test(q)) {
    directive.motionPreset = "zoom-in";
  }

  if (/\b(fast|speed\s*up|1\.5x|quick)\b/.test(q)) {
    directive.speed = 1.5;
  } else if (/\b(2x|double\s*speed|hyperlapse)\b/.test(q)) {
    directive.speed = 2;
  } else if (/\b(slow|slow\s*mo|0\.5x)\b/.test(q)) {
    directive.speed = 0.5;
  }

  const titleMatch = message.match(/(?:title|caption|text)\s*(?:card)?\s*(?:saying|to|:)?\s*["']([^"']{2,60})["']/i);
  if (titleMatch) {
    directive.overlayText = titleMatch[1].trim();
  }

  if (/\b(trim|tighten|cut|montage|edit)\b/.test(q)) {
    directive.trimStartDelta = 0.25;
    directive.autoMontage = true;
  }

  return Object.keys(directive).length > 0 ? directive : undefined;
}

export function detectNaturalNavigationIntent(
  message: string,
  hasAttachedClips = false,
): DetectedIntent {
  const clean = message.trim();
  if (!clean && !hasAttachedClips) return {};

  const result: DetectedIntent = {};

  if (hasAttachedClips) {
    result.tab = "video";
    result.videoEdit = extractVideoEditDirective(clean) || {
      filterPreset: "cinematic",
      motionPreset: "zoom-in",
      autoMontage: true,
    };
    return result;
  }

  const lower = clean.toLowerCase();

  // ArtCraft MCP detection
  if (/\b(designcraft|photocraft|vectorcraft|lightcraft|artcraft)\b/i.test(lower)) {
    if (lower.includes("photocraft")) result.artCraftApp = "photocraft";
    else if (lower.includes("vectorcraft")) result.artCraftApp = "vectorcraft";
    else if (lower.includes("lightcraft")) result.artCraftApp = "lightcraft";
    else result.artCraftApp = "designcraft";
  }

  const wantsTabSwitch =
    /\b(open|go\s+to|take\s+me\s+to|switch\s+to|show\s+me|navigate\s+to|head\s+to|launch|edit)\b/i.test(
      lower,
    );

  if (wantsTabSwitch) {
    for (const entry of TAB_PATTERNS) {
      if (entry.re.test(lower)) {
        result.tab = entry.tab;
        break;
      }
    }
  }

  if (result.tab === "video") {
    result.videoEdit = extractVideoEditDirective(clean);
  }

  return result;
}
