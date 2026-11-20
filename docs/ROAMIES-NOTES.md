# Roamies — Analysis Notes (inspiration only)

Repo: https://github.com/KenKaiii/Roamies — **AGPL-3.0 licensed.**
⚠️ No code, assets, models or text were taken from it (license requires sharing
derivatives; we stay clean-room). This file is a feature analysis for roadmap
inspiration only, as requested.

## What Roamies is
A Tauri-based desktop companion ("desktop pet") with an AI sidekick that lives
on your screen: talks, remembers commitments, reminds you, reads/points at your
screen, and can click/type in other apps. macOS + Windows (+ Linux beta).

## Feature breakdown & how JARVIS maps to each

| Roamies feature | JARVIS status | Notes / idea |
|---|---|---|
| Desktop creature near cursor, 3 sizes | ❌ (we have orb in app + mini player) | The **mini player** (~done) is our "always with you" surface. A desktop-pet orb is possible later as a click-through transparent Tauri window. |
| Hold Ctrl+Alt to talk (push-to-talk) | ⚠️ partial | We have wake word + mic button. PTT would need a global shortcut + audio capture outside the webview → backend `sounddevice` loop + VAD. Good Phase 3 item. |
| Tap Ctrl+Shift for a tiny type bar by cursor | ❌ | Could reuse our mini window as a quick-ask field. |
| Spoken replies w/ personality voices (Fish Audio / Gemini) | ✅ basic | We use Web Speech TTS (free, local-ish). Upgrade path: ElevenLabs/Fish Audio key in Settings → voice dropdown. |
| **Remembers what you said you'd do + NL reminders** ("every weekday at 9") | ⚠️ Hermes has `cron` built-in but it's not exposed in UI yet | **Best next feature**: a Reminders tab that talks to `hermes cron` via our bridge. |
| **Screen annotations** (rings buttons, step walkthroughs, answer cards w/ diagrams/3D) | ⚠️ partial | Our Workspace renders live HTML/3D "answer cards" already. True screen-overlay drawing = transparent always-on-top window + screenshot grounding. Big project; note for Phase 4. |
| Reads other apps (Windows UI Automation) + GUI grounding (Qwen3-VL etc.) | ❌ | Hermes has computer-use tools; precise GUI grounding needs a vision model. Possible via Hermes provider config later. |
| Clicks/types in other apps (with gates) | ⚠️ | Hermes computer_use toolset + our Approve/Deny guardrail cover the same ground safely. |
| Ask about an area (Ctrl+Shift+A region select) | ❌ | Screenshot region → vision model. Backend `desktop_control.take_screenshot` exists; needs region select UI. Phase 3+. |
| Local models (Ollama / LM Studio / OpenAI-compatible) | ⚠️ | Hermes supports custom base_url. **Easy win**: Settings → "Custom endpoint (Ollama/LM Studio)" field → bridge provider config. |
| Safe by default: risky actions gated, always ask | ✅ | We ship this (confirmation guardrail + Run confirmations). |
| "Shows its work": tool animations | ⚠️ | We show tool_call chips; could add per-tool icons/animations later. |
| No taskbar presence, hide/show hotkey, **Esc stops reply** | ✅/✅/✅ | Tray + Ctrl+Shift+J + skip_taskbar mini; **Esc stop implemented** (takes the idea, trivially standard UX). |
| Self-updating, signature-checked | ❌ | Tauri updater plugin later; skip for personal build. |
| Keys in OS keychain (DPAPI on Windows) | ❌ | We store keys in backend/.env (file perms on user profile). Keyring upgrade possible via `keyring` Python package. |
| No analytics, privacy doc | ✅ | JARVIS is fully local; only model calls leave the machine. |

## Directly actionable next steps (in priority order)
1. **Reminders tab** backed by Hermes cron (NL → schedule). Highest value/effort ratio.
2. **Custom local endpoint** in Settings (Ollama/LM Studio) — Hermes already supports it.
3. **Push-to-talk** via backend audio loop (Ctrl+Alt hold) — pairs with wake word.
4. **Better TTS voices** (provider key + voice picker in Settings).
5. **Region ask** (screenshot region → vision question) once a vision model is configured.

## Architecture observations (no code taken)
- Roamies runs the agent in a **Node sidecar**; we run Hermes in a Python venv —
  same pattern, better fit for Hermes.
- Their "JARVIS" persona is literally "a glowing sphere that ripples as it
  speaks" — our orb already does this with real 3D shaders.
- Their model requirements list (vision + tools + grounding + 32k ctx) is a
  useful checklist for when we wire screen understanding into JARVIS.
