"""Hermes Agent bridge.

Wraps the hermes-agent `AIAgent` runtime in a thread-safe, queue-based
interface the FastAPI WebSocket layer can stream from.

Isolation: the runtime runs with HERMES_HOME pointed at
backend/hermes-home so it NEVER touches the user's personal Hermes install
(%LOCALAPPDATA%\\Hermes). Set HERMES_HOME before importing this module (main.py
does it first thing).

Safety: dangerous tools (terminal/shell, computer use, file writes) pass
through a guardrail that, when confirmations are enabled, blocks the tool
until the frontend approves it over the WebSocket. Denials feed a synthetic
tool result back to the model instead of executing anything.

Fallback: if the Hermes runtime can't start (missing key, import error, bad
config) the bridge reports mode "openrouter" and the model_router takes over,
so the app always responds.
"""

from __future__ import annotations

import logging
import os
import queue
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from config import BACKEND_DIR, Settings, get_settings
from secret_store import get_openrouter_key

logger = logging.getLogger("jarvis.hermes")

HERMES_HOME = BACKEND_DIR / "hermes-home"

# Tools that can affect the real world and therefore require confirmation
# when confirm_dangerous_tools is on. Matched by prefix so variants
# (e.g. "shell_command_v2") stay covered.
DANGEROUS_TOOL_PREFIXES = (
    "shell",
    "terminal",
    "bash",
    "computer",
    "desktop",
    "mouse",
    "keyboard",
    "screen",
    "file_write",
    "write_file",
    "edit_file",
    "delete",
    "move_file",
    "run_",
    "execute",
)


def is_dangerous_tool(name: str) -> bool:
    lowered = name.lower()
    return lowered.startswith(DANGEROUS_TOOL_PREFIXES)


@dataclass
class PendingConfirmation:
    tool_name: str
    args: dict[str, Any]
    event: threading.Event = field(default_factory=threading.Event)
    approved: bool = False


class ConfirmationGuardrail:
    """Human-in-the-loop gate for dangerous tools.

    Implements the same interface as agent.tool_guardrails.ToolCallGuardrailController
    (before_call / after_call / reset_for_turn) by composition, so it can be
    assigned to agent._tool_guardrails without touching hermes internals.
    """

    def __init__(self, bridge: "HermesBridge") -> None:
        self._bridge = bridge
        self._real: Any = None
        try:
            from agent.tool_guardrails import ToolCallGuardrailController

            self._real = ToolCallGuardrailController()
        except Exception:  # pragma: no cover - older/newer hermes versions
            self._real = None

    def reset_for_turn(self) -> None:
        if self._real is not None:
            self._real.reset_for_turn()

    def before_call(self, tool_name: str, args: dict[str, Any] | None) -> Any:
        from agent.tool_guardrails import ToolGuardrailDecision
        from permissions import audit, decide

        decision = decide(tool_name, args, source="agent")
        if decision["action"] == "block":
            audit(tool_name, "blocked", args, detail=decision["reason"])
            return ToolGuardrailDecision(
                action="block",
                code="kill_switch",
                message="The kill switch is ON. Do not retry; tell the owner actions are paused "
                "and ask them to release the kill switch in the Control tab.",
                tool_name=tool_name,
            )
        if decision["action"] == "allow":
            audit(tool_name, "allowed", args, detail=decision["reason"])
            if self._real is not None:
                return self._real.before_call(tool_name, args)
            return ToolGuardrailDecision(action="allow", code="allow")

        approved = self._bridge.request_confirmation(tool_name, dict(args or {}))
        audit(tool_name, "approved" if approved else "denied", args, detail=decision["reason"])
        if approved:
            return ToolGuardrailDecision(
                action="allow", code="user_approved", tool_name=tool_name
            )
        return ToolGuardrailDecision(
            action="block",
            code="user_denied",
            message="The user denied this action in the JARVIS UI. Do not retry it; "
            "explain what you wanted to do and ask how to proceed.",
            tool_name=tool_name,
        )

    def after_call(self, *args: Any, **kwargs: Any) -> Any:
        if self._real is not None and hasattr(self._real, "after_call"):
            try:
                return self._real.after_call(*args, **kwargs)
            except Exception:  # pragma: no cover
                return None
        return None

    def halt_decision(self) -> Any:
        if self._real is not None and hasattr(self._real, "halt_decision"):
            try:
                return self._real.halt_decision()
            except Exception:  # pragma: no cover
                return None
        return None


class HermesBridge:
    """Lazily-initialized, thread-safe wrapper around hermes-agent AIAgent."""

    def __init__(self) -> None:
        self._agent: Any = None
        self._agent_lock = threading.Lock()
        self._init_error: str | None = None
        self._current_model: str | None = None
        # Per-session model chosen by the chat picker. Kept separate from the
        # cached Settings object: mutating Settings here leaked a per-message
        # override into the persistent default and /agent/status.
        self._override_model: str | None = None
        self._pending: dict[str, PendingConfirmation] = {}
        self._pending_lock = threading.Lock()
        # WS event sink for the CURRENT turn, set by run_turn(). Confirmations
        # raised from the agent worker thread need it to reach the UI
        # (this used to crash with AttributeError: no attribute '_emit').
        self._emit_sink: Callable[[dict[str, Any]], None] | None = None

    # ---------- state ----------

    @property
    def mode(self) -> str:
        if self._agent is not None:
            return "hermes"
        if self._init_error:
            return "openrouter"
        return get_settings().brain if get_settings().brain != "auto" else "hermes"

    @property
    def init_error(self) -> str | None:
        return self._init_error

    @property
    def current_model(self) -> str | None:
        return self._current_model or get_settings().default_model

    # ---------- confirmations ----------

    def request_confirmation(self, tool_name: str, args: dict[str, Any]) -> bool:
        """Called from the agent worker thread. Emits a confirm_request and
        blocks until the frontend answers or the timeout elapses (auto-deny)."""
        settings = get_settings()
        request_id = uuid.uuid4().hex[:12]
        pending = PendingConfirmation(tool_name=tool_name, args=args)
        with self._pending_lock:
            self._pending[request_id] = pending

        emit = self._emit_sink
        if emit is None:
            # No UI attached (shouldn't happen during a turn): fail CLOSED —
            # never run an unapproved dangerous tool.
            logger.error("confirmation for %s but no UI emitter attached — denying", tool_name)
            with self._pending_lock:
                self._pending.pop(request_id, None)
            return False

        emit(
            {
                "type": "confirm_request",
                "requestId": request_id,
                "tool": tool_name,
                "args": args,
            }
        )
        logger.info("confirmation requested: %s (%s)", tool_name, request_id)

        approved = pending.event.wait(timeout=settings.confirmation_timeout_seconds)
        with self._pending_lock:
            self._pending.pop(request_id, None)

        if not approved:
            logger.info("confirmation timed out for %s", tool_name)
        return approved and pending.approved

    def resolve_confirmation(self, request_id: str, approved: bool) -> bool:
        with self._pending_lock:
            pending = self._pending.get(request_id)
        if pending is None:
            return False
        pending.approved = approved
        pending.event.set()
        return True

    # ---------- agent lifecycle ----------

    def _ensure_env(self) -> None:
        HERMES_HOME.mkdir(parents=True, exist_ok=True)
        os.environ["HERMES_HOME"] = str(HERMES_HOME)
        # Publish every stored provider key from Windows Credential Manager into
        # the process environment (Hermes reads keys from env; children like the
        # gateway/cron inherit it). Env files never hold secrets.
        try:
            from hermes_control import publish_all_keys

            publish_all_keys()
        except Exception as exc:  # noqa: BLE001
            logger.warning("could not publish provider keys: %s", exc)
        key = get_openrouter_key()
        if key:
            os.environ["OPENROUTER_API_KEY"] = key

    def _build_agent(self) -> Any:
        self._ensure_env()
        from run_agent import AIAgent  # imported here so HERMES_HOME is set first

        settings = get_settings()
        provider = (settings.provider or "openrouter").strip() or "openrouter"
        model = self._override_model or settings.default_model

        if provider == "openrouter":
            api_key = get_openrouter_key()
            if not api_key:
                raise RuntimeError("No API key configured — set it in Settings.")
            base_url = settings.openrouter_base_url
        else:
            # Catalog-driven build for any of the 41 Hermes providers, plus
            # user-defined endpoints addressed as "custom:<name>".
            from secret_store import get_provider_key

            base_slug = "custom" if provider.startswith("custom") else provider
            entry = None
            try:
                from hermes_control import provider_entry

                entry = provider_entry(base_slug)
            except Exception as exc:  # noqa: BLE001
                logger.warning("provider catalog unavailable: %s", exc)
            api_key = ""
            if entry and entry["envVars"]:
                api_key = get_provider_key(entry["envVars"][0])
            base_url = None
            if entry and entry["baseUrlEnvVar"]:
                base_url = os.environ.get(entry["baseUrlEnvVar"]) or None
            if provider.startswith("custom"):
                # Local servers (LM Studio/Ollama) usually need no real key,
                # but the OpenAI client requires a non-empty string.
                api_key = api_key or "not-needed"
            elif not api_key:
                raise RuntimeError(
                    f"No API key saved for '{provider}'. Add one in the Providers tab."
                )

        agent = AIAgent(
            provider=provider,
            base_url=base_url,
            api_key=api_key,
            model=model,
            max_iterations=25,
            quiet_mode=True,
            verbose_logging=False,
            save_trajectories=False,
            enabled_toolsets=(settings.toolsets_list or None),
        )
        # Human-in-the-loop gate for dangerous tools.
        try:
            agent._tool_guardrails = ConfirmationGuardrail(self)
        except Exception as exc:  # pragma: no cover
            logger.warning("could not attach confirmation guardrail: %s", exc)
        return agent

    def get_agent(self) -> Any:
        with self._agent_lock:
            if self._agent is None and self._init_error is None:
                try:
                    self._agent = self._build_agent()
                    self._current_model = self._override_model or get_settings().default_model
                    logger.info("hermes agent initialized (model=%s)", self._current_model)
                except Exception as exc:
                    self._init_error = f"{type(exc).__name__}: {exc}"
                    logger.warning("hermes init failed, falling back to openrouter: %s", exc)
            return self._agent

    def rebuild(self, keep_override: bool = False) -> None:
        """Drop the runtime so the next call rebuilds it (model/keys changed)."""
        with self._agent_lock:
            if self._agent is not None:
                try:
                    self._agent.close()
                except Exception:
                    pass
            self._agent = None
            self._init_error = None
            self._current_model = None
            if not keep_override:
                self._override_model = None

    def switch_model(self, model: str | None) -> None:
        """Use `model` for the next turn without touching persisted settings.

        An empty value means "use the saved default". Only rebuilds when the
        effective model actually changes, so ordinary turns stay fast.
        """
        target = (model or "").strip() or None
        settings_default = get_settings().default_model
        effective = target or settings_default
        if effective == self.current_model and self._agent is not None:
            self._override_model = target
            return
        self.rebuild(keep_override=True)
        self._override_model = target

    def set_provider(self, provider: str) -> None:
        """Rebuild against a newly-persisted provider (caller persists first)."""
        self.rebuild()

    # ---------- conversation ----------

    def run_turn(
        self,
        message: str,
        emit: Callable[[dict[str, Any]], None],
        history: list[dict[str, Any]] | None = None,
    ) -> str:
        """Run one conversation turn. Emits WS events synchronously from the
        calling (worker) thread via `emit`. Returns the final response text."""
        agent = self.get_agent()
        if agent is None:
            raise RuntimeError(self._init_error or "Hermes runtime unavailable")

        self._emit_sink = emit  # confirmations during this turn reach the UI

        q: "queue.Queue[dict[str, Any] | None]" = queue.Queue()
        collected: list[str] = []
        done = threading.Event()

        def stream_cb(*args: Any, **kwargs: Any) -> None:
            delta = next((a for a in args if isinstance(a, str)), "")
            if delta:
                collected.append(delta)
                q.put({"type": "token", "content": delta})

        def tool_start_cb(*args: Any, **kwargs: Any) -> None:
            # (tc_id, name, display_args) per tool_executor.py
            name = args[1] if len(args) >= 2 else "tool"
            tool_args = args[2] if len(args) >= 3 else {}
            q.put({"type": "tool_call", "tool": str(name), "args": tool_args or {}})

        def thinking_cb(*args: Any, **kwargs: Any) -> None:
            flag = bool(args[0]) if args else True
            q.put({"type": "thinking", "status": flag})

        def worker() -> None:
            try:
                result = agent.run_conversation(
                    message,
                    conversation_history=history or [],
                    stream_callback=stream_cb,
                )
                final = ""
                if isinstance(result, dict):
                    final = result.get("final_response") or ""
                if not final:
                    final = "".join(collected)
                q.put({"type": "__final__", "content": final})
            except Exception as exc:
                logger.exception("hermes turn failed")
                q.put({"type": "__error__", "content": f"{type(exc).__name__}: {exc}"})
            finally:
                done.set()
                q.put(None)

        thread = threading.Thread(target=worker, daemon=True, name="jarvis-hermes-turn")
        thread.start()

        final_text = ""
        try:
            while True:
                event = q.get()
                if event is None:
                    break
                kind = event.get("type")
                if kind == "__final__":
                    final_text = event.get("content", "")
                elif kind == "__error__":
                    raise RuntimeError(event.get("content", "hermes turn failed"))
                else:
                    emit(event)
        finally:
            self._emit_sink = None  # confirmations outside a turn are denied
        return final_text


BRIDGE = HermesBridge()
