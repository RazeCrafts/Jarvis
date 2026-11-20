import {
  Box,
  Brain,
  KeyRound,
  ListTodo,
  MonitorCog,
  Orbit,
  Puzzle,
  RadioTower,
  Settings,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { TabId } from "@/types";

export interface TabDef {
  id: TabId;
  label: string;
  icon: LucideIcon;
  /** Which end of the sidebar the tab sits at. */
  position: "top" | "bottom";
}

export const TABS: TabDef[] = [
  { id: "home", label: "Assistant", icon: Orbit, position: "top" },
  { id: "workspace", label: "Workspace", icon: Box, position: "top" },
  { id: "providers", label: "Providers", icon: KeyRound, position: "top" },
  { id: "tools", label: "Tools", icon: Wrench, position: "top" },
  { id: "control", label: "Control", icon: MonitorCog, position: "top" },
  { id: "tasks", label: "Tasks", icon: ListTodo, position: "top" },
  { id: "gateway", label: "Gateway", icon: RadioTower, position: "top" },
  { id: "skills", label: "Skills", icon: Puzzle, position: "top" },
  { id: "memory", label: "Memory", icon: Brain, position: "top" },
  { id: "settings", label: "Settings", icon: Settings, position: "bottom" },
];
