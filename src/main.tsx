import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./index.css";
import App from "./App";
import MiniPlayerPage from "@/pages/MiniPlayerPage";
import { agentService } from "@/lib/agentService";
import { initVoiceBridge } from "@/lib/voiceController";
import { useChatStore, useOrbStore, useUiStore, useWorkspaceStore } from "@/store";

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
// Backend-owned microphone: wake word, push-to-talk and transcripts. The main
// window turns a transcript into a chat message; the mini player only shows
// state (otherwise every command would be sent twice).
initVoiceBridge((text) => agentService.send(text));

// Dev-only console probes: window.__jarvis.<store>.getState()
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__jarvis = {
    useChatStore,
    useOrbStore,
    useUiStore,
    useWorkspaceStore,
  };
}
