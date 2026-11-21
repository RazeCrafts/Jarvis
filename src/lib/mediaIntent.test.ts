import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDedicatedAppTargets,
  isDirectMediaUrl,
  parseMediaPlayCommand,
  toEmbedUrl,
} from "./mediaIntent";

test("parseMediaPlayCommand extracts online movie play-in-site requests", () => {
  const intent = parseMediaPlayCommand("find Oppenheimer movie online and play it from this site");
  assert.ok(intent);
  assert.equal(intent.query, "Oppenheimer");
  assert.equal(intent.kind, "movie");
  assert.equal(intent.playInSite, true);
});

test("parseMediaPlayCommand extracts song + dedicated app requests", () => {
  const intent = parseMediaPlayCommand("play Blinding Lights song on Spotify");
  assert.ok(intent);
  assert.equal(intent.query, "Blinding Lights");
  assert.equal(intent.kind, "song");
  assert.equal(intent.preferredApp, "spotify");
});

test("parseMediaPlayCommand recognizes local playback preference without swallowing LG TV commands", () => {
  const localSong = parseMediaPlayCommand("play interstellar theme song locally");
  assert.ok(localSong);
  assert.equal(localSong.playLocal, true);
  assert.equal(localSong.kind, "song");

  assert.equal(parseMediaPlayCommand("open Netflix on my LG TV"), null);
  assert.equal(parseMediaPlayCommand("open workshop"), null);
});

test("toEmbedUrl converts YouTube, Archive.org, Vimeo, and Spotify track URLs", () => {
  assert.equal(
    toEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    "https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0",
  );
  assert.equal(
    toEmbedUrl("https://archive.org/details/night_of_the_living_dead"),
    "https://archive.org/embed/night_of_the_living_dead",
  );
  assert.equal(
    toEmbedUrl("https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b"),
    "https://open.spotify.com/embed/track/0VjIjW4GlUZAMYd2vXMi3b",
  );
  assert.equal(isDirectMediaUrl("https://cdn.example.com/movie.mp4"), true);
});

test("buildDedicatedAppTargets builds Spotify protocol URI for songs and streaming targets for movies", () => {
  const songTargets = buildDedicatedAppTargets("Daft Punk Get Lucky", "song");
  assert.equal(songTargets[0]?.id, "spotify");
  assert.ok(songTargets[0]?.protocolUri?.startsWith("spotify:search:"));

  const movieTargets = buildDedicatedAppTargets("Interstellar", "movie");
  assert.ok(movieTargets.some((t) => t.id === "netflix"));
  assert.ok(movieTargets.some((t) => t.id === "stremio"));
  assert.ok(movieTargets.some((t) => t.id === "archive"));
});
