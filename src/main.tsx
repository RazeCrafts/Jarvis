import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/outfit/500.css";
import "@fontsource/outfit/600.css";
import "@fontsource/outfit/700.css";
import "@fontsource/plus-jakarta-sans/400.css";
import "@fontsource/plus-jakarta-sans/500.css";
import "@fontsource/plus-jakarta-sans/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./index.css";
import App from "./App";
import MiniPlayerPage from "@/pages/MiniPlayerPage";
import { agentService } from "@/lib/agentService";
import { initVoiceBridge } from "@/lib/voiceController";
import {
  useChatStore,
  useHudStore,
  useLifeStore,
  useOrbStore,
  useUiStore,
  useWorkspaceStore,
} from "@/store";

// Apply persisted theme tokens immediately before first paint
useHudStore.getState().applyActiveTheme();

const isMini = typeof window !== "undefined" && window.location.hash === "#mini";

ReactDOM.createRoot(document.getElementById("root")!).render(
  isMini ? (
    <MiniPlayerPage />
  ) : (
    <React.StrictMode>
      <App />
    </React.StrictMode>
  ),
);

agentService.init();
initVoiceBridge((text) => agentService.send(text));

if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__jarvis = {
    useChatStore,
    useOrbStore,
    useUiStore,
    useWorkspaceStore,
    useHudStore,
    useLifeStore,
  };
}
