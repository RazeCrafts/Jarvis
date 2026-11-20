# JARVIS

Personal AI assistant for Windows — Tauri 2 shell, React 18 interface, Python brain.

- **Orb visualizer** with 4 customizable styles (Core / Swirl / Plasma / Hologram), ring, starfield, live states (idle / listening / thinking / speaking)
- **Chat** with streaming replies, code highlighting (Prism), voice input + spoken replies (Web Speech API)
- **Workspace** where anything JARVIS codes renders live — code (runnable), web pages, 3D scenes (sandboxed), markdown
- **Memory** & **Skills** tabs backed by the Hermes Agent runtime
- **System tray + Ctrl+Shift+J** to show/hide from anywhere; closing the window keeps JARVIS alive in the tray

## Quick start (dev)

```powershell
# 1. Frontend (terminal 1)
npm install
npm run dev               # http://localhost:1420

# 2. Backend (terminal 2)
cd backend
python -m venv .venv                  # once
.venv\Scripts\python -m pip install -r requirements.txt   # once
copy .env.example .env                # once, then put your OpenRouter key in it
.venv\Scripts\python main.py          # serves http://127.0.0.1:8420

# 3. Or simply run the desktop app (starts the backend itself)
npm run tauri dev
```

Or double-click `start-jarvis.bat` (starts backend + frontend dev server).

## Configuration

Everything lives in `backend\.env` (editable later in the app's Settings tab):
OpenRouter API key, model tiers (default / fast / heavy), safety toggles, voice, port. See `backend\.env.example`.

## Architecture

```
┌────────────────────────────┐  ws://127.0.0.1:8420/ws/chat
│  Tauri 2 shell (Rust)      │──────────────► FastAPI backend (Python)
│  • window, tray, hotkey    │                │
│  • spawns/kills backend    │                ├─ hermes_bridge.py  → Hermes Agent runtime
│  React 18 UI               │                ├─ model_router.py   → OpenRouter (fallback)
│  • orb (Three.js shaders)  │◄───────────────├─ desktop_control.py → allowlisted actions
│  • chat, workspace, tabs   │  REST + events └─ confirmation guardrail (dangerous tools)
└────────────────────────────┘
```

The Hermes runtime is **isolated**: `HERMES_HOME=backend/hermes-home` — it never
touches a personal Hermes Desktop install (`%LOCALAPPDATA%\Hermes`).

## Safety

- Dangerous tool calls (terminal, desktop control, file writes) pause and show an
  **Approve / Deny** dialog in the app. Denials are fed back to the model.
- Workspace "Run" executes code only after explicit confirmation, with a timeout.
- `desktop_control` REST actions are allowlist-gated (`JARVIS_ALLOWED_APPS`).

## Backing up your personal Hermes install

Use `tools\backup-hermes.ps1` — writes a timestamped zip of config, memories,
skills, sessions, vault and secrets to your Desktop (excludes reinstallable
program files).

## Build

```powershell
npm run tauri build      # NSIS installer + portable exe in src-tauri\target\release\
```
