import { defaultEnabledTransforms, siteRules } from "./transforms.js";

export const transformSettingsStorageKey = "clean-my-link-transform-settings";
export const transformSettingsVersion = 1;

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function getDefaultDomainTransformSettings() {
  return Object.fromEntries(
    siteRules.map((definition) => [definition.id, definition.defaultEnabled])
  );
}

export function normalizeDomainTransformSettings(value = {}) {
  const source = isRecord(value) && isRecord(value.enabledTransforms)
    ? value.enabledTransforms
    : isRecord(value)
      ? value
      : {};

  return Object.fromEntries(
    siteRules.map((definition) => [
      definition.id,
      typeof source[definition.id] === "boolean"
        ? source[definition.id]
        : definition.defaultEnabled
    ])
  );
}

export function composeEnabledTransforms(domainSettings = {}) {
  return {
    ...defaultEnabledTransforms,
    ...normalizeDomainTransformSettings(domainSettings)
  };
}

export function toStoredTransformSettings(domainSettings = {}) {
  return {
    version: transformSettingsVersion,
    enabledTransforms: normalizeDomainTransformSettings(domainSettings)
  };
}

export function domainTransformSettingsEqual(left, right) {
  const normalizedLeft = normalizeDomainTransformSettings(left);
  const normalizedRight = normalizeDomainTransformSettings(right);

  return siteRules.every((definition) => normalizedLeft[definition.id] === normalizedRight[definition.id]);
}
