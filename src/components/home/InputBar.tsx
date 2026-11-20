import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { ArrowUp, Eye, Film, Loader2, Mic, ScanSearch, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useAgentStore, useChatStore, useHudStore, useUiStore, useVideoStore } from "@/store";
import { toggleMic as toggleVoiceMic } from "@/lib/voiceController";
import { ModelPicker } from "@/components/home/ModelPicker";
import { ScreenVisionBar } from "@/components/vision/ScreenVisionBar";
import { agentApi } from "@/lib/agentApi";
import { createDefaultClip, type VideoClip } from "@/lib/videoTimeline";
import { detectNaturalNavigationIntent } from "@/lib/autoNavigator";

const MODEL_KEY = "jarvis-chat-model";
const MODEL_PROVIDER_KEY = "jarvis-chat-model-provider";

function loadChatModel(): string {
  try {
    return localStorage.getItem(MODEL_KEY) ?? "";
  } catch {
    return "";
  }
}

interface AttachedClipDraft {
  id: string;
  name: string;
  url: string;
  duration: number;
}

interface Props {
  onSend: (text: string, model?: string) => void;
}

export function InputBar({ onSend }: Props) {
  const [value, setValue] = useState("");
  const [model, setModel] = useState<string>(loadChatModel);
  const [provider, setProvider] = useState("");
  const [showVision, setShowVision] = useState(false);
  const [attachedClips, setAttachedClips] = useState<AttachedClipDraft[]>([]);

  const isListening = useChatStore((s) => s.isListening);
  const isThinking = useAgentStore((s) => s.isThinking);
  const autoSwitchTabs = useHudStore((s) => s.autoSwitchTabs);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const setCircleToSearchOpen = useUiStore((s) => s.setCircleToSearchOpen);
  const addVideoClips = useVideoStore((s) => s.addClips);
  const applyAutoEditDirective = useVideoStore((s) => s.applyAutoEditDirective);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const clipInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    agentApi
      .getSettings()
      .then((settings) => {
        const active = settings.provider || "gemini-builtin";
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
        /* offline tolerance */
      });
  }, []);

  const canSend = (value.trim().length > 0 || attachedClips.length > 0) && !isThinking;

  const changeModel = (next: string) => {
    setModel(next);
    try {
      if (next) {
        localStorage.setItem(MODEL_KEY, next);
        localStorage.setItem(MODEL_PROVIDER_KEY, provider || "gemini-builtin");
      } else {
        localStorage.removeItem(MODEL_KEY);
      }
    } catch {
      /* ignore */
    }
  };

  const handleClipAttach = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    files.forEach((file) => {
      const url = URL.createObjectURL(file);
      const id = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const probe = document.createElement("video");
      probe.src = url;
      probe.onloadedmetadata = () => {
        setAttachedClips((prev) => [
          ...prev,
          {
            id,
            name: file.name,
            url,
            duration: Number.isFinite(probe.duration) && probe.duration > 0 ? probe.duration : 8,
          },
        ]);
      };
      probe.onerror = () => {
        setAttachedClips((prev) => [...prev, { id, name: file.name, url, duration: 8 }]);
      };
    });

    e.target.value = "";
  };

  const submit = () => {
    if (!canSend) return;
    const text = value.trim();

    if (attachedClips.length > 0) {
      const created: VideoClip[] = attachedClips.map((c) =>
        createDefaultClip({ name: c.name, src: c.url, duration: c.duration }),
      );
      addVideoClips(created);
      const intent = detectNaturalNavigationIntent(text, true);
      if (intent.videoEdit) {
        applyAutoEditDirective(intent.videoEdit);
      }
      if (autoSwitchTabs) {
        setActiveTab("video");
      }
      const clipNames = attachedClips.map((c) => c.name).join(", ");
      const outgoing = text
        ? `${text} [Clips loaded into Video Studio: ${clipNames}]`
        : `Edit these attached clips in Video Studio and build a dynamic montage: ${clipNames}`;
      onSend(outgoing, model || undefined);
      setAttachedClips([]);
      setValue("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      return;
    }

    onSend(value, model || undefined);
    setValue("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="shrink-0 px-5 pb-4 pt-2">
      <div className="mx-auto max-w-3xl">
        {showVision && <ScreenVisionBar onClose={() => setShowVision(false)} />}

        {attachedClips.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2 rounded-xl border border-border bg-elevated/90 px-3 py-2">
            {attachedClips.map((clip) => (
              <div
                key={clip.id}
                className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-1 text-xs text-fg"
              >
                <Film size={12} className="text-accent" />
                <span className="max-w-44 truncate">{clip.name}</span>
                <button
                  type="button"
                  onClick={() => setAttachedClips((prev) => prev.filter((c) => c.id !== clip.id))}
                  className="text-fg-muted hover:text-fg"
                  title="Remove clip"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="hud-panel flex items-end gap-1.5 px-2.5 py-1.5 transition-colors focus-within:border-accent">
          <input
            ref={clipInputRef}
            type="file"
            multiple
            accept="video/*"
            onChange={handleClipAttach}
            className="hidden"
          />

          <button
            type="button"
            onClick={submit}
            disabled={!canSend}
            aria-label="Send message"
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors",
              canSend
                ? "bg-accent text-background hover:opacity-90"
                : "text-fg-muted/50",
            )}
          >
            {isThinking ? <Loader2 size={17} className="animate-spin" /> : <ArrowUp size={17} strokeWidth={2.2} />}
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
            placeholder={
              isListening
                ? "Listening…"
                : "Ask JARVIS, attach clips, or use ArtCraft MCP…"
            }
            aria-label="Message JARVIS"
            className="max-h-28 min-h-[36px] flex-1 resize-none bg-transparent px-1.5 py-2 text-sm leading-snug text-fg outline-none placeholder:truncate placeholder:text-fg-muted"
          />

          <ModelPicker value={model} onChange={changeModel} />

          <button
            type="button"
            onClick={() => clipInputRef.current?.click()}
            title="Attach video clips to auto-edit in Video Studio"
            aria-label="Attach video clips"
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors",
              attachedClips.length > 0
                ? "bg-accent/15 text-accent"
                : "text-fg-muted hover:bg-elevated hover:text-fg",
            )}
          >
            <Film size={17} strokeWidth={1.8} />
          </button>

          <button
            type="button"
            onClick={() => setCircleToSearchOpen(true)}
            title="Circle part of the screen to search"
            aria-label="Circle to Search"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-elevated hover:text-fg"
          >
            <ScanSearch size={17} strokeWidth={1.8} />
          </button>

          <button
            type="button"
            onClick={() => setShowVision((v) => !v)}
            title="Toggle Screen Vision capture"
            aria-label="Toggle Screen Vision"
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors",
              showVision ? "bg-accent/15 text-accent" : "text-fg-muted hover:bg-elevated hover:text-fg",
            )}
          >
            <Eye size={17} strokeWidth={1.8} />
          </button>

          <button
            type="button"
            onClick={() => void toggleVoiceMic("manual")}
            aria-label={isListening ? "Stop listening" : "Start voice input"}
            aria-pressed={isListening}
            title={isListening ? "Stop listening" : "Voice command"}
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors",
              isListening
                ? "bg-red-500/20 text-red-500 ring-1 ring-red-500/50"
                : "text-fg-muted hover:bg-elevated hover:text-fg",
            )}
          >
            <Mic size={17} strokeWidth={1.8} />
          </button>
        </div>
      </div>
    </div>
  );
}
