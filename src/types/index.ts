export type TabId = "home" | "workspace" | "skills" | "memory" | "providers" | "tools" | "control" | "gateway" | "tasks" | "settings";

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  streaming?: boolean;
}
