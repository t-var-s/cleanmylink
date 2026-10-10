export const trackingParamPrefixes = Object.freeze(["utm_", "ref_", "mtm_", "pk_", "hsa_", "_bta_"]);

export const knownTrackingParams = new Set(
  [
    "ref",
    // Google and Bing ads
    "gclid",
    "gclsrc",
    "gbraid",
    "wbraid",
    "gad_source",
    "gad_campaignid",
    "dclid",
    "srsltid",
    "msclkid",
    "_ga",
    "_gl",
    // Social platforms
    "fbclid",
    "fb_action_ids",
    "fb_ref",
    "fb_source",
    "igshid",
    "igsh",
    "ttclid",
    "twclid",
    "li_fat_id",
    "yclid",
    // Email and marketing
    "mc_cid",
    "mc_eid",
    "_hsenc",
    "_hsmi",
    "mkt_tok",
    "oly_anon_id",
    "oly_enc_id",
    "vero_id",
    "ml_subscriber",
    "ml_subscriber_hash",
    "elqTrackId",
    "elqTrack",
    "_openstat",
    "vgo_ee",
    // Publishers and analytics
    "smid",
    "s_cid",
    "sc_cid",
    "cmpid",
    "wickedid",
    "spm",
    "scm",
    // Affiliate and click IDs
    "irclickid",
    "rb_clickid",
    "cjevent",
    "_branch_match_id",
    "click_id",
    "clickid"
  ].map((name) => name.toLowerCase())
);

export const trackingFragmentNames = new Set(["xtor"]);

// Wrappers whose real destination sits in a query parameter. A wrapper is
// recognised by host and path. `host` is an exact hostname, `hostSuffix` any
// subdomain of the suffix, `hostPattern` a regular expression over the
// hostname. `path` compares without a trailing slash, so `/l/` and `/l`
// match the same entry. `params` are tried in order.
export const redirectWrappers = Object.freeze([
  // google.com, google.co.uk, google.com.au, google.de, and so on
  { hostPattern: /^(www\.)?google(\.[a-z]{2,3}){1,2}$/, path: "/url", params: ["q", "url"] },
  { host: "googleadservices.com", path: "/pagead/aclk", params: ["adurl"] },
  { host: "www.googleadservices.com", path: "/pagead/aclk", params: ["adurl"] },
  { host: "l.facebook.com", path: "/l.php", params: ["u"] },
  { host: "lm.facebook.com", path: "/l.php", params: ["u"] },
  { host: "l.instagram.com", path: "/", params: ["u"] },
  { host: "youtube.com", path: "/redirect", params: ["q"] },
  { host: "www.youtube.com", path: "/redirect", params: ["q"] },
  { host: "out.reddit.com", path: "/", params: ["url"] },
  { host: "duckduckgo.com", path: "/l/", params: ["uddg"] },
  { host: "linkedin.com", path: "/safety/go", params: ["url"] },
  { host: "www.linkedin.com", path: "/safety/go", params: ["url"] },
  { host: "slack-redir.net", path: "/link", params: ["url"] },
  { host: "steamcommunity.com", path: "/linkfilter/", params: ["url"] },
  { hostSuffix: ".safelinks.protection.outlook.com", path: "/", params: ["url"] },
  { host: "linkprotect.cudasvc.com", path: "/url", params: ["a"] },
  { host: "medium.com", path: "/r/", params: ["url"] },
  { host: "getpocket.com", path: "/redirect", params: ["url"] }
]);

export const maxUnwrapPasses = 4;

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

export function isTrackingParam(name) {
  const normalizedName = name.toLowerCase();
  return (
    trackingParamPrefixes.some((prefix) => normalizedName.startsWith(prefix)) ||
    knownTrackingParams.has(normalizedName)
  );
}

export function stripTrackingParams(url) {
  const keysToDelete = [];

  url.searchParams.forEach((_, key) => {
    if (isTrackingParam(key)) {
      keysToDelete.push(key);
    }
  });

  for (const key of keysToDelete) {
    url.searchParams.delete(key);
  }

  return url;
}

function normalizePath(pathname) {
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

function matchesWrapperHost(hostname, wrapper) {
  if (wrapper.host) {
    return hostname === wrapper.host;
  }

  if (wrapper.hostSuffix) {
    return hostname.endsWith(wrapper.hostSuffix) && hostname.length > wrapper.hostSuffix.length;
  }

  return wrapper.hostPattern.test(hostname);
}

function matchesWrapper(url, wrapper) {
  return (
    matchesWrapperHost(url.hostname, wrapper) &&
    normalizePath(url.pathname) === normalizePath(wrapper.path)
  );
}

export function findWrappedUrl(url) {
  for (const wrapper of redirectWrappers) {
    if (!matchesWrapper(url, wrapper)) {
      continue;
    }

    for (const param of wrapper.params) {
      const destination = parseUrl(url.searchParams.get(param) ?? "");
      if (destination) {
        return destination;
      }
    }
  }

  return null;
}

export function unwrapRedirects(url) {
  for (let pass = 0; pass < maxUnwrapPasses; pass += 1) {
    const destination = findWrappedUrl(url);
    if (!destination) {
      break;
    }

    url.href = destination.href;
  }

  return url;
}

export function stripTrackingFragment(url) {
  let fragment = url.hash.replace(/^#/, "");

  // A text fragment directive can follow a real anchor: `#install:~:text=...`.
  const directiveIndex = fragment.indexOf(":~:");
  if (directiveIndex !== -1) {
    fragment = fragment.slice(0, directiveIndex);
  }

  const [, name] = fragment.match(/^([^=&]+)=/) ?? [];
  if (name && (trackingFragmentNames.has(name.toLowerCase()) || isTrackingParam(name))) {
    fragment = "";
  }

  url.hash = fragment;

  return url;
}

// Trailing characters a sentence or markup can leave on a URL token.
const trailingPunctuation = new Set([...".,;:!?'\"»›)]}>…。，、；：！？）】》」』"]);

function countChar(text, char) {
  return text.split(char).length - 1;
}

function trimUrlToken(token) {
  let trimmed = token;

  while (trimmed.length > 0) {
    const last = trimmed.at(-1);
    if (!trailingPunctuation.has(last)) {
      break;
    }

    // A closing parenthesis that balances one inside the URL belongs to it,
    // as in Wikipedia article titles.
    if (last === ")" && countChar(trimmed, "(") >= countChar(trimmed, ")")) {
      break;
    }

    trimmed = trimmed.slice(0, -1);
  }

  return trimmed;
}

export function extractSingleUrl(text) {
  const matches = text.match(/https?:\/\/\S+/gi) ?? [];
  const distinct = new Set();

  for (const match of matches) {
    const token = trimUrlToken(match);
    if (parseUrl(token)) {
      distinct.add(token);
    }
  }

  return distinct.size === 1 ? [...distinct][0] : null;
}

// A line-wrapped link breaks inside the URL, so every piece after the first
// continues it with a URL character. Words after a link start with a letter.
const urlContinuation = /^[/?&#=%.\-_:;,+@~]/;

export function joinSplitUrl(text) {
  const pieces = text.split(/\s+/);
  if (pieces.length > 1 && !pieces.slice(1).every((piece) => urlContinuation.test(piece))) {
    return null;
  }

  return pieces.join("");
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
    id: "unwrap-redirects",
    label: "Unwrap redirect links",
    type: "url",
    category: "cleanup",
    defaultEnabled: true,
    matches() {
      return true;
    },
    apply(url) {
      return unwrapRedirects(url);
    }
  },

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
    id: "strip-tracking-fragments",
    label: "Remove tracking fragments",
    type: "url",
    category: "cleanup",
    defaultEnabled: true,
    matches() {
      return true;
    },
    apply(url) {
      return stripTrackingFragment(url);
    }
  },

  {
    id: "rewrite-x-to-fxtwitter",
    domainLabel: "x.com",
    label: "Change to fxtwitter.com",
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
    label: "Point to Redlib instead",
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
    label: "Keep only the video ID and start time",
    type: "url",
    category: "site",
    defaultEnabled: true,
    matches(url) {
      return /(^|\.)youtube\.com$/.test(url.hostname) || /(^|\.)youtu\.be$/.test(url.hostname);
    },
    apply(url) {
      // `v` is the video and `t` the start time the sender chose; both are
      // part of what the link means. Everything else goes.
      const kept = ["v", "t"]
        .map((name) => [name, url.searchParams.get(name)])
        .filter(([, value]) => value !== null);
      url.search = "";
      for (const [name, value] of kept) {
        url.searchParams.set(name, value);
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
  // Whitespace is removed first so a line-wrapped link still parses as one URL,
  // but only when every piece after the first continues the URL.
  const urlCandidate = joinSplitUrl(trimmed);
  const joinedUrl = urlCandidate ? parseUrl(urlCandidate) : null;

  if (joinedUrl) {
    const output = cleanUrl(joinedUrl, options);
    return {
      output,
      isUrl: true,
      changed: output !== urlCandidate
    };
  }

  // Share sheets often wrap the link in a title and a prompt. When the text
  // holds exactly one distinct URL, that URL is the link and the rest is noise.
  const extractedUrl = extractSingleUrl(trimmed);

  if (extractedUrl) {
    const output = cleanUrl(parseUrl(extractedUrl), options);
    return {
      output,
      isUrl: true,
      changed: output !== trimmed
    };
  }

  const output = cleanText(trimmed, options);
  return {
    output,
    isUrl: false,
    changed: output !== trimmed
  };
}
