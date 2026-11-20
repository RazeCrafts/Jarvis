# Phase 0 Diagnosis — evidence, root causes, fix order

Date: 2026-11-16. Method: live reproduction, log capture, code reading. No fixes applied in this phase.
Reference: `Desktop\JARVIS fix-and-finish prompt.md`. PROJECT_STATE.md read first, as instructed.

---

## 1. `npm run tauri dev` — what actually happens (evidence)

Command run; full log captured to `%TEMP%\opencode\tauri-dev.log`.

Sequence observed:

1. Vite starts on 1420, Rust compiles (first build, ~360 crates).
2. **Window opens** — the webview loads the UI and talks to the spawned backend
   (backend log shows `OPTIONS/GET /agent/skills 200` arriving from the app webview).
3. Backend child process spawns correctly (`Uvicorn running on http://127.0.0.1:8420`).
4. **The window process then panics and dies:**

```
thread 'main' (12320) panicked at
tauri-2.12.5\src\lib.rs:761:7:
state() called before manage() for
tauri_plugin_global_shortcut::GlobalShortcut<tauri_runtime_wry::Wry<tauri::EventLoopMessage>>
error: process didn't exit successfully: `target\debug\jarvis.exe` (exit code: 101)
```

5. The spawned backend is **orphaned** — it keeps listening on 8420 after the app is gone.

**Root cause (exact):** `src-tauri/src/lib.rs` registers only
`.plugin(tauri_plugin_single_instance::init(...))` (line 102). The
`tauri_plugin_global_shortcut` crate is a dependency and its trait is imported
(line 13) and used (line 184 `app.global_shortcut()…`), but the plugin was never
registered with `.plugin(tauri_plugin_global_shortcut::init())`. Calling
`app.global_shortcut()` therefore fetches unmanaged state → panic.

**Consequences:** every earlier browser-based checkmark in PROJECT_STATE.md is
unverified-in-window, as the prompt predicted. The app window currently cannot
survive launch. Also the "backend starts and stops with the app" guarantee is
false today (orphaning, observed above).

**Fix (Phase 1):** register the plugin; additionally make backend shutdown
explicit (kill child in `on_window_event`/exit handler rather than relying on
Drop semantics during panic), and add a panic hook / error screen.

---

## 2. API-key bug — full reproduction (evidence)

Backend used standalone (uvicorn on 8420). Test key: `sk-or-test-abc123456789` (fake).

| Step | Result |
|---|---|
| `POST /agent/settings {"openrouterApiKey": …}` | `{"ok":true,"applied":["openrouter_api_key"]}` |
| `GET /agent/settings` right after | `hasKey: true`, masked shown |
| `backend\.env` on disk | `OPENROUTER_API_KEY=sk-or-test-abc123456789` present |
| Kill + restart backend, `GET /agent/settings` | **`hasKey: true` — persists across restart** |
| WS turn with the fake key | `brain: hermes`, reply text `HTTP 401: Missing Authentication header` |
| Wire decode (direct httpx to OpenRouter) | fake key → `401 Missing Authentication header`; no key → `401 No cookie auth credentials found` |

**Conclusion:** at the backend level the key chain **works** — save, persist,
restart, and delivery to the model provider (the 401 is the fake key being
rejected; a real key would pass). Two latent backend issues found anyway:

- `backend/hermes-home/.env` was left containing an **empty**
  `OPENROUTER_API_KEY=` line (written by `hermes_bridge._ensure_env()` during the
  first keyless init). Hermes loads that file with `override=True`
  (`hermes_cli/env_loader.py:313-315`), so an empty value poisons every Hermes
  code path that reads the env var directly (CLI subprocesses, gateway). The
  chat path is unaffected (explicit `api_key` param wins), but this must be
  fixed in Phase 2 (never write empty values; keep one source of truth).
- A 401 from the provider is surfaced as **assistant reply text**
  (`done.fullResponse = "HTTP 401: …"`) instead of a structured error — bad UX,
  fix in Phase 2 alongside Test-connection.

**The user-visible bug is frontend + operational.** Reproduced with the UI:

- Backend **down** (the state the owner actually had — the backend only runs if
  manually started; nothing launches it in browser mode): typing a key and
  pressing Save shows a bare **"Failed to fetch"** banner (the catch in
  `saveApiKey` sets `error` to `exc.message` only), saves nothing, and a page
  refresh discards the typed text → *"the key disappears and the app still says
  no key is available."* Console spams `WebSocket connection to
  'ws://127.0.0.1:8420/ws/chat' failed` every few seconds.
- Pressing **Enter in the key field does nothing** (verified by clean bisect:
  Enter-only → disk unchanged, `hasKey` stays false; only the Save button
  submits). Users who press Enter believe it saved.

**Fix order (Phase 2):** single secret store (Windows Credential Manager via
`keyring` OR Hermes env — pick one, document), masked display + Remove button,
plain-language **Test connection** button, Enter submits, offline state shown
prominently with a "backend not running — start JARVIS" call to action.

---

## 3. Endpoint / WebSocket usage audit (UI ↔ backend)

**REST endpoints actually used by the UI:**
`/agent/status`, `/agent/settings` (GET+POST), `/agent/brain`,
`/agent/models`, `/agent/memory` (+`/content`, DELETE), `/agent/skills`
(+`/content`, DELETE), `/workspace/run-code`.

**Dead from the UI** (defined, never called):
- `agentApi.health` → `GET /health` (UI-side; still useful for Tauri readiness)
- `agentApi.setModel` → `POST /agent/model`
- `agentApi.runCommand` → `POST /system/run-command`
- `agentApi.screenshot` → `POST /system/screenshot`
- backend `POST /system/open-app`, `POST /system/open-url` — no caller at all

**WebSocket events:** all 8 frontend cases (`status, thinking, token, tool_call,
confirm_request, notice, error, done`) have backend emitters — no dead events.
Client→server `ping` is never sent (`pong` path is dead). `tool_call` /
`confirm_request` only ever fire in hermes-brain mode.

**Dead frontend code:** `src/lib/mockAgent.ts` (only referenced by a comment in
`agentService.ts`). The mini player exists but has never been verified in the
real window (its Rust window is created before the panic point, so it is
plausibly functional, but unproven).

---

## 4. Proposed fix order (matches the prompt's phases)

1. **Phase 1** — register `global_shortcut` plugin (one line); explicit backend
   shutdown; wait-for-`/health` before showing UI; splash + error screen with
   copy-logs; Windows-native window controls (replace macOS traffic lights);
   verify tray/hotkey/single-instance in the real window; delete
   `mockAgent.ts` and dead endpoints/fields.
2. **Phase 2** — keyring-backed secrets, masked display, Remove, Test
   connection, Enter submits, plain-language offline state; fix empty
   `hermes-home\.env` poisoning; structured provider errors instead of
   401-as-chat-text.
3. **Phase 3+** — per the prompt (full Hermes surface: providers, tools,
   skills hub, MCP, cron, messaging gateway), then PC control/vision (Phase 4),
   voice/media (Phase 5), Workspace upgrade (Phase 6), orb per reference image
   (Phase 7 — reference image received and noted: amber mechanical core-and-
   ring design, will get its own spec before coding), installer (Phase 8).

## 5. Things verified TRUE today (no complaint)

- Backend REST save/persist/restart of the key works.
- Hermes runtime initializes and sends the key to the provider (401 decode
  proves the header was present).
- WS protocol is fully wired end-to-end (status/thinking/done observed).
- Vite build, TypeScript, Python, and `cargo check` all pass.

## 6. Cleanup done during diagnosis

- Fake test keys removed from `backend\.env` and `backend/hermes-home\.env`
  restored to empty (`OPENROUTER_API_KEY=` line) — owner must still paste a
  real key; nothing of theirs was touched or copied.
- Orphaned backend processes killed; ports 1420/8420 freed after the crash
  test; dev pair (vite + backend) relaunched detached for continued browser
  preview until Phase 1 delivers the real window.
