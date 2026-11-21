export const FINISH_MS = 900;

const IMMEDIATE_BARGE_IN_RE =
  /^(?:stop|wait|hold on|quiet|silence|shut up|cancel|never\s?mind)[.!?]*$/i;

export function isImmediateBargeIn(text: string): boolean {
  return IMMEDIATE_BARGE_IN_RE.test(text.trim());
}

export function isMuteFlagActive(search?: string): boolean {
  const raw =
    typeof search === "string"
      ? search
      : typeof window !== "undefined"
        ? window.location.search
        : "";
  if (!raw) return false;
  try {
    const params = new URLSearchParams(raw.startsWith("?") ? raw : `?${raw}`);
    const val = (params.get("mute") || "").trim().toLowerCase();
    return val === "1" || val === "true" || val === "yes";
  } catch {
    return false;
  }
}

export interface VoiceBufferOptions {
  finishMs?: number;
  onDispatch: (utterance: string) => void;
  onBargeIn?: (command: string) => void;
}

/**
 * Accumulates speech recognition chunks across brief pauses (`FINISH_MS = 900`)
 * so mid-sentence hesitations send as a single clean utterance, while
 * immediate barge-in words ("stop", "wait") dispatch with zero delay.
 */
export class VoiceUtteranceBuffer {
  private readonly finishMs: number;
  private readonly onDispatch: (utterance: string) => void;
  private readonly onBargeIn?: (command: string) => void;
  private chunks: string[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: VoiceBufferOptions) {
    this.finishMs = options.finishMs ?? FINISH_MS;
    this.onDispatch = options.onDispatch;
    this.onBargeIn = options.onBargeIn;
  }

  push(text: string, isFinal = true): void {
    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean) return;

    if (isImmediateBargeIn(clean)) {
      this.clear();
      this.onBargeIn?.(clean);
      return;
    }

    if (!isFinal) {
      this.resetTimer();
      return;
    }

    const last = this.chunks[this.chunks.length - 1];
    if (!last || last.toLowerCase() !== clean.toLowerCase()) {
      this.chunks.push(clean);
    }
    this.resetTimer();
  }

  flush(): string {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const combined = this.chunks.join(" ").replace(/\s+/g, " ").trim();
    this.chunks = [];
    if (combined) {
      this.onDispatch(combined);
    }
    return combined;
  }

  clear(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.chunks = [];
  }

  pendingText(): string {
    return this.chunks.join(" ").trim();
  }

  private resetTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.flush();
    }, this.finishMs);
  }
}
