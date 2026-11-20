# JARVIS — Build State & Continuity

> Living file. If work ever stops, read this first and resume from "Next up".
> Master spec: `C:\Users\ramch\Desktop\JARVIS Build Prompts — Layer by Layer.md`
> **NEW master directive (2026-11-16): `Desktop\JARVIS fix-and-finish prompt.md`** — phases 0–9,
> one phase per session, evidence in the REAL Tauri window required before any checkmark.
> Read `docs/DIAGNOSIS.md` for Phase 0 results.
> Owner preferences: dark #0a0a0f theme, electric blue #00d4ff; Phase 7 orb reference image
> received (amber mechanical core + ring design, on Desktop).
> Rule 5 of the new prompt: small diffs, finish one phase, stop, report. Do NOT auto-continue to the next phase.

## Environment
- Windows 11. Node v22.23.5 (portable) at `C:\Users\ramch\.local\nodejs` (on user PATH).
- Rust: rustup + cargo 1.100 (stable-msvc) installed; VS Build Tools at C:\VS2022Build.
- Python 3.12.10 system-wide; backend venv at `backend\.venv` (hermes-agent 0.19.0 + fastapi + uvicorn + httpx + pyautogui).
- Project: `C:\Users\ramch\Jarvis`. User kept a snapshot copy elsewhere.
- Hermes user data backed up: `Desktop\Hermes-Backup-2026-11-16_0123.zip` (362MB) + README.
  Reusable script: `tools\backup-hermes.ps1`. User's personal Hermes install was NOT touched.
- Launch everything: `start-jarvis.bat` (backend + vite) or `npm run tauri dev` (full desktop app).
- ⚠️ ACTION FOR USER: paste OpenRouter key in Settings tab (or backend\.env). I did NOT copy
  their Hermes credentials without consent — ask them tomorrow.

## Phase 1 of fix-and-finish — COMPLETE (real-window verified, 2026-11-16)
Evidence summary (full detail in `docs/DIAGNOSIS.md` §Phase 1 + this section):
- [x] **`tauri_plugin_global_shortcut` registered** (`.plugin(Builder::new().build())`) — the
  Phase 0 panic (`state() called before manage()`) is gone; window survives every launch.
- [x] **Backend lifecycle gate**: Rust spawns backend → polls `/health` over raw TCP → emits
  `backend://phase` events (`starting`/`ready`/`failed`) → `StartupGate.tsx` shows splash while
  booting, app when ready, **error screen with Copy logs + Try again** when failed (verified by
  deliberately hiding `main.py` — real error surfaced: "backend directory not found (main.py missing)").
- [x] **No orphaned backends — two independent mechanisms**: (1) explicit `kill_child()` on
  RunEvent Exit/ExitRequested; (2) kill-on-close **Windows Job Object** (new `windows` dep,
  target-gated) — verified: `Stop-Process -Force` on jarvis.exe killed the backend too.
- [x] **Native Windows 11 window controls** (`decorations: true`, `theme: Dark`) — real
  min/max/close ✕ confirmed by owner screenshot. In-app TitleBar traffic lights removed.
- [x] **OWNER DECISION (overrides plan): close = default Windows behavior.** ✕ quits the app;
  no hide-to-tray. Bug found while testing: closing main window left a zombie process (hidden
  mini window kept it alive) → fixed via `WindowEvent::Destroyed`(main) → `app.exit(0)`.
  Tray (Show/Hide/Mini/Quit) still available while the app runs.
- [x] **Dead code removed**: `src/lib/mockAgent.ts` deleted; `agentApi.health/setModel/
  runCommand/screenshot` removed; backend `/agent/model`, `/system/open-app|open-url|
  screenshot|run-command` endpoints removed; WS `ping/pong` branch removed; unused
  `desktop_control`/`HermesBridge` imports removed.
- [x] **Verified repeatedly in the real window (4 rounds)**: launch→backend ready in log;
  Ctrl+Shift+J show/hide cycle PASS (×2 rounds); single-instance PASS (2nd launch exits,
  ×2); ✕ close → process exits AND backend dies (×3); crash-kill → backend dies (job object);
  error screen PASS (spawn-failure injection); user themselves chatted in the real window
  (backend log shows real turns) and their OpenRouter key **works** (auth passed).
- Untested path (honest note): `restart_backend` "Try again" button is wired but not yet
  exercised end-to-end; splash "Still loading… (Ns)" progress text not observed (backend
  starts in ~5s, under the 8s threshold).
- Known issue for **Phase 2**: default model slug `deepseek/deepseek-chat-v3.1:free` is
  RETIRED on OpenRouter ("unavailable for free" 404) → chat fails with model errors even
  with a valid key. Fix: stop hardcoding free models; refresh from `/agent/models` live list.

## Phase 2 of fix-and-finish — COMPLETE (2026-11-17, endpoint + UI verified)

Scope: original plan (working keys/settings) + owner-requested chat model switcher.
Also fixed two crashes/bugs discovered during the owner's live testing.

- [x] **Secrets → Windows Credential Manager (keyring)**. One source of truth: backend
  venv got `keyring` 25.7.0 (WinVaultKeyring). New `backend/secret_store.py` (deliberately
  NOT named secrets.py — would shadow stdlib `secrets`, which Hermes imports). At startup
  `bootstrap_secrets()` migrates the legacy key out of backend/.env into Credential
  Manager and strips OPENROUTER_API_KEY lines from backend/.env AND hermes-home/.env.
  backend/.env keeps only non-secret settings. Verified: key migrated (73 chars), both
  env files clean, /agent/settings returns masked `sk-or-…c0f7` only.
- [x] **`hermes-home\.env` poisoning FIXED** (the empty `OPENROUTER_API_KEY=` line that
  hermes_cli/env_loader.py loads with override=True). `_ensure_env` no longer writes the
  key into that file (uses process env instead). Gotcha found: the poisoned file had a
  UTF-8 BOM so `.strip()` didn't match — reads now use `utf-8-sig`. File is now EMPTY.
- [x] **Masked display + Remove button** in Settings ("Saved: sk-or-…c0f7" + Remove).
  Enter submits the key field. Verified: removeKey → hasKey=false; re-save → back.
- [x] **Test connection** (POST /agent/test-connection): tiny real request GET
  /api/v1/key (documented OpenRouter endpoint) → plain-language result. Verified in UI:
  green "✓ Connection works — your key is valid (free tier, used 0/0)."; fake key →
  "Your API key was rejected (invalid or revoked)…"; no key → "No API key saved yet…".
- [x] **Plain-language provider errors** (`backend/errors.py`): 401 invalid key, 402 no
  credit, 404 retired-free-model vs unknown slug, 429 rate-limit (incl. the daily
  free-models-per-day quota message), 5xx, network. Hermes turns that "succeed" with an
  error string as the reply are detected (`is_error_reply`) and translated. Verified
  end-to-end via WS: raw "API call failed after 3 retries: HTTP 429…" now shows as
  "OpenRouter's daily free-model limit is used up (it resets every day)…".
- [x] **Retired default models fixed**: config.py defaults now verified-live free slugs
  (nvidia/nemotron-3.5-super-vl:free etc.); SettingsPage hardcoded fallback list REMOVED
  (model lists come from /agent/models live fetch only). Owner's saved nemotron slugs
  are valid and were confirmed by a real streamed reply.
- [x] **Chat model switcher (owner bonus, per their reference pic)**: `ModelPicker.tsx`
  pill in the composer (between input and mic) → popover with search + live free list
  (name, slug, context size, refresh button). Choice persists (localStorage
  jarvis-chat-model) and is sent as per-message `model` override. Backend: direct path
  uses it directly; hermes path does `BRIDGE.switch_model` (in-memory, not persisted).
  Verified: picker opened in UI with real list ("14 free models"), selection → pill +
  storage update, reset → Default; WS test with override → real streamed reply
  ("I'm Hermes Agent… created by NVIDIA") + PASS.
- [x] **CRASH FIX found in owner's live session**: `HermesBridge.request_confirmation`
  called nonexistent `self._emit` → every dangerous-tool confirmation raised
  AttributeError and derailed the turn (seen in app-p2b logs while owner chatted with
  the dots model). Fixed with `_emit_sink` set per turn in run_turn; no-sink → fail
  CLOSED (auto-deny). Unit-verified: request → resolve → approved=True; unknown id →
  False; no sink → deny.
- Honest notes: (a) owner's OpenRouter **daily free quota was used up** during testing
  (429 free-models-per-day) — live model replies after that point can only return the
  plain-language quota message until reset/credits; the switcher path itself was proven
  with a real reply earlier the same morning. (b) "Add 10 credits → 1000 free req/day"
  is worth doing. (c) Hermes file tools fail without Git Bash ("Git Bash not found…
  requires Git for Windows") — surfaced in the owner's session; needs handling in a
  later phase (install prompt or tool degradation).

## Phase 3 of fix-and-finish — COMPLETE (2026-11-18, real-window verified)

Goal: replicate the Hermes system inside JARVIS — every provider/model, tools,
MCP, cron, gateway — driven by Hermes's own surfaces, never hardcoded lists.

### Architecture (verified against the installed hermes-agent 0.19.0)
- Provider catalog: `hermes_cli.provider_catalog.provider_catalog()` → 41 providers
  (read in-process by `backend/hermes_control.py`, single source of truth).
- Keys: Windows Credential Manager, service "JARVIS", entry = canonical env var
  (`ANTHROPIC_API_KEY`, …); OpenRouter keeps legacy `openrouter_api_key`. At startup
  and on every agent rebuild, stored keys are published into `os.environ`; the
  gateway/cron child processes inherit them. Env files never hold secrets.
- Active provider: `JARVIS_PROVIDER` setting (e.g. `openrouter`, `anthropic`,
  `custom:<name>`), consumed by `hermes_bridge._build_agent`. `custom:<name>` entries
  live in `backend/hermes-home/config.yaml` `providers.<name>` with the schema
  Hermes's `resolve_user_provider` expects (`name`, `api`, `key_env`, `transport`).
- Models: OpenRouter live free list; other providers from models.dev (Hermes cache);
  custom endpoints probed at `{base_url}/models`. No static model lists anywhere.
- Toolsets: `hermes_cli.tools_config.CONFIGURABLE_TOOLSETS` → 25 groups. Toggles
  persist to `JARVIS_TOOLSETS` AND mirror into Hermes config via `hermes tools enable|disable`.
- MCP: `hermes mcp add|remove|test|catalog`, state in `config.yaml` `mcp_servers`.
- Cron: `hermes cron create|pause|resume|run|remove`, state in
  `backend/hermes-home/cron/jobs.json`. Jobs tick only while the gateway runs.
- Gateway: managed `hermes gateway run` child (pid tracked, logs to
  `hermes-home/logs/jarvis-gateway.log`), platform bot tokens in Credential Manager,
  start/stop/status/logs from the UI.
- Doctor: `hermes doctor` streamed to the Tools page.
- All CLI calls run the venv's `hermes.exe` with `HERMES_HOME=backend/hermes-home` —
  fully isolated from the owner's personal `%LOCALAPPDATA%\Hermes` install.

### UI
- New sidebar tabs: Providers, Tools, Tasks, Gateway (order: Assistant, Workspace,
  Providers, Tools, Tasks, Gateway, Skills, Memory, Settings).
- Providers: 36 keys-tab cards live from the catalog, API-key tab + Accounts/OAuth
  tab, search, masked saved key, Add/Update/Remove key, "Choose model" (live list →
  sets provider + default model), custom endpoint form + list, ACTIVE badge.
- Tools: 25 toolsets with toggles, MCP add/test/remove, "Run doctor" output panel.
- Tasks: create (schedule/name/prompt/deliver/repeat), pause/resume/run-now/delete,
  gateway-stopped warning.
- Gateway: status dot, start/stop, pid/platform/job counts, per-platform token
  cards (Telegram/Discord/Slack/Email), live log tail.

### Evidence (real Tauri window + live backend, 2026-11-18)
| Check | Result |
|---|---|
| `GET /hermes/providers` | 200 · 41 providers · OpenRouter `configured:true`, masked `sk-or-…c0f7` |
| Providers page (webview DOM) | header + 36 keys-tab cards, OpenRouter ACTIVE + masked key, Anthropic/Fireworks/etc. present |
| `GET /agent/settings` | `provider:"openrouter"`, `brain:"hermes"`, toolsets + customProviders fields present (env prefix fix works) |
| Toolsets list | 25, labels/descriptions from Hermes, all enabled by default |
| Toolset toggle | disable `video` → 24 items, `video` absent, persisted; re-enable → 25, present; UI switch reflects backend state |
| Tools page (webview DOM) | 25 toolset cards with real descriptions, MCP section, Run doctor button |
| Cron create | job `e3e418075a7d`, "once in 30m", next-run timestamp; remove → jobs [] |
| Gateway start | running pid 11092, Hermes banner in logs; status reports running; stop clean |
| Gateway page (webview DOM) | 4 platform cards with env-var names, Save, log tail rendered |
| Tasks page (webview DOM) | create form, "SCHEDULED JOBS (0)", gateway-stopped warning |
| `hermes doctor` | 116-line report returned and rendered |
| Frontend build | `npm run build` green |

### Bugs found & fixed in Phase 3 (do not regress)
1. `Settings` had **no env prefix**, so every `JARVIS_*` line in `backend/.env`
   (brain, models, TTS, provider, toolsets…) was silently ignored — saved settings
   appeared to revert on restart. Fixed with `env_prefix="JARVIS_"` (Tauri's
   `JARVIS_PORT` is unaffected; Rust reads the raw var).
2. First `set_toolset` implementation could re-add a tool it was disabling when
   the starting list was empty ("everything on"). Now: materialize full list when
   empty, remove the name, re-add only if `enabled`.
3. `persist_settings` needed explicit `toolsets` (list→CSV) and `customProviders`
   (dict→JSON) mappings — added.

### Honest notes
- Owner's OpenRouter **daily free quota is still exhausted** (429
  free-models-per-day). Non-OpenRouter provider chats and tool-call round-trips are
  wired but cannot be live-verified until a second provider key is added (or quota
  resets / ~$10 credits).
- Phase 3 does not install anything system-wide; all state stays in
  `backend/hermes-home` + Credential Manager.

### Contracts added
- REST: `GET /hermes/providers`, `POST /hermes/providers/key`,
  `POST /hermes/providers/remove-key`, `GET /hermes/providers/{slug}/models`,
  `POST /hermes/custom-providers[/remove]`, `GET /hermes/toolsets`,
  `POST /hermes/toolsets/toggle`, `GET /hermes/mcp[/catalog]`,
  `POST /hermes/mcp/add|remove|test`, `GET /hermes/cron`,
  `POST /hermes/cron/create|action`, `GET /hermes/gateway[/logs]`,
  `POST /hermes/gateway/start|stop|platform[/remove]`, `GET /hermes/doctor`,
  `GET /hermes/skills/hub`, `POST /hermes/skills/install|uninstall`.
- Settings payload additions: `provider`, `toolsets[]`, `customProviders{}`.

## Phase 4 of fix-and-finish — COMPLETE (2026-11-18, real-window verified)

Goal: control the PC and see the screen, with three-level permissions, a kill
switch and an audit log.

### Installs (owner consented via explicit click)
- Git for Windows 2.56.0 (winget) → Hermes file/terminal tools now have Git Bash.
- cua-driver 0.53.0 (official installer) → Hermes `computer_use` backend.
- Backend startup now prepends Git + cua-driver to PATH (`HC.ensure_tool_paths()`)
  so both work before the next logon refreshes the user PATH.

### Backend
- `app_index.py`: Start Menu index from `Get-StartApps` (186 apps here, cached 5m),
  fuzzy search (difflib + word overlap), launch via `shell:AppsFolder`,
  focus/minimize/maximize/restore/close via pywinauto UI Automation, window list,
  pyautogui typing/keys as the audited fallback.
- `file_ops.py`: extension→category plan, dry-run only until Apply, move-only,
  conflict detection, JSON undo journal (last 50 ops), protected-folder refusal.
  Defaults: Windows, Program Files (x86), ProgramData, Recovery, AppData, .ssh.
- `permissions.py`: per-tool modes ask/risky/allow (`JARVIS_PERMISSIONS`),
  risky-action classifier, process-wide kill switch, configurable global hotkey
  (default ctrl+shift+x, `keyboard` hook), append-only audit log
  (`hermes-home/logs/audit.jsonl`, rotated).
- `vision.py`: whole screen / one window / region → downscaled PNG → active
  provider's vision model (OpenAI-compatible; OpenRouter or custom endpoint).
  Plain-language errors for missing key, quota, or non-vision model.
- Guardrail rewritten to use `permissions.decide()`: kill switch blocks
  everything, allow/ask per tool, every decision audited. Confirmations timed
  out before — see bug 1 below.
- New endpoints: `/permissions*`, `/desktop/apps|launch|windows|window|type|keys`,
  `/files/plan|apply|undo|journal|protected`, `/vision/see|image`,
  `/hermes/computer-use/status`.
- Settings additions: `permissions`, `killSwitchHotkey`, `protectedFolders`,
  `visionModel`; Settings payload returns all of them plus kill-switch state.

### UI
- New **Control** tab: kill switch (engage/release + hotkey field), Start Menu
  search with Open/Focus/Close and the agent allowlist, file organizer (path →
  plan table → Apply → Undo last, protected folders editor), per-tool permission
  selects (rows from enabled Hermes toolsets), See-my-screen (screen or window,
  question, screenshot preview + answer), and the live audit feed (5s poll).
  Load is `Promise.allSettled` so one failed call can't blank the page.

### Evidence (real Tauri window + live backend)
| Check | Result |
|---|---|
| Start Menu index | 186 apps via `Get-StartApps` |
| Launch/focus/minimize/close | Notepad launched by appId, focused, minimized, closed |
| Typing (REST) | `hello from JARVIS` typed; clipboard round-trip exact match |
| Agent opens app | "Open Notepad and stop" → 16 approved computer_use actions (win+r, background clicks, focus_app, captures); final report says Notepad open |
| Agent types | "Type hello into it" → `computer_use type text=hello` → editor shows `hello from JARVIShello` |
| Vision | "app on screen is JARVIS" · "No, Calculator is not visible" · "yes, hello from JARVIS" (nvidia/nemotron-3.5-super-vl:free) |
| File plan/apply/undo (REST) | 6 moves planned → applied to Images/Documents/Music/Archives/Code/Other → undo restored all 6 |
| File flow (real UI) | Plan table → "Apply 6 move(s)" → "Moved 6 file(s). Undo is available." → "Restored 6 file(s)." |
| Protected folders | Test folder under AppData was refused (correct) |
| Kill switch | Engaged → `/desktop/launch` 403; released; audit entries for both |
| Kill-switch hotkey | ctrl+shift+x toggled on, second press released (`active: true`) |
| Permission override | terminal → allow persisted in settings and audit logged |
| cua-driver | `hermes computer-use status` → installed 0.53.0, up to date |
| Frontend build | `npm run build` green |

### Bugs found & fixed (do not regress)
1. **WS chat receive loop was blocked during a turn** (`await asyncio.to_thread(run_turn)`
   inside the receive loop), so `confirmation` messages were never processed and
   every dangerous tool timed out after 120s and was auto-denied. Turns now run
   as background tasks (`ChatSession._run_turn`), the loop keeps reading
   confirmation replies, and a second message while a turn runs gets a notice
   instead of interleaving.
2. Confirmations bypassed the old `confirm_dangerous_tools`-only check; all
   tool calls now go through `permissions.decide()` so the kill switch and
   per-tool modes actually apply.
3. Git/cua-driver installed mid-session weren't on the process PATH — Hermes
   reported "not installed". Fixed with `ensure_tool_paths()` at startup and on
   every child spawn.

### Honest notes
- **Calculator is not installed on this PC.** The agent checked processes,
  AppX packages, protocols and paths (25 iterations) and correctly reported it;
  its earlier 25-step thrash is visible in the audit log. Not a code defect, but
  a tighter iteration budget for "app not found" is worth adding later.
- Mouse/keyboard go through cua-driver background modes; the agent approved each
  action in the dialog (no silent input). pywinauto UIA is the window-control
  fallback.
- Tests only touched a scratch folder (`C:\Users\ramch\jarvis-files-test`, then
  removed) and the open Notepad buffer ("hello from JARVIS"). No owner files
  were moved or deleted.
- Vision needs an OpenAI-compatible provider (OpenRouter or custom endpoint);
  Anthropic-style vision APIs are not wired yet.

### Contracts added
- REST: `GET /permissions`, `POST /permissions/mode`, `POST /permissions/kill`,
  `GET /permissions/audit`, `GET /desktop/apps`, `POST /desktop/apps/refresh`,
  `POST /desktop/launch`, `GET /desktop/windows`, `POST /desktop/window`,
  `POST /desktop/type`, `POST /desktop/keys`, `POST /files/plan`,
  `POST /files/apply`, `POST /files/undo`, `GET /files/journal`,
  `GET|POST /files/protected`, `POST /vision/see`, `GET /vision/image`,
  `GET /hermes/computer-use/status`.
- Settings: `permissions{}` (tool→mode), `killSwitchHotkey`, `protectedFolders[]`,
  `visionModel`; settings GET includes `killSwitch{engaged,hotkey,active}`.

## Phase 5 of fix-and-finish — COMPLETE (2026-11-19, real-window + real-audio verified)

Goal: voice, search, video, music — with the speech stack moved to the Python
backend because Web Speech cannot work inside Tauri's WebView2.

### Why the backend owns speech (measured, not assumed)
- `SpeechRecognition` in the WebView ended the session immediately, and
  `getUserMedia` hung on a permission prompt the embedded webview never shows.
- Renderer TTS (`speechSynthesis`) **does** work and is kept there (no extra
  process, natural Windows voices).
- So: wake word + STT + PTT live in `backend/voice.py`; TTS stays in the renderer.

### Backend
- `voice.py`: `sounddevice` capture (16 kHz mono, ring buffer), **openWakeWord**
  (`hey_jarvis_v0.1.onnx`, default threshold 0.55), **faster-whisper**
  (`tiny.en` by default, auto-downloads once), push-to-talk global hotkey
  (`ctrl+alt+j` by default), `inject_wav()` test path, state machine
  (`stopped/idle/listening/thinking/speaking`), audio level publisher.
- The mic stream opens only when wake is enabled or a listen starts, so the
  device is not held open all day.
- TTS-state gate: while the renderer speaks it sends `{type:"tts_state"}`;
  detection is suppressed so JARVIS never transcribes its own voice. Mic
  button / PTT / Esc barge in and emit `voice_barge_in`.
- `spotify.py`: level 1 = URI-scheme search (`spotify:search:…`), level 2 =
  media keys (play/pause/next/prev via `keyboard`), level 3 = Spotify Web API
  with PKCE (owner's own client ID, tokens in Credential Manager, Premium
  required and stated in the UI). Redirect
  `http://127.0.0.1:8420/music/spotify/callback`.
- `actions.py`: deterministic router that runs **before** the LLM for
  Spotify/YouTube/browser/volume/media/stop commands, so those never depend on
  a model's tool-calling. "search for X" deliberately falls through to Hermes
  web search so the answer is summarized.
- Video branch: resolves the first YouTube result with `yt-dlp` and opens it,
  falling back to the search-results page.
- Voice turns are sent by the **main** (non-mini) window only; the backend
  forwards voice events to every WS session so the mini window shows state
  without double-sending.
- New endpoints: `GET /voice/status`, `GET /voice/mics`,
  `POST /voice/listen`, `POST /voice/cancel`, `POST /voice/test-wav`,
  `POST /actions/run`, `GET /music/spotify/status|auth-url|callback|search`,
  `POST /music/spotify/client|disconnect|play|control`.

### UI
- `src/lib/voiceController.ts`: owns transcript sending, wake toggle, barge-in,
  mic toggle; ignores `voice_transcript` in the mini window.
- `voiceEngine.ts` is TTS-only now and feeds `setAudioLevel` / TTS state to the
  backend.
- `InputBar` and `MiniPlayer` mic buttons call the backend (no Web Speech).
  Orb/mic visualiser uses the live level from `voice_level` events.
- Settings → **Voice**: wake-word toggle, microphone picker, STT model,
  PTT hotkey, "Test microphone" (records 4 s and shows the transcript), TTS
  on/off, rate and pitch.
- Settings → **Music**: Spotify client ID, Connect/Disconnect, live status,
  and the Premium note.
- Chat renders `voice_transcript`, `stop_speaking`, `action` and notice events.

### Evidence (real Tauri window + live audio, 2026-11-19)
| Check | Result |
|---|---|
| Mic enumeration | 13 input devices, Realtek array is default, Stereo Mix + Bluetooth headset listed |
| STT (real speech in) | SAPI wav "Reply with exactly: voice pipeline ok" → `Reply with exactly, voice pipeline okay.` (45 s first run incl. model load; 0.8–1.0 s after) |
| Wake word score | SAPI "Hey Jarvis" → **0.998** (threshold 0.55), `wakeModelReady: true` |
| Wake toggle | Settings → wake on → `state: idle, wakeEnabled: true, streamOpen: true`; off → `stopped` |
| Voice → turn → reply (window) | "🎙 Wake word detected — listening…" → transcript bubble → assistant reply "voice pipeline okay." |
| **Phase 5 done-when #1** | voice "Play lo-fi on Spotify." → *Opened Spotify search for “lo-fi”. Press play, or connect Spotify in Settings for exact playback.* (Spotify launched) |
| **Phase 5 done-when #2** | voice "Pause." → *Paused.* (media key) |
| **Phase 5 done-when #3** | voice "Open a YouTube video about volcanoes." → *Opening “Volcano | The Dr. Binocs Show | Learn Videos For Kids” on YouTube.* |
| Mic button (UI) | click → `state: listening, streamOpen: true`; cancel → `stopped` |
| Volume / mute (router) | "volume up 0" → *Volume set to 2%.*; "unmute" → *Unmuted.* (pycaw fix) |
| Test connection | NVIDIA NIM answered with `nvidia/nemotron-3.5-super-vl-120b-a12b` |
| Frontend build | `npm run build` green |

### Bugs found & fixed (do not regress)
1. **Provider/model mismatch ("the model doesn't exist on OpenRouter")** — the
   chat picker listed OpenRouter `:free` slugs while the active provider was
   NVIDIA NIM, and the direct fallback always hit OpenRouter. Now:
   - `model_router.stream_openrouter` streams from the **active** provider
     (`providers.list_providers()` profile: base URL, key env, headers), with
     custom endpoints as `custom:<name>`.
   - `errors.explain_*` name the real provider and handle 410 end-of-life;
     an OpenRouter 404 message can no longer be shown for NVIDIA.
   - A stale per-message override from another provider is **dropped** with a
     notice (never persisted); only an invalid persistent default is replaced,
     preferring the provider profile's `fallback_models`.
   - Switching provider in Settings/Providers rewrites **every** model tier
     (default/fast/heavy) that the payload doesn't set — fast/heavy can no
     longer keep a foreign id (this was the second half of the bug).
   - `InputBar` clears `jarvis-chat-model` when the provider marker differs.
   - Chat pickers ask for `?chat_only=true`; embed/rerank/image/TTS ids are
     filtered out (`HC.is_non_chat_model`).
2. **Per-message model override leaked into the saved settings** —
   `HermesBridge.switch_model` mutated the cached `Settings` object, so
   `/agent/status` and later turns reported the picker's model as the default.
   Now an explicit `_override_model` is used (`rebuild(keep_override=True)`),
   `rebuild()` resets `_current_model`, and nothing touches persisted settings.
3. **Replies with no streamed tokens were invisible** — translated error
   replies and tool-only answers arrive in `final_text` with no `token` events.
   `_run_turn` now counts streamed tokens and emits `final_text` as a token
   when none were sent (verified: "stale override handled", "backend ok").
4. **Models.dev lists retired ids** (`moonshotai/kimi-k2.6` → HTTP 410 end of
   life 2026-11-15). Auto-selection now prefers the provider profile's
   `fallback_models`; 410 is explained in plain language.
5. Test-connection was OpenRouter-only and always checked `/key`; it now tests
   the active provider (1-token completion for non-OpenRouter).
6. **Volume/mute were broken on modern pycaw** — `AudioUtilities.GetSpeakers()`
   returns an `AudioDevice` whose old `.Activate()` path raises
   *"'AudioDevice' object has no attribute 'Activate'"* (the smoke test caught
   it on every volume/mute command). `actions._volume_interface()` now uses
   `AudioDevice.EndpointVolume` with the old API as a fallback. Verified via
   `POST /actions/run` ("volume up 0" → *Volume set to 2%.*, "unmute" →
   *Unmuted.*) and a read-only check of the current level.

### Honest notes
- The first faster-whisper run downloads the model (~40 s); later runs are ~1 s.
- Voice commands were verified with synthesized speech played through the
  backend's `inject_wav`, which is the same code path as the microphone
  (capture → wake/PTT → STT → event → turn → action). A live spoken test
  through the physical mic is still worth doing with the owner present.
- Spotify precise playback (level 3) is implemented but **not** exercised: it
  needs the owner's client ID and a Premium account. Levels 1 and 2 were tested.
- Barge-in and the PTT hotkey are wired and registered (`ptt=ctrl+alt+j` in the
  log) but were not keypress-tested in this pass.
- Wake word is **off by default**; the owner turns it on in Settings → Voice.

### Contracts added
- REST: `GET /voice/status`, `GET /voice/mics`, `POST /voice/listen`,
  `POST /voice/cancel`, `POST /voice/test-wav`, `POST /actions/run`,
  `GET /music/spotify/status`, `GET /music/spotify/auth-url`,
  `GET /music/spotify/callback`, `POST /music/spotify/client`,
  `POST /music/spotify/disconnect`, `POST /music/spotify/play`,
  `GET /music/spotify/search`, `POST /music/spotify/control`.
- WS (server→client): `voice_state` (`idle|listening|transcribing|stopped`),
  `voice_wake`, `voice_level`, `voice_transcript`, `voice_barge_in`,
  `voice_error`, `stop_speaking`, `action`, `notice`;
  (client→server): `tts_state`.
- Settings GET: `voice{state,wakeEnabled,wakeWord,wakeThreshold,micDevice,
  sttModel,pttHotkey,streamOpen,wakeModelReady,sttReady,…}` + `tts{}`,
  `spotify{configured,authorized,clientIdMasked,redirectUri,premium,displayName,product}`.

## OWNER EXTRAS requested 2026-11-17 (note & schedule — do not forget)
0. **UI preference (done same day): plain BLACK background** — owner found the bluish-grey
   glow washes "cheap". Changes: --color-background #000000, neutralized surface/elevated/
   border tokens, removed body radial glows, removed the blue radial wash behind the orb,
   orb camera 4.4 → 5.8 (owner: "blob too big, can't see the messages"). Built + HMR-verified;
   real-window screenshot pending (window was minimized at capture time).
1. **Reply/quote system** for chat messages (like their reference pic) → chat-UX phase
   (candidate: right after Phase 3, or bundle with attachments).
2. **Attachments: files, images, "anything else"** in chat → chat-UX phase (needs
   multimodal model support + upload path; also feeds Phase 4 vision).
3. **Permission settings** → **DONE in Phase 4**: three levels per tool
   (ask / ask-if-risky / always allow), global kill switch with configurable
   hotkey, live activity/audit feed, protected folders for file organization.
4. **Multi-provider system replicating Hermes** (multiple providers, multiple models,
   every API provider Hermes supports — not just OpenRouter) → **DONE in Phase 3**:
   Providers tab (41-provider catalog, per-provider keys, live model lists, custom
   OpenAI-compatible endpoints for Ollama/LM Studio), active-provider switch in the
   runtime. Provider chats beyond OpenRouter await a second key/quota reset (see
   Phase 3 honest notes).


## Status — ALL ORIGINAL LAYERS COMPLETE ✅
- [x] Layer 1 — scaffold, design system, shell (sidebar w/ labels, titlebar w/ arc-reactor icon, stores, pages)
- [x] Layer 2 — JarvisOrb: 4 states + orbStore (persisted localStorage jarvis-orb) + OrbCustomizer panel
  - Styles: core / swirl (default; matches concept art) / plasma / holo; ring toggle; intensity & speed sliders
- [x] Layer 3 — ChatWindow (bubbles, hover timestamps, Prism code blocks w/ copy, thinking dots, streaming cursor,
  glass greeting, system chips), InputBar (send/mic/interim transcript/Enter+Shift+Enter/connection dot),
  voiceEngine (STT/TTS wrappers + synthetic audioLevel). (mockAgent.ts deleted in Phase 1 — dead code)
- [x] Layer 4 — backend: config.py (env-driven; POST /agent/settings persists to backend/.env),
  hermes_bridge.py (AIAgent; HERMES_HOME=backend/hermes-home ISOLATED from user's %LOCALAPPDATA%\Hermes;
  ConfirmationGuardrail blocks dangerous tools pending WS approval w/ timeout auto-deny; OpenRouter fallback),
  model_router.py (streaming + heavy/fast keyword routing + free-model list), desktop_control.py
  (allowlisted open_app/screenshot/run_command), main.py (WS /ws/chat: status|thinking|token|tool_call|
  confirm_request|notice|error|done + REST: health, agent/status|memory|skills|models|model|brain|settings,
  system/*, workspace/run-code). Hermes plugins load fine (53 found); only the key is missing.
- [x] Layer 5 — websocketService (backoff reconnect + queue), agentService (event→store glue, TTS on done,
  barge-in, artifact capture), agentApi REST client, ConfirmationDialog (global approve/deny),
  chat persistence (zustand persist jarvis-chat, cap 100). E2E VERIFIED: "Backend connected".
- [x] Layer 6 — Workspace: artifact detection from replies (fences → code/html/three/markdown),
  ArtifactRenderer (Prism+Run w/ confirm modal → /workspace/run-code w/ 15s timeout → output panel;
  sandboxed iframes allow-scripts for html/three via CDN importmap; mini md renderer),
  split 38/62 layout, history strip last 5, Clear/Download/Fullscreen. VERIFIED: python ran (hello 0/1/2).
- [x] Layer 7 — MemoryPage (search, delete, content viewer, skeleton/empty states — LIVE data verified:
  Soul.md from sandboxed hermes-home), SkillsPage (grid, view modal, delete, exact spec empty copy),
  SettingsPage (API key save → backend .env, Brain auto/hermes/direct, model dropdowns from live free list,
  TTS enable/rate/pitch + test button, wake word toggle, safety toggle, backend URL override, About/credits).
- [x] Layer 8 — Tauri shell: tray (Show/Toggle mini/Hide/Quit, left-click toggle), global hotkey Ctrl+Shift+J,
  single-instance, backend child process (venv python, CREATE_NO_WINDOW; Phase 1: readiness gate + Job-Object
  + explicit kill — no orphans ever), native Windows 11 window controls + dark title bar (Phase 1; close =
  default quit, no hide-to-tray), startup splash/error gate (Phase 1), Cargo.toml w/ tray-icon +
  single-instance + global-shortcut plugins + windows (JobObjects), capabilities for main+mini,
  README.md, start-jarvis.bat. Phase 1 real-window verification: 4 rounds, all PASS (see Phase 1 section).

## Phase 2 extras (done beyond original scope)
- [x] "Hey JARVIS" wake word: continuous SpeechRecognition w/ auto-restart, pause/resume on agent busy,
  window show+focus via Tauri API, chime, handoff to command listening. Toggle in Settings
  (localStorage jarvis-wake-word). Wake loop pauses while listening/speaking. (Backend openWakeWord =
  possible upgrade; interface-compatible with wakeWord.ts.)
- [x] Mini player: Tauri "mini" window (300x380, always-on-top, frameless, skip taskbar, hidden default;
  tray "Toggle mini player"), #mini route → MiniPlayerPage (compact orb, last reply via localStorage
  storage-event sync, mic, drag region, hide btn). NOTE: separate JS context — chat view syncs one-way
  from main window; mic in mini creates its own WS session.
- [x] Esc interrupts (stops speaking + listening).
- [x] Chat history survives restarts.
- [x] docs/ROAMIES-NOTES.md — Roamies analyzed for inspiration ONLY (AGPL-3.0; zero code/assets taken).
  Roadmap candidates: Reminders tab via hermes cron, Ollama/LM Studio endpoint field, push-to-talk,
  better TTS voices, region-ask w/ vision model.

## Verified in browser (multiple passes, zero console errors)
chat E2E → thinking → stream → done → TTS; code fences → Prism (72 tokens) → copy; orb styles swap +
persist; tab switching; memory/skills/settings live data; workspace render + run-code loop; chat
persistence across reload; mini route; WS auto-reconnect (shows "Backend connected").

## Bugs found & fixed (do not regress)
1. framer-motion `AnimatePresence mode="wait"` DEADLOCKS page swaps in this env (App + Workspace) —
   replaced with plain keyed motion.div remounts. Do not reintroduce mode="wait".
2. Windows PowerShell: relative exe paths starting with `.` fail — use absolute paths / call operator.
3. Vite file watcher occasionally misses edits to main.tsx (stale transform) — restart dev server if a
   fresh page shows old behavior.
4. std::process::Command creation_flags needs `use std::os::windows::process::CommandExt;` (cfg-gated).

## Contracts
- WS /ws/chat server→client: {type: status(brain,model)|thinking(bool)|token(content)|tool_call(tool,args)|
  confirm_request(requestId,tool,args)|notice(message)|error(message)|done(fullResponse,brain)}
  client→server: {type: message(content)|confirmation(requestId,approved)|ping}
- REST: GET /health, /agent/status|memory|skills|models|settings, memory/skills content?path=,
  DELETE memory|skills?path=, POST /agent/model{model,tier}, /agent/brain{brain}, /agent/settings{...},
  /system/open-app|open-url|screenshot|run-command, /workspace/run-code{language,code}
- localStorage keys: jarvis-orb (orb prefs), jarvis-chat (history), jarvis-tts, jarvis-wake-word,
  jarvis-backend-url (REST base; WS derives from it)
- Ports: 1420 frontend, 8420 backend. CORS: localhost:1420 + tauri.localhost.

## Phase 6 of fix-and-finish — COMPLETE (2026-11-20, real-window & HUD verified)

Goal: Workspace that really builds things (3D/2D, versions, self-repair) + Tony Stark HUD layout transformation.

### Architecture & Features
- **Tony Stark HUD Layout**: The home screen transformed from a text-messenger into a voice-first command deck.
  - Left HUD column (~370px): companion 3D Arc Reactor / Orb with real-time speech subtitles, glowing state badge, telemetry, quick blueprint starters, and discreet input bar. Full chat history available via collapsible overlay.
  - Right stage (flex-1): Live Workshop Bench. Renders the active artifact (Three.js 3D model, canvas simulation, SVG, or HTML mini-app) immediately in front of the user. No manual tab navigation needed.
- **Voice UI Navigation**: "Open workspace / memory / settings / tools / control / tasks" automatically switches views and confirms in character ("Opening workspace, sir.").
- **3D Workshop Stage Voice Controls**: "Pull it apart", "Put it back together", "Camera from the top / front", "3D print it" (GLB export), "Photograph it" (PNG render).
- **Workspace Engine**: Bundled Three.js + OrbitControls runtime (`runtime.generated.js`), sandboxed iframe with `window.JARVIS` helper API, versioning with undo, error self-repair, GLB/PNG export.
- **Cleanup**: Obsolete temporary test files removed (`car.html`, `cube-viewer.html`, `cube.obj`, `tmp_eval.js`).
- Build status: `npm run build` PASS (tsc + vite green).

## Next up (with user)
1. **PHASE 7** — The Orb & Visual Controls (amber mechanical core + orbital rings styling per reference, Appearance controls for size, speed, intensity).
2. **PHASE 8** — Standalone Windows Installer (`npm run tauri build` bundling embedded Python + Hermes runtime).
3. **PHASE 9** — Final polish and acceptance.
3. Chat-UX owner extras, still open: reply/quote system and file/image
   attachments (schedule with the owner; they pair well with Phase 6/7 work).
- Phase 5 note: wake word is off by default; enable it in Settings → Voice.
- Spotify precise playback needs the owner's client ID + Premium; search and
  media keys work without them.
- Owner's OpenRouter daily free quota was exhausted 2026-11-17; the active
  provider is now NVIDIA NIM, so OpenRouter quota only matters if they switch.
- Owner preferences to honor: default Windows window behavior (done in Phase 1);
  pure black background (done); smaller orb so chat stays readable (done);
  Phase 7 orb = amber mechanical core+ring reference (spec before coding).
- Old browser-era notes below are historical; every real-window guarantee is
  now Phase 1–5 verified.
