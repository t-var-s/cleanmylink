import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "..", "dist");
const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "package.json"), "utf8"));

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function existsInDist(...segments) {
  return fs.existsSync(path.join(distDir, ...segments));
}

function readDistFile(...segments) {
  return fs.readFileSync(path.join(distDir, ...segments), "utf8");
}

test("build output publishes the generated site without source-only directories", () => {
  assert.ok(existsInDist("index.html"));
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
  assert.match(serviceWorker, /\.\/manifest\.webmanifest/);
  assert.match(serviceWorker, /\.\/assets\/index-[^"]+\.js/);
  assert.match(serviceWorker, /\.\/assets\/index-[^"]+\.css/);
  assert.match(serviceWorker, /\.\/assets\/favicon-48-v4\.png/);
  assert.match(serviceWorker, /\.\/assets\/icon-192-v4\.png/);
  assert.doesNotMatch(serviceWorker, /\.\/references\//);
});
