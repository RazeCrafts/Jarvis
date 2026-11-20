"""Phase 3 endpoint smoke test (read-only GETs + safe POSTs)."""

import json
import sys

import httpx

BASE = "http://127.0.0.1:8420"


def show(label, response, keys=None):
    try:
        data = response.json()
    except Exception:
        data = response.text[:200]
    if isinstance(data, dict) and keys:
        data = {k: data.get(k) for k in keys}
    print(f"{label}: {response.status_code} {json.dumps(data)[:400]}")


print("=== providers ===")
r = httpx.get(f"{BASE}/hermes/providers", timeout=30)
show("hermes/providers", r, ["providers"])
if r.status_code == 200:
    providers = r.json()["providers"]
    print("  count:", len(providers))
    kr = [p for p in providers if p["slug"] == "openrouter"][0]
    print("  openrouter keys:", kr["keys"], "configured:", kr["configured"])

print("=== settings ===")
r = httpx.get(f"{BASE}/agent/settings", timeout=20)
show("agent/settings", r, ["brain", "provider", "hasKey", "toolsets", "customProviders"])

print("=== toolsets ===")
r = httpx.get(f"{BASE}/hermes/toolsets", timeout=60)
if r.status_code == 200:
    ts = r.json()["toolsets"]
    print("  count:", len(ts))
    print("  sample:", [(t["name"], t["enabled"]) for t in ts[:5]])

print("=== mcp ===")
r = httpx.get(f"{BASE}/hermes/mcp", timeout=30)
show("hermes/mcp", r)

print("=== cron ===")
r = httpx.get(f"{BASE}/hermes/cron", timeout=30)
show("hermes/cron", r)

print("=== gateway ===")
r = httpx.get(f"{BASE}/hermes/gateway", timeout=30)
show("hermes/gateway", r, ["running", "configuredPlatforms", "jobCount"])

print("=== doctor ===")
r = httpx.get(f"{BASE}/hermes/doctor", timeout=180)
if r.status_code == 200:
    report = r.json().get("report", "")
    print("  doctor lines:", len(report.splitlines()))
    print("  first 2:", [line for line in report.splitlines() if line.strip()][:2])
else:
    show("doctor", r)

print("=== provider models (openrouter) ===")
r = httpx.get(f"{BASE}/hermes/providers/openrouter/models", timeout=60)
if r.status_code == 200:
    d = r.json()
    print("  source:", d.get("source"), "count:", len(d.get("models", [])))
else:
    show("models", r)
