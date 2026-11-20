"""Phase 4 end-to-end checks: apps, windows, typing, files plan/apply/undo,
kill switch and the audit feed."""

import shutil
import subprocess
import time
from pathlib import Path

import httpx

BASE = "http://127.0.0.1:8420"


def j(r):
    try:
        return r.json()
    except Exception:
        return r.text[:300]


def wait_window(name: str, timeout: float = 20.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        windows = httpx.get(f"{BASE}/desktop/windows", timeout=30).json()["windows"]
        match = [w for w in windows if name.lower() in w["title"].lower()]
        if match:
            return match[0]
        time.sleep(1)
    return None


print("=== apps: launch Notepad (only when none is open, to avoid touching unsaved work) ===")
existing = [w for w in httpx.get(f"{BASE}/desktop/windows", timeout=30).json()["windows"] if "notepad" in w["title"].lower()]
if existing:
    print("skipped typing test — a Notepad window is already open:", existing[0]["title"])
else:
    r = httpx.post(f"{BASE}/desktop/launch", json={"name": "Notepad"}, timeout=60)
    print("launch:", r.status_code, j(r))
    window = wait_window("Notepad")
    print("window:", window)
    if window:
        name = window["title"]
        r = httpx.post(f"{BASE}/desktop/window", json={"name": name, "action": "focus"}, timeout=60)
        print("focus:", r.status_code, j(r))
        time.sleep(1)
        typed = "hello from JARVIS"
        r = httpx.post(f"{BASE}/desktop/type", json={"text": typed}, timeout=60)
        print("type:", r.status_code, j(r))
        time.sleep(0.5)
        httpx.post(f"{BASE}/desktop/keys", json={"keys": "ctrl+a"}, timeout=30)
        httpx.post(f"{BASE}/desktop/keys", json={"keys": "ctrl+c"}, timeout=30)
        time.sleep(0.5)
        clip = subprocess.run(
            ["powershell", "-NoProfile", "-Command", "Get-Clipboard -Raw"],
            capture_output=True,
            text=True,
        ).stdout.strip()
        print("TYPED TEXT MATCH:", clip == typed)
        print("minimize:", j(httpx.post(f"{BASE}/desktop/window", json={"name": name, "action": "minimize"}, timeout=60)))
        print("close:", j(httpx.post(f"{BASE}/desktop/window", json={"name": name, "action": "close"}, timeout=60)))
        time.sleep(1)
        subprocess.run(["taskkill", "/F", "/IM", "notepad.exe"], capture_output=True)

print("=== files: plan / apply / undo ===")
test_dir = Path(r"C:\Users\ramch\jarvis-files-test")
if test_dir.exists():
    shutil.rmtree(test_dir, ignore_errors=True)
test_dir.mkdir(parents=True)
for fname in ("photo.jpg", "notes.txt", "song.mp3", "archive.zip", "script.py", "weird.xyz"):
    (test_dir / fname).write_text("x", encoding="utf-8")

r = httpx.post(f"{BASE}/files/plan", json={"directory": str(test_dir)}, timeout=60)
plan = j(r)
print("plan:", r.status_code, "ok:", plan.get("ok"), "moves:", len(plan.get("moves", [])), "skipped:", len(plan.get("skipped", [])))
if plan.get("error"):
    print("plan error:", plan["error"])
for move in plan.get("moves", []):
    print("  ", move["name"], "->", move["category"])

if plan.get("ok"):
    r = httpx.post(f"{BASE}/files/apply", json={"planId": plan["id"]}, timeout=120)
    print("apply:", r.status_code, j(r))
    moved = sorted(p.relative_to(test_dir).as_posix() for p in test_dir.rglob("*") if p.is_file())
    print("tree after apply:", moved)
    r = httpx.post(f"{BASE}/files/undo", timeout=120)
    print("undo:", r.status_code, j(r))
    after = sorted(p.name for p in test_dir.iterdir() if p.is_file())
    print("files at root after undo:", after)
    print("UNDO COMPLETE:", len(after) == 6)
shutil.rmtree(test_dir, ignore_errors=True)

print("=== kill switch ===")
print("engage:", j(httpx.post(f"{BASE}/permissions/kill", json={"engaged": True}, timeout=30)))
r = httpx.post(f"{BASE}/desktop/launch", json={"name": "Notepad"}, timeout=30)
print("launch while engaged:", r.status_code, j(r))
print("release:", j(httpx.post(f"{BASE}/permissions/kill", json={"engaged": False}, timeout=30)))

print("=== hotkey ===")
import keyboard

print("active:", httpx.get(f"{BASE}/permissions", timeout=30).json()["killSwitch"].get("active"))
keyboard.press_and_release("ctrl+shift+x")
time.sleep(2)
state = httpx.get(f"{BASE}/permissions", timeout=30).json()["killSwitch"]["engaged"]
print("kill after hotkey:", state)
if state:
    keyboard.press_and_release("ctrl+shift+x")
    time.sleep(2)
    print("released after second press:", httpx.get(f"{BASE}/permissions", timeout=30).json()["killSwitch"]["engaged"])

print("=== permissions override ===")
r = httpx.post(f"{BASE}/permissions/mode", json={"tool": "terminal", "mode": "allow"}, timeout=30)
print("terminal -> allow:", r.status_code, j(r).get("modes", {}).get("terminal"))
settings = httpx.get(f"{BASE}/agent/settings", timeout=30).json()
print("persisted in settings:", settings.get("permissions"))
# reset to default so a fresh install posture is unchanged
httpx.post(f"{BASE}/agent/settings", json={"permissions": {}}, timeout=30)

print("=== audit ===")
entries = httpx.get(f"{BASE}/permissions/audit?limit=25", timeout=30).json()["entries"]
for entry in entries[:12]:
    print(f"  {entry['ts']} {entry['source']:<6} {entry['tool']:<22} {entry['decision']}")
