import test from "node:test";
import assert from "node:assert/strict";
import { classifyFileKind } from "./fileAttachment";

test("classifyFileKind accurately identifies video, audio, image, text, and binary documents", () => {
  assert.equal(classifyFileKind("vlog_clip.mkv", ""), "video");
  assert.equal(classifyFileKind("clip.mov", "video/quicktime"), "video");
  assert.equal(classifyFileKind("beat.mp3", "audio/mpeg"), "audio");
  assert.equal(classifyFileKind("track.flac", ""), "audio");
  assert.equal(classifyFileKind("cover.webp", "image/webp"), "image");
  assert.equal(classifyFileKind("notes.md", ""), "text");
  assert.equal(classifyFileKind("config.json", "application/json"), "text");
  assert.equal(classifyFileKind("spec.pdf", "application/pdf"), "document");
});
