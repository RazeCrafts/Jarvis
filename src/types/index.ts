export type TabId =
  | "home"
  | "workspace"
  | "video"
  | "smarthome"
  | "memory"
  | "skills"
  | "providers"
  | "settings";

export type ChatRole = "user" | "assistant" | "system";

export type LiveVisualChartType =
  | "line"
  | "area"
  | "bar"
  | "pie"
  | "radar"
  | "flowchart"
  | "table";

export interface LiveVisualSeries {
  name: string;
  values: number[];
}

export interface LiveVisualNode {
  id: string;
  label: string;
  detail?: string;
}

export interface LiveVisualEdge {
  from: string;
  to: string;
  label?: string;
}

export interface LiveVisualSpec {
  id: string;
  title: string;
  subtitle?: string;
  chartType: LiveVisualChartType;
  labels?: string[];
  series?: LiveVisualSeries[];
  nodes?: LiveVisualNode[];
  edges?: LiveVisualEdge[];
  createdAt: number;
}

export interface WebCitation {
  title: string;
  uri: string;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  streaming?: boolean;
  visuals?: LiveVisualSpec[];
  citations?: WebCitation[];
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}
