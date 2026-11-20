# JARVIS — Consolidated Project Summary

Owner-facing, plain-language map of what is built, how it works, what is left,
and how to run it. Keep this file updated at the end of every phase.
Last updated: 2026-11-19 (end of Phase 5).

---

## 1. What JARVIS is

A Windows 11 desktop assistant with a native Tauri window and a real agent
runtime (Hermes). It can chat, run tools, control the PC, see the screen, manage
files safely, and (next) talk, search, play video and music.

Stack:
- Frontend: React 18 + Vite + TypeScript + Tailwind v4 (pure black theme).
- Shell: Tauri 2 (Rust). Owns the window, tray, hotkey, and the backend process.
- Backend: Python FastAPI on 127.0.0.1:8420, venv at `backend/.venv`.
- Brain: hermes-agent 0.19.0 installed in that venv, sandboxed to
  `backend/hermes-home` (never the owner's personal `%LOCALAPPDATA%\Hermes`).
- Secrets: Windows Credential Manager, service "JARVIS" (never `.env`).

How to run:
- Dev: `npm run dev` in the project root, then `src-tauri/target/debug/jarvis.exe`.
- The exe spawns the backend; backend edits need an app restart
  (`taskkill /F /IM jarvis.exe`, start the exe again).
- Frontend-only edits hot-reload via Vite at http://localhost:1420.
- Ports: 1420 (UI), 8420 (API/WebSocket).

---

## 2. Status at a glance

| Phase | Scope | Status |
|---|---|---|
| 0–2 | Shell, chat, voice basics, secrets, settings, live models | DONE |
| 3 | Full Hermes control plane: providers, toolsets, MCP, cron, gateway | DONE |
| 4 | PC control, vision, permissions, kill switch, audit | DONE |
| 5 | Voice, search, video, music | DONE |
| 6 | Workspace that really builds things (3D/2D, versions, self-repair) + Tony Stark HUD | DONE |
| 7 | Orb + visual settings per reference image | NEXT |
| 8 | Packaging, updates, reliability | PENDING |
| 9 | Final polish and acceptance | PENDING |

Definition of done used throughout: real evidence in the actual Tauri window
(not just a browser), and honest notes for anything blocked (quota, missing app,
admin prompt).

---

## 3. What exists now (by area)

### Chat and brain
- WebSocket `/ws/chat`: status → thinking → token streaming → done.
- Hermes agent with tool calls; dangerous tools show an approval dialog.
- Confirmation loop is non-blocking: one turn runs as a background task so
  approval clicks are processed immediately (fixed in Phase 4).
- Model picker is **provider-aware**: it lists the active provider's chat models
  (OpenRouter shows its live free list; NVIDIA NIM, Groq, etc. show their own),
  with embed/rerank/image/TTS ids filtered out.
- Direct fallback streams from the **active** provider (not always OpenRouter),
  and error messages name the provider that actually failed.
- A per-message model from another provider is dropped with a notice instead of
  being sent to the wrong API.

### Providers (Phase 3)
- `Providers` tab: 41-provider catalog straight from Hermes
  (`hermes_cli.provider_catalog`), keys tab + accounts/OAuth tab, search,
  masked stored keys, add/update/remove, live model lists, active provider badge.
- Keys are stored per provider under their canonical env var
  (`ANTHROPIC_API_KEY`, …); OpenRouter keeps `openrouter_api_key`.
- Custom OpenAI-compatible endpoints (Ollama, LM Studio, vLLM) are written to
  `hermes-home/config.yaml` `providers.<name>` and used as `custom:<name>`.
- Active provider is `JARVIS_PROVIDER`, consumed by `hermes_bridge._build_agent`.

### Tools, MCP, cron, gateway (Phase 3)
- `Tools` tab: 25 Hermes toolsets with toggles, MCP servers (add/test/remove),
  `hermes doctor` output.
- `Tasks` tab: cron jobs (create/pause/resume/run/delete). Jobs tick only while
  the gateway runs; the UI says so.
- `Gateway` tab: Telegram/Discord/Slack/Email bot tokens, start/stop the managed
  `hermes gateway run` child, status, pid, log tail.
- Everything runs the venv's `hermes.exe` with `HERMES_HOME=backend/hermes-home`.

### PC control (Phase 4)
- `Control` tab with five sections: kill switch, apps, files, permissions, vision,
  plus a live activity feed.
- Apps: Start Menu index via `Get-StartApps` (186 apps on this PC), fuzzy match,
  launch by AppsFolder id, focus/minimize/maximize/restore/close via UI
  Automation (pywinauto).
- Mouse/keyboard: Hermes `computer_use` via cua-driver 0.53 (background input,
  element tokens, screenshots) with pyautogui as the audited REST fallback.
- Files: "organize this folder" builds a plan, shows every move, applies only
  after the button, move-only (never delete), one-click undo, protected-folder
  refusal (Windows, Program Files, ProgramData, AppData, .ssh, …).
- Vision: whole screen, one window, or a region → the active provider's vision
  model. Plain-language errors when no key/quota/no vision support.
- Permissions: per-tool ask / ask-if-risky / always-allow; global kill switch
  with a configurable hotkey (default ctrl+shift+x); append-only audit log.

### Voice, search, video, music (Phase 5)
- **Speech lives in the backend.** Web Speech cannot work inside Tauri's
  WebView2 (the session ends instantly; the mic permission prompt never shows),
  so `backend/voice.py` does capture, **openWakeWord** ("Hey JARVIS", 0.998 on a
  test clip) and **faster-whisper** STT (`tiny.en`, ~1 s after the first load).
  Text-to-speech stays in the renderer (`speechSynthesis`), which works.
- Wake word toggle, microphone picker, STT model, push-to-talk hotkey
  (`ctrl+alt+j`), "Test microphone" and TTS rate/pitch in **Settings → Voice**.
  Wake word is **off by default**.
- Chat states: idle → listening → thinking → speaking, with a live audio level
  for the orb. JARVIS stops transcribing while it is speaking; the mic button,
  PTT and Esc barge in and stop speech.
- Deterministic command router (runs before the model) for Spotify, YouTube,
  the browser, system volume/mute and media keys, so these never depend on a
  model's tool-calling. "Search for X" deliberately goes to Hermes web search so
  the answer is summarized.
- Spotify in three levels: URI search, media keys, and the Spotify Web API with
  PKCE (owner's own client ID; playback control needs Premium, stated in the UI).
- **Settings → Music**: client ID, Connect/Disconnect, live status.

### Safety model (do not weaken)
- Secrets never go to `.env` and are never returned to the UI (masked preview).
- Every agent tool call passes `permissions.decide()`; kill switch wins.
- Direct desktop/file REST calls are explicit user clicks and are audited.
- Dangerous installs (Git, cua-driver, personal Hermes data) require explicit
  owner consent; nothing from the personal Hermes install is copied.
- File organization is move-only with undo; protected folders are refused.

---

## 4. Key files

Backend (`C:\Users\ramch\Jarvis\backend`):
- `main.py` — FastAPI app: chat WS, all REST endpoints, settings persistence.
- `config.py` — pydantic settings, `JARVIS_*` env prefix, `.env` persistence.
- `secret_store.py` — Credential Manager read/write, per-provider keys, publish.
- `hermes_control.py` — provider catalog, toolsets, MCP, cron, gateway, doctor,
  custom providers, PATH fix for Git/cua-driver.
- `hermes_bridge.py` — agent lifecycle, provider-aware build, confirmations,
  guardrail → `permissions.decide()`.
- `permissions.py` — modes, kill switch, hotkey, audit log.
- `app_index.py` — Start Menu index, launch, window control, input fallback.
- `file_ops.py` — plan/apply/undo, protected folders, journal.
- `vision.py` — screenshots + vision model call.
- `voice.py` — wake word, STT, PTT, barge-in, mic list, audio level.
- `actions.py` — deterministic Spotify/YouTube/browser/volume/media router.
- `spotify.py` — URI search, media keys, PKCE Web API, Credential Manager tokens.
- `model_router.py` — provider-aware streaming + live model lists + routing.
- `desktop_control.py` — older small actions (open allowlisted app, screenshot,
  run command) still used by Workspace.

Frontend (`C:\Users\ramch\Jarvis\src`):
- `App.tsx`, `lib/tabs.ts` — sidebar: Assistant, Workspace, Providers, Tools,
  Control, Tasks, Gateway, Skills, Memory, Settings.
- `lib/agentApi.ts` — REST client and all shared types.
- `pages/ProvidersPage.tsx`, `ToolsPage.tsx`, `TasksPage.tsx`, `GatewayPage.tsx`,
  `ControlPage.tsx`, `HomePage.tsx`, `WorkspacePage.tsx`, `SettingsPage.tsx`,
  `MemoryPage.tsx`, `SkillsPage.tsx`.
- `lib/websocketService.ts`, `lib/agentService.ts` — chat transport and event glue.
- `lib/voiceController.ts` — backend voice bridge (transcripts, wake, barge-in).
- `components/home/InputBar.tsx`, `components/home/ModelPicker.tsx`,
  `components/home/MiniPlayer.tsx` — composer, provider-aware model pill, mini window.

State files:
- `PROJECT_STATE.md` — phase-by-phase evidence and bugs (authoritative detail).
- `backend/.env` — non-secret settings only (`JARVIS_*` keys).
- `backend/hermes-home/` — sandboxed runtime state: config.yaml, cron/jobs.json,
  logs (audit.jsonl, jarvis-gateway.log), screenshots, file-ops/journal.json.

---

## 5. Phase 4 evidence (short)

- Start Menu: 186 apps; Notepad launched/focused/minimized/closed.
- Typing: REST typed "hello from JARVIS" (clipboard exact match).
- Agent: "Open Notepad and stop" → 16 approved computer_use actions; "Type
  hello into it" → editor shows `hello from JARVIShello`.
- Vision: "app on screen is JARVIS"; "No, Calculator is not visible"; "yes,
  hello from JARVIS".
- Files: plan 6 → apply 6 → undo 6, both via REST and the real UI.
- Kill switch: blocks launches (403), hotkey toggles, audit shows everything.
- Permission override persisted and audited.

## 5b. Phase 5 evidence (short)

- Real speech in: SAPI clip → `Reply with exactly, voice pipeline okay.`
  (0.8–1.0 s after the one-time model download).
- Wake word: "Hey Jarvis" scored **0.998** against the 0.55 threshold.
- In the window: "🎙 Wake word detected — listening…" → transcript bubble →
  assistant reply.
- The spec's exact sequence, by voice:
  1. "Play lo-fi on Spotify." → Spotify opened with the search.
  2. "Pause." → "Paused." (media key).
  3. "Open a YouTube video about volcanoes." → opened *Volcano | The Dr. Binocs
     Show*.
- Mic button opens and cancels a real capture; wake toggle opens/stops the mic.
- Volume/mute/media keys work (a pycaw API change was caught by the smoke test
  and fixed); Spotify precise playback still needs a client ID + Premium.
- Provider bug fixed and verified: NVIDIA NIM model works, stale OpenRouter
  override is dropped with a notice, no more "doesn't exist on OpenRouter".

---

## 6. Known issues / honest notes

1. **Calculator is not installed on this PC.** The agent correctly reported it
   after checking processes, AppX packages, protocols and paths. Consider a
   smaller retry budget for "app not found" cases.
2. **OpenRouter free quota** was exhausted earlier, then recovered. If replies
   turn into the quota message, wait for the daily reset or add credits.
3. **Vision** is wired for OpenAI-compatible providers only (OpenRouter or a
   custom endpoint). Anthropic-native vision is not wired.
4. **Notepad buffer:** during Phase 4 tests Notepad held an unsaved
   `ches.html` buffer; typing/closing tests ran against it. No owner files were
   touched, but avoid force-closing Notepad with unsaved work.
5. **PATH after installs:** Git/cua-driver are added by the backend at startup;
   terminals opened before the install need a restart to see them.
6. **cua-driver installer** reported a stale daemon during setup but the driver
   is healthy (`doctor` passes, `computer-use status` = installed).
7. **Retired model ids:** providers keep models in their public lists after
   end-of-life (e.g. `moonshotai/kimi-k2.6` → HTTP 410 on NVIDIA). JARVIS now
   says "retired that model" and auto-selection prefers the provider's curated
   fallback models; if a reply says so, pick a current model in the picker.
8. **Wake word is off by default.** Turn it on in Settings → Voice. The first
   faster-whisper run downloads `tiny.en` (~40 s); later runs are ~1 s.
9. **Spotify precise playback** needs the owner's Spotify developer client ID
   and a Premium account. Search/media-key control works without them.
10. **Live microphone pass pending:** Phase 5 was verified with synthesized
    speech played through the same capture → wake/PTT → STT → action pipeline.
    A spoken test with the owner present is still worth doing.

---

## 7. What to do next — Phase 6 (Workspace that really builds things)

Phase 5 is complete. Next:
1. Bundle Three.js + OrbitControls locally (no CDN, offline).
2. Render artifacts in a sandboxed iframe with a small injected helper library
   (scene/lights/materials/groups/animation/auto-fit camera/export .glb + PNG)
   and document that API to the model.
3. Iteration on the **same** artifact with versions v1/v2/v3 + undo.
4. Catch sandbox errors, show them, and send them back to the model for one
   self-repair retry.
5. 2D: SVG, canvas, HTML mini-apps; image generation only with a configured
   provider.
6. "Save to folder" and an Examples row (3D car, solar system, to-do app,
   SVG logo, bouncing ball).
7. Done when: "build me a 3D spaceship" renders in one reply, "add glowing
   engines" updates it, and a bad model answer self-repairs once.

Then Phase 7 (orb per the reference image + Appearance settings), Phase 8
(installer), Phase 9 (polish/acceptance).

---

## 8. Testing helpers

- `tools/test_phase3_endpoints.py` — read-only Phase 3 endpoints.
- `tools/test_phase3_mutations.py` — toolset, cron, gateway mutations.
- `tools/test_phase4.py` — apps/typing/files/kill switch/permissions/audit.
- `tools/test_agent_pc.py` — live WS agent turn with auto-approval + vision check.
- `tools/test_chat_models.py` — stale per-message override + real provider reply.
- `tools/smoke_phase5.py` — voice/mic/settings/action-router smoke test.
- `tools/webview_cdp.py` — evaluate JS in the real WebView2 window (CDP :9222).

Run with the venv python:
`backend\.venv\Scripts\python.exe tools\test_phase4.py`

---

## 9. Rules that keep this safe

- One phase per working session; evidence before "done"; report honestly.
- No hardcoded provider/tool/model lists — read them from Hermes or user config.
- No silent PC changes; installs and personal-data imports need a consent click.
- Never reintroduce `AnimatePresence mode="wait"` (deadlocks page swaps).
- Backend edits require an app restart; frontend edits hot-reload.
