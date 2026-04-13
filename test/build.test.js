import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { contentSecurityPolicy, pages } from "../site.config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.resolve(__dirname, "..", "dist");
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function existsInDist(...segments) {
  return fs.existsSync(path.join(distDir, ...segments));
}

function readDistFile(...segments) {
  return fs.readFileSync(path.join(distDir, ...segments), "utf8");
}

function readRootFile(...segments) {
  return fs.readFileSync(path.join(rootDir, ...segments), "utf8");
}

test("build output publishes the generated site without source-only directories", () => {
  assert.ok(existsInDist("index.html"));
  assert.ok(existsInDist("settings.html"));
  assert.ok(existsInDist("manifest.webmanifest"));
  assert.ok(existsInDist("sw.js"));
  assert.ok(existsInDist("assets"));

  assert.equal(existsInDist("references"), false);
  assert.equal(existsInDist("test"), false);
  assert.equal(existsInDist("scripts"), false);
  assert.equal(existsInDist("src"), false);
});

test("generated service worker includes a stamped cache version and built app shell", () => {
  const serviceWorker = readDistFile("sw.js");

  assert.match(
    serviceWorker,
    new RegExp(`const APP_VERSION = "${escapeRegExp(packageJson.version)}-[^"]+"`)
  );
  assert.doesNotMatch(serviceWorker, /__APP_VERSION__/);
  assert.doesNotMatch(serviceWorker, /__APP_SHELL__/);
  assert.match(serviceWorker, /\.\/index\.html/);
  assert.match(serviceWorker, /\.\/settings\.html/);
  assert.match(serviceWorker, /\.\/manifest\.webmanifest/);
  assert.match(serviceWorker, /\.\/assets\/index-[^"]+\.js/);
  assert.match(serviceWorker, /\.\/assets\/settings-[^"]+\.js/);
  assert.match(serviceWorker, /\.\/assets\/[^"]+\.css/);
  assert.match(serviceWorker, /\.\/assets\/favicon-48-v4\.png/);
  assert.match(serviceWorker, /\.\/assets\/icon-192-v4\.png/);
  assert.doesNotMatch(serviceWorker, /\.\/references\//);
});

test("built pages receive shared and page-specific head metadata", () => {
  for (const page of Object.values(pages)) {
    const html = readDistFile(path.basename(page.input));

    assert.doesNotMatch(html, /app-head/);
    assert.match(html, new RegExp(`<title>${escapeRegExp(page.title)}</title>`));
    assert.match(
      html,
      new RegExp(`<meta name="description" content="${escapeRegExp(page.description)}">`)
    );
    assert.match(
      html,
      new RegExp(`<meta property="og:title" content="${escapeRegExp(page.title)}">`)
    );
    assert.match(
      html,
      new RegExp(`<meta name="twitter:title" content="${escapeRegExp(page.title)}">`)
    );
    assert.match(
      html,
      new RegExp(`<meta http-equiv="Content-Security-Policy" content="${escapeRegExp(contentSecurityPolicy)}">`)
    );
    assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/);
    assert.match(html, /<link rel="stylesheet" crossorigin href="\/assets\/[^"]+\.css">/);
  }
});

test("Netlify CSP header stays aligned with the shared app policy", () => {
  const netlifyToml = readRootFile("netlify.toml");
  const match = netlifyToml.match(/Content-Security-Policy = "([^"]+)"/);

  assert.ok(match, "Netlify CSP header is missing.");
  assert.equal(match[1], contentSecurityPolicy);
});
