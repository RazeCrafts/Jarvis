"""JARVIS backend configuration.

Non-secret settings are read from backend/.env (see .env.example) so nothing
is hardcoded. Settings changes made in the app's Settings tab are persisted
back to this file by main.py (POST /agent/settings).

Secrets (API keys) are NOT stored here — they live in Windows Credential
Manager, managed by secrets.py (Phase 2: one source of truth).
"""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        env_prefix="JARVIS_",
        extra="ignore",
        case_sensitive=False,
    )

    # --- server ---
    host: str = "127.0.0.1"
    port: int = 8420

    # --- brain ---
    # "hermes" = hermes-agent runtime (needs a provider key), "openrouter" =
    # direct OpenRouter chat (always available fallback), "auto" = hermes with
    # automatic fallback to openrouter if the runtime can't start.
    brain: str = "auto"

    # --- openrouter / models ---
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    # Active Hermes provider slug (Phase 3). "openrouter", "anthropic",
    # "custom:<name>" (user-defined OpenAI-compatible endpoint), etc.
    provider: str = "openrouter"
    # Defaults are just fresh-install fallbacks; the Settings UI and the chat
    # model picker load the LIVE free list from OpenRouter (/agent/models).
    # Never assume these stay valid — OpenRouter retires free slugs.
    default_model: str = "nvidia/nemotron-3.5-super-vl:free"
    fast_model: str = "nvidia/nemotron-3.5-lightning:free"
    heavy_model: str = "nvidia/nemotron-3-ultra-550b-a55b:free"

    # --- safety ---
    # Require frontend approval before the agent runs dangerous tools
    # (terminal/shell, computer use, file writes outside its home).
    confirm_dangerous_tools: bool = True
    confirmation_timeout_seconds: int = 120
    # Apps desktop_control may open without confirmation (empty = confirm all).
    allowed_apps: str = "notepad,calculator,explorer,spotify,chrome,edge,code"
    # Max seconds a desktop-control action may block.
    desktop_action_timeout_seconds: int = 15

    # --- voice (frontend reads these via /agent/settings) ---
    tts_enabled: bool = True
    tts_rate: float = 0.98
    tts_pitch: float = 0.85
    # Backend listening (Phase 5): WebView2 speech recognition is unusable, so
    # the microphone, wake word and STT live in the Python backend.
    wake_word_enabled: bool = False
    wake_word: str = "hey_jarvis_v0.1"
    wake_threshold: float = 0.55
    stt_model: str = "tiny.en"
    voice_language: str = "en"
    mic_device: str = ""
    ptt_hotkey: str = "ctrl+alt+j"
    voice_silence_ms: int = 700
    voice_max_seconds: int = 15

    # --- music (Phase 5) ---
    # User's own Spotify developer app client ID (PKCE; no secret stored).
    # Premium is required for playback control through the Web API.
    spotify_client_id: str = ""
    spotify_redirect_uri: str = "http://127.0.0.1:8420/music/spotify/callback"

    # --- toolsets ---
    # Comma-separated list of enabled toolset names (subset of CONFIGURABLE_TOOLSETS).
    toolsets: str = ""

    # --- PC control, vision & permissions (Phase 4) ---
    # JSON map: tool name -> "ask" | "risky" | "allow". Empty = default posture.
    permissions: str = ""
    # Global kill switch (blocks every tool/desktop action while on).
    kill_switch_hotkey: str = "ctrl+shift+x"
    # Semicolon-separated absolute folders file organization must never touch.
    # Empty = built-in defaults (Windows, Program Files, AppData, …).
    protected_folders: str = ""
    # Vision model for "see my screen"; empty = default_model.
    vision_model: str = ""

    # --- custom providers (user-defined, merged into runtime) ---
    # JSON dict: { "name1": { "api_url": "...", "key_env": "...", "transport": "...", "base_url_env_var": "..." }, ... }
    custom_providers: str = ""

    @property
    def allowed_apps_list(self) -> list[str]:
        return [a.strip().lower() for a in self.allowed_apps.split(",") if a.strip()]

    @property
    def toolsets_list(self) -> list[str]:
        """Return enabled toolset names as a list (empty string → all default)."""
        if not self.toolsets:
            return []
        return [s.strip() for s in self.toolsets.split(",") if s.strip()]

    @property
    def custom_providers_dict(self) -> dict:
        """Parse custom_providers JSON; return {} on failure."""
        import json
        try:
            return json.loads(self.custom_providers) if self.custom_providers else {}
        except Exception:
            return {}


@lru_cache
def get_settings() -> Settings:
    return Settings()


def persist_settings(updates: dict[str, str]) -> None:
    """Merge updates into backend/.env (creating it if needed)."""
    env_path = BACKEND_DIR / ".env"
    lines: list[str] = []
    if env_path.exists():
        lines = env_path.read_text(encoding="utf-8").splitlines()

    keys = {k.upper() for k in updates}
    kept: list[str] = []
    seen: set[str] = set()
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in line:
            kept.append(line)
            continue
        name = line.split("=", 1)[0].strip().upper()
        if name in keys:
            seen.add(name)
            continue  # drop; re-added below in canonical order
        kept.append(line)

    for name in sorted(keys):
        value = updates[name.lower()]
        kept.append(f"{name}={value}")

    env_path.write_text("\n".join(kept).rstrip() + "\n", encoding="utf-8")

    # Bust the cached settings so the running process picks changes up.
    get_settings.cache_clear()
