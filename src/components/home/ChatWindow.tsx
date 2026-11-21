import { useEffect, useMemo, useRef } from "react";
import { motion } from "framer-motion";
import { ExternalLink, Film, FolderOpen, Music, Play } from "lucide-react";
import Prism from "prismjs";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-python";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-json";
import "prismjs/components/prism-css";
import "prismjs/components/prism-markup";
import "prismjs/themes/prism-tomorrow.css";
import { agentApi } from "@/lib/agentApi";
import { cn } from "@/lib/cn";
import type { MediaLaunchBundle } from "@/lib/mediaIntent";
import { useAgentStore, useChatStore, useHudStore, usePlayerStore } from "@/store";
import type { ChatMessage } from "@/types";
import { LiveVisualRenderer } from "@/components/visuals/LiveVisualRenderer";

interface Segment {
  type: "text" | "code";
  lang?: string;
  text: string;
}

function parseSegments(content: string): Segment[] {
  const segments: Segment[] = [];
  const re = /```(\w*)\n?([\s\S]*?)(?:```|$)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content))) {
    if (match.index > last) {
      segments.push({ type: "text", text: content.slice(last, match.index) });
    }
    segments.push({ type: "code", lang: match[1] || undefined, text: match[2].replace(/\n$/, "") });
    last = re.lastIndex;
  }
  if (last < content.length) segments.push({ type: "text", text: content.slice(last) });
  return segments;
}

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const html = useMemo(() => {
    const grammar = (lang && (Prism.languages as Record<string, Prism.Grammar>)[lang]) || Prism.languages.clike;
    return Prism.highlight(code, grammar, lang ?? "clike");
  }, [code, lang]);

  return (
    <div className="jarvis-code my-2 overflow-hidden rounded-xl border border-border bg-[#0b101b] text-slate-100">
      <div className="flex items-center justify-between border-b border-slate-700/60 px-3 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-slate-400">{lang ?? "code"}</span>
        <button
          type="button"
          onClick={() => void navigator.clipboard?.writeText(code)}
          className="rounded px-1.5 py-0.5 text-[10px] text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
        >
          Copy
        </button>
      </div>
      <pre className="!bg-transparent overflow-x-auto p-3">
        <code className="!bg-transparent font-mono text-xs leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </div>
  );
}

function MediaCard({ media }: { media: MediaLaunchBundle }) {
  const openPlayerItem = usePlayerStore((s) => s.openItem);
  const localPickerRef = useRef<HTMLInputElement | null>(null);

  const playInSite = () => {
    openPlayerItem({
      id: media.id,
      title: media.title,
      kind: media.kind,
      source: media.localDataUrl ? "local" : "online",
      watchUrl: media.watchUrl,
      embedUrl: media.embedUrl,
      localSrc: media.localDataUrl,
      mimeType: media.mimeType,
      channel: media.channel,
      targets: media.targets,
    });
  };

  const handleLocalFile = (files: FileList | null) => {
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
      targets: media.targets,
    });
  };

  return (
    <div className="mt-2.5 space-y-2 rounded-xl border border-border bg-elevated/70 p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {media.kind === "song" ? (
            <Music size={14} className="shrink-0 text-accent" />
          ) : (
            <Film size={14} className="shrink-0 text-accent" />
          )}
          <div className="min-w-0">
            <p className="truncate font-semibold text-fg">{media.title}</p>
            <p className="font-mono text-[10px] text-fg-muted">
              {media.channel || "Online Search"} · {media.kind.toUpperCase()}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={playInSite}
            className="inline-flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1 text-[11px] font-medium text-background"
          >
            <Play size={11} /> Play on Site
          </button>
          <input
            ref={localPickerRef}
            type="file"
            accept="video/*,audio/*,.mp4,.mkv,.webm,.mp3,.wav,.flac,.m4a,.ogg"
            className="hidden"
            onChange={(e) => handleLocalFile(e.target.files)}
          />
          <button
            type="button"
            onClick={() => localPickerRef.current?.click()}
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1 text-[11px] text-fg hover:border-accent"
          >
            <FolderOpen size={11} /> Play Local File
          </button>
        </div>
      </div>

      {media.targets.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-border/70 pt-2">
          {media.targets.map((t) => (
            <a
              key={t.id}
              href={t.protocolUri || t.webUrl}
              target={t.protocolUri ? undefined : "_blank"}
              rel={t.protocolUri ? undefined : "noreferrer"}
              onClick={() => {
                if (t.bridgeAppName) void agentApi.launchApp(t.bridgeAppName).catch(() => undefined);
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-2 py-1 text-[11px] text-fg transition-colors hover:border-accent hover:text-accent"
            >
              {t.label} <ExternalLink size={10} />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function Bubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const segments = parseSegments(message.content);
  const time = new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  if (message.role === "system") {
    const isError = message.content.startsWith("⚠");
    return (
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex justify-center"
      >
        <span
          className={cn(
            "rounded-lg border px-3 py-1 text-[11px]",
            isError
              ? "border-red-500/40 bg-red-500/10 text-red-500 dark:text-red-300"
              : "border-border bg-elevated text-fg-muted",
          )}
        >
          {message.content}
        </span>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
      className={cn("group flex flex-col", isUser ? "items-end" : "items-start")}
    >
      <div
        className={cn(
          "hud-panel px-4 py-2.5 text-sm leading-relaxed text-fg",
          isUser ? "max-w-[78%] border-accent/40 bg-elevated" : "w-full max-w-[92%]",
        )}
      >
        {segments.map((seg, i) =>
          seg.type === "code" ? (
            <CodeBlock key={i} code={seg.text} lang={seg.lang} />
          ) : (
            <span key={i} className="whitespace-pre-wrap">
              {seg.text}
              {message.streaming && i === segments.length - 1 && <span className="streaming-cursor" />}
            </span>
          ),
        )}
        {message.streaming && segments.length === 0 && <span className="streaming-cursor" />}

        {message.visuals &&
          message.visuals.map((vis) => <LiveVisualRenderer key={vis.id} visual={vis} />)}

        {message.mediaCard && <MediaCard media={message.mediaCard} />}

        {message.citations && message.citations.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-2 border-t border-border pt-2 text-[11px] text-fg-muted">
            <span className="font-medium text-fg">Sources:</span>
            {message.citations.map((c, i) => (
              <a
                key={c.uri + i}
                href={c.uri}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-accent hover:underline"
              >
                {c.title.slice(0, 32)} <ExternalLink size={10} />
              </a>
            ))}
          </div>
        )}
      </div>
      <span className="mt-1 px-1 text-[10px] text-fg-muted opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        {time}
      </span>
    </motion.div>
  );
}

function ThinkingBubble() {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex items-start">
      <div className="hud-panel flex items-center gap-1.5 px-4 py-3">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent"
            style={{ animationDelay: `${i * 0.14}s` }}
          />
        ))}
      </div>
    </motion.div>
  );
}

function greeting(userTitle: string): string {
  const h = new Date().getHours();
  if (h < 5) return `Working late, ${userTitle}.`;
  if (h < 12) return `Good morning, ${userTitle}.`;
  if (h < 18) return `Good afternoon, ${userTitle}.`;
  return `Good evening, ${userTitle}.`;
}

export function ChatWindow({ onQuickPrompt }: { onQuickPrompt?: (prompt: string) => void }) {
  const messages = useChatStore((s) => s.messages);
  const isThinking = useAgentStore((s) => s.isThinking);
  const userTitle = useHudStore((s) => s.persona.userTitle || "Sir");
  const assistantName = useHudStore((s) => s.persona.assistantName || "JARVIS");
  const scrollRef = useRef<HTMLDivElement>(null);

  const lastContent = messages.length > 0 ? messages[messages.length - 1].content : "";

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, lastContent, isThinking]);

  if (messages.length === 0 && !isThinking) {
    const starters = [
      "Find Night of the Living Dead movie online and play it",
      "Play Blinding Lights on Spotify",
      "Explain quantum computing with a live comparison chart",
      "Build a 3D orbital satellite inside Workshop",
    ];
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-6 text-center">
        <div className="hud-panel max-w-xl px-6 py-4">
          <p className="font-display text-lg font-semibold tracking-tight text-fg">{greeting(userTitle)}</p>
          <p className="mt-1 text-xs text-fg-muted">
            {assistantName} systems nominal. Write and run code, orchestrate Hermes skills, play media, or inspect your screen.
          </p>
          {onQuickPrompt && (
            <div className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {starters.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => onQuickPrompt(prompt)}
                  className="hud-elevated px-3 py-2 text-left text-[11px] text-fg transition-colors hover:border-accent"
                >
                  {prompt}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        {messages.map((m) => (
          <Bubble key={m.id} message={m} />
        ))}
        {isThinking && <ThinkingBubble />}
      </div>
    </div>
  );
}
