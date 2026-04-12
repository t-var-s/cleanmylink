import test from "node:test";
import assert from "node:assert/strict";

import { createStorageAdapter } from "../src/storage.js";
import {
  composeEnabledTransforms,
  transformSettingsStorageKey
} from "../src/settings-storage.js";
import { siteRules } from "../src/transforms.js";

function createMemoryStorage() {
  const data = new Map();

  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },

    setItem(key, value) {
      data.set(key, String(value));
    }
  };
}

test("storage adapter persists only domain transform settings", async () => {
  const memoryStorage = createMemoryStorage();
  const storage = createStorageAdapter({ storageObject: memoryStorage });

  await storage.writeDomainTransformSettings({
    "strip-tracking-params": false,
    "rewrite-reddit-to-redlib": false
  });

  const saved = JSON.parse(memoryStorage.getItem(transformSettingsStorageKey));

  assert.deepEqual(
    Object.keys(saved.enabledTransforms).sort(),
    siteRules.map(({ id }) => id).sort()
  );
  assert.equal(saved.enabledTransforms["rewrite-reddit-to-redlib"], false);
  assert.equal(saved.enabledTransforms["strip-tracking-params"], undefined);
});

test("domain settings keep global cleanup transforms enabled", async () => {
  const memoryStorage = createMemoryStorage();
  const storage = createStorageAdapter({ storageObject: memoryStorage });

  await storage.writeDomainTransformSettings({
    "strip-tracking-params": false,
    "keep-youtube-video-id": false
  });

  const enabledTransforms = composeEnabledTransforms(
    await storage.readDomainTransformSettings()
  );

  assert.equal(enabledTransforms["strip-tracking-params"], true);
  assert.equal(enabledTransforms["keep-youtube-video-id"], false);
});

test("domain settings recover from malformed storage", async () => {
  const memoryStorage = createMemoryStorage();
  const storage = createStorageAdapter({ storageObject: memoryStorage });

  memoryStorage.setItem(transformSettingsStorageKey, "{nope");

  assert.deepEqual(
    await storage.readDomainTransformSettings(),
    Object.fromEntries(siteRules.map((definition) => [definition.id, definition.defaultEnabled]))
  );
});
