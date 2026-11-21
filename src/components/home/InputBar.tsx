import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import {
  ArrowUp,
  Eye,
  File as FileIcon,
  FileText,
  Film,
  Image as ImageIcon,
  Loader2,
  Mic,
  Music,
  Paperclip,
  ScanSearch,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useAgentStore, useChatStore, useHudStore, useUiStore, useVideoStore } from "@/store";
import { toggleMic as toggleVoiceMic } from "@/lib/voiceController";
import { ModelPicker } from "@/components/home/ModelPicker";
import { ScreenVisionBar } from "@/components/vision/ScreenVisionBar";
import { agentApi } from "@/lib/agentApi";
import { createDefaultClip, type VideoClip } from "@/lib/videoTimeline";
import { detectNaturalNavigationIntent } from "@/lib/autoNavigator";
import { analyzeMediaAudioUrl } from "@/lib/audioBeatAnalyzer";
import { prepareFileAttachment, type PreparedAttachment } from "@/lib/fileAttachment";

const MODEL_KEY = "jarvis-chat-model";
const MODEL_PROVIDER_KEY = "jarvis-chat-model-provider";

function loadChatModel(): string {
  try {
    return localStorage.getItem(MODEL_KEY) ?? "";
  } catch {
    return "";
  }
}

export interface ChatSendAttachment {
  name: string;
  mimeType: string;
  kind?: string;
  dataBase64?: string;
  textContent?: string;
}

interface Props {
  onSend: (text: string, model?: string, attachments?: ChatSendAttachment[]) => void;
}

function AttachmentBadgeIcon({ kind }: { kind: PreparedAttachment["kind"] }) {
  switch (kind) {
    case "video":
      return <Film size={12} className="shrink-0 text-accent" />;
    case "image":
      return <ImageIcon size={12} className="shrink-0 text-accent" />;
    case "audio":
      return <Music size={12} className="shrink-0 text-accent" />;
    case "text":
      return <FileText size={12} className="shrink-0 text-accent" />;
    default:
      return <FileIcon size={12} className="shrink-0 text-accent" />;
  }
}

export function InputBar({ onSend }: Props) {
  const [value, setValue] = useState("");
  const [model, setModel] = useState<string>(loadChatModel);
  const [provider, setProvider] = useState("");
  const [showVision, setShowVision] = useState(false);
  const [attachments, setAttachments] = useState<PreparedAttachment[]>([]);
  const [draggingOver, setDraggingOver] = useState(false);

  const isListening = useChatStore((s) => s.isListening);
  const isThinking = useAgentStore((s) => s.isThinking);
  const autoSwitchTabs = useHudStore((s) => s.autoSwitchTabs);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const setCircleToSearchOpen = useUiStore((s) => s.setCircleToSearchOpen);
  const addVideoClips = useVideoStore((s) => s.addClips);
  const setMusicTrack = useVideoStore((s) => s.setMusicTrack);
  const applyAutoEditDirective = useVideoStore((s) => s.applyAutoEditDirective);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const canSend = (value.trim().length > 0 || attachments.length > 0) && !isThinking;

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

  const ingestFiles = async (fileList: File[]) => {
    if (fileList.length === 0) return;
    const prepared = await Promise.all(fileList.map((f) => prepareFileAttachment(f)));
    setAttachments((prev) => [...prev, ...prepared]);
  };

  const handleFileAttach = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    void ingestFiles(files);
    e.target.value = "";
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDraggingOver(false);
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length > 0) {
      void ingestFiles(files);
    }
  };

  const submit = async () => {
    if (!canSend) return;
    const text = value.trim();
    const videoItems = attachments.filter((a) => a.kind === "video");
    const audioItems = attachments.filter((a) => a.kind === "audio");
    const imageItems = attachments.filter((a) => a.kind === "image");
    const docItems = attachments.filter((a) => a.kind === "text" || a.kind === "document");

    const wantsVideoEdit =
      videoItems.length > 0 ||
      (/\b(edit|cut|capcut|montage|reel|tiktok|beat|sync|timeline|video)\b/i.test(text) &&
        (imageItems.length > 0 || audioItems.length > 0));

    if (wantsVideoEdit) {
      const timelineClips: VideoClip[] = [
        ...videoItems.map((c) =>
          createDefaultClip({
            name: c.name,
            src: c.objectUrl || "",
            mediaType: "video",
            duration: c.duration || 6,
          }),
        ),
        ...imageItems.map((img) =>
          createDefaultClip({
            name: img.name,
            src: img.objectUrl || "",
            mediaType: "image",
            duration: 4,
          }),
        ),
      ];
      if (timelineClips.length > 0) {
        addVideoClips(timelineClips);
      }

      const firstAudio = audioItems[0];
      const audioUrl = firstAudio?.objectUrl;
      if (firstAudio && audioUrl) {
        const beatRes = await analyzeMediaAudioUrl(audioUrl).catch(() => ({
          duration: firstAudio.duration || 10,
          bpm: 120,
          beats: [],
          energyDrops: [],
          waveform: [],
        }));
        setMusicTrack({
          url: audioUrl,
          name: firstAudio.name,
          bpm: beatRes.bpm,
          beats: beatRes.beats,
          waveform: beatRes.waveform,
        });
      }

      const intent = detectNaturalNavigationIntent(text, true);
      if (intent.videoEdit) {
        applyAutoEditDirective(intent.videoEdit);
      }
      if (autoSwitchTabs) {
        setActiveTab("video");
      }
    }

    const forwardAttachments: ChatSendAttachment[] = [
      ...imageItems,
      ...audioItems,
      ...docItems,
    ]
      .filter((a) => Boolean(a.dataBase64 || a.textContent))
      .map((a) => ({
        name: a.name,
        mimeType: a.mimeType,
        kind: a.kind,
        ...(a.dataBase64 ? { dataBase64: a.dataBase64 } : {}),
        ...(a.textContent ? { textContent: a.textContent } : {}),
      }));

    const attachedNames = attachments.map((a) => a.name).join(", ");
    const outgoing = text
      ? attachments.length > 0
        ? `${text} [Attached: ${attachedNames}]`
        : text
      : wantsVideoEdit
        ? `Edit these attached media files in CapCut Video Studio: ${attachedNames}`
        : `Analyze these attached files: ${attachedNames}`;

    onSend(outgoing, model || undefined, forwardAttachments);
    setAttachments([]);
    setValue("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <div
      className="shrink-0 px-5 pb-4 pt-2"
      onDragOver={(e) => {
        e.preventDefault();
        setDraggingOver(true);
      }}
      onDragLeave={() => setDraggingOver(false)}
      onDrop={handleDrop}
    >
      <div className="mx-auto max-w-3xl">
        {showVision && <ScreenVisionBar onClose={() => setShowVision(false)} />}

        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2 rounded-xl border border-border bg-elevated/90 px-3 py-2">
            {attachments.map((att) => (
              <div
                key={att.id}
                className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-1 text-xs text-fg"
              >
                {att.kind === "image" && att.objectUrl ? (
                  <img src={att.objectUrl} alt={att.name} className="h-5 w-5 rounded object-cover" />
                ) : (
                  <AttachmentBadgeIcon kind={att.kind} />
                )}
                <span className="max-w-44 truncate">{att.name}</span>
                <span className="font-mono text-[10px] uppercase text-fg-muted">{att.kind}</span>
                <button
                  type="button"
                  onClick={() => setAttachments((prev) => prev.filter((c) => c.id !== att.id))}
                  className="text-fg-muted hover:text-fg"
                  title="Remove attachment"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div
          className={cn(
            "hud-panel flex items-end gap-1.5 px-2.5 py-1.5 transition-colors focus-within:border-accent",
            draggingOver && "border-accent bg-accent/10",
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileAttach}
            className="hidden"
          />

          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSend}
            aria-label="Send message"
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors",
              canSend ? "bg-accent text-background hover:opacity-90" : "text-fg-muted/50",
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
              draggingOver
                ? "Drop any video, audio, image, PDF, or code file here…"
                : isListening
                  ? "Listening…"
                  : "Ask JARVIS or attach any file (video, audio, image, PDF, code)…"
            }
            aria-label="Message JARVIS"
            className="max-h-28 min-h-[36px] flex-1 resize-none bg-transparent px-1.5 py-2 text-sm leading-snug text-fg outline-none placeholder:truncate placeholder:text-fg-muted"
          />

          <ModelPicker value={model} onChange={changeModel} />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Attach any file format (video, audio, image, PDF, documents, code)"
            aria-label="Attach any file"
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors",
              attachments.length > 0
                ? "bg-accent/15 text-accent"
                : "text-fg-muted hover:bg-elevated hover:text-fg",
            )}
          >
            <Paperclip size={17} strokeWidth={1.8} />
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
