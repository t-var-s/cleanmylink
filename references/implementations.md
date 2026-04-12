## Current architecture

This is a static client-side app with a Vite build step and no backend. The source runtime remains plain HTML, CSS, and browser JavaScript; Vite bundles the browser entry and writes the deployable site to `dist/`.

Verified on April 12, 2026:

- `npm test` passes
- `npm run build` writes the deploy artifact to `dist/`
- `dist/` excludes source-only directories such as `references/`, `test/`, `scripts/`, and `src/`
- the app runs locally from the Vite dev server and Vite preview server
- the main clipboard flow works in-browser when clipboard permissions are granted
- the blocked-permission path, empty-clipboard path, text-cleaning path, URL-cleaning path, history rendering, startup storage loading states, service worker registration, and manifest availability were all checked in a local browser session

## File map

- [`../index.html`](../index.html): main Vite HTML entry, metadata, CSP, manifest link, settings navigation, hero panel, button, history section, initial saved-links loading copy, and module script loading
- [`../settings.html`](../settings.html): settings Vite HTML entry for domain-transform toggles, initial settings loading row, disabled-until-ready save navigation, and module script loading
- [`../src/styles.css`](../src/styles.css): mobile-first layout, button, history, settings, view-transition, responsive desktop breakpoint at `960px`, and reduced-motion handling
- [`../src/transforms.js`](../src/transforms.js): ESM transform registry and shared cleanup logic for URLs and plain text
- [`../src/app.js`](../src/app.js): app factory and controller for clipboard access, history persistence, startup history loading state, responsive layout, button states, and service worker update handling
- [`../src/main.js`](../src/main.js): browser bootstrap entry that starts the app
- [`../src/storage.js`](../src/storage.js): async storage adapter used by app and settings controllers
- [`../src/settings-storage.js`](../src/settings-storage.js): settings normalization, defaulting, serialization, and enabled-transform composition helpers
- [`../src/settings.js`](../src/settings.js): settings page factory and controller for loading domain settings, rendering domain toggles, saving staged changes, and handling settings storage read/write failures
- [`../src/settings-main.js`](../src/settings-main.js): browser bootstrap entry that starts the settings page
- [`../src/sw-template.js`](../src/sw-template.js): service worker template with build-time placeholders for app version and precached app-shell paths
- [`../public/manifest.webmanifest`](../public/manifest.webmanifest): install metadata and app icons, copied to `dist/` by Vite
- [`../public/assets/`](../public/assets): stable-path install icons, social preview image, and other public assets copied to `dist/assets/`
- [`../src/assets/`](../src/assets): source assets imported by bundled CSS, such as local fonts
- [`../scripts/generate-sw.js`](../scripts/generate-sw.js): post-build service worker generator that writes `dist/sw.js`
- [`../vite.config.mjs`](../vite.config.mjs): Vite config with explicit `dist` output
- [`../netlify.toml`](../netlify.toml): Netlify build command, publish directory, and cache/security headers
- [`../test/transforms.test.js`](../test/transforms.test.js): Node test suite for transform behavior
- [`../test/storage.test.js`](../test/storage.test.js): Node test suite for the storage adapter and domain-transform settings behavior
- [`../test/app.test.js`](../test/app.test.js): Node test suite for app module import safety
- [`../test/build.test.js`](../test/build.test.js): Node test suite for build output and generated service worker behavior

## Runtime implementation details

### `src/transforms.js`

The transform layer is an ESM module. It exports:

- `parseUrl`
- `isSafeHttpUrl`
- `stripTrackingParams`
- `cleanUrl`
- `cleanText`
- `cleanInput`
- `isAllCaps`
- `toSentenceCase`
- `transformDefinitions`
- `urlTransforms`
- `textTransforms`
- `siteRules`
- `defaultEnabledTransforms`
- `isTransformEnabled`

Implementation choices:

- URL validation is based on `new URL(...)` plus an explicit `http:` or `https:` allowlist.
- URL cleaning always clones the input URL before mutation.
- Tracking-parameter stripping is case-insensitive.
- Transforms are defined with stable `id`, `label`, `type`, `category`, `defaultEnabled`, and `apply` metadata so a settings UI can persist user choices without depending on array order.
- Site-rule transforms also expose `domainLabel` metadata for the settings UI.
- `apply(...)` receives a context object with the active `enabledTransforms` map, so later transforms can inspect settings without changing the registry contract.
- `cleanUrl`, `cleanText`, and `cleanInput` accept an optional `enabledTransforms` map. Missing keys fall back to each transform's `defaultEnabled` value.
- Plain-text cleaning converts all-caps text to sentence case only when there are at least two letters.

Current default-enabled transforms:

- tracking-parameter cleanup
- `x.com` -> `fxtwitter.com` except article paths
- `reddit.com` -> `redlib.freedit.eu`
- `youtube.com` / `youtu.be` -> clear search params, then keep only `v` if present
- whitespace cleanup for plain text
- sentence-case conversion for all-caps plain text

### `src/app.js`

`app.js` exports `createApp(...)` and `bootApp(...)`. `createApp(...)` accepts browser dependency overrides for test doubles, and `bootApp(...)` initializes the app returned by the factory. `src/main.js` is the browser entry that calls `bootApp()`.

The app object is organized with grouped concerns:

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
- Storage access goes through the shared async adapter in `src/storage.js`; the backing store is currently `localStorage`, leaving room for IndexedDB or encrypted storage later.
- History entries are loaded into `state.historyEntries` during app startup.
- Rendering reads from in-memory state instead of reading storage directly.
- History loading is wrapped in `try/catch` so malformed local storage does not break the app.
- Startup sets the history empty slot to `Loading saved links from this device...` with `aria-busy="true"` while the async history read is pending.
- The history loading state is cleared and the history panel is rendered as soon as `readHistoryEntries()` settles, before transform settings and service-worker update checks continue.
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
- Reads domain-transform settings during app startup through `storage.readDomainTransformSettings()`, composes them with default transforms, and keeps the resulting enabled-transform map in memory for clipboard cleaning.
- If domain-transform settings cannot be read during main-page startup, the app falls back to default transform settings and logs the storage error.
- Shows blocked/error/empty/success status messages based on the outcome
- Stores only URL results in history

### Settings

The settings page only exposes site-specific URL transforms:

- `x.com` -> `fxtwitter.com`
- `reddit.com` -> `redlib.freedit.eu`
- `youtube.com` / `youtu.be` query cleanup

Settings behavior:

- Global tracking-parameter cleanup and plain-text cleanup are not exposed in settings and continue to apply by default.
- The initial HTML includes a settings loading row so the page does not look empty while `readDomainTransformSettings()` is pending.
- The settings form starts with `aria-busy="true"` and the save button disabled; `settings.js` clears both once saved settings are loaded or defaulted.
- If settings cannot be read, the page falls back to default-enabled domain rules, renders the toggles, and reports `Settings could not be loaded. Defaults are shown.`
- Settings are staged in memory while the user changes toggles.
- The save action uses a square icon button with `/assets/icon_save.webp` and adjacent text.
- The save label starts as `Confirm and go back to cleaning`.
- The save label changes to `Save changes and go back to cleaning` when staged settings differ from saved settings.
- On save, the settings controller writes through `storage.writeDomainTransformSettings(...)` and navigates back to `/`.
- Malformed settings storage falls back to default-enabled domain rules.
- Missing transform IDs fall back to each transform's `defaultEnabled` value.

Settings storage:

- Storage key: `clean-my-link-transform-settings`
- Stored shape: `{ version: 1, enabledTransforms: { [transformId]: boolean } }`
- Only site-rule transform IDs are serialized; any global cleanup IDs are ignored by normalization.

Localhost development helper:

- On `localhost`, `127.0.0.1`, and `[::1]`, `app.dev.installHelpers()` exposes `window.resetAppCache(...)`.
- `window.resetAppCache({ reload = true })` unregisters local service workers, clears Cache Storage, and optionally reloads the page.
- The helper is intended for local iteration when the service worker's cache-first behavior would otherwise keep stale assets in the browser.
- Service worker registration is skipped in Vite dev mode through `import.meta.env.DEV`, so local HMR is not controlled by a production worker.

### `index.html`

Security and metadata already live in the document shell:

- restrictive `Content-Security-Policy` in a meta tag
- `referrer` policy set to `no-referrer`
- Open Graph and Twitter card metadata
- manifest and icon links
- Vite module entry: `/src/main.js`

The body contains only two user-facing sections:

- hero/action panel
- recent-links panel

It also includes a top-right settings link using `/assets/icon_settings.webp`.

### `src/styles.css`

The CSS matches the current product direction:

- dark background with subtle grid
- restrained card styling rather than marketing-heavy chrome
- fixed bottom action area on mobile
- two-column product layout on desktop
- startup loading styles for storage-backed history and settings content
- settings page styles for the domain-toggle form
- cross-document View Transitions API opt-in with a restrained root fade and normal navigation fallback
- no JavaScript calls `document.startViewTransition()`; page-to-page animation is browser-managed through `@view-transition { navigation: auto; }`
- hover refinements only inside `@media (hover: hover)`
- global reduced-motion fallback
- local fonts are referenced from `src/assets/`, so Vite fingerprints them into `dist/assets/`

### Vite build

The production build is:

- `npm run build`
- `vite build`
- `node scripts/generate-sw.js`

Vite writes the deployable site to `dist/`. That output contains the app shell, `index.html`, `settings.html`, bundled and fingerprinted JS/CSS/font assets, files copied from `public/`, and the generated `sw.js`.

`references/`, `test/`, `scripts/`, and `src/` are not publishable production artifacts. `test/build.test.js` checks that those directories are absent from `dist/`.

### `src/sw-template.js` and `dist/sw.js`

The source service worker is a template. `scripts/generate-sw.js` reads the completed `dist/` tree after Vite runs, replaces placeholders, and writes `dist/sw.js`.

The generated service worker uses a versioned cache name:

- `APP_VERSION` is generated at build time from the package version, git short SHA, and a build ID or timestamp
- `CACHE_NAME` is derived from `APP_VERSION`
- `APP_SHELL` is generated from the actual files in `dist/`, excluding `sw.js` itself

Current behavior:

- pre-caches the app shell on install
- deletes old versioned caches on activate
- claims clients after activation
- listens for `{ type: "SKIP_WAITING" }`
- serves cached GET responses first
- caches successful same-origin GET responses after network fetches

### `public/manifest.webmanifest`

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

- transform behavior in [`../test/transforms.test.js`](../test/transforms.test.js)
- settings storage and domain-only settings behavior in [`../test/storage.test.js`](../test/storage.test.js)
- settings page controller behavior, including settings-read fallback and loading-state clearing, in [`../test/settings.test.js`](../test/settings.test.js)
- import-safety coverage and startup history-loading behavior for [`../src/app.js`](../src/app.js) in [`../test/app.test.js`](../test/app.test.js)
- build output and generated service worker checks in [`../test/build.test.js`](../test/build.test.js)

Current gaps:

- no broad automated coverage yet for `app.js` DOM behavior beyond startup history loading
- no automated browser test for clipboard permission states
- no automated test for history expiry, de-duplication, or desktop/mobile ordering
- no automated test for service worker update mode transitions

## Local development

Run locally:

```bash
npm run start
```

Current Vite dev server:

- `http://127.0.0.1:5173/`
- use `npm run dev -- --port 5174` when a second developer or browser session needs a separate port

Preview the built production artifact:

```bash
npm run build
npm run preview
```

Current Vite preview server:

- `http://127.0.0.1:4173/`

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

Netlify uses [`../netlify.toml`](../netlify.toml):

- build command: `npm run build`
- publish directory: `dist`
- `sw.js` and `manifest.webmanifest` revalidate on each request
- built assets under `/assets/*` are cacheable as immutable

The PWA cache version is generated during `npm run build`; do not manually edit `APP_VERSION` in the generated `dist/sw.js`.
