"""Phase 2 negative-path test for /agent/test-connection + key lifecycle.
The real key is read from Windows Credential Manager and restored at the end;
it is never printed."""

import httpx
import keyring

BASE = "http://127.0.0.1:8420"
REAL = keyring.get_password("JARVIS", "openrouter_api_key") or ""
assert REAL, "no key in Credential Manager to restore afterwards"


def post(path: str, payload: dict | None = None):
    return httpx.post(f"{BASE}{path}", json=payload or {}, timeout=40)


def show(label: str, response: httpx.Response) -> None:
    try:
        data = response.json()
    except Exception:
        data = {"raw": response.text[:120]}
    print(f"{label}: {data.get('message', data)}")


# 1. fake key → plain-language rejection
r = post("/agent/settings", {"openrouterApiKey": "sk-or-v1-this-is-a-fake-key-000000000000000"})
print("save fake key:", r.status_code)
r = post("/agent/test-connection")
show("fake-key test-connection", r)

# 2. remove key → empty state
r = post("/agent/settings", {"removeKey": True})
print("removeKey:", r.status_code, r.json())
s = httpx.get(f"{BASE}/agent/settings", timeout=20).json()
print(f"after remove: hasKey={s['hasKey']} masked={s['openrouterApiKeyMasked']!r}")
r = post("/agent/test-connection")
show("no-key test-connection", r)

# 3. restore the real key (from memory, never printed)
keyring.set_password("JARVIS", "openrouter_api_key", REAL)
print("real key restored to Credential Manager (length", len(REAL), ")")
r = post("/agent/test-connection")
show("restored test-connection", r)
s = httpx.get(f"{BASE}/agent/settings", timeout=20).json()
print(f"final settings: hasKey={s['hasKey']} masked-present={bool(s['openrouterApiKeyMasked'])}")
