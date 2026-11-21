import {
  Box,
  CalendarClock,
  CalendarDays,
  Cpu,
  Film,
  Music,
  Network,
  Orbit,
  Puzzle,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import type { TabId } from "@/types";

export interface TabDef {
  id: TabId;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
  position: "top" | "bottom";
}

export const TABS: TabDef[] = [
  { id: "home", label: "Command HUD", shortLabel: "HUD", icon: Orbit, position: "top" },
  { id: "workspace", label: "Workshop", shortLabel: "Workshop", icon: Box, position: "top" },
  { id: "galaxy", label: "File Galaxy & Brain", shortLabel: "Galaxy", icon: Network, position: "top" },
  { id: "video", label: "Video Studio", shortLabel: "Video", icon: Film, position: "top" },
  { id: "media", label: "Movies & Music", shortLabel: "Media", icon: Music, position: "top" },
  { id: "tasks", label: "Daily Tasks", shortLabel: "Tasks", icon: CalendarClock, position: "top" },
  { id: "memory", label: "Memory, Cal & Timers", shortLabel: "Memory", icon: CalendarDays, position: "top" },
  { id: "skills", label: "Plugins & Skills", shortLabel: "Plugins", icon: Puzzle, position: "top" },
  { id: "providers", label: "Models & Bridge", shortLabel: "Models", icon: Cpu, position: "top" },
  { id: "settings", label: "Settings", shortLabel: "Settings", icon: SlidersHorizontal, position: "bottom" },
];
