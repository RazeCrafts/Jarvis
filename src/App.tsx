import type { ComponentType } from "react";
import { useEffect } from "react";
import { MotionConfig, motion } from "framer-motion";
import { Sidebar } from "@/components/layout/Sidebar";
import { TitleBar } from "@/components/layout/TitleBar";
import { StartupGate } from "@/components/layout/StartupGate";
import { ConfirmationDialog } from "@/components/layout/ConfirmationDialog";
import { FloatingBlob } from "@/components/overlay/FloatingBlob";
import { CircleToSearchOverlay } from "@/components/overlay/CircleToSearchOverlay";
import { agentService } from "@/lib/agentService";
import { cn } from "@/lib/cn";
import { useHudStore, useUiStore } from "@/store";
import type { TabId } from "@/types";
import HomePage from "@/pages/HomePage";
import WorkspacePage from "@/pages/WorkspacePage";
import VideoStudioPage from "@/pages/VideoStudioPage";
import SmartHomePage from "@/pages/SmartHomePage";
import MemoryCalendarPage from "@/pages/MemoryCalendarPage";
import PluginsPage from "@/pages/PluginsPage";
import ProvidersBridgePage from "@/pages/ProvidersBridgePage";
import CustomizePage from "@/pages/CustomizePage";

const PAGES: Record<TabId, ComponentType> = {
  home: HomePage,
  workspace: WorkspacePage,
  video: VideoStudioPage,
  smarthome: SmartHomePage,
  memory: MemoryCalendarPage,
  skills: PluginsPage,
  providers: ProvidersBridgePage,
  settings: CustomizePage,
};

export default function App() {
  const activeTab = useUiStore((s) => s.activeTab);
  const minimizedToBlob = useUiStore((s) => s.minimizedToBlob);
  const hudGrid = useHudStore((s) => s.hudGrid);
  const applyActiveTheme = useHudStore((s) => s.applyActiveTheme);
  const syncFromServer = useHudStore((s) => s.syncFromServer);
  const Page = PAGES[activeTab] ?? HomePage;

  useEffect(() => {
    applyActiveTheme();
    void syncFromServer();
    agentService.init();
  }, [applyActiveTheme, syncFromServer]);

  return (
    <MotionConfig reducedMotion="user">
      <StartupGate>
        <div
          className={cn(
            "flex h-full select-none flex-col bg-background text-fg",
            hudGrid && "hud-grid-bg",
            minimizedToBlob && "hidden",
          )}
        >
          <TitleBar />
          <div className="flex min-h-0 flex-1">
            <Sidebar />
            <main className="min-w-0 flex-1 pb-3 pr-3">
              <div className="hud-panel relative h-full overflow-hidden">
                <motion.div
                  key={activeTab}
                  className="absolute inset-0"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.16, ease: "easeOut" }}
                >
                  <Page />
                </motion.div>
              </div>
            </main>
          </div>
        </div>
        <FloatingBlob />
        <CircleToSearchOverlay />
        <ConfirmationDialog />
      </StartupGate>
    </MotionConfig>
  );
}
