import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGalaxyGraph,
  classifyFileCategory,
  extractRememberIntent,
  queryGalaxyBrain,
} from "./fileGalaxy.ts";

test("classifyFileCategory handles diverse workspace file formats", () => {
  assert.equal(classifyFileCategory("demo.mp4", "video/mp4"), "video");
  assert.equal(classifyFileCategory("beat.wav", "audio/wav"), "audio");
  assert.equal(classifyFileCategory("chassis.png", "image/png"), "image");
  assert.equal(classifyFileCategory("drone.py", "text/x-python"), "code");
  assert.equal(classifyFileCategory("telemetry.csv", "text/csv"), "data");
  assert.equal(classifyFileCategory("manual.pdf", "application/pdf"), "document");
});

test("buildGalaxyGraph connects notes, memories, and files via wikilinks, tags, and keywords", () => {
  const graph = buildGalaxyGraph({
    notes: [
      {
        id: "n1",
        title: "Orbital Truss Design",
        body: "Use carbon fiber struts linked to [[Telemetry Frame]] specs.",
        tags: ["aerospace", "cad"],
        updatedAt: 1000,
      },
      {
        id: "n2",
        title: "Telemetry Frame",
        body: "Antenna Dish specs and carbon fiber mass budget.",
        tags: ["telemetry"],
        updatedAt: 900,
      },
    ],
    memories: [
      {
        id: "m1",
        category: "project",
        title: "Propulsion Preference",
        content: "Always default aerospace alloys to brushed titanium.",
        pinned: true,
        createdAt: 800,
        updatedAt: 800,
      },
    ],
    files: [
      {
        id: "f1",
        name: "dish_cad_notes.md",
        mimeType: "text/markdown",
        sizeBytes: 2400,
        category: "document",
        tags: ["cad"],
        textPreview: "Carbon fiber antenna dish tolerances.",
        createdAt: 700,
        updatedAt: 700,
      },
    ],
  });

  assert.equal(graph.nodes.length, 4);
  assert.ok(graph.edges.some((e) => e.reason === "wikilink"));
  assert.ok(graph.edges.some((e) => e.reason === "tag"));
});

test("queryGalaxyBrain differentiates small talk, focused fly dive (1-3), and cluster lighting (4+)", () => {
  const graph = buildGalaxyGraph({
    notes: [
      { id: "n1", title: "Coffee Beans", body: "Single origin Ethiopian espresso beans", tags: ["coffee"], updatedAt: 10 },
      { id: "n2", title: "Alpha Log", body: "orbital test log 1", tags: ["orbital"], updatedAt: 9 },
      { id: "n3", title: "Beta Log", body: "orbital test log 2", tags: ["orbital"], updatedAt: 8 },
      { id: "n4", title: "Gamma Log", body: "orbital test log 3", tags: ["orbital"], updatedAt: 7 },
      { id: "n5", title: "Delta Log", body: "orbital test log 4", tags: ["orbital"], updatedAt: 6 },
    ],
    memories: [],
    files: [],
  });

  const smallTalk = queryGalaxyBrain(graph, "Hello there!");
  assert.equal(smallTalk.cameraAction, "still");
  assert.equal(smallTalk.litNodeIds.length, 0);

  const focused = queryGalaxyBrain(graph, "What espresso beans do I like?");
  assert.equal(focused.cameraAction, "fly");
  assert.equal(focused.focusNodeId, "note:n1");

  const broad = queryGalaxyBrain(graph, "orbital test log");
  assert.equal(broad.cameraAction, "cluster");
  assert.equal(broad.focusNodeId, null);
  assert.ok(broad.litNodeIds.length >= 4);
});

test("extractRememberIntent captures natural recall phrases", () => {
  const hit = extractRememberIntent("Remember that my LG TV IP address is 192.168.1.55");
  assert.ok(hit);
  assert.ok(hit.body.includes("192.168.1.55"));
  assert.ok(hit.tags.includes("live-recall"));
});
