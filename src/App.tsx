import type { ComponentType } from "react";
import { useEffect } from "react";
import { MotionConfig, motion } from "framer-motion";
import { Sidebar } from "@/components/layout/Sidebar";
import { TitleBar } from "@/components/layout/TitleBar";
import { StartupGate } from "@/components/layout/StartupGate";
import { ConfirmationDialog } from "@/components/layout/ConfirmationDialog";
import { agentService } from "@/lib/agentService";
import { useUiStore } from "@/store";
import type { TabId } from "@/types";
import HomePage from "@/pages/HomePage";
import WorkspacePage from "@/pages/WorkspacePage";
import SkillsPage from "@/pages/SkillsPage";
import MemoryPage from "@/pages/MemoryPage";
import ProvidersPage from "@/pages/ProvidersPage";
import ToolsPage from "@/pages/ToolsPage";
import ControlPage from "@/pages/ControlPage";
import GatewayPage from "@/pages/GatewayPage";
import TasksPage from "@/pages/TasksPage";
import SettingsPage from "@/pages/SettingsPage";

const PAGES: Record<TabId, ComponentType> = {
  home: HomePage,
  workspace: WorkspacePage,
  skills: SkillsPage,
  memory: MemoryPage,
  providers: ProvidersPage,
  tools: ToolsPage,
  control: ControlPage,
  gateway: GatewayPage,
  tasks: TasksPage,
  settings: SettingsPage,
};

export default function App() {
  const activeTab = useUiStore((s) => s.activeTab);
  const Page = PAGES[activeTab];

  // Connect the backend bridge once for the whole app. Voice (wake word, STT,
  // push-to-talk) is initialized in main.tsx because the mini window needs it
  // too and its Esc/barge-in handling lives in voiceController.
  useEffect(() => {
    agentService.init();
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <StartupGate>
        <div className="flex h-full select-none flex-col">
          <TitleBar />
          <div className="flex min-h-0 flex-1">
            <Sidebar />
            <main className="min-w-0 flex-1 pb-3 pr-3">
              <div className="glass relative h-full overflow-hidden rounded-2xl">
                <motion.div
                  key={activeTab}
                  className="absolute inset-0"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                >
                  <Page />
                </motion.div>
              </div>
            </main>
          </div>
        </div>
        <ConfirmationDialog />
      </StartupGate>
    </MotionConfig>
  );
}
