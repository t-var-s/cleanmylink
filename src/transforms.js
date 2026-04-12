export const knownTrackingParams = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "msclkid",
  "ttclid",
  "twclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "_hsenc",
  "_hsmi",
  "mkt_tok",
  "oly_anon_id",
  "oly_enc_id",
  "smid",
  "vero_id",
  "wickedid",
  "yclid"
]);

export function parseUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export function isSafeHttpUrl(value) {
  return Boolean(parseUrl(value));
}

export function stripTrackingParams(url) {
  const keysToDelete = [];

  url.searchParams.forEach((_, key) => {
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey.startsWith("utm_") ||
      normalizedKey === "ref" ||
      normalizedKey.startsWith("ref_") ||
      knownTrackingParams.has(normalizedKey)
    ) {
      keysToDelete.push(key);
    }
  });

  for (const key of keysToDelete) {
    url.searchParams.delete(key);
  }

  return url;
}

export function isAllCaps(value) {
  const lettersOnly = value.replace(/[^a-z]/gi, "");
  return lettersOnly.length >= 2 && lettersOnly === lettersOnly.toUpperCase();
}

export function toSentenceCase(value) {
  const lowered = value.toLowerCase();
  return lowered.replace(/(^\s*[a-z])|([.!?]\s+[a-z])/g, (segment) => segment.toUpperCase());
}

const transformDefinitionsSource = [
  {
    id: "strip-tracking-params",
    label: "Remove tracking parameters",
    type: "url",
    category: "cleanup",
    defaultEnabled: true,
    matches() {
      return true;
    },
    apply(url) {
      return stripTrackingParams(url);
    }
  },

  {
    id: "rewrite-x-to-fxtwitter",
    domainLabel: "x.com",
    label: "Open X posts with fxtwitter.com",
    type: "url",
    category: "site",
    defaultEnabled: true,
    matches(url) {
      return url.hostname === "x.com" && !url.pathname.toLowerCase().includes("article");
    },
    apply(url) {
      url.hostname = "fxtwitter.com";
      return url;
    }
  },

  {
    id: "rewrite-reddit-to-redlib",
    domainLabel: "reddit.com",
    label: "Open Reddit links with Redlib",
    type: "url",
    category: "site",
    defaultEnabled: true,
    matches(url) {
      return /(^|\.)reddit\.com$/.test(url.hostname);
    },
    apply(url) {
      url.hostname = "redlib.freedit.eu";
      return url;
    }
  },

  {
    id: "keep-youtube-video-id",
    domainLabel: "youtube.com and youtu.be",
    label: "Keep only the YouTube video ID",
    type: "url",
    category: "site",
    defaultEnabled: true,
    matches(url) {
      return /(^|\.)youtube\.com$/.test(url.hostname) || /(^|\.)youtu\.be$/.test(url.hostname);
    },
    apply(url) {
      const videoId = url.searchParams.get("v");
      url.search = "";
      if (videoId) {
        url.searchParams.set("v", videoId);
      }
      return url;
    }
  },

  {
    id: "normalize-text-whitespace",
    label: "Clean up text spacing",
    type: "text",
    category: "cleanup",
    defaultEnabled: true,
    apply(value) {
      return value.replace(/\r?\n+/g, " ").replace(/\s{2,}/g, " ").trim();
    }
  },

  {
    id: "sentence-case-all-caps",
    label: "Convert all-caps text to sentence case",
    type: "text",
    category: "cleanup",
    defaultEnabled: true,
    apply(value) {
      return isAllCaps(value) ? toSentenceCase(value) : value;
    }
  }
];

export const transformDefinitions = Object.freeze(
  transformDefinitionsSource.map((definition) => Object.freeze(definition))
);

export const urlTransforms = Object.freeze(
  transformDefinitions.filter((definition) => definition.type === "url")
);

export const textTransforms = Object.freeze(
  transformDefinitions.filter((definition) => definition.type === "text")
);

export const siteRules = Object.freeze(
  urlTransforms.filter((definition) => definition.category === "site")
);

export const defaultEnabledTransforms = Object.freeze(
  Object.fromEntries(
    transformDefinitions.map((definition) => [definition.id, definition.defaultEnabled])
  )
);

export function isTransformEnabled(definition, enabledTransforms = defaultEnabledTransforms) {
  const settings = enabledTransforms || defaultEnabledTransforms;
  return settings[definition.id] ?? definition.defaultEnabled;
}

export function cleanUrl(url, options = {}) {
  const cleaned = new URL(url.toString());
  const enabledTransforms = options.enabledTransforms || defaultEnabledTransforms;

  for (const transform of urlTransforms) {
    if (isTransformEnabled(transform, enabledTransforms) && transform.matches(cleaned)) {
      transform.apply(cleaned, { enabledTransforms });
    }
  }

  if (!cleaned.search) {
    cleaned.search = "";
  }

  return cleaned.toString();
}

export function cleanText(value, options = {}) {
  const enabledTransforms = options.enabledTransforms || defaultEnabledTransforms;
  let output = value;

  for (const transform of textTransforms) {
    if (isTransformEnabled(transform, enabledTransforms)) {
      output = transform.apply(output, { enabledTransforms });
    }
  }

  return output;
}

export function cleanInput(rawValue, options = {}) {
  const trimmed = rawValue.trim();
  const urlCandidate = trimmed.replace(/\s+/g, "");
  const parsedUrl = parseUrl(urlCandidate);

  if (parsedUrl) {
    const output = cleanUrl(parsedUrl, options);
    return {
      output,
      isUrl: true,
      changed: output !== urlCandidate
    };
  }

  const output = cleanText(trimmed, options);
  return {
    output,
    isUrl: false,
    changed: output !== trimmed
  };
}
