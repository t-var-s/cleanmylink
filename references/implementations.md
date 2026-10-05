## Current architecture

This is a static client-side app with a Vite build step and no backend. The source runtime remains plain HTML, CSS, and browser JavaScript; Vite bundles the browser entry and writes the deployable site to `dist/`.

Verified on April 15, 2026:

- `npm test` passes
- `npm run build` writes the deploy artifact to `dist/`
- `dist/` excludes source-only directories such as `references/`, `test/`, `scripts/`, and `src/`
- the app runs locally from the Vite dev server and Vite preview server
- the main clipboard flow works in-browser when clipboard permissions are granted
- the blocked-permission path, empty-clipboard path, text-cleaning path, URL-cleaning path, history rendering, startup storage loading states, service worker registration, manifest availability, IndexedDB persistence, settings persistence, and localStorage migration were all checked in a local browser session

## File map

- [`../index.html`](../index.html): main Vite HTML entry with the shared head injection marker, hero panel with a visually hidden `h1`, a `role="status"` paragraph, and the clean form (visually hidden label, `.clean-stage` with the textarea and a hidden, `aria-hidden` `output` for the transformation display, and the action button), history section, initial saved-links loading copy, settings navigation after `main`, and module script loading
- [`../settings.html`](../settings.html): settings Vite HTML entry with the shared head injection marker, domain-transform toggles, initial settings loading row, disabled-until-ready save navigation, and module script loading
- [`../site.config.mjs`](../site.config.mjs): Vite-side page registry, shared head metadata including the viewport meta with `interactive-widget=resizes-content`, page-specific title/description values, and the shared CSP policy string
- [`../src/styles.css`](../src/styles.css): mobile-first layout, button, history, settings, view-transition, responsive desktop breakpoint at `960px`, and reduced-motion handling
- [`../src/transforms.js`](../src/transforms.js): ESM transform registry and shared cleanup logic for URLs and plain text
- [`../src/diff.js`](../src/diff.js): pure token diff between the text before and after cleaning, used by the transformation display
- [`../src/app.js`](../src/app.js): app factory and controller for the text field and its input sources, the transformation display, clipboard access, history persistence, startup history loading state, responsive layout, button states, and service worker update handling
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
- [`../test/diff.test.js`](../test/diff.test.js): Node test suite for the tokenizer and the token diff
- [`../test/storage.test.js`](../test/storage.test.js): Node test suite for the storage adapter and domain-transform settings behavior
- [`../test/app.test.js`](../test/app.test.js): Node test suite for app module import safety, history behavior, clipboard cleaning, the text field input sources, the transformation display, responsive history ordering, and PWA update button states
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

### `src/diff.js`

`diff.js` is a pure ESM module with no DOM access. It exports:

- `tokenize(text)`: splits on runs of whitespace and on the URL delimiters `/ ? # & = : . , ; ! @ $ ' ( ) * + [ ]`, keeping every delimiter as its own token, so joining the tokens gives the original text back. Words such as `utm_source` stay whole because `_` and `-` are not delimiters
- `diffSegments(input, output)`: returns `{ text, kind }` segments with `kind` of `same`, `removed`, or `added`. It runs a longest-common-subsequence over the two token arrays with a quadratic `Uint16Array` table, then walks it forward. Within each changed run the removed text comes before the added text, empty segments are dropped, and neighbours of the same kind are merged. Concatenating the `same` and `removed` segments gives the input; `same` and `added` give the output
- `maxDiffTokens` (300): above this many tokens on either side the diff falls back to one `removed` segment for the whole input and one `added` segment for the whole output. Identical strings return a single `same` segment without building the table

### `src/app.js`

`app.js` exports `createApp(...)` and `bootApp(...)`. `createApp(...)` accepts browser dependency overrides for test doubles, and `bootApp(...)` initializes the app returned by the factory. `src/main.js` is the browser entry that calls `bootApp()`.

The app object is organized with grouped concerns:

- `config`
- `messages`
- `elements`
- `state`
- `storage`
- `history`
- `sharing`
- `layout`
- `ui`
- `clipboard`
- `stage`
- `input`
- `pwa`
- `dev`
- `events`

Important behavior in the current implementation:

- Local history key: `clean-my-link-history`
- IndexedDB database: `clean-my-link-storage`
- IndexedDB object store: `keyval`
- History TTL: `72 * 60 * 60 * 1000`
- History limit: `100`
- Desktop breakpoint: `960`
- Default button mode: paste
- Alternate button modes: clean, copy, update, retry-update

History handling:

- Storage access goes through async `storage.readHistoryEntries()` and `storage.writeHistoryEntries()` methods.
- Storage access goes through the shared async adapter in `src/storage.js`; the default backing store is IndexedDB via `idb`.
- Existing `localStorage` values are copied into IndexedDB on first missing read and left in place for rollback.
- If IndexedDB cannot open or a write fails, the adapter falls back to the localStorage-compatible implementation.
- History entries are loaded into `state.historyEntries` during app startup.
- Rendering reads from in-memory state instead of reading storage directly.
- History loading is wrapped in `try/catch` so malformed local storage or IndexedDB data does not break the app.
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
- History items remain external links rendered with `target="_blank"` and `rel="noopener noreferrer"`.
- When the Web Share API is available for a saved entry, tapping that saved item shares entry-derived data instead of opening a new tab.
- The current share payload is URL-only, built from the saved entry as `{ url: entry.url }`, so future entry metadata can enrich the share data without changing the history rendering flow.
- User-cancelled shares are ignored; unexpected share errors are logged without changing the app status.

Responsive behavior:

- `body.dataset.layout` is set to `mobile` or `desktop`.
- On mobile, history is rendered in reverse order and auto-scrolled to the bottom.
- On desktop, history is rendered in storage order and scroll position is reset to the top.
- `resize`, `orientationchange`, `visualViewport.resize`, and `visualViewport.scroll` all run `layout.apply()`, which re-syncs the layout mode, the viewport height variable, the viewport pan, and the history scroll position.
- `layout.syncViewportHeight()` sets `--viewport-height` on the root element to `visualViewport.height` in pixels on mobile and removes it on desktop or when `visualViewport` is unavailable. The stylesheet falls back to `100dvh`. iOS does not shrink the layout viewport for the on-screen keyboard, so this variable is what keeps the bottom panel above the keyboard.
- `layout.resetViewportPan()` runs right after the height sync. On mobile, when `visualViewport.scale` is 1 or less and either `visualViewport.offsetTop` or `window.scrollY` is above zero, it calls `window.scrollTo(0, 0)`, which in Safari moves the visual viewport back to the origin. iOS focuses the field while the body still spans the full viewport, pans the visual viewport up by about the keyboard height to reveal it, and only then fires `visualViewport.resize`; the body shrinks but the pan stays, so the visible area would show the bottom of the shorter body with an empty band of layout viewport above the keyboard. iOS reports that pan through `visualViewport.scroll`, sometimes after `resize` and again during the keyboard animation, so the `scroll` listener re-runs the correction and also covers the late restore when the keyboard closes. A scale above 1 means pinch zoom, which is never fought. Desktop never scrolls the window, and a missing `visualViewport` is read as no pan.
- There is no measurement of the hero panel. Status changes still go through `ui.setStatus()` or `ui.setPrimaryActionMode()`, which schedule `layout.apply()` so the mobile history list stays scrolled to its newest entry when the panel grows. `input.syncHeight()` does the same whenever the textarea's rendered height changes. Any future change that alters the panel height outside those paths must schedule `layout.apply()` or call `ui.syncHistoryScroll()` itself.

Input sources:

All sources feed `input.clean(text, { source })`, which cleans with the enabled transforms, keeps the result in `state.lastResult`, starts the clipboard write-back through `clipboard.writeBack()`, starts the transformation display with `stage.play()`, then waits for the write, sets the status, hands the outcome to `stage.finish()`, and saves URL results to history. `input.clean()` does not wait for the display; the stage empties and blurs the field after the animation and hold when the write succeeded, or switches to the Copy fallback when it was refused. Text that is empty after trimming reports the empty-clipboard status and leaves any running display alone.

- Paste into the field: the textarea `paste` handler reads `text/plain` from `clipboardData`, calls `preventDefault()` so nothing is inserted, and cleans. A paste always replaces the field content. Pastes without plain text, or whose text is empty after trimming, keep the browser default, so a whitespace-only paste is inserted as typed text instead of reporting the empty-clipboard status.
- Paste anywhere: a `document` `paste` handler cleans when the event target is not editable (`INPUT`, `TEXTAREA`, `SELECT`, or `isContentEditable`), which also leaves pastes into the main field to its own handler. Cmd+V or Ctrl+V therefore works without focusing the field.
- Typed text: the `input` handler cancels any running transformation display, syncs the height and switches the button to `Clean` while the trimmed value is non-empty, and back to `Paste` when it is empty. `Clean`, Enter without Shift (ignored during IME composition), and the form `submit` event all clean the field value through `input.handleSubmit()`, which is a no-op while `input.isHoldingResult()` is true: the stage is busy and its pending result was written. During the hold the field still holds the source text under the output, so without the check a second tap or Enter would clean the same text again and restart the display. Shift+Enter inserts a line break. Escape empties the field and keeps focus; it also cancels a running display, even when the field itself is empty because the text came from a paste. There is no debounce-on-input cleaning.
- Drop: `dragenter`, `dragover`, `dragleave`, and `drop` are handled on `.app-panel-hero`. Drags carrying `text/uri-list` or `text/plain` are accepted, highlighted with the `is-dragover` class, and counted with `state.dragDepth` so moving across child elements does not flicker the highlight. The drop reads the first non-comment line of `text/uri-list` and falls back to `text/plain`. Drags of files only are left to the browser.
- Paste button: while the button reads `Paste`, the click handler starts `navigator.clipboard.readText()` synchronously before disabling the button, which keeps Safari's paste activation, then hands the text to `clipboard.cleanLatest()`, a thin wrapper around `input.clean()`. When `readText` is unavailable, the button focuses the field instead. The button never cleans field content in this mode.
- `input.guard()` wraps every source: `NotAllowedError` reports the blocked status, any other failure reports the generic error, and the button loading state is always cleared.

Field state:

- `.clean-stage` carries `data-state`, set through `stage.setState()`: `idle` for an empty field, `editing` for typed text, `cleaning` while the transformation animates, `done` while the clean string holds after the animation or while a refused write-back leaves it in the field, and `update` in the PWA update modes.
- `ui.setPrimaryActionMode()` cancels any running display, disables the textarea in the `update` and `retry-update` modes, and sets the stage to `update`, which hides it so the action button spans the full row as `Update Now` or `Try again`, as before the field existed. Returning to a clean mode re-enables the field, restores the default status, and re-derives `Paste` or `Clean` from any text the field kept. In update mode the paste handlers, the drop handlers, and the submit path ignore their events and leave the browser default alone. The `online` and `offline` listeners check `ui.isUpdateMode()`.
- The form never submits natively; the CSP sets `form-action 'none'`, and the `submit` handler calls `preventDefault()`. The action button is `type="button"`.
- The field is autofocused on load for every pointer type, unless something else already has focus, as the landing spot for a desktop paste. It is not refocused after a clean.
- Clicking the stage outside the textarea focuses the field.
- `input.syncHeight()` runs on every `input` event. Where `CSS.supports("field-sizing", "content")` is false it sets the inline height from `scrollHeight` plus the border; the stylesheet's `max-height` caps it at five lines. In both cases it schedules `layout.apply()` when `offsetHeight` changes.

Transformation display:

- `stage.play(input, result)` runs right after `clipboard.writeBack()` has been called, so the `writeText` call is already inside the paste or click activation before anything renders. It first cancels any earlier display, then remembers the result in `state.stageResult`. The input passed in is the trimmed source text, so a whitespace-split URL shows the whitespace being removed
- `stage.render(segments)` empties `#clean-output` and appends one `span` per segment with the classes `tok tok-same`, `tok tok-removed`, or `tok tok-added`, filled through `textContent`; user text never goes through `innerHTML`. It shows the output, adds `has-output` to `.clean-stage`, sets the `cleaning` state, and schedules `layout.apply()`, because the output can be taller than the field and the newest mobile history entry would otherwise end up under the panel
- `stage.animate()` reads `offsetWidth` to commit the starting styles, adds `is-animating` to the output, which starts the CSS transitions, and arms `state.animationTimer` with `windowObject.setTimeout` for `config.animationTimeoutMs` (600 ms). The first `transitionend` on the output whose `propertyName` is `font-size`, or the timeout, whichever comes first, ends the animation through `stage.endAnimation()`
- `stage.finish(result)` runs once the write-back has settled and ignores results that are no longer the current display. It settles at once when no animation is running, otherwise `stage.endAnimation()` settles when the animation ends. Settling with a refused write-back clears the output and calls `input.showCopy()`, so the Copy state appears as soon as the animation is over, with no hold. Settling with a successful write re-renders the output as the plain clean string, sets `done`, and arms `state.animationTimer` for `config.resultHoldMs` (800 ms), after which `input.reset({ blur: true })` empties and blurs the field and returns the button to `Paste`
- an unchanged result renders the plain string without the `is-animating` class, skips the collapse, and `stage.finish()` restarts the `is-pulsing` animation on the status through `ui.pulseStatus()`; the 800 ms hold still applies
- the button keeps its label during the animation and the hold, so a typed clean still reads `Clean` until the reset. Once the write-back has succeeded, `Clean` and Enter are ignored until the reset; before the write settles they still start a new clean, which cancels the display as any other source would
- `stage.cancel()` clears `state.animationTimer`, forgets `state.stageResult`, empties and hides the output, and schedules `layout.apply()`. It runs from `stage.play()` for a new paste, drop, typed clean, or paste-button clean, from `input.reset()` for Escape, Copy, and the end of the hold, from the `input` handler when the user types, and from `ui.setPrimaryActionMode()` when update mode starts. A write-back that settles after its display was cancelled changes nothing on the stage
- the textarea stays focused and keeps its value under the output. While `.clean-stage` has `has-output` it is positioned over the output with `opacity: 0` and no pointer events, so it adds no height, keeps the on-screen keyboard open until the blur at the end of the hold, and still receives typing, Enter, and Escape. If the write-back fails unexpectedly, the display is cancelled and the field shows its previous content with the generic error status
- reduced motion: `stage.prefersReducedMotion()` reads `windowObject.matchMedia(config.reducedMotionQuery)`, where the query is `(prefers-reduced-motion: reduce)`, and treats a missing `matchMedia` as no preference. When it matches, `stage.play()` renders nothing and `stage.finish()` settles straight to the end state with no hold and no status pulse: a successful write empties and blurs the field and returns the button to `Paste` as soon as the write resolves, and a refused write shows the Copy state at once. The JS branch is needed because the stylesheet's global reduced-motion rule sets `transition: none`, so `transitionend` would never fire and the display would otherwise wait for the 600 ms timeout and then hold
- `#clean-output` is `aria-hidden="true"`: the `output` element is a live region by default, and the status paragraph is the only announcement per clean

Clipboard flow:

- Reads via `navigator.clipboard.readText()` on the paste button path only; paste and drop events carry their own data
- Writes the cleaned output with `navigator.clipboard.writeText(...)` immediately after cleaning, before any other await and before the transformation display renders, so it stays inside the paste or click activation
- `clipboard.writeBack(output)` returns `{ written: true }` on success and `{ written: false }` when `writeText` rejects with `NotAllowedError` or is unavailable; any other rejection propagates to the generic error status
- A refused write-back is not an error: the status stays `All clear!`, and once the animation ends the clean string is put in the field and selected so a keyboard copy also works, the stage becomes `done`, and the button reads `Copy`. Paste and drop events do not always carry the activation `writeText` needs, for example Safari's Edit-menu paste or a drop from another window. Verified on an iPhone running iOS 27 on 5 October 2026: a paste chosen from the QuickType suggestion above the keyboard cleans the text and shows `All clear!`, but the write-back is refused, so the clean link stays selected in the field with the `Copy` button. That is the designed outcome for that path, not a defect
- Tapping `Copy` calls `clipboard.copyLast()`, which writes `state.lastResult.output` inside its own click activation, then empties and blurs the field and returns the button to `Paste` with the status unchanged. If that write is refused too, the button stays `Copy` and the blocked status is shown
- Editing the field leaves Copy mode for `Clean`, Escape empties it back to `Paste`, and a new paste or drop replaces it
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
- Settings use the same IndexedDB key/value store, copy-and-keep localStorage migration, and localStorage fallback path as history.

Localhost development helper:

- On `localhost`, `127.0.0.1`, and `[::1]`, `app.dev.installHelpers()` exposes `window.resetAppCache(...)`.
- `window.resetAppCache({ reload = true })` unregisters local service workers, clears Cache Storage, and optionally reloads the page.
- The helper is intended for local iteration when the service worker's cache-first behavior would otherwise keep stale assets in the browser.
- Service worker registration is skipped in Vite dev mode through `import.meta.env.DEV`, so local HMR is not controlled by a production worker.

### `index.html` and `settings.html`

The main page heading is a visually hidden `h1` that always reads `Clean My Link`. Below the status, `#clean-form` holds a visually hidden `label` for `#clean-input`, the `.clean-stage` container with `data-state="idle"`, the textarea with `rows="1"`, `autocomplete="off"`, `autocapitalize="off"`, `enterkeyhint="done"`, and the placeholder `Paste a link here`, a hidden `output` element with `aria-hidden="true"` for the transformation display, and `.clean-actions` with the action button. The textarea has no `inputmode="url"`, because the iOS URL keyboard drops the space bar and plain text is a supported input. It also has no `autocorrect="off"` and no `spellcheck="false"`: iOS shows no QuickType predictions row for a field with autocorrection turned off, and that row is where it places the paste suggestion for recently copied content. Paste is the primary path and pasted text is never autocorrected; typed plain text can be, which is visible in the field before `Clean` is tapped, and URLs are left alone because autocorrect skips tokens with slashes and dots. `autocomplete="off"` stays because it controls autofill, not predictions. The settings link sits after `main` in the DOM, so the tab order is field, action button, credit link, history links, then settings; it is `position: fixed`, so its place on screen does not change. The status line is `<p id="status-message" class="status-message" role="status">`; `role="status"` gives it polite, atomic live-region semantics, so `ui.setStatus()` only needs to replace `textContent`. The status keeps the former heading's visual style through `.status-message`, including an explicit `font-weight: 700`, because the headline font ships only in weight 400 and the browser synthesizes the bold. `.visually-hidden` is the shared utility for off-screen text.

Each HTML entry keeps a small `<head>` containing an `<!-- app-head -->` marker. During the Vite HTML transform, `vite.config.mjs` injects generated head tags from `site.config.mjs`.

Shared generated head metadata:

- character set, viewport, theme color, and referrer policy
- the viewport meta is `width=device-width, initial-scale=1, interactive-widget=resizes-content`, so Chrome on Android shrinks the layout viewport for the on-screen keyboard; Safari ignores the extra directive
- restrictive `Content-Security-Policy` meta tag
- shared Open Graph and Twitter image metadata
- manifest and icon links
- stylesheet link to `/src/styles.css`, which Vite fingerprints in production

Page-specific generated metadata:

- title
- description
- Open Graph title and description
- Twitter title and description

The Vite build inputs are derived from the same page registry, so adding a new HTML entry should start in `site.config.mjs`.

The body contains only two user-facing sections:

- hero/action panel
- recent-links panel

It also includes a settings link using `/assets/icon_settings.webp`; the link is positioned top-right on mobile and bottom-right on desktop.

### `src/styles.css`

The CSS matches the current product direction:

- dark background with subtle grid
- restrained card styling rather than marketing-heavy chrome
- mobile layout is a flex column: `body` is `height: var(--viewport-height, 100dvh)` with `overflow: hidden`, `.app-shell` and `.app-column` are flex columns that fill it, `.history-section` takes the remaining height with `flex: 1 1 auto; min-height: 0; overflow-y: auto`, and `.hero-stage` is `flex: none` at the bottom with the mobile gutters as its only padding. It has no `env(safe-area-inset-bottom)` padding: the viewport meta has no `viewport-fit=cover`, so the inset is always zero, and without `cover` Safari already keeps the page above the home indicator in the browser and in the home-screen app
- the visual order on mobile comes from `order` on `.history-section` and `.hero-stage`, so the DOM keeps the hero first
- below `580px` the hero keeps the mobile gutters; from `580px` the `34rem` column already fits inside the viewport with its gutters, so the hero panel fills the column, which keeps the width the old fixed panel had
- `.settings-page` and the `960px` desktop breakpoint reset `body` to `display: block`, `height: auto`, and `overflow: auto`, so the settings page and the desktop grid scroll normally
- the history section is not an `.app-panel`; its mobile rules are its own, and the `960px` block gives it the panel border, background, shadow, blur, `1.25rem` padding, and `1.2rem` gap directly. Between `540px` and `959px` the section therefore keeps its `3.25rem` top padding, mobile gutters, and `0.9rem` gap, where the old `.app-panel` media rules used to override them
- the clean form is a flex row with the field stage taking the remaining width (`flex: 1 1 0`) and the action column fixed at a `6.5rem` minimum, so `Paste`, `Clean`, and future labels do not resize the field. The row aligns to the bottom, so the button stays next to the last line as the field grows. The form has `min-width: 0` because the hero panel is a grid and the field's min-content width would otherwise be an unbroken URL
- `.clean-input` uses a `16px` font so iOS does not zoom on focus, a single-line height that matches the button, `field-sizing: content`, and `max-height` for five lines with internal scrolling. Focus shows the accent border and the shared focus ring
- `.clean-output` shares the field's box through the same rule as `.clean-input`: `--field-line`, `--field-padding`, the border, background, `16px` font, minimum height, and five-line `max-height`, so swapping the field for the output does not move anything. It adds `min-width: 0`, `white-space: pre-wrap`, and `overflow-wrap: anywhere`, so line breaks in the source text survive and an unbroken URL wraps instead of widening the panel, and `pointer-events: none`, so a click lands on the stage and focuses the field. `.clean-output[hidden]` keeps `display: none` against the block display
- `.clean-stage` is `position: relative`; `.clean-stage.has-output .clean-input` is absolutely positioned over the output with `max-height: 100%`, which also caps an inline height from the JS fallback, `opacity: 0`, and no pointer events. `.clean-stage.has-output:focus-within .clean-output` shows the field's focus border and ring on the output
- `.tok-removed` starts with a transparent line-through, `.tok-added` starts at `font-size: 0` and `opacity: 0`. Under `.clean-output.is-animating`, removed tokens dim to the muted color and their strike line appears over 160 ms, then removed tokens shrink to `font-size: 0` and fade out while added tokens grow to `1em` and fade in over 300 ms after a 180 ms delay, about 480 ms in total. Shrinking `font-size` collapses inline text even across wrapped lines, which a width transition cannot do. Both token kinds use `vertical-align: top`, because a zero-size inline box aligned on its baseline would stretch the line box under the fixed `--field-line` height
- `.status-message.is-pulsing` runs a 520 ms `status-pulse` keyframe that tints the status with the accent and scales it by 3% from its left edge, for unchanged results
- `.clean-stage[data-state="update"]` is hidden and the adjacent `.clean-actions` grows to the full row, so update mode reuses the full-width `.push-button` look
- `.app-panel-hero.is-dragover` highlights the panel border while a text drag is over it
- one `.push-button` class carries the blue gradient, border, shadow, pressed, hover, focus-visible, and disabled-cursor rules for the clean button, the settings link, and the settings save button. `.clean-button` only adds its size and typography, `.settings-link` and `.settings-save-button` only add the square icon sizing and their own positioning or disabled opacity
- `touch-action: manipulation` is declared once on `html`; descendants inherit the effective value, so no other selector repeats it
- two-column product layout on desktop
- startup loading styles for storage-backed history and settings content
- settings page styles for the domain-toggle form
- `.visually-hidden` utility for screen-reader-only text such as the page heading
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

Build-step details:

- `vite.config.mjs` uses `transformIndexHtml` to inject shared and page-specific head metadata from `site.config.mjs`.
- `vite.config.mjs` derives `build.rollupOptions.input` from the same page registry used for metadata.
- `test/build.test.js` verifies that built HTML pages receive generated metadata, that the source marker is removed from `dist/`, that the stylesheet is fingerprinted, and that the Netlify CSP header remains aligned with the shared CSP string from `site.config.mjs`.

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
- the HTML CSP meta tag is generated from `site.config.mjs`, and `test/build.test.js` asserts the Netlify response header matches the same policy string
- the service worker only writes successful same-origin GET responses into cache

## Validation status and gaps

Current automated coverage:

- transform behavior in [`../test/transforms.test.js`](../test/transforms.test.js)
- tokenizer and token diff behavior in [`../test/diff.test.js`](../test/diff.test.js)
- settings storage, domain-only settings behavior, and transform-setting default normalization in [`../test/storage.test.js`](../test/storage.test.js)
- settings page controller behavior, including settings-read fallback and loading-state clearing, in [`../test/settings.test.js`](../test/settings.test.js)
- import safety, startup history loading, malformed history fallback, history expiry pruning, history de-duplication, history limit enforcement, clipboard URL/text cleaning, unchanged-input status, unexpected clipboard failure handling, the transformation display with its transitionend and timeout endings, hold, cancellation, and reduced-motion branch, the refused write-back Copy fallback, field and document paste including whitespace-only pastes, typed text with Enter and Escape, the Clean and Enter no-op during the result hold, the visual viewport pan reset and its listeners, drop sources, field reset and height sync, responsive history ordering, saved-link share/fallback behavior, PWA update button states, and the field in update mode for [`../src/app.js`](../src/app.js) in [`../test/app.test.js`](../test/app.test.js)
- build output, generated service worker, generated HTML head metadata, and Netlify CSP alignment checks in [`../test/build.test.js`](../test/build.test.js)

Current gaps:

- no automated browser test for clipboard permission states
- no automated browser test for service worker registration, update lifecycle, or offline cache reuse
- reduced motion is covered by unit tests with an injected `matchMedia` and by a playwright-cli run with `page.emulateMedia({ reducedMotion: 'reduce' })`, not by an automated browser test

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
