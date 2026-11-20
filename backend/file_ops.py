"""File organization with dry-run, approval and undo (Phase 4).

Rules from the spec:
- "organize my Downloads" first produces a PLAN (what moves where) shown in
  the UI; nothing moves until the owner approves.
- Move only. Never delete anything.
- Every applied plan is journaled; the last operation can be undone in one click.
- Protected folders (Windows, Program Files, AppData, …) are refused, and the
  list is editable in the UI (JARVIS_PROTECTED_FOLDERS).
"""

from __future__ import annotations

import json
import logging
import shutil
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from config import BACKEND_DIR, get_settings

logger = logging.getLogger("jarvis.files")

JOURNAL_FILE = (BACKEND_DIR / "hermes-home" / "file-ops" / "journal.json").resolve()

DEFAULT_PROTECTED = (
    r"C:\Windows",
    r"C:\Program Files",
    r"C:\Program Files (x86)",
    r"C:\ProgramData",
    r"C:\Recovery",
    r"C:\$Recycle.Bin",
    r"C:\Users\ramch\AppData",
    r"C:\Users\ramch\.ssh",
    r"C:\Users\ramch\Documents\WindowsPowerShell",
)

CATEGORIES: dict[str, tuple[str, ...]] = {
    "Images": (".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".svg", ".heic", ".tif", ".tiff", ".ico"),
    "Documents": (
        ".pdf", ".doc", ".docx", ".txt", ".rtf", ".odt", ".xls", ".xlsx", ".csv",
        ".ppt", ".pptx", ".md", ".epub", ".pages", ".numbers", ".key",
    ),
    "Videos": (".mp4", ".mkv", ".avi", ".mov", ".wmv", ".webm", ".flv", ".m4v"),
    "Music": (".mp3", ".wav", ".flac", ".aac", ".ogg", ".m4a", ".wma", ".aiff"),
    "Archives": (".zip", ".rar", ".7z", ".tar", ".gz", ".bz2", ".xz", ".iso"),
    "Installers": (".exe", ".msi", ".msix", ".appx", ".pkg", ".dmg"),
    "Code": (
        ".py", ".js", ".ts", ".tsx", ".jsx", ".json", ".html", ".css", ".scss",
        ".java", ".c", ".cpp", ".h", ".cs", ".rs", ".go", ".rb", ".php", ".sh",
        ".ps1", ".bat", ".yml", ".yaml", ".toml", ".sql", ".ipynb",
    ),
    "Other": (),
}

_EXT_TO_CATEGORY = {
    ext: category for category, exts in CATEGORIES.items() for ext in exts
}

_plans: dict[str, dict[str, Any]] = {}


# ---------------------------------------------------------------- helpers


def protected_folders() -> list[str]:
    settings = get_settings()
    raw = (settings.protected_folders or "").strip()
    if not raw:
        return list(DEFAULT_PROTECTED)
    return [p.strip().strip('"') for p in raw.split(";") if p.strip()]


def _is_protected(path: Path) -> str | None:
    resolved = path.resolve()
    for folder in protected_folders():
        try:
            root = Path(folder).resolve()
        except Exception:  # noqa: BLE001
            continue
        if resolved == root or root in resolved.parents:
            return str(root)
    return None


def _load_journal() -> list[dict[str, Any]]:
    if not JOURNAL_FILE.exists():
        return []
    try:
        data = json.loads(JOURNAL_FILE.read_text(encoding="utf-8-sig"))
        return data if isinstance(data, list) else []
    except Exception as exc:  # noqa: BLE001
        logger.warning("journal unreadable: %s", exc)
        return []


def _save_journal(entries: list[dict[str, Any]]) -> None:
    JOURNAL_FILE.parent.mkdir(parents=True, exist_ok=True)
    JOURNAL_FILE.write_text(json.dumps(entries[-50:], indent=1), encoding="utf-8")


def _category_for(path: Path) -> str:
    return _EXT_TO_CATEGORY.get(path.suffix.lower(), "Other")


# ---------------------------------------------------------------- plan / apply


def plan_organization(directory: str) -> dict[str, Any]:
    folder = Path((directory or "").strip().strip('"')).expanduser()
    if not folder.exists() or not folder.is_dir():
        return {"ok": False, "error": f"'{directory}' is not a folder JARVIS can see."}
    if _is_protected(folder):
        return {"ok": False, "error": f"'{folder}' is a protected folder and will not be touched."}

    moves: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    try:
        entries = sorted(folder.iterdir(), key=lambda p: p.name.lower())
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"cannot read '{folder}': {exc}"}

    for item in entries:
        if not item.is_file():
            continue
        category = _category_for(item)
        target_dir = folder / category
        target = target_dir / item.name
        if target.exists():
            skipped.append({"name": item.name, "reason": f"{category}/{item.name} already exists"})
            continue
        moves.append(
            {
                "name": item.name,
                "from": str(item),
                "to": str(target),
                "category": category,
                "size": item.stat().st_size,
            }
        )

    plan_id = uuid.uuid4().hex[:10]
    plan = {
        "id": plan_id,
        "directory": str(folder.resolve()),
        "moves": moves,
        "skipped": skipped,
        "createdAt": datetime.now().isoformat(timespec="seconds"),
    }
    _plans[plan_id] = plan
    return {"ok": True, **plan}


def apply_plan(plan_id: str) -> dict[str, Any]:
    plan = _plans.get((plan_id or "").strip())
    if plan is None:
        return {"ok": False, "error": "That plan expired — create a new one."}
    if _is_protected(Path(plan["directory"])):
        return {"ok": False, "error": "That folder is protected."}

    done: list[dict[str, str]] = []
    failures: list[dict[str, str]] = []
    for move in plan["moves"]:
        src, dst = Path(move["from"]), Path(move["to"])
        try:
            if not src.exists():
                failures.append({"name": move["name"], "reason": "source disappeared"})
                continue
            if dst.exists():
                failures.append({"name": move["name"], "reason": "destination already exists"})
                continue
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), str(dst))
            done.append({"from": str(src), "to": str(dst)})
        except Exception as exc:  # noqa: BLE001
            failures.append({"name": move["name"], "reason": str(exc)[:200]})

    journal = _load_journal()
    entry = {
        "id": uuid.uuid4().hex[:10],
        "ts": datetime.now().isoformat(timespec="seconds"),
        "directory": plan["directory"],
        "moves": done,
        "undone": False,
    }
    if done:
        journal.append(entry)
        _save_journal(journal)
    return {
        "ok": True,
        "moved": len(done),
        "failed": failures,
        "journalId": entry["id"] if done else None,
    }


def undo_last() -> dict[str, Any]:
    journal = _load_journal()
    target = next((e for e in reversed(journal) if not e.get("undone")), None)
    if target is None:
        return {"ok": False, "error": "Nothing to undo yet."}
    restored = 0
    problems: list[str] = []
    for move in reversed(target.get("moves", [])):
        src, dst = Path(move["to"]), Path(move["from"])
        try:
            if not src.exists():
                problems.append(f"{src.name}: already gone")
                continue
            if dst.exists():
                problems.append(f"{dst.name}: original path is occupied")
                continue
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), str(dst))
            restored += 1
        except Exception as exc:  # noqa: BLE001
            problems.append(f"{src.name}: {exc}"[:200])
    target["undone"] = True
    target["undoneAt"] = datetime.now().isoformat(timespec="seconds")
    _save_journal(journal)
    return {"ok": True, "restored": restored, "problems": problems, "journalId": target["id"]}


def journal() -> list[dict[str, Any]]:
    return list(reversed(_load_journal()))
