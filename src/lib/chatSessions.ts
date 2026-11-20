import type { ChatMessage, ChatSession } from "@/types";

export const DEFAULT_SESSION_TITLE = "Command Session";
export const MAX_PERSISTED_SESSIONS = 25;
export const MAX_SESSION_MESSAGES = 100;

export function isDefaultSessionTitle(title: string): boolean {
  return /^(Command Session|New Session)( \d+)?$/i.test(title.trim());
}

export function deriveSessionTitle(firstPrompt: string): string {
  const cleaned = firstPrompt.replace(/\s+/g, " ").trim();
  if (!cleaned) return DEFAULT_SESSION_TITLE;
  return cleaned.length > 36 ? `${cleaned.slice(0, 35).trimEnd()}…` : cleaned;
}

export function createChatSession(title?: string, id?: string): ChatSession {
  const now = Date.now();
  return {
    id: id || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `sess-${now}`),
    title: title?.trim() || DEFAULT_SESSION_TITLE,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

export function sanitizeSessions(rawSessions: unknown, legacyMessages?: unknown): {
  sessions: ChatSession[];
  activeSessionId: string;
} {
  const parseMsgs = (arr: unknown): ChatMessage[] => {
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(
        (m): m is ChatMessage =>
          Boolean(m && typeof m === "object" && typeof (m as ChatMessage).content === "string"),
      )
      .map((m) => ({
        ...m,
        id: typeof m.id === "string" ? m.id : `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: m.role === "user" || m.role === "assistant" || m.role === "system" ? m.role : "assistant",
        createdAt: typeof m.createdAt === "number" ? m.createdAt : Date.now(),
        streaming: false,
      }))
      .slice(-MAX_SESSION_MESSAGES);
  };

  if (Array.isArray(rawSessions) && rawSessions.length > 0) {
    const valid = rawSessions
      .filter((s): s is ChatSession => Boolean(s && typeof s === "object" && typeof (s as ChatSession).id === "string"))
      .slice(0, MAX_PERSISTED_SESSIONS)
      .map((s, idx) => ({
        id: s.id,
        title: typeof s.title === "string" && s.title.trim() ? s.title.trim() : `${DEFAULT_SESSION_TITLE} ${idx + 1}`,
        createdAt: typeof s.createdAt === "number" ? s.createdAt : Date.now(),
        updatedAt: typeof s.updatedAt === "number" ? s.updatedAt : Date.now(),
        messages: parseMsgs(s.messages),
      }));
    if (valid.length > 0) {
      return { sessions: valid, activeSessionId: valid[0].id };
    }
  }

  const migrated = createChatSession(`${DEFAULT_SESSION_TITLE} 1`, "session-1");
  migrated.messages = parseMsgs(legacyMessages);
  if (migrated.messages.length > 0) {
    const firstUser = migrated.messages.find((m) => m.role === "user");
    if (firstUser) migrated.title = deriveSessionTitle(firstUser.content);
  }
  return { sessions: [migrated], activeSessionId: migrated.id };
}
