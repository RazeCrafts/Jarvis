export type AttachmentKind = "video" | "image" | "audio" | "text" | "document";

export interface PreparedAttachment {
  id: string;
  name: string;
  mimeType: string;
  kind: AttachmentKind;
  size: number;
  objectUrl?: string;
  duration?: number;
  dataBase64?: string;
  textContent?: string;
}

const VIDEO_EXT_RE = /\.(mp4|mov|mkv|webm|avi|m4v|flv|wmv|ts|3gp|ogv)$/i;
const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|svg|bmp|avif|heic|ico)$/i;
const AUDIO_EXT_RE = /\.(mp3|wav|ogg|m4a|flac|aac|opus|weba)$/i;
const TEXT_EXT_RE =
  /\.(txt|md|markdown|json|csv|tsv|xml|ya?ml|toml|ini|env|log|py|ts|tsx|js|jsx|mjs|cjs|html?|css|scss|sql|sh|bash|ps1|rs|go|java|c|cpp|h|hpp|rb|php)$/i;

export function classifyFileKind(name: string, mimeType: string): AttachmentKind {
  const mime = (mimeType || "").toLowerCase();
  if (mime.startsWith("video/") || VIDEO_EXT_RE.test(name)) return "video";
  if (mime.startsWith("image/") || IMAGE_EXT_RE.test(name)) return "image";
  if (mime.startsWith("audio/") || AUDIO_EXT_RE.test(name)) return "audio";
  if (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/xml" ||
    mime === "application/javascript" ||
    TEXT_EXT_RE.test(name)
  ) {
    return "text";
  }
  return "document";
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed reading file"));
    reader.readAsDataURL(file);
  });
}

function probeMediaDuration(url: string, tag: "video" | "audio"): Promise<number> {
  return new Promise((resolve) => {
    const el = document.createElement(tag);
    el.preload = "metadata";
    el.src = url;
    const done = (dur: number) => {
      el.onloadedmetadata = null;
      el.onerror = null;
      resolve(Number.isFinite(dur) && dur > 0 ? dur : tag === "video" ? 6 : 10);
    };
    el.onloadedmetadata = () => done(el.duration);
    el.onerror = () => done(tag === "video" ? 6 : 10);
  });
}

export async function prepareFileAttachment(file: File): Promise<PreparedAttachment> {
  const kind = classifyFileKind(file.name, file.type);
  const id = `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const mimeType =
    file.type ||
    (kind === "video"
      ? "video/mp4"
      : kind === "image"
        ? "image/png"
        : kind === "audio"
          ? "audio/mpeg"
          : kind === "text"
            ? "text/plain"
            : "application/pdf");

  if (kind === "video") {
    const objectUrl = URL.createObjectURL(file);
    const duration = await probeMediaDuration(objectUrl, "video");
    return { id, name: file.name, mimeType, kind, size: file.size, objectUrl, duration };
  }

  if (kind === "audio") {
    const objectUrl = URL.createObjectURL(file);
    const duration = await probeMediaDuration(objectUrl, "audio");
    let dataBase64: string | undefined;
    if (file.size <= 6 * 1024 * 1024) {
      const dataUrl = await readAsDataUrl(file).catch(() => "");
      dataBase64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : undefined;
    }
    return { id, name: file.name, mimeType, kind, size: file.size, objectUrl, duration, dataBase64 };
  }

  if (kind === "image") {
    const objectUrl = URL.createObjectURL(file);
    let dataBase64: string | undefined;
    if (file.size <= 6 * 1024 * 1024) {
      const dataUrl = await readAsDataUrl(file).catch(() => "");
      dataBase64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : undefined;
    }
    return { id, name: file.name, mimeType, kind, size: file.size, objectUrl, duration: 4, dataBase64 };
  }

  if (kind === "text") {
    const rawText = await file.text().catch(() => "");
    return {
      id,
      name: file.name,
      mimeType,
      kind,
      size: file.size,
      textContent: rawText.slice(0, 32000),
    };
  }

  // Generic binary documents (PDF, DOCX, etc.)
  let dataBase64: string | undefined;
  if (file.size <= 8 * 1024 * 1024) {
    const dataUrl = await readAsDataUrl(file).catch(() => "");
    dataBase64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : undefined;
  }
  return { id, name: file.name, mimeType, kind, size: file.size, dataBase64 };
}

/**
 * Sample real JPEG frames from a playable video or image source URL so AI Vision can inspect clip visuals.
 */
export async function extractMediaKeyframes(
  srcUrl: string,
  mediaType: "video" | "image" = "video",
  clipDuration = 5,
  samplesPerVideo = 2,
): Promise<Array<{ timestampSec: number; imageBase64: string }>> {
  if (!srcUrl || typeof document === "undefined") return [];

  if (mediaType === "image") {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = 480;
        c.height = 270;
        const ctx = c.getContext("2d");
        if (!ctx) return resolve([]);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve([{ timestampSec: 0, imageBase64: c.toDataURL("image/jpeg", 0.72) }]);
      };
      img.onerror = () => resolve([]);
      img.src = srcUrl;
    });
  }

  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = srcUrl;

    const frames: Array<{ timestampSec: number; imageBase64: string }> = [];
    const safeDur = Math.max(0.6, clipDuration);
    const points =
      samplesPerVideo <= 1
        ? [safeDur * 0.4]
        : [Math.min(0.4, safeDur * 0.15), Math.max(0.3, safeDur * 0.6)];

    let idx = 0;
    const cleanup = () => {
      video.onloadedmetadata = null;
      video.onseeked = null;
      video.onerror = null;
      video.src = "";
    };

    const timer = window.setTimeout(() => {
      cleanup();
      resolve(frames);
    }, 4500);

    const captureAt = (t: number) => {
      try {
        video.currentTime = Math.min(Math.max(0.05, t), Math.max(0.1, (video.duration || safeDur) - 0.05));
      } catch {
        window.clearTimeout(timer);
        cleanup();
        resolve(frames);
      }
    };

    video.onloadedmetadata = () => {
      captureAt(points[0]);
    };

    video.onseeked = () => {
      try {
        const c = document.createElement("canvas");
        c.width = 426;
        c.height = 240;
        const ctx = c.getContext("2d");
        if (ctx) {
          ctx.drawImage(video, 0, 0, c.width, c.height);
          frames.push({
            timestampSec: Number(video.currentTime.toFixed(2)),
            imageBase64: c.toDataURL("image/jpeg", 0.7),
          });
        }
      } catch {
        /* ignore canvas taint */
      }
      idx += 1;
      if (idx < points.length) {
        captureAt(points[idx]);
      } else {
        window.clearTimeout(timer);
        cleanup();
        resolve(frames);
      }
    };

    video.onerror = () => {
      window.clearTimeout(timer);
      cleanup();
      resolve(frames);
    };
  });
}
