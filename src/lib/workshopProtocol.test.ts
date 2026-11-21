import test from "node:test";
import assert from "node:assert/strict";
import {
  estimateUsageCostUsd,
  parseWorkshopParts,
  replaceWorkshopPart,
  summarizeCostReceipt,
} from "./workshopProtocol.ts";

test("parseWorkshopParts splits incremental //@part blocks and //@say messages", () => {
  const src = `//@title Orbital Drone
const baseColor = "#22d3ee";
//@part frame | Building central chassis
W.add(JARVIS.box(2, 0.3, 2, W.metal("titanium")), { name: "frame", explode: [0, 0, 0] });
//@part rotor-fl | Adding front-left rotor
W.add(JARVIS.cylinder(0.5, 0.5, 0.1, W.metal("gold")), { name: "rotor-fl", explode: [-1.2, 0.8, 1.2] });
//@say Ready for inspection, sir.
//@end`;

  const parsed = parseWorkshopParts(src);
  assert.equal(parsed.title, "Orbital Drone");
  assert.equal(parsed.parts.length, 2);
  assert.equal(parsed.parts[0].name, "frame");
  assert.equal(parsed.parts[1].name, "rotor-fl");
  assert.deepEqual(parsed.say, ["Ready for inspection, sir."]);
  assert.equal(parsed.complete, true);
});

test("replaceWorkshopPart swaps one part without altering others", () => {
  const initial = `//@title Drone
//@part frame | Chassis
const f = 1;
//@part rotor | Silver rotor
const r = "silver";
//@end`;

  const edited = replaceWorkshopPart(initial, "rotor", 'const r = "rose-gold";', "Rose gold rotor");
  const reparsed = parseWorkshopParts(edited);
  assert.equal(reparsed.parts.length, 2);
  assert.equal(reparsed.parts[0].code, "const f = 1;");
  assert.equal(reparsed.parts[1].code, 'const r = "rose-gold";');
  assert.equal(reparsed.parts[1].status, "Rose gold rotor");
});

test("estimateUsageCostUsd & summarizeCostReceipt produce accurate totals", () => {
  const c1 = estimateUsageCostUsd({ model: "gemini-4-hydrogen", inputTokens: 2000, outputTokens: 1000 });
  const c2 = estimateUsageCostUsd({ model: "gemini-3.1-flash-lite-image", imageCount: 1 });
  const summary = summarizeCostReceipt([
    { id: "1", ts: 1, model: "gemini-4-hydrogen", kind: "chat", inputTokens: 2000, outputTokens: 1000, imageCount: 0, estimatedUsd: c1 },
    { id: "2", ts: 2, model: "gemini-3.1-flash-lite-image", kind: "image", inputTokens: 0, outputTokens: 0, imageCount: 1, estimatedUsd: c2 },
  ]);
  assert.equal(summary.callCount, 2);
  assert.equal(summary.imageCount, 1);
  assert.ok(summary.totalUsd > 0.039);
});
