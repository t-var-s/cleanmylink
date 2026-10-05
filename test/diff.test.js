import test from "node:test";
import assert from "node:assert/strict";

import { diffSegments, maxDiffTokens, tokenize } from "../src/diff.js";
import { cleanInput } from "../src/transforms.js";

function sideOf(segments, kind) {
  return segments
    .filter((segment) => segment.kind === "same" || segment.kind === kind)
    .map((segment) => segment.text)
    .join("");
}

test("tokenize splits on URL delimiters and whitespace and keeps them", () => {
  const url = "https://example.com/a/b?x=1&y=2#top";

  assert.deepEqual(tokenize(url), [
    "https", ":", "/", "/", "example", ".", "com", "/", "a", "/", "b",
    "?", "x", "=", "1", "&", "y", "=", "2", "#", "top"
  ]);
  assert.equal(tokenize(url).join(""), url);
  assert.deepEqual(tokenize("one  two\nthree"), ["one", "  ", "two", "\n", "three"]);
  assert.deepEqual(tokenize(""), []);
});

test("diffSegments marks removed query parameters as removed", () => {
  const input = "https://example.com/path?utm_source=newsletter&keep=1";
  const segments = diffSegments(input, cleanInput(input).output);

  assert.deepEqual(segments, [
    { text: "https://example.com/path?", kind: "same" },
    { text: "utm_source=newsletter&", kind: "removed" },
    { text: "keep=1", kind: "same" }
  ]);
});

test("diffSegments marks a trailing tracking query as removed", () => {
  const input = "https://example.com/?gclid=abc";

  assert.deepEqual(diffSegments(input, cleanInput(input).output), [
    { text: "https://example.com/", kind: "same" },
    { text: "?gclid=abc", kind: "removed" }
  ]);
});

test("diffSegments shows a host rewrite as removed plus added", () => {
  const input = "https://x.com/user/status/42?utm_source=x";
  const segments = diffSegments(input, cleanInput(input).output);

  assert.deepEqual(segments, [
    { text: "https://", kind: "same" },
    { text: "x", kind: "removed" },
    { text: "fxtwitter", kind: "added" },
    { text: ".com/user/status/42", kind: "same" },
    { text: "?utm_source=x", kind: "removed" }
  ]);
  assert.equal(sideOf(segments, "removed"), input);
  assert.equal(sideOf(segments, "added"), "https://fxtwitter.com/user/status/42");
});

test("diffSegments yields a single same segment for identical strings", () => {
  const url = "https://example.com/path?keep=1";

  assert.deepEqual(diffSegments(url, url), [{ text: url, kind: "same" }]);
  assert.deepEqual(diffSegments("", ""), []);
});

test("diffSegments represents a plain-text whitespace collapse", () => {
  const input = "hello   world\nagain";
  const output = cleanInput(input).output;
  const segments = diffSegments(input, output);

  assert.equal(output, "hello world again");
  assert.deepEqual(segments, [
    { text: "hello", kind: "same" },
    { text: "   ", kind: "removed" },
    { text: " ", kind: "added" },
    { text: "world", kind: "same" },
    { text: "\n", kind: "removed" },
    { text: " ", kind: "added" },
    { text: "again", kind: "same" }
  ]);
});

test("diffSegments keeps both sides recoverable for sentence-case text", () => {
  const input = "HELLO   WORLD.\nTHIS IS FINE.";
  const output = cleanInput(input).output;
  const segments = diffSegments(input, output);

  assert.equal(sideOf(segments, "removed"), input);
  assert.equal(sideOf(segments, "added"), output);
  assert.ok(segments.some((segment) => segment.kind === "removed"));
  assert.ok(segments.some((segment) => segment.kind === "added"));
});

test("diffSegments falls back to one removed and one added segment for oversized input", () => {
  const input = `https://example.com/?${Array.from({ length: maxDiffTokens }, (_, index) => `p${index}=1`).join("&")}&utm_source=x`;
  const output = input.replace("&utm_source=x", "");

  assert.ok(tokenize(input).length > maxDiffTokens);
  assert.deepEqual(diffSegments(input, output), [
    { text: input, kind: "removed" },
    { text: output, kind: "added" }
  ]);
});

test("diffSegments handles empty sides", () => {
  assert.deepEqual(diffSegments("", "added"), [{ text: "added", kind: "added" }]);
  assert.deepEqual(diffSegments("removed", ""), [{ text: "removed", kind: "removed" }]);
});
