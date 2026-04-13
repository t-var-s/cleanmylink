export const contentSecurityPolicy = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";

export const pages = {
  "/index.html": {
    input: "./index.html",
    inputName: "index",
    title: "Clean My Link",
    description: "Grab this web app to remove junk parameters from your URLs"
  },
  "/settings.html": {
    input: "./settings.html",
    inputName: "settings",
    title: "Clean My Link Settings",
    description: "Choose Clean My Link domain transformations"
  }
};

const documentHeadTags = [
  {
    tag: "meta",
    attrs: {
      charset: "utf-8"
    }
  },
  {
    tag: "meta",
    attrs: {
      name: "viewport",
      content: "width=device-width, initial-scale=1"
    }
  },
  {
    tag: "meta",
    attrs: {
      name: "theme-color",
      content: "#0f0f0f"
    }
  }
];

const socialImageHeadTags = [
  {
    tag: "meta",
    attrs: {
      property: "og:image",
      content: "/assets/cleanmylink_v4.jpg"
    }
  },
  {
    tag: "meta",
    attrs: {
      property: "og:image:type",
      content: "image/jpeg"
    }
  },
  {
    tag: "meta",
    attrs: {
      property: "og:image:width",
      content: "1024"
    }
  },
  {
    tag: "meta",
    attrs: {
      property: "og:image:height",
      content: "1024"
    }
  },
  {
    tag: "meta",
    attrs: {
      property: "og:image:alt",
      content: "Clean My Link artwork showing a broom sweeping away URL tracking parameters"
    }
  },
  {
    tag: "meta",
    attrs: {
      name: "twitter:card",
      content: "summary_large_image"
    }
  }
];

const twitterImageHeadTags = [
  {
    tag: "meta",
    attrs: {
      name: "twitter:image",
      content: "/assets/cleanmylink_v4.jpg"
    }
  },
  {
    tag: "meta",
    attrs: {
      name: "twitter:image:alt",
      content: "Clean My Link artwork showing a broom sweeping away URL tracking parameters"
    }
  }
];

const policyAndAssetHeadTags = [
  {
    tag: "meta",
    attrs: {
      "http-equiv": "Content-Security-Policy",
      content: contentSecurityPolicy
    }
  },
  {
    tag: "meta",
    attrs: {
      name: "referrer",
      content: "no-referrer"
    }
  },
  {
    tag: "link",
    attrs: {
      rel: "manifest",
      href: "/manifest.webmanifest"
    }
  },
  {
    tag: "link",
    attrs: {
      rel: "icon",
      href: "/assets/favicon-48-v4.png",
      type: "image/png",
      sizes: "48x48"
    }
  },
  {
    tag: "link",
    attrs: {
      rel: "apple-touch-icon",
      sizes: "180x180",
      href: "/assets/apple-touch-icon-180-v4.png"
    }
  },
  {
    tag: "link",
    attrs: {
      rel: "stylesheet",
      href: "/src/styles.css"
    }
  }
];

function escapeHtmlAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function renderTag({ tag, attrs }) {
  const renderedAttrs = Object.entries(attrs)
    .map(([name, value]) => `${name}="${escapeHtmlAttribute(value)}"`)
    .join(" ");

  return `<${tag} ${renderedAttrs}>`;
}

export function getPageConfig(pathname) {
  return pages[pathname === "/" ? "/index.html" : pathname];
}

export function renderHeadTags(page) {
  const headTags = [
    ...documentHeadTags,
    {
      tag: "meta",
      attrs: {
        name: "description",
        content: page.description
      }
    },
    {
      tag: "meta",
      attrs: {
        property: "og:type",
        content: "website"
      }
    },
    {
      tag: "meta",
      attrs: {
        property: "og:title",
        content: page.title
      }
    },
    {
      tag: "meta",
      attrs: {
        property: "og:description",
        content: page.description
      }
    },
    ...socialImageHeadTags,
    {
      tag: "meta",
      attrs: {
        name: "twitter:title",
        content: page.title
      }
    },
    {
      tag: "meta",
      attrs: {
        name: "twitter:description",
        content: page.description
      }
    },
    ...twitterImageHeadTags,
    ...policyAndAssetHeadTags
  ];

  return [
    ...headTags.map(renderTag),
    `<title>${escapeHtmlAttribute(page.title)}</title>`
  ].join("\n    ");
}
