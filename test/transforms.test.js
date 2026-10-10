import test from "node:test";
import assert from "node:assert/strict";

import * as transforms from "../src/transforms.js";

test("transform definitions expose stable settings metadata", () => {
  assert.deepEqual(
    transforms.transformDefinitions.map(({ id }) => id),
    [
      "unwrap-redirects",
      "strip-tracking-params",
      "strip-tracking-fragments",
      "rewrite-x-to-fxtwitter",
      "rewrite-reddit-to-redlib",
      "keep-youtube-video-id",
      "normalize-text-whitespace",
      "sentence-case-all-caps"
    ]
  );

  for (const definition of transforms.transformDefinitions) {
    assert.equal(typeof definition.label, "string");
    assert.equal(typeof definition.defaultEnabled, "boolean");
    assert.ok(["url", "text"].includes(definition.type));
  }

  for (const definition of transforms.siteRules) {
    assert.equal(typeof definition.domainLabel, "string");
  }
});

test("cleanUrl removes standard and known tracking parameters while preserving others", () => {
  const input = new URL(
    "https://example.com/path?utm_source=newsletter&ref=abc&fbclid=123&gclid=456&smid=789&keep=ok"
  );

  assert.equal(transforms.cleanUrl(input), "https://example.com/path?keep=ok");
});

test("cleanUrl can leave tracking parameters enabled by settings", () => {
  const input = new URL("https://example.com/path?utm_source=newsletter&keep=ok");

  assert.equal(
    transforms.cleanUrl(input, {
      enabledTransforms: {
        "strip-tracking-params": false
      }
    }),
    "https://example.com/path?utm_source=newsletter&keep=ok"
  );
});

test("cleanUrl rewrites x.com links to fxtwitter.com when the path is not an article", () => {
  const input = new URL("https://x.com/someuser/status/42?utm_source=social");

  assert.equal(transforms.cleanUrl(input), "https://fxtwitter.com/someuser/status/42");
});

test("cleanUrl can leave the x.com rewrite disabled by settings", () => {
  const input = new URL("https://x.com/someuser/status/42?utm_source=social");

  assert.equal(
    transforms.cleanUrl(input, {
      enabledTransforms: {
        "rewrite-x-to-fxtwitter": false
      }
    }),
    "https://x.com/someuser/status/42"
  );
});

test("cleanUrl leaves x.com article links unchanged apart from tracking cleanup", () => {
  const input = new URL("https://x.com/i/article/123?fbclid=999&keep=ok");

  assert.equal(transforms.cleanUrl(input), "https://x.com/i/article/123?keep=ok");
});

test("cleanUrl rewrites reddit.com links to redlib.freedit.eu", () => {
  const input = new URL("https://www.reddit.com/r/node/comments/abc123/post?utm_source=share&keep=ok");

  assert.equal(
    transforms.cleanUrl(input),
    "https://redlib.freedit.eu/r/node/comments/abc123/post?keep=ok"
  );
});

test("cleanUrl keeps only the video id and start time on YouTube watch URLs", () => {
  const input = new URL("https://www.youtube.com/watch?v=abc123&utm_source=newsletter&t=90&list=PL1");

  assert.equal(transforms.cleanUrl(input), "https://www.youtube.com/watch?v=abc123&t=90");
  assert.equal(
    transforms.cleanUrl(new URL("https://youtu.be/abc123?si=share&t=5")),
    "https://youtu.be/abc123?t=5"
  );
  assert.equal(
    transforms.cleanUrl(new URL("https://www.youtube.com/watch?v=abc123&si=share")),
    "https://www.youtube.com/watch?v=abc123"
  );
});

test("cleanUrl removes tracking prefixes and the full known list case-insensitively", () => {
  const input = new URL(
    "https://example.com/?MTM_campaign=1&pk_kwd=2&HSA_ad=3&_bta_c=4&ElqTrackId=5&gbraid=6&srsltid=7&igsh=8&spm=9&clickid=10&keep=ok"
  );

  assert.equal(transforms.cleanUrl(input), "https://example.com/?keep=ok");
  assert.equal(transforms.isTrackingParam("UTM_Source"), true);
  assert.equal(transforms.isTrackingParam("keep"), false);
});

test("cleanUrl unwraps a redirect wrapper and cleans the destination", () => {
  const input = new URL("https://www.google.com/url?q=https://example.com/a%3Futm_medium%3Dmail&sa=D");

  assert.equal(transforms.cleanUrl(input), "https://example.com/a");
  assert.equal(
    transforms.cleanUrl(new URL("https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2F&rut=abc")),
    "https://example.org/"
  );
  assert.equal(
    transforms.cleanUrl(new URL("https://l.facebook.com/l.php?u=https%3A%2F%2Fx.com%2Fuser%2Fstatus%2F42%3Ffbclid%3D1&h=AT0")),
    "https://fxtwitter.com/user/status/42"
  );
});

test("cleanUrl unwraps nested wrappers up to the pass limit", () => {
  const inner = "https://example.com/p?fbclid=1&keep=2";
  const google = `https://www.google.com/url?q=${encodeURIComponent(inner)}`;
  const safelink = `https://nam12.safelinks.protection.outlook.com/?url=${encodeURIComponent(google)}&data=05`;

  assert.equal(transforms.cleanUrl(new URL(safelink)), "https://example.com/p?keep=2");

  let wrapped = inner;
  for (let depth = 0; depth < transforms.maxUnwrapPasses + 1; depth += 1) {
    wrapped = `https://www.google.com/url?q=${encodeURIComponent(wrapped)}`;
  }
  const output = new URL(transforms.cleanUrl(new URL(wrapped)));
  assert.equal(output.hostname, "www.google.com");
  assert.equal(output.pathname, "/url");
});

test("cleanUrl leaves wrappers alone when the destination is not an HTTP(S) URL or the path differs", () => {
  assert.equal(
    transforms.cleanUrl(new URL("https://www.google.com/url?q=javascript:alert(1)")),
    "https://www.google.com/url?q=javascript:alert(1)"
  );
  assert.equal(
    transforms.cleanUrl(new URL("https://www.google.com/url?q=/relative")),
    "https://www.google.com/url?q=/relative"
  );
  assert.equal(
    transforms.cleanUrl(new URL("https://google.com/search?q=https://example.com")),
    "https://google.com/search?q=https://example.com"
  );
  assert.equal(
    transforms.cleanUrl(new URL("https://evil.safelinks.protection.outlook.com.example.net/?url=https://a.com")),
    "https://evil.safelinks.protection.outlook.com.example.net/?url=https://a.com"
  );
  assert.equal(transforms.cleanUrl(new URL("https://t.co/AbC123")), "https://t.co/AbC123");
});

test("cleanUrl can leave redirect unwrapping disabled by settings", () => {
  const input = new URL("https://www.google.com/url?q=https://example.com/a");

  assert.equal(
    transforms.cleanUrl(input, { enabledTransforms: { "unwrap-redirects": false } }),
    "https://www.google.com/url?q=https://example.com/a"
  );
});

test("cleanUrl removes text and tracking fragments but keeps anchors", () => {
  assert.equal(
    transforms.cleanUrl(new URL("https://example.com/page#:~:text=quoted%20words")),
    "https://example.com/page"
  );
  assert.equal(
    transforms.cleanUrl(new URL("https://example.com/docs#install:~:text=foo")),
    "https://example.com/docs#install"
  );
  assert.equal(transforms.cleanUrl(new URL("https://example.com/docs#install")), "https://example.com/docs#install");
  assert.equal(transforms.cleanUrl(new URL("https://example.com/a#xtor=AD-1")), "https://example.com/a");
  assert.equal(transforms.cleanUrl(new URL("https://example.com/a#fbclid=1")), "https://example.com/a");
  assert.equal(transforms.cleanUrl(new URL("https://example.com/a#")), "https://example.com/a");
  assert.equal(transforms.cleanUrl(new URL("https://example.com/app#/route?x=1")), "https://example.com/app#/route?x=1");
});

test("cleanInput treats whitespace-split URLs as URLs and cleans them", () => {
  const result = transforms.cleanInput(" https://example.com/\n?utm_source=test&keep=1 ");

  assert.deepEqual(result, {
    output: "https://example.com/?keep=1",
    isUrl: true,
    changed: true
  });
});

test("cleanInput extracts a URL followed by words instead of joining them into it", () => {
  assert.deepEqual(transforms.cleanInput("https://example.com/x?utm_a=1 see this"), {
    output: "https://example.com/x",
    isUrl: true,
    changed: true
  });
  assert.equal(transforms.cleanInput("https://example.com/\n?utm_a=1\n&keep=1").output, "https://example.com/?keep=1");
  assert.equal(transforms.joinSplitUrl("https://example.com/a b"), null);
});

test("cleanUrl unwraps google.com/url on any Google country domain", () => {
  for (const host of ["google.co.uk", "www.google.com.au", "google.de"]) {
    assert.equal(
      transforms.cleanUrl(new URL(`https://${host}/url?q=https://example.com/a&sa=D`)),
      "https://example.com/a",
      host
    );
  }
  assert.equal(
    transforms.cleanUrl(new URL("https://google.example.net/url?q=https://example.com/a")),
    "https://google.example.net/url?q=https://example.com/a"
  );
});

test("cleanInput extracts the single distinct URL from share text and cleans it", () => {
  const shareText =
    "72 【Title - User | 小红书】 😆 ABC 😆 https://www.xiaohongshu.com/discovery/item/64abc?xhsshare=pc_web&utm_source=copy 复制本条信息，打开【小红书】App查看精彩内容！";

  assert.deepEqual(transforms.cleanInput(shareText), {
    output: "https://www.xiaohongshu.com/discovery/item/64abc?xhsshare=pc_web",
    isUrl: true,
    changed: true
  });

  assert.equal(
    transforms.cleanInput("Title https://example.com/x?utm_a=1\nhttps://example.com/x?utm_a=1").output,
    "https://example.com/x"
  );
  assert.equal(
    transforms.cleanInput("SEE https://example.com/Case?utm_a=1 NOW").output,
    "https://example.com/Case"
  );
});

test("cleanInput trims punctuation and markup around an extracted URL", () => {
  assert.equal(transforms.cleanInput("Check this out: https://example.com/a?utm_source=x.").output, "https://example.com/a");
  assert.equal(transforms.cleanInput("<https://example.com/b?fbclid=1>").output, "https://example.com/b");
  assert.equal(transforms.cleanInput("[title](https://example.com/c?gclid=1)").output, "https://example.com/c");
  assert.equal(transforms.cleanInput("「https://example.com/f」。").output, "https://example.com/f");
  assert.equal(
    transforms.cleanInput("see https://en.wikipedia.org/wiki/Foo_(bar).").output,
    "https://en.wikipedia.org/wiki/Foo_(bar)"
  );
  assert.equal(transforms.extractSingleUrl("nothing here"), null);
});

test("cleanInput keeps text with two distinct URLs as plain text", () => {
  assert.deepEqual(transforms.cleanInput("see https://a.com/?utm_a=1 and https://b.com/"), {
    output: "see https://a.com/?utm_a=1 and https://b.com/",
    isUrl: false,
    changed: false
  });
});

test("cleanText collapses whitespace and converts all-caps text to sentence case", () => {
  assert.equal(
    transforms.cleanText("HELLO   WORLD.\nTHIS IS FINE."),
    "Hello world. This is fine."
  );
});

test("cleanText can disable text transforms independently", () => {
  assert.equal(
    transforms.cleanText("HELLO   WORLD.\nTHIS IS FINE.", {
      enabledTransforms: {
        "sentence-case-all-caps": false
      }
    }),
    "HELLO WORLD. THIS IS FINE."
  );
});

test("parseUrl only accepts http and https URLs", () => {
  assert.equal(transforms.parseUrl("mailto:test@example.com"), null);
  assert.ok(transforms.parseUrl("https://example.com"));
});
