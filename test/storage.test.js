import test from "node:test";
import assert from "node:assert/strict";

import { createStorageAdapter, historyStorageKey } from "../src/storage.js";
import {
  composeEnabledTransforms,
  normalizeDomainTransformSettings,
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

function createFakeDatabase(seed = {}) {
  const data = new Map(Object.entries(seed));
  const writes = [];

  return {
    writes,

    async get(storeName, key) {
      return data.get(key);
    },

    async put(storeName, value, key) {
      data.set(key, value);
      writes.push({ storeName, key, value });
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

test("domain settings fill missing and invalid transform ids with defaults", () => {
  assert.deepEqual(
    normalizeDomainTransformSettings({
      enabledTransforms: {
        "rewrite-x-to-fxtwitter": false,
        "rewrite-reddit-to-redlib": "nope"
      }
    }),
    {
      "rewrite-x-to-fxtwitter": false,
      "rewrite-reddit-to-redlib": true,
      "keep-youtube-video-id": true
    }
  );
});

test("indexeddb adapter persists history entries", async () => {
  const database = createFakeDatabase();
  const storage = createStorageAdapter({
    openDatabase: async () => database
  });
  const entries = [
    {
      url: "https://example.com/one",
      timestamp: 1
    }
  ];

  await storage.writeHistoryEntries(entries);

  assert.deepEqual(
    database.writes,
    [
      {
        storeName: "keyval",
        key: historyStorageKey,
        value: JSON.stringify(entries)
      }
    ]
  );
  assert.deepEqual(await storage.readHistoryEntries(), entries);
});

test("indexeddb adapter persists only domain transform settings", async () => {
  const database = createFakeDatabase();
  const storage = createStorageAdapter({
    openDatabase: async () => database
  });

  await storage.writeDomainTransformSettings({
    "strip-tracking-params": false,
    "rewrite-x-to-fxtwitter": false
  });

  const saved = JSON.parse(database.writes[0].value);

  assert.equal(database.writes[0].storeName, "keyval");
  assert.equal(database.writes[0].key, transformSettingsStorageKey);
  assert.deepEqual(
    Object.keys(saved.enabledTransforms).sort(),
    siteRules.map(({ id }) => id).sort()
  );
  assert.equal(saved.enabledTransforms["rewrite-x-to-fxtwitter"], false);
  assert.equal(saved.enabledTransforms["strip-tracking-params"], undefined);
});

test("indexeddb adapter migrates missing history from local storage", async () => {
  const localStorage = createMemoryStorage();
  const database = createFakeDatabase();
  const entries = [
    {
      url: "https://example.com/migrated",
      timestamp: 2
    }
  ];
  localStorage.setItem(historyStorageKey, JSON.stringify(entries));

  const storage = createStorageAdapter({
    openDatabase: async () => database,
    fallbackStorageObject: localStorage
  });

  assert.deepEqual(await storage.readHistoryEntries(), entries);
  assert.deepEqual(database.writes, [
    {
      storeName: "keyval",
      key: historyStorageKey,
      value: JSON.stringify(entries)
    }
  ]);
  assert.equal(localStorage.getItem(historyStorageKey), JSON.stringify(entries));
});

test("indexeddb adapter migrates missing domain settings from local storage", async () => {
  const localStorage = createMemoryStorage();
  const database = createFakeDatabase();
  const savedSettings = {
    version: 1,
    enabledTransforms: {
      "rewrite-x-to-fxtwitter": false,
      "rewrite-reddit-to-redlib": true,
      "keep-youtube-video-id": true
    }
  };
  localStorage.setItem(transformSettingsStorageKey, JSON.stringify(savedSettings));

  const storage = createStorageAdapter({
    openDatabase: async () => database,
    fallbackStorageObject: localStorage
  });

  assert.deepEqual(await storage.readDomainTransformSettings(), savedSettings.enabledTransforms);
  assert.deepEqual(database.writes, [
    {
      storeName: "keyval",
      key: transformSettingsStorageKey,
      value: JSON.stringify(savedSettings)
    }
  ]);
  assert.equal(localStorage.getItem(transformSettingsStorageKey), JSON.stringify(savedSettings));
});

test("indexeddb adapter prefers indexeddb values over local storage migration values", async () => {
  const localStorage = createMemoryStorage();
  localStorage.setItem(
    historyStorageKey,
    JSON.stringify([
      {
        url: "https://example.com/local",
        timestamp: 1
      }
    ])
  );

  const indexedEntries = [
    {
      url: "https://example.com/indexed",
      timestamp: 3
    }
  ];
  const database = createFakeDatabase({
    [historyStorageKey]: JSON.stringify(indexedEntries)
  });
  const storage = createStorageAdapter({
    openDatabase: async () => database,
    fallbackStorageObject: localStorage
  });

  assert.deepEqual(await storage.readHistoryEntries(), indexedEntries);
  assert.deepEqual(database.writes, []);
});

test("storage adapter falls back to local storage when indexeddb cannot open", async () => {
  const localStorage = createMemoryStorage();
  const entries = [
    {
      url: "https://example.com/fallback",
      timestamp: 4
    }
  ];
  const storage = createStorageAdapter({
    openDatabase: async () => {
      throw new Error("indexeddb unavailable");
    },
    fallbackStorageObject: localStorage
  });

  await storage.writeHistoryEntries(entries);

  assert.equal(localStorage.getItem(historyStorageKey), JSON.stringify(entries));
  assert.deepEqual(await storage.readHistoryEntries(), entries);
});
