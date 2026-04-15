import { openDB } from "idb";

import {
  getDefaultDomainTransformSettings,
  normalizeDomainTransformSettings,
  toStoredTransformSettings,
  transformSettingsStorageKey
} from "./settings-storage.js";

export const historyStorageKey = "clean-my-link-history";
const databaseName = "clean-my-link-storage";
const databaseVersion = 1;
const storeName = "keyval";

function parseHistoryEntries(rawEntries) {
  const entries = JSON.parse(rawEntries || "[]");
  return Array.isArray(entries) ? entries : [];
}

function parseDomainTransformSettings(rawSettings) {
  if (!rawSettings) {
    return getDefaultDomainTransformSettings();
  }

  try {
    return normalizeDomainTransformSettings(JSON.parse(rawSettings));
  } catch {
    return getDefaultDomainTransformSettings();
  }
}

function openCleanMyLinkDatabase() {
  return openDB(databaseName, databaseVersion, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(storeName)) {
        database.createObjectStore(storeName);
      }
    }
  });
}

function getGlobalLocalStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function createLocalStorageAdapter({
  storageObject = getGlobalLocalStorage(),
  historyKey = historyStorageKey,
  settingsKey = transformSettingsStorageKey
} = {}) {
  if (!storageObject) {
    throw new Error("Clean My Link storage requires an injected storage object.");
  }

  return {
    async readHistoryEntries() {
      return parseHistoryEntries(storageObject.getItem(historyKey));
    },

    async writeHistoryEntries(entries) {
      storageObject.setItem(historyKey, JSON.stringify(entries));
    },

    async readDomainTransformSettings() {
      return parseDomainTransformSettings(storageObject.getItem(settingsKey));
    },

    async writeDomainTransformSettings(domainSettings) {
      storageObject.setItem(
        settingsKey,
        JSON.stringify(toStoredTransformSettings(domainSettings))
      );
    }
  };
}

function createIndexedDbStorageAdapter({
  openDatabase,
  fallbackStorageObject,
  historyKey = historyStorageKey,
  settingsKey = transformSettingsStorageKey
} = {}) {
  let databasePromise;
  let fallbackAdapter;

  function getDatabase() {
    databasePromise ||= Promise.resolve().then(openDatabase);
    return databasePromise;
  }

  function getFallbackAdapter() {
    fallbackAdapter ||= createLocalStorageAdapter({
      storageObject: fallbackStorageObject,
      historyKey,
      settingsKey
    });
    return fallbackAdapter;
  }

  function readFallbackRaw(key) {
    if (!fallbackStorageObject) {
      return null;
    }

    return fallbackStorageObject.getItem(key);
  }

  async function readRaw(key) {
    let database;

    try {
      database = await getDatabase();
    } catch {
      if (key === historyKey) {
        return JSON.stringify(await getFallbackAdapter().readHistoryEntries());
      }

      return JSON.stringify(
        toStoredTransformSettings(await getFallbackAdapter().readDomainTransformSettings())
      );
    }

    try {
      const indexedValue = await database.get(storeName, key);
      if (indexedValue !== undefined) {
        return indexedValue;
      }

      const fallbackValue = readFallbackRaw(key);
      if (fallbackValue !== null && fallbackValue !== undefined) {
        try {
          await database.put(storeName, fallbackValue, key);
        } catch {
          // A failed copy should not prevent the old local value from being used.
        }

        return fallbackValue;
      }
    } catch {
      return readFallbackRaw(key);
    }

    return null;
  }

  return {
    async readHistoryEntries() {
      return parseHistoryEntries(await readRaw(historyKey));
    },

    async writeHistoryEntries(entries) {
      const value = JSON.stringify(entries);

      try {
        const database = await getDatabase();
        await database.put(storeName, value, historyKey);
      } catch {
        await getFallbackAdapter().writeHistoryEntries(entries);
      }
    },

    async readDomainTransformSettings() {
      return parseDomainTransformSettings(await readRaw(settingsKey));
    },

    async writeDomainTransformSettings(domainSettings) {
      const storedSettings = toStoredTransformSettings(domainSettings);
      const value = JSON.stringify(storedSettings);

      try {
        const database = await getDatabase();
        await database.put(storeName, value, settingsKey);
      } catch {
        await getFallbackAdapter().writeDomainTransformSettings(domainSettings);
      }
    }
  };
}

export function createStorageAdapter(options = {}) {
  const {
    storageObject,
    fallbackStorageObject = storageObject ?? getGlobalLocalStorage(),
    openDatabase = openCleanMyLinkDatabase,
    historyKey = historyStorageKey,
    settingsKey = transformSettingsStorageKey
  } = options;

  if (storageObject !== undefined && !options.openDatabase) {
    return createLocalStorageAdapter({
      storageObject,
      historyKey,
      settingsKey
    });
  }

  return createIndexedDbStorageAdapter({
    openDatabase,
    fallbackStorageObject,
    historyKey,
    settingsKey
  });
}
