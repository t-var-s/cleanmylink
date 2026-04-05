(function initCleanMyLinkTransforms(globalScope) {
  const knownTrackingParams = new Set([
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

  const siteRules = [
    {
      matches(url) {
        return url.hostname === "x.com" && !url.pathname.toLowerCase().includes("article");
      },

      apply(url) {
        url.hostname = "fxtwitter.com";
        return url;
      }
    },

    {
      matches(url) {
        return /(^|\.)reddit\.com$/.test(url.hostname);
      },

      apply(url) {
        url.hostname = "redlib.freedit.eu";
        return url;
      }
    },

    {
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
    }
  ];

  function parseUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:" ? url : null;
    } catch {
      return null;
    }
  }

  function isSafeHttpUrl(value) {
    return Boolean(parseUrl(value));
  }

  function stripTrackingParams(url) {
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
  }

  function cleanUrl(url) {
    const cleaned = new URL(url.toString());
    stripTrackingParams(cleaned);

    for (const rule of siteRules) {
      if (rule.matches(cleaned)) {
        rule.apply(cleaned);
      }
    }

    if (!cleaned.search) {
      cleaned.search = "";
    }

    return cleaned.toString();
  }

  function isAllCaps(value) {
    const lettersOnly = value.replace(/[^a-z]/gi, "");
    return lettersOnly.length >= 2 && lettersOnly === lettersOnly.toUpperCase();
  }

  function toSentenceCase(value) {
    const lowered = value.toLowerCase();
    return lowered.replace(/(^\s*[a-z])|([.!?]\s+[a-z])/g, (segment) => segment.toUpperCase());
  }

  function cleanText(value) {
    const singleLine = value.replace(/\r?\n+/g, " ").replace(/\s{2,}/g, " ").trim();
    return isAllCaps(singleLine) ? toSentenceCase(singleLine) : singleLine;
  }

  function cleanInput(rawValue) {
    const trimmed = rawValue.trim();
    const urlCandidate = trimmed.replace(/\s+/g, "");
    const parsedUrl = parseUrl(urlCandidate);

    if (parsedUrl) {
      const output = cleanUrl(parsedUrl);
      return {
        output,
        isUrl: true,
        changed: output !== urlCandidate
      };
    }

    const output = cleanText(trimmed);
    return {
      output,
      isUrl: false,
      changed: output !== trimmed
    };
  }

  const transforms = {
    siteRules,
    cleanInput,
    parseUrl,
    isSafeHttpUrl,
    cleanUrl,
    stripTrackingParams,
    cleanText,
    isAllCaps,
    toSentenceCase
  };

  globalScope.cleanMyLinkTransforms = transforms;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = transforms;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
