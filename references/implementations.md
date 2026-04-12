## Current architecture

This is a static client-side app with no build step and no backend. The runtime is plain HTML, CSS, and browser JavaScript.

Verified on April 7, 2026:

- `npm test` passes
- the app runs locally from a static server
- the main clipboard flow works in-browser when clipboard permissions are granted
- the blocked-permission path, empty-clipboard path, text-cleaning path, URL-cleaning path, history rendering, service worker registration, and manifest availability were all checked in a local browser session

## File map

- [`index.html`](index.html): app shell, metadata, CSP, manifest link, hero panel, button, history section, and deferred script loading
- [`styles.css`](styles.css): mobile-first layout, button and history styling, responsive desktop breakpoint at `960px`, and reduced-motion handling
- [`transforms.js`](transforms.js): shared cleanup logic for URLs and plain text; exposed on `globalThis` for the browser and `module.exports` for tests
- [`app.js`](app.js): application controller for clipboard access, history persistence, responsive layout, button states, and service worker update handling
- [`sw.js`](sw.js): versioned app-shell caching plus cache cleanup and `SKIP_WAITING` support
- [`manifest.webmanifest`](manifest.webmanifest): install metadata and app icons
- [`test/transforms.test.js`](test/transforms.test.js): Node test suite for transform behavior
- [`assets/`](assets): install icons and social preview image
- [`clipboard-v2.png`](clipboard-v2.png): favicon

## Runtime implementation details

### `transforms.js`

The transform layer is an IIFE that publishes a single shared object. That object currently exposes:

- `parseUrl`
- `isSafeHttpUrl`
- `stripTrackingParams`
- `cleanUrl`
- `cleanText`
- `cleanInput`
- `isAllCaps`
- `toSentenceCase`
- `siteRules`

Implementation choices:

- URL validation is based on `new URL(...)` plus an explicit `http:` or `https:` allowlist.
- URL cleaning always clones the input URL before mutation.
- Tracking-parameter stripping is case-insensitive.
- Site rules are defined as `{ matches, apply }` objects inside a `siteRules` array, so the rule list is already extensible.
- Plain-text cleaning converts all-caps text to sentence case only when there are at least two letters.

Current site rules:

- `x.com` -> `fxtwitter.com` except article paths
- `reddit.com` -> `redlib.freedit.eu`
- `youtube.com` / `youtu.be` -> clear search params, then keep only `v` if present

### `app.js`

`app.js` is organized as a single `app` object with grouped concerns:

- `config`
- `messages`
- `elements`
- `state`
- `storage`
- `history`
- `layout`
- `ui`
- `clipboard`
- `pwa`
- `dev`
- `events`

Important behavior in the current implementation:

- Local history key: `clean-my-link-history`
- History TTL: `72 * 60 * 60 * 1000`
- History limit: `100`
- Desktop breakpoint: `960`
- Default button mode: clean
- Alternate button modes: update, retry-update

History handling:

- Storage access goes through async `storage.readHistoryEntries()` and `storage.writeHistoryEntries()` methods.
- The storage adapter is currently backed by `localStorage`, leaving room for IndexedDB or encrypted storage later.
- History entries are loaded into `state.historyEntries` during app startup.
- Rendering reads from in-memory state instead of reading storage directly.
- History loading is wrapped in `try/catch` so malformed local storage does not break the app.
- Persisted entries are re-validated before use.
- Invalid entries are removed when encountered.
- Entries are stored newest first.
- Saving the same cleaned URL again moves it to the front instead of creating duplicates.
- Only valid HTTP(S) URLs are saved.

Rendering and safety:

- History items are built with `createElement` and `textContent`.
- User-controlled content is never interpolated with `innerHTML`.
- External links are rendered with `target="_blank"` and `rel="noopener noreferrer"`.

Responsive behavior:

- `body.dataset.layout` is set to `mobile` or `desktop`.
- On mobile, history is rendered in reverse order and auto-scrolled to the bottom.
- On desktop, history is rendered in storage order and scroll position is reset to the top.
- `ResizeObserver`, `resize`, `orientationchange`, and `visualViewport.resize` are used to keep the layout stable.

Clipboard flow:

- Reads via `navigator.clipboard.readText()`
- Writes the cleaned output with `navigator.clipboard.writeText(...)`
- Shows blocked/error/empty/success status messages based on the outcome
- Stores only URL results in history

Localhost development helper:

- On `localhost`, `127.0.0.1`, and `[::1]`, `app.dev.installHelpers()` exposes `window.resetAppCache(...)`.
- `window.resetAppCache({ reload = true })` unregisters local service workers, clears Cache Storage, and optionally reloads the page.
- The helper is intended for local iteration when the service worker's cache-first behavior would otherwise keep stale assets in the browser.

### `index.html`

Security and metadata already live in the document shell:

- restrictive `Content-Security-Policy` in a meta tag
- `referrer` policy set to `no-referrer`
- Open Graph and Twitter card metadata
- manifest and icon links

The body contains only two user-facing sections:

- hero/action panel
- recent-links panel

### `styles.css`

The CSS matches the current product direction:

- dark background with subtle grid
- restrained card styling rather than marketing-heavy chrome
- fixed bottom action area on mobile
- two-column product layout on desktop
- hover refinements only inside `@media (hover: hover)`
- global reduced-motion fallback

### `sw.js`

The service worker uses a versioned cache name:

- `APP_VERSION` is the manual cache-busting switch
- `CACHE_NAME` is derived from `APP_VERSION`

Current behavior:

- pre-caches the app shell on install
- deletes old versioned caches on activate
- claims clients after activation
- listens for `{ type: "SKIP_WAITING" }`
- serves cached GET responses first
- caches successful same-origin GET responses after network fetches

### `manifest.webmanifest`

The manifest currently defines:

- standalone display mode
- background and theme colors
- 192px and 512px icons
- install name and short name

## Security notes

Current security-relevant measures in the codebase:

- only `http` and `https` URLs are accepted as links
- stored history is treated as untrusted input
- user content is rendered through safe DOM APIs
- external links use `noopener noreferrer`
- CSP disallows remote scripts, objects, and forms
- the service worker only writes successful same-origin GET responses into cache

## Validation status and gaps

Current automated coverage:

- transform behavior in [`test/transforms.test.js`](test/transforms.test.js)

Current gaps:

- no automated tests yet for `app.js` DOM behavior
- no automated browser test for clipboard permission states
- no automated test for history expiry, de-duplication, or desktop/mobile ordering
- no automated test for service worker update mode transitions

## Local development

Run locally:

```bash
npm run start
```

Current local server:

- `python3 -m http.server 4173`

Run tests:

```bash
npm test
```

When a local browser session is stuck on stale cached assets, run this in the devtools console:

```js
await window.resetAppCache()
```

Deploy preview:

```bash
npm run netlify:deploy
```

Deploy production:

```bash
npm run netlify:deploy:prod
```

Before shipping a new PWA version, bump `APP_VERSION` in [`sw.js`](sw.js) so installed clients rotate caches and detect the update.
