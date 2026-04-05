# Clean My Link

Clean My Link is a small mobile-first web app and installable PWA that cleans whatever you just copied.

If the clipboard contains an `http` or `https` link, the app removes common tracking parameters and applies site-specific cleanup rules. If the clipboard contains plain text instead, it normalizes whitespace and converts all-caps text to sentence case.

## What it does

- Reads the current clipboard when you tap `Clean My Link`
- Cleans whitespace-split URLs before parsing them
- Removes common tracking parameters such as `utm_*`, `ref`, `ref_*`, and `smid`
- Applies site-specific transforms
- Writes the cleaned result back to the clipboard
- Stores recent cleaned links in local storage for 24 hours
- Works offline with a service worker and web app manifest

## Current custom rules

- YouTube watch URLs keep only the `v` parameter

## Security and behavior constraints

- Only `http` and `https` URLs are treated as valid links
- Stored history is treated as untrusted input and re-validated before rendering
- User-controlled content is rendered without `innerHTML`
- External links should use safe attributes
- Netlify headers keep a restrictive Content Security Policy in place

## Project structure

- [`index.html`](/Users/agency/dev/codex/cleanmylink/index.html): app shell and metadata
- [`styles.css`](/Users/agency/dev/codex/cleanmylink/styles.css): mobile-first UI
- [`app.js`](/Users/agency/dev/codex/cleanmylink/app.js): clipboard flow, UI state, history handling
- [`transforms.js`](/Users/agency/dev/codex/cleanmylink/transforms.js): URL and text cleanup logic
- [`sw.js`](/Users/agency/dev/codex/cleanmylink/sw.js): offline caching
- [`manifest.webmanifest`](/Users/agency/dev/codex/cleanmylink/manifest.webmanifest): install metadata
- [`test/transforms.test.js`](/Users/agency/dev/codex/cleanmylink/test/transforms.test.js): transform tests

## Run locally

```bash
npm run start
```

This starts a static server on `http://localhost:4173`.

## Test

```bash
npm test
```

## Deploy

Preview deploy:

```bash
npm run netlify:deploy
```

Production deploy:

```bash
npm run netlify:deploy:prod
```

Before deploying a new version, bump `APP_VERSION` in [`sw.js`](/Users/agency/dev/codex/cleanmylink/sw.js) so installed PWAs detect the update and rotate caches.

## Git notes

This repo is intended to ignore local-only assistant folders, Netlify local state, Playwright artifacts, macOS metadata, and the local `netlify.toml` file.
