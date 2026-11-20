"""Workspace artifacts — Phase 6.

One artifact at a time is "live": JARVIS writes short code against a small
helper API, the Workspace renders it in a sandboxed iframe (no network), and
follow-up requests edit the SAME artifact with version history + undo.

Everything here is deterministic:
- request detection decides whether a chat message is an artifact request,
- the prompt carries the helper API plus the current code for edits,
- the reply parser pulls exactly one fenced block out of the model's answer,
- versions are stored on disk under HERMES_HOME/workspace.

Kinds: ``three`` (helper-driven 3D), ``html`` (page / canvas / mini-app),
``svg`` (vector), plus the older ``code`` / ``markdown`` / ``image`` kinds.
"""

from __future__ import annotations

import json
import os
import re
import time
import uuid
from pathlib import Path
from typing import Any

from config import BACKEND_DIR

DATA_DIR = Path(os.environ.get("HERMES_HOME") or (BACKEND_DIR / "hermes-home")) / "workspace"
STORE_FILE = DATA_DIR / "artifacts.json"
MAX_ARTIFACTS = 24
MAX_VERSIONS = 10

ARTIFACT_KINDS = {"three", "html", "svg", "code", "markdown", "image"}


# ------------------------------------------------------------------ storage


def _load() -> list[dict[str, Any]]:
    try:
        data = json.loads(STORE_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def _store(items: list[dict[str, Any]]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    STORE_FILE.write_text(json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8")


def list_artifacts() -> list[dict[str, Any]]:
    return [_public(a) for a in _load()]


def clear() -> None:
    _store([])


def current() -> dict[str, Any] | None:
    items = _load()
    return _public(items[-1]) if items else None


def get(artifact_id: str) -> dict[str, Any] | None:
    for item in _load():
        if item.get("id") == artifact_id:
            return _public(item)
    return None


def _public(item: dict[str, Any]) -> dict[str, Any]:
    versions = item.get("versions") or []
    numbers = [int(v.get("n") or 0) for v in versions if int(v.get("n") or 0) > 0]
    latest = numbers[-1] if numbers else 1
    return {
        "id": item.get("id"),
        "kind": item.get("kind") or "code",
        "title": item.get("title") or "artifact",
        "language": item.get("language") or "",
        "content": item.get("content") or "",
        "version": latest,
        "versionCount": len(numbers) or 1,
        "versions": numbers or [1],
        "createdAt": item.get("createdAt") or 0,
        "updatedAt": item.get("updatedAt") or 0,
    }


def _ext_for(kind: str, language: str = "") -> str:
    if kind == "html":
        return "html"
    if kind == "svg":
        return "svg"
    if kind == "markdown":
        return "md"
    if kind == "image":
        return "png"
    if kind == "three":
        return "js"
    return {"python": "py", "typescript": "ts", "javascript": "js"}.get(language, "txt")


def save(
    kind: str,
    title: str,
    content: str,
    artifact_id: str | None = None,
    language: str = "",
) -> dict[str, Any]:
    """Create a v1 artifact, or append a new version when editing."""
    kind = kind if kind in ARTIFACT_KINDS else "code"
    content = (content or "").strip("\n")
    if not content.strip():
        raise ValueError("artifact content is empty")

    items = _load()
    now = int(time.time() * 1000)
    target = None
    if artifact_id:
        for item in items:
            if item.get("id") == artifact_id and item.get("kind") == kind:
                target = item
                break

    if target is None:
        target = {
            "id": uuid.uuid4().hex[:12],
            "kind": kind,
            "title": (title or "artifact").strip()[:70],
            "language": language,
            "createdAt": now,
            "updatedAt": now,
            "content": content,
            "versions": [{"n": 1, "at": now, "content": content}],
        }
        items.append(target)
    else:
        target["content"] = content
        target["updatedAt"] = now
        if title and title.strip():
            target["title"] = title.strip()[:70]
        latest = int((target["versions"][-1] or {}).get("n") or len(target["versions"]))
        target["versions"].append({"n": latest + 1, "at": now, "content": content})
        target["versions"] = target["versions"][-MAX_VERSIONS:]

    items = items[-MAX_ARTIFACTS:]
    _store(items)
    return _public(target)


def undo(artifact_id: str) -> dict[str, Any] | None:
    """Drop the newest version and restore the previous content."""
    items = _load()
    for item in items:
        if item.get("id") != artifact_id:
            continue
        versions = item.get("versions") or []
        if len(versions) <= 1:
            return _public(item)
        versions.pop()
        item["versions"] = versions
        item["content"] = versions[-1].get("content") or ""
        item["updatedAt"] = int(time.time() * 1000)
        _store(items)
        return _public(item)
    return None


def activate_version(artifact_id: str, number: int) -> dict[str, Any] | None:
    """Restore a specific version as a NEW version (non-destructive)."""
    items = _load()
    for item in items:
        if item.get("id") != artifact_id:
            continue
        versions = item.get("versions") or []
        match = next((v for v in versions if int(v.get("n", 0)) == number), None)
        if match is None:
            return _public(item)
        return save(
            str(item.get("kind")),
            str(item.get("title")),
            str(match.get("content") or ""),
            artifact_id,
            str(item.get("language") or ""),
        )
    return None


def save_to_folder(artifact_id: str, folder: str) -> dict[str, Any]:
    """Write the current artifact into a folder the owner picked."""
    target = get(artifact_id)
    if target is None:
        raise ValueError("artifact not found")
    directory = Path(os.path.expandvars(os.path.expanduser((folder or "").strip())))
    if not directory.is_dir():
        raise ValueError(f"folder not found: {directory}")
    slug = re.sub(r"[^\w-]+", "_", target["title"]).strip("_")[:50] or "artifact"
    ext = _ext_for(target["kind"], target.get("language") or "")
    path = directory / f"{slug}_v{target['version']}.{ext}"
    prefix = ""
    if target["kind"] == "three":
        prefix = "// Rendered by JARVIS Workspace with the JARVIS 3D helper API.\n"
    path.write_text(prefix + target["content"], encoding="utf-8")
    return {"ok": True, "path": str(path)}


# ------------------------------------------------------------------ request detection

_BUILD_RE = re.compile(
    r"\b(build|make|create|generate|design|draw|render|code|program|craft|model)\b", re.I
)
_EDIT_RE = re.compile(
    r"\b(add|change|make|turn|recolo(u)?r|colou?r|remove|delete|move|rotate|scale|shrink|enlarge|"
    r"bigger|smaller|replace|fix|animate|glow|thicken|thin|update|adjust|put|swap|bend|"
    r"reposition|zoom|brighten|darken)\b",
    re.I,
)
_TARGET_RE = re.compile(
    r"\b(3d|three\.?js|scene|model|spaceship|space\s?ship|rocket|ship|car|vehicle|planet|"
    r"solar\s+system|earth|moon|sun|house|robot|character|creature|logo|svg|icon|"
    r"web\s?page|website|html|dashboard|timer|clock|calculator|todo|to-do|app|game|"
    r"simulation|animation|canvas|chart|graph|bouncing|particles?|artifact|diagram|poster|"
    r"form|quiz|piano|keyboard)\b",
    re.I,
)
_REF_RE = re.compile(
    r"\b(it|its|this|that|them|those|the\s+(scene|model|ship|car|object|artifact|design|render|"
    r"animation|app|page|logo|logo|art))\b",
    re.I,
)
_CHAT_ONLY_RE = re.compile(
    r"\b(email|e-mail|remind|reminder|note|summary|summari[sz]e|explain|what\s+is|who\s+is|"
    r"how\s+do|why\s+|tell\s+me|message|call|schedule|meeting|weather|news|search|google)\b",
    re.I,
)


def infer_kind(message: str) -> str:
    lowered = message.lower()
    if re.search(r"\b(svg|logo|icon|vector|badge|emblem)\b", lowered):
        return "svg"
    if re.search(
        r"\b(html|web\s?page|website|landing|dashboard|timer|clock|calculator|todo|to-do|"
        r"app|canvas|bouncing|simulation|game|chart|graph|form|quiz|piano|keyboard)\b",
        lowered,
    ):
        return "html"
    return "three"


def request_kind(message: str) -> dict[str, Any] | None:
    """Decide whether a chat message is an artifact build/edit request."""
    text = (message or "").strip()
    if not text:
        return None
    forced = text.lower().startswith("workspace:")
    if forced:
        text = text.split(":", 1)[1].strip()

    latest = current()
    build = bool(_BUILD_RE.search(text)) and bool(_TARGET_RE.search(text))
    edit = (
        bool(latest)
        and not build
        and bool(_EDIT_RE.search(text))
        and len(text) < 140
        and not _CHAT_ONLY_RE.search(text)
        and (bool(_REF_RE.search(text)) or bool(_TARGET_RE.search(text)) or len(text) < 80)
    )

    if forced:
        # "workspace: …" always targets the canvas; verbs decide build vs edit.
        wants_edit = bool(latest) and bool(
            re.search(r"\b(add|change|make|fix|update|remove|recolor|colou?r|animate|move|rotate)\b", text, re.I)
        )
        edit = wants_edit
        build = not wants_edit
    elif not (build or edit):
        return None

    if edit and latest is not None:
        kind = str(latest.get("kind") or "three")
    else:
        kind = infer_kind(text)
    if kind not in ARTIFACT_KINDS:
        kind = "three"
    return {
        "kind": kind,
        "edit": edit,
        "artifact": latest if edit else None,
    }


# ------------------------------------------------------------------ prompts

HELPER_DOC = """\
THREE HELPERS (already loaded — do not import anything):
  JARVIS.scene({background:'#0a0a12'})                      -> THREE.Scene
  JARVIS.camera({fov:50, position:[3,2,5], lookAt:[0,0,0]}) -> camera
  JARVIS.lights({ambient:0.6, key:1.6, fill:0.6})           -> {ambient,key,fill}
  JARVIS.mat('#ff5533', {metalness:0.6, roughness:0.35, emissive:'#000000',
                        emissiveIntensity:1, opacity:1, flatShading:false,
                        wireframe:false})                  -> MeshStandardMaterial
  JARVIS.box(w,h,d,mat)  JARVIS.sphere(r,mat)  JARVIS.cylinder(rTop,rBottom,h,mat)
  JARVIS.cone(r,h,mat)   JARVIS.torus(r,tube,mat)  JARVIS.plane(w,h,mat)
  JARVIS.group(...objects)                                  -> THREE.Group
  JARVIS.at(object, [x,y,z], {rotation:[x,y,z], scale:[x,y,z]}) -> the same object
  JARVIS.add(...objects)                                    -> adds to the scene
  JARVIS.fit({padding:1.4})                                 -> auto-fit camera (call once)
  JARVIS.onFrame((tSeconds, deltaSeconds) => { ... })       -> animation hook
  JARVIS.orbit({autoRotate:true, autoRotateSpeed:0.8, minDistance:2, maxDistance:20})
  THREE is also available globally for anything the helpers don't cover.
  Glowing parts: JARVIS.mat(color, {emissive:color, emissiveIntensity:2}) plus a point light.
"""


def build_prompt(message: str, artifact: dict[str, Any] | None, kind: str) -> str:
    kind = kind if kind in {"three", "html", "svg"} else "three"
    rules = f"""\
You are building a LIVE artifact for JARVIS's Workspace.

OUTPUT RULES
- Reply with one or two short sentences about what you built, then EXACTLY ONE fenced code block tagged `{kind}`.
- Do not add any other code block or file.
- The artifact runs offline inside a sandboxed iframe: no imports, no CDN, no fetch, no external assets.
- Keep it under ~200 lines and make it visually clear. Animate when it helps.
"""
    if kind == "three":
        body = f"""\
- Write plain JavaScript (no imports). Use the helpers below inside the block.
- End with JARVIS.fit() and, when something moves, JARVIS.onFrame(...).
- Set a dark background so it fits the app.

{HELPER_DOC}

EXAMPLE SHAPE
```three
const mat = JARVIS.mat('#c9d1e8', {{metalness:0.7, roughness:0.3}});
const body = JARVIS.cylinder(0.5, 0.8, 2.2, mat);
JARVIS.at(body, [0, 1.2, 0], {{rotation:[0,0,0]}});
JARVIS.add(body, JARVIS.at(JARVIS.sphere(0.8, mat), [0, 2.7, 0]));
JARVIS.lights({{ambient:0.5, key:2}});
JARVIS.orbit({{autoRotate:true}});
JARVIS.fit();
```"""
    elif kind == "svg":
        body = """\
- The code block contains a complete `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">…</svg>`.
- Inline styles/ gradients only; no external fonts or images. Make it crisp and centered."""
    else:
        body = """\
- The code block contains a complete `<!doctype html>` document with inline CSS and JS.
- No external fonts, scripts, images or links. Use system fonts and CSS/SVG/canvas.
- It must work on its own: timers, calculators, dashboards, small games, canvas animations."""

    current = ""
    if artifact is not None:
        current = f"""\

CURRENT ARTIFACT (v{artifact.get('version', 1)}) — edit THIS code, keep everything that still applies:
```{artifact.get('kind', kind)}
{artifact.get('content', '')}
```
Apply the request below to the current artifact and return the COMPLETE updated artifact.
"""
    return f"{rules}{body}\n{current}\nUSER REQUEST: {message}"


def repair_prompt(artifact: dict[str, Any] | None, error: str) -> str:
    if artifact is None:
        return "The Workspace artifact failed to render. Reply with a minimal working `three` scene."
    kind = artifact.get("kind") if artifact.get("kind") in {"three", "html", "svg"} else "three"
    if kind == "three":
        shape = f"""\
- Use the JARVIS helper API below. Do NOT create your own renderer, scene or canvas.
- End with JARVIS.fit() and keep animations on JARVIS.onFrame(...).

{HELPER_DOC}"""
    elif kind == "svg":
        shape = "- Return one complete `<svg xmlns=\"http://www.w3.org/2000/svg\" …>` element."
    else:
        shape = "- Return one complete `<!doctype html>` document with inline CSS/JS."
    return f"""\
The Workspace artifact below crashed in the browser. Fix the bug and return the complete corrected artifact.

ERROR
```
{error[:1500]}
```

CURRENT CODE (v{artifact.get('version', 1)}):
```{kind}
{artifact.get('content', '')}
```

OUTPUT RULES
- Reply with one short sentence about the fix, then EXACTLY ONE fenced `{kind}` block.
- Offline sandbox: no imports, no CDN, no fetch, no external assets.
- Keep everything that still works; this is a repair, not a redesign.
- Keep it under ~200 lines.
{shape}
"""


# ------------------------------------------------------------------ reply parsing

_FENCE_RE = re.compile(r"```([\w-]*)\s*\n([\s\S]*?)```", re.MULTILINE)


def title_from(message: str) -> str:
    """A short human title from the request ("build me a 3D spaceship")."""
    text = re.sub(r"^(hey\s+jarvis[,!.]?\s*)", "", (message or "").strip(), flags=re.I)
    text = re.sub(
        r"^(please\s+)?(can\s+you\s+)?(build|make|create|generate|design|draw|render|code|program)\s+"
        r"(me\s+)?(a|an|the)?\s*",
        "",
        text,
        flags=re.I,
    )
    text = re.sub(r"\s+", " ", text).strip(" .!?")
    if not text:
        return "Artifact"
    words = text.split(" ")[:7]
    title = " ".join(words)
    return title[:1].upper() + title[1:]


def parse_reply(text: str) -> dict[str, Any] | None:
    """Pull the artifact block out of the model's reply."""
    blocks = [(lang.lower(), code.rstrip()) for lang, code in _FENCE_RE.findall(text or "")]
    if not blocks:
        return None
    picked: tuple[str, str] | None = None
    for lang, code in blocks:
        if lang in {"three", "html", "svg"}:
            picked = (lang, code)
            break
    if picked is None:
        for lang, code in blocks:
            lowered = code.lower()
            if "<svg" in lowered:
                picked = ("svg", code)
            elif "<html" in lowered or "<!doctype" in lowered:
                picked = ("html", code)
            elif "three" in lowered or "jarvis." in lowered:
                picked = ("three", code)
        if picked is None:
            lang, code = blocks[0]
            if lang in {"js", "javascript", "ts"} and ("three" in code.lower() or "jarvis." in code.lower()):
                picked = ("three", code)
    if picked is None:
        return None
    kind, code = picked
    return {"kind": kind, "content": code.strip("\n")}


def strip_fences(text: str) -> str:
    """The prose part of a reply (for the chat bubble)."""
    without = _FENCE_RE.sub("", text or "")
    without = re.sub(r"\n{3,}", "\n\n", without).strip()
    return without


# ------------------------------------------------------------------ repair bookkeeping

_REPAIRED: dict[tuple[str, int], float] = {}
_REPAIR_WINDOW = 15 * 60


def can_repair(artifact_id: str, version: int) -> bool:
    key = (artifact_id, int(version))
    last = _REPAIRED.get(key)
    return last is None or (time.time() - last) > _REPAIR_WINDOW


def mark_repaired(artifact_id: str, version: int) -> None:
    _REPAIRED[(artifact_id, int(version))] = time.time()
