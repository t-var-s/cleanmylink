const test = require("node:test");
const assert = require("node:assert/strict");

const transforms = require("../transforms.js");

test("cleanUrl removes standard and known tracking parameters while preserving others", () => {
  const input = new URL(
    "https://example.com/path?utm_source=newsletter&ref=abc&fbclid=123&gclid=456&smid=789&keep=ok"
  );

  assert.equal(transforms.cleanUrl(input), "https://example.com/path?keep=ok");
});

test("cleanUrl rewrites x.com links to fxtwitter.com when the path is not an article", () => {
  const input = new URL("https://x.com/someuser/status/42?utm_source=social");

  assert.equal(transforms.cleanUrl(input), "https://fxtwitter.com/someuser/status/42");
});

test("cleanUrl leaves x.com article links unchanged apart from tracking cleanup", () => {
  const input = new URL("https://x.com/i/article/123?fbclid=999&keep=ok");

  assert.equal(transforms.cleanUrl(input), "https://x.com/i/article/123?keep=ok");
});

test("cleanUrl keeps only the video id on YouTube watch URLs", () => {
  const input = new URL("https://www.youtube.com/watch?v=abc123&utm_source=newsletter&t=90");

  assert.equal(transforms.cleanUrl(input), "https://www.youtube.com/watch?v=abc123");
});

test("cleanInput treats whitespace-split URLs as URLs and cleans them", () => {
  const result = transforms.cleanInput(" https://example.com/\n?utm_source=test&keep=1 ");

  assert.deepEqual(result, {
    output: "https://example.com/?keep=1",
    isUrl: true,
    changed: true
  });
});

test("cleanText collapses whitespace and converts all-caps text to sentence case", () => {
  assert.equal(
    transforms.cleanText("HELLO   WORLD.\nTHIS IS FINE."),
    "Hello world. This is fine."
  );
});

test("parseUrl only accepts http and https URLs", () => {
  assert.equal(transforms.parseUrl("mailto:test@example.com"), null);
  assert.ok(transforms.parseUrl("https://example.com"));
});
