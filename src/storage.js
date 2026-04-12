import {
  getDefaultDomainTransformSettings,
  normalizeDomainTransformSettings,
  toStoredTransformSettings,
  transformSettingsStorageKey
} from "./settings-storage.js";

export const historyStorageKey = "clean-my-link-history";

export function createStorageAdapter({
  storageObject = globalThis.localStorage,
  historyKey = historyStorageKey
} = {}) {
  if (!storageObject) {
    throw new Error("Clean My Link storage requires an injected storage object.");
  }

  return {
    async readHistoryEntries() {
      const entries = JSON.parse(storageObject.getItem(historyKey) || "[]");
      return Array.isArray(entries) ? entries : [];
    },

    async writeHistoryEntries(entries) {
      storageObject.setItem(historyKey, JSON.stringify(entries));
    },

    async readDomainTransformSettings() {
      try {
        const rawSettings = storageObject.getItem(transformSettingsStorageKey);
        if (!rawSettings) {
          return getDefaultDomainTransformSettings();
        }

        return normalizeDomainTransformSettings(JSON.parse(rawSettings));
      } catch {
        return getDefaultDomainTransformSettings();
      }
    },

    async writeDomainTransformSettings(domainSettings) {
      storageObject.setItem(
        transformSettingsStorageKey,
        JSON.stringify(toStoredTransformSettings(domainSettings))
      );
    }
  };
}
