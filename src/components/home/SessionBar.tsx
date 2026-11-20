import { useState } from "react";
import { MessageSquare, Pencil, Plus, X } from "lucide-react";
import { useChatStore } from "@/store";
import { cn } from "@/lib/cn";

export function SessionBar() {
  const sessions = useChatStore((s) => s.sessions);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const createSession = useChatStore((s) => s.createSession);
  const switchSession = useChatStore((s) => s.switchSession);
  const renameSession = useChatStore((s) => s.renameSession);
  const deleteSession = useChatStore((s) => s.deleteSession);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");

  const startRename = (id: string, currentTitle: string) => {
    setEditingId(id);
    setDraftTitle(currentTitle);
  };

  const commitRename = () => {
    if (editingId && draftTitle.trim()) {
      renameSession(editingId, draftTitle.trim());
    }
    setEditingId(null);
    setDraftTitle("");
  };

  return (
    <div
      data-testid="session-bar"
      className="flex items-center gap-1.5 overflow-x-auto border-b border-border bg-background/35 px-4 py-1.5"
    >
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
        {sessions.map((sess) => {
          const active = sess.id === activeSessionId;
          const isEditing = editingId === sess.id;
          const msgCount = sess.messages.filter((m) => m.role !== "system").length;

          return (
            <div
              key={sess.id}
              className={cn(
                "group flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] transition-colors",
                active
                  ? "border-accent bg-surface text-fg"
                  : "border-border bg-background/40 text-fg-muted hover:border-accent/40 hover:text-fg",
              )}
            >
              <MessageSquare
                size={11}
                className={active ? "shrink-0 text-accent" : "shrink-0 text-fg-muted"}
              />

              {isEditing ? (
                <input
                  autoFocus
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") {
                      setEditingId(null);
                      setDraftTitle("");
                    }
                  }}
                  aria-label="Session title"
                  className="w-32 bg-transparent text-[11px] text-fg outline-none"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => switchSession(sess.id)}
                  onDoubleClick={() => startRename(sess.id, sess.title)}
                  title={`${sess.title} (${msgCount} messages) — double-click to rename`}
                  className="max-w-40 truncate text-left font-medium"
                >
                  {sess.title}
                </button>
              )}

              {msgCount > 0 && !isEditing && (
                <span className="font-mono text-[10px] text-fg-muted tabular-nums">
                  {msgCount}
                </span>
              )}

              {!isEditing && active && (
                <button
                  type="button"
                  onClick={() => startRename(sess.id, sess.title)}
                  title="Rename session"
                  aria-label={`Rename ${sess.title}`}
                  className="text-fg-muted opacity-0 transition-opacity hover:text-accent group-hover:opacity-100"
                >
                  <Pencil size={10} />
                </button>
              )}

              {sessions.length > 1 && !isEditing && (
                <button
                  type="button"
                  onClick={() => deleteSession(sess.id)}
                  title="Close session"
                  aria-label={`Delete ${sess.title}`}
                  className="text-fg-muted transition-colors hover:text-red-400"
                >
                  <X size={11} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => createSession()}
        title="Start a new independent JARVIS chat session"
        className="flex shrink-0 items-center gap-1 rounded-lg border border-border bg-elevated px-2.5 py-1 text-[11px] font-medium text-fg transition-colors hover:border-accent hover:text-accent"
      >
        <Plus size={12} className="text-accent" />
        <span>New Session</span>
      </button>
    </div>
  );
}
