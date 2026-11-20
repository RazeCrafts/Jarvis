import { useEffect, useMemo, useRef } from "react";
import { motion } from "framer-motion";
import Prism from "prismjs";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-python";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-json";
import "prismjs/components/prism-css";
import "prismjs/components/prism-markup";
import "prismjs/themes/prism-tomorrow.css";
import { cn } from "@/lib/cn";
import { useAgentStore, useChatStore } from "@/store";
import type { ChatMessage } from "@/types";

/* ---------- content parsing: text + fenced code ---------- */

interface Segment {
  type: "text" | "code";
  lang?: string;
  text: string;
}

/** Split message content into text and ```fenced``` segments. Unterminated
 * fences (still streaming) render as code so they build up live. */
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
    <div className="jarvis-code my-2 overflow-hidden rounded-xl border border-white/10 bg-black/40">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">{lang ?? "code"}</span>
        <button
          type="button"
          onClick={() => void navigator.clipboard?.writeText(code)}
          className="rounded px-1.5 py-0.5 text-[10px] text-fg-muted transition-colors hover:bg-white/5 hover:text-fg"
        >
          Copy
        </button>
      </div>
      <pre className="overflow-x-auto p-3 !bg-transparent">
        <code className="!bg-transparent font-mono text-xs leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </div>
  );
}

/* ---------- bubbles ---------- */

function Bubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const segments = parseSegments(message.content);
  const time = new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  // System events (tool calls, notices, errors) render as subtle centered chips.
  if (message.role === "system") {
    const isError = message.content.startsWith("⚠");
    const isApproval = message.content.startsWith("✓") || message.content.startsWith("✗");
    return (
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex justify-center"
      >
        <span
          className={cn(
            "rounded-full border px-3 py-1 text-[11px] tracking-wide",
            isError
              ? "border-red-400/30 bg-red-400/10 text-red-300"
              : isApproval
                ? "border-white/10 bg-white/[0.04] text-fg-muted"
                : "border-accent/25 bg-accent/[0.07] text-accent/90",
          )}
        >
          {message.content}
        </span>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className={cn("group flex flex-col", isUser ? "items-end" : "items-start")}
    >
      <div
        className={cn(
          "max-w-[78%] px-4 py-2.5 text-sm leading-relaxed",
          "glass rounded-2xl",
          isUser ? "rounded-br-md border-accent/30 shadow-[0_0_18px_rgb(0_212_255/0.08)]" : "rounded-bl-md",
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
      </div>
      <span
        className={cn(
          "mt-1 px-1 text-[10px] text-fg-muted opacity-0 transition-opacity duration-200 group-hover:opacity-100",
        )}
      >
        {time}
      </span>
    </motion.div>
  );
}

function ThinkingBubble() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-start"
    >
      <div className="glass flex items-center gap-1.5 rounded-2xl rounded-bl-md px-4 py-3">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent"
            style={{ animationDelay: `${i * 0.15}s`, boxShadow: "0 0 6px rgb(0 212 255 / 0.7)" }}
          />
        ))}
      </div>
    </motion.div>
  );
}

/* ---------- window ---------- */

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Working late, sir.";
  if (h < 12) return "Good morning, sir.";
  if (h < 18) return "Good afternoon, sir.";
  return "Good evening, sir.";
}

export function ChatWindow() {
  const messages = useChatStore((s) => s.messages);
  const isThinking = useAgentStore((s) => s.isThinking);
  const scrollRef = useRef<HTMLDivElement>(null);

  const lastContent = messages.length > 0 ? messages[messages.length - 1].content : "";

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, lastContent, isThinking]);

  if (messages.length === 0 && !isThinking) {
    return (
      <div className="absolute inset-x-0 bottom-24 top-0 z-10 flex flex-col items-center justify-end pb-10 text-center">
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.4 }}
          className="glass rounded-2xl px-5 py-3 shadow-[0_4px_24px_rgb(0_0_0/0.35)]"
        >
          <p className="text-lg font-light tracking-wide text-fg/90">{greeting()}</p>
          <p className="mt-1 text-xs text-fg-muted">All systems online. Type below, or tap the mic and speak.</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="absolute inset-0 z-10 overflow-y-auto px-6 pb-32 pt-6 [mask-image:linear-gradient(to_bottom,transparent,black_32px)]"
    >
      <div className="mx-auto flex max-w-2xl flex-col gap-3">
        {messages.map((m) => (
          <Bubble key={m.id} message={m} />
        ))}
        {isThinking && <ThinkingBubble />}
      </div>
    </div>
  );
}
