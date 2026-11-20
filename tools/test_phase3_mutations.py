"""Phase 3 mutation tests: toolset toggle, cron create/remove, gateway start/stop."""

import json
import time

import httpx

BASE = "http://127.0.0.1:8420"


def j(r):
    try:
        return r.json()
    except Exception:
        return r.text[:300]


print("=== toolset toggle (video off -> on) ===")
r = httpx.post(f"{BASE}/hermes/toolsets/toggle", json={"name": "video", "enabled": False}, timeout=120)
print("disable video:", r.status_code, str(j(r))[:200])
r = httpx.get(f"{BASE}/hermes/toolsets", timeout=60)
video = next((t for t in r.json()["toolsets"] if t["name"] == "video"), None)
print("  state now:", video)
r = httpx.post(f"{BASE}/hermes/toolsets/toggle", json={"name": "video", "enabled": True}, timeout=120)
print("re-enable video:", r.status_code, str(j(r))[:200])

print("=== cron create ===")
r = httpx.post(
    f"{BASE}/hermes/cron/create",
    json={"schedule": "30m", "prompt": "Phase 3 test task — say hello", "name": "p3-test", "deliver": "local"},
    timeout=120,
)
print("create:", r.status_code, str(j(r))[:300])
jobs = j(r).get("jobs", []) if r.status_code == 200 else []
test_job = next((x for x in jobs if x.get("name") == "p3-test"), None)
print("  job:", test_job)

if test_job:
    r = httpx.post(f"{BASE}/hermes/cron/action", json={"action": "remove", "jobId": test_job["id"]}, timeout=120)
    print("remove:", r.status_code, str(j(r))[:200])

print("=== gateway start/stop ===")
r = httpx.post(f"{BASE}/hermes/gateway/start", timeout=60)
print("start:", r.status_code, j(r))
time.sleep(4)
r = httpx.get(f"{BASE}/hermes/gateway", timeout=30)
print("status:", j(r)["running"], "pid:", j(r)["pid"])
r = httpx.get(f"{BASE}/hermes/gateway/logs?lines=25", timeout=30)
print("logs tail:", "\n".join(r.json().get("logs", "").splitlines()[-6:]))
r = httpx.post(f"{BASE}/hermes/gateway/stop", timeout=60)
print("stop:", j(r))
