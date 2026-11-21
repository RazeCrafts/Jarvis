import test from "node:test";
import assert from "node:assert/strict";
import { JARVIS_THEMES, getThemeById } from "./themes";

test("provides 41 distinct themes across dark and daylight categories including Golden Holographic Core", () => {
  assert.equal(JARVIS_THEMES.length, 41);
  const ids = new Set(JARVIS_THEMES.map((t) => t.id));
  assert.equal(ids.size, 41);
  assert.equal(JARVIS_THEMES[0].id, "golden-hologram");
  const darkCount = JARVIS_THEMES.filter((t) => t.isDark).length;
  const lightCount = JARVIS_THEMES.filter((t) => !t.isDark).length;
  assert.ok(darkCount >= 25);
  assert.ok(lightCount >= 8);
});

test("every theme contains valid hex tokens and fallback lookup works", () => {
  const hexRe = /^#[0-9a-fA-F]{6}$/;
  for (const theme of JARVIS_THEMES) {
    assert.match(theme.background, hexRe, `${theme.id} background`);
    assert.match(theme.surface, hexRe, `${theme.id} surface`);
    assert.match(theme.accent, hexRe, `${theme.id} accent`);
    assert.match(theme.fg, hexRe, `${theme.id} fg`);
  }
  assert.equal(getThemeById("non-existent-id").id, JARVIS_THEMES[0].id);
  assert.equal(getThemeById("architectural-paper").isDark, false);
});
