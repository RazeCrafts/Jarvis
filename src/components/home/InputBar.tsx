import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp, Loader2, Mic } from "lucide-react";
import { cn } from "@/lib/cn";
import { useAgentStore, useChatStore } from "@/store";
import { toggleMic as toggleVoiceMic } from "@/lib/voiceController";
import { ModelPicker } from "@/components/home/ModelPicker";
import { agentApi } from "@/lib/agentApi";

const MODEL_KEY = "jarvis-chat-model";
const MODEL_PROVIDER_KEY = "jarvis-chat-model-provider";

function loadChatModel(): string {
  try {
    return localStorage.getItem(MODEL_KEY) ?? "";
  } catch {
    return "";
  }
}

function ConnectionDot() {
  const isConnected = useAgentStore((s) => s.isConnected);
  return (
    <span
      role="status"
      aria-label={isConnected ? "Backend connected" : "Backend offline"}
      title={isConnected ? "Backend connected" : "Backend offline — start the JARVIS backend"}
      className={cn(
        "absolute -top-0.5 right-1 h-1.5 w-1.5 rounded-full",
        isConnected
          ? "bg-emerald-400 shadow-[0_0_6px_rgb(52_211_153/0.8)]"
          : "bg-fg-muted/40",
      )}
    />
  );
}

interface Props {
  onSend: (text: string, model?: string) => void;
}

/**
 * Pill-shaped composer: send button, auto-growing input, mic toggle, and the
 * model picker. Enter sends, Shift+Enter inserts a newline. While listening,
 * the interim transcript is shown in the placeholder and the mic pulses red.
 */
export function InputBar({ onSend }: Props) {
  const [value, setValue] = useState("");
  const [model, setModel] = useState<string>(loadChatModel);
  const [provider, setProvider] = useState("");
  const isListening = useChatStore((s) => s.isListening);
  const isThinking = useAgentStore((s) => s.isThinking);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // A per-message override saved while another provider was active would be
  // sent to the wrong API (OpenRouter slug → NVIDIA NIM). Clear it on a
  // provider change and remember which provider the choice belongs to.
  useEffect(() => {
    agentApi
      .getSettings()
      .then((settings) => {
        const active = settings.provider || "openrouter";
        setProvider(active);
        let stored: string | null = null;
        try {
          stored = localStorage.getItem(MODEL_PROVIDER_KEY);
        } catch {
          /* ignore */
        }
        if (stored !== active) {
          try {
            localStorage.removeItem(MODEL_KEY);
            localStorage.setItem(MODEL_PROVIDER_KEY, active);
          } catch {
            /* ignore */
          }
          setModel("");
        }
      })
      .catch(() => {
        /* backend offline: keep the current selection */
      });
  }, []);

  const canSend = value.trim().length > 0 && !isThinking;

  const changeModel = (next: string) => {
    setModel(next);
    try {
      if (next) {
        localStorage.setItem(MODEL_KEY, next);
        localStorage.setItem(MODEL_PROVIDER_KEY, provider || "openrouter");
      } else {
        localStorage.removeItem(MODEL_KEY);
      }
    } catch {
      /* localStorage unavailable — selection stays session-only */
    }
  };

  const submit = () => {
    if (!canSend) return;
    onSend(value, model || undefined);
    setValue("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const handleMic = () => {
    void toggleVoiceMic("manual");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="absolute inset-x-0 bottom-0 z-20 px-6 pb-5">
      <div
        className={cn(
          "glass relative mx-auto flex max-w-2xl items-end gap-1.5 rounded-full py-1.5 pl-2 pr-2 transition-shadow",
          "focus-within:shadow-[0_0_24px_rgb(0_212_255/0.12)]",
        )}
      >
        <ConnectionDot />
        <button
          type="button"
          onClick={submit}
          disabled={!canSend}
          aria-label="Send message"
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all",
            canSend
              ? "bg-accent/15 text-accent hover:bg-accent/25 hover:shadow-[0_0_14px_rgb(0_212_255/0.4)]"
              : "text-fg-muted/50",
          )}
        >
          {isThinking ? (
            <Loader2 size={17} className="animate-spin" />
          ) : (
            <ArrowUp size={17} strokeWidth={2.2} />
          )}
        </button>

        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 112)}px`;
          }}
          onKeyDown={onKeyDown}
          placeholder={isListening ? "Listening…" : "Ask JARVIS anything…"}
          aria-label="Message JARVIS"
          className="max-h-28 flex-1 resize-none bg-transparent px-1 py-1.5 text-sm text-fg outline-none placeholder:text-fg-muted"
        />

        <ModelPicker value={model} onChange={changeModel} />

        <button
          type="button"
          onClick={handleMic}
          aria-label={isListening ? "Stop listening" : "Start voice input"}
          aria-pressed={isListening}
          title={isListening ? "Stop listening" : "Voice input (backend microphone)"}
          className={cn(
            "relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all",
            isListening
              ? "bg-red-500/20 text-red-400 ring-1 ring-red-500/50"
              : "text-fg-muted hover:bg-white/5 hover:text-fg",
          )}
        >
          <Mic size={17} strokeWidth={1.8} className={cn(isListening && "animate-pulse")} />
          {isListening && (
            <span className="absolute inset-0 animate-ping rounded-full bg-red-500/20" />
          )}
        </button>
      </div>
    </div>
  );
}
