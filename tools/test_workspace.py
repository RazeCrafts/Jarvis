"""Quick self-test for backend/workspace.py (no network, temp store)."""

import os
import sys
import tempfile

os.environ["HERMES_HOME"] = tempfile.mkdtemp()
sys.path.insert(0, r"C:\Users\ramch\Jarvis\backend")

import workspace as W  # noqa: E402

cases = [
    ("build me a 3D spaceship", "three", False, "build"),
    ("create a to-do app", "html", False, "build"),
    ("design an SVG logo for JARVIS", "svg", False, "build"),
    ("build a solar system", "three", False, "build"),
    ("make a bouncing ball simulation", "html", False, "build"),
    ("what is the weather tomorrow", None, None, "chat"),
    ("search for cheap flights", None, None, "chat"),
    ("make me a sandwich", None, None, "chat (no artifact yet)"),
]
for message, kind, edit, label in cases:
    got = W.request_kind(message)
    ok = (got is None and kind is None) or (
        got is not None and got["kind"] == kind and got["edit"] is edit
    )
    print(("PASS" if ok else "FAIL"), label, "->", got)

reply = """Ship is ready.

```three
const s = JARVIS.sphere(1, JARVIS.mat('#fff'));
JARVIS.add(s);
JARVIS.fit();
```

Enjoy the glow."""
parsed = W.parse_reply(reply)
print("parse:", parsed["kind"], parsed["content"].splitlines()[0])
print("prose:", repr(W.strip_fences(reply)))
print("title:", W.title_from("build me a 3D spaceship with glowing engines"))

a = W.save("three", "Ship", "const s=1;")
b = W.save("three", "Ship", "const s=2;", a["id"])
c = W.undo(a["id"])
print("versions:", a["version"], b["version"], "undo ->", c["version"], c["content"])

print("edit now:", W.request_kind("make the wings red"))
print("build now:", W.request_kind("build a solar system"))
print("not edit:", W.request_kind("explain the wings"))
