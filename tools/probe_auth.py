"""Phase 0 probe: how does Hermes resolve OpenRouter credentials?

Sets a test key three ways and prints what Hermes actually resolves.
No network calls.
"""
import os
import sys

sys.path.insert(0, r"C:\Users\ramch\Jarvis\backend\.venv\Lib\site-packages")
os.environ["HERMES_HOME"] = r"C:\Users\ramch\Jarvis\backend\hermes-home"
os.environ["OPENROUTER_API_KEY"] = "sk-or-test-abc123456789"

print("=== 1. env var set before import:", os.environ["OPENROUTER_API_KEY"])

# Import run_agent like the bridge does (this triggers load_hermes_dotenv)
import run_agent  # noqa: E402

print("=== 2. env var AFTER run_agent import:", repr(os.environ.get("OPENROUTER_API_KEY")))

# Now resolve the provider client the same way init_agent does
from hermes_cli.auth import resolve_provider  # noqa: E402
import inspect  # noqa: E402

print("    resolve_provider signature:", inspect.signature(resolve_provider))

try:
    result = resolve_provider("openrouter", explicit_api_key="sk-or-test-abc123456789")
    print("=== 3. resolve_provider(explicit key) ->", str(result)[:400])
except Exception as exc:
    print("=== 3. resolve_provider(explicit key) RAISED:", type(exc).__name__, str(exc)[:300])

# And with NO explicit key (env-only)
try:
    result2 = resolve_provider(None)
    print("=== 4. resolve_provider(env only) ->", str(result2)[:400])
except Exception as exc:
    print("=== 4. resolve_provider(env only) RAISED:", type(exc).__name__, str(exc)[:300])
