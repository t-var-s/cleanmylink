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

- [`../index.html`](../index.html): main Vite HTML entry with the shared head injection marker, hero panel with a visually hidden `h1`, a `role="status"` paragraph, and `.clean-stage` with a hidden, `aria-hidden` `output` for the transformation display and the paste target button, history section, initial saved-links loading copy, settings navigation after `main`, and module script loading
- [`../settings.html`](../settings.html): settings Vite HTML entry with the shared head injection marker, domain-transform toggles, initial settings loading row, disabled-until-ready save navigation, and module script loading
- [`../site.config.mjs`](../site.config.mjs): Vite-side page registry, shared head metadata including the viewport meta with `interactive-widget=resizes-content`, page-specific title/description values, and the shared CSP policy string
- [`../src/styles.css`](../src/styles.css): mobile-first layout, button, history, settings, view-transition, responsive desktop breakpoint at `960px`, and reduced-motion handling
- [`../src/transforms.js`](../src/transforms.js): ESM transform registry and shared cleanup logic for URLs and plain text
- [`../src/diff.js`](../src/diff.js): pure token diff between the text before and after cleaning, used by the transformation display
- [`../src/app.js`](../src/app.js): app factory and controller for the paste target and the other input sources, the transformation display, clipboard access, history persistence, startup history loading state, responsive layout, button states, and service worker update handling
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
- [`../test/app.test.js`](../test/app.test.js): Node test suite for app module import safety, history behavior, clipboard cleaning, the paste target, document paste and drop sources, the transformation display, the Copy fallback, responsive history ordering, and PWA update button states
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
- Alternate button modes: copy, update, retry-update

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
- `resize` and `orientationchange` run `layout.apply()`, which re-syncs the layout mode and the history scroll position. Nothing in the app opens the on-screen keyboard, so there is no visual viewport handling: `body` is `100dvh` and the browser's own chrome changes are already reported through `dvh`.
- There is no measurement of the hero panel. Status changes go through `ui.setStatus()` or `ui.setPrimaryActionMode()`, and the output is shown and hidden through `stage.showOutput()`; all three schedule `layout.apply()` so the mobile history list stays scrolled to its newest entry when the panel grows. Any future change that alters the panel height outside those paths must schedule `layout.apply()` or call `ui.syncHistoryScroll()` itself.

Input sources:

All sources feed `input.clean(text, { source })`, which cleans with the enabled transforms, keeps the result in `state.lastResult`, starts the clipboard write-back through `clipboard.writeBack()`, starts the transformation display with `stage.play()`, then waits for the write, sets the status, hands the outcome to `stage.finish()`, and saves URL results to history. `input.clean()` does not wait for the display; the stage empties after the animation and hold when the write succeeded, or switches to the Copy fallback when it was refused. Text that is empty after trimming reports the empty-clipboard status and leaves any running display alone. There is no typed input: a link that is on screen but not on the clipboard has to be copied first.

- Paste target: while the control is in `paste` mode, the click handler starts `navigator.clipboard.readText()` synchronously before disabling the control, which keeps Safari's paste activation, then hands the text to `clipboard.cleanLatest()`, a thin wrapper around `input.clean()`. On touch this is the only path, and the browser's own Paste control appears over the box. When `readText` is unavailable, the click sets the status `Press Cmd+V or Ctrl+V to paste a link.` and changes nothing else.
- Paste anywhere: a `document` `paste` handler cleans when the event is not already handled and its target is not editable (`INPUT`, `TEXTAREA`, `SELECT`, or `isContentEditable`). It reads `text/plain` from `clipboardData`, calls `preventDefault()`, and cleans. Pastes without plain text, or whose text is empty after trimming, and pastes in update mode keep the browser default. Cmd+V or Ctrl+V is the desktop zero-click path.
- Drop: `dragenter`, `dragover`, `dragleave`, and `drop` are handled on `.app-panel-hero`. Drags carrying `text/uri-list` or `text/plain` are accepted, highlighted with the `is-dragover` class, and counted with `state.dragDepth` so moving across child elements does not flicker the highlight. The drop reads the first non-comment line of `text/uri-list` and falls back to `text/plain`. Drags of files only are left to the browser.
- `input.guard()` wraps every source: `NotAllowedError` reports the blocked status, any other failure reports the generic error, and the control's loading state is always cleared.

Control and stage state:

- `state.buttonMode` is `paste`, `copy`, `update`, or `retry-update`. `ui.setPrimaryActionMode()` sets the label, mirrors the mode into `data-mode` on `.clean-stage`, and swaps the control's look in one place: the `paste-target` class in `paste` mode, the `push-button` class otherwise. The `clean-button` class stays for the sizing. The stylesheet keys the layout off `data-state` and `data-mode`.
- `.clean-stage` carries `data-state`, set through `stage.setState()`: `idle` with the target as a box and the output hidden, `cleaning` while the transformation shows, `done` while the clean string holds after the animation or while a refused write-back leaves it in the output beside `Copy`, and `update` in the PWA update modes.
- In the `update` and `retry-update` modes `ui.setPrimaryActionMode()` cancels any running display and sets the stage to `update`, which hides the output and lets the control fill the row as `Update Now` or `Try again`. Returning to `paste` restores the default status and the `idle` state. In update mode the paste and drop handlers ignore their events and leave the browser default alone. The `online` and `offline` listeners check `ui.isUpdateMode()`.
- `input.reset()` is the one place the end of a clean goes through: it cancels the display and, outside update mode, returns the control to `paste` and the stage to `idle`. It runs at the end of the hold, after a successful `Copy`, after an unexpected write-back failure, and once during `init()`.
- The control is a real `button` with `type="button"`: focusable, activated by Space and Enter, and never focused by the app. Nothing in the app opens the on-screen keyboard.

Transformation display:

- `stage.play(input, result)` runs right after `clipboard.writeBack()` has been called, so the `writeText` call is already inside the paste or click activation before anything renders. It first cancels any earlier display, then remembers the result in `state.stageResult`. The input passed in is the trimmed source text, so a whitespace-split URL shows the whitespace being removed. For a changed result it renders the segments, marks the display as animating, and arms `state.animationTimer` for `config.revealHoldMs` (300 ms) before `stage.animate()` runs, so the pasted text shows for a beat before the junk starts to go. The reveal counts as animation time, which is why a write-back that settles during it waits for the display instead of settling at once; a second paste during the reveal cancels it through `stage.cancel()` like any other pending timer
- `stage.render(segments)` empties `#clean-output` and appends one `span` per segment with the classes `tok tok-same`, `tok tok-removed`, or `tok tok-added`, filled through `textContent`; user text never goes through `innerHTML`. It shows the output, sets the `cleaning` state, and schedules `layout.apply()`, because the output can be taller than the target and the newest mobile history entry would otherwise end up under the panel. While the stage is `cleaning` or `done` in `paste` mode, the stylesheet hides the target, so the output takes its place in the row
- `stage.animate()` reads `offsetWidth` to commit the starting styles, adds `is-animating` to the output, which starts the CSS transitions, and arms `state.animationTimer` with `windowObject.setTimeout` for `config.animationTimeoutMs` (450 ms), counted from the end of the reveal. The first `transitionend` on the output whose `propertyName` is `font-size`, or the timeout, whichever comes first, ends the animation through `stage.endAnimation()`
- `stage.finish(result)` runs once the write-back has settled and ignores results that are no longer the current display. It settles at once when no animation is running, otherwise `stage.endAnimation()` settles when the animation ends. Settling with a refused write-back calls `stage.showCopy()`, so the Copy state appears as soon as the animation is over, with no hold. Settling with a successful write re-renders the output as the plain clean string, sets `done`, and arms `state.animationTimer` for `config.resultHoldMs` (500 ms), after which `input.reset()` hides the output and brings the target back
- an unchanged result renders the plain string without the `is-animating` class, skips the collapse, and `stage.finish()` restarts the `is-pulsing` animation on the status through `ui.pulseStatus()`; there is no reveal, and the 500 ms hold still applies
- the control stays hidden during the animation and the hold in `paste` mode, so a tap on the box cannot restart the display; a new document paste or drop still can
- `stage.cancel()` clears `state.animationTimer`, forgets `state.stageResult`, empties and hides the output, and schedules `layout.apply()`. It runs from `stage.play()` for a new paste, drop, or target clean, from `stage.showCopy()`, from `input.reset()`, and from `ui.setPrimaryActionMode()` when update mode starts. A write-back that settles after its display was cancelled changes nothing on the stage. `stage.play()` also returns the control from `copy` to `paste` when a new clean starts, so `Copy` never shows beside a running transformation
- if the write-back fails unexpectedly, `input.reset()` clears the display and the generic error status is shown
- reduced motion: `stage.prefersReducedMotion()` reads `windowObject.matchMedia(config.reducedMotionQuery)`, where the query is `(prefers-reduced-motion: reduce)`, and treats a missing `matchMedia` as no preference. When it matches, `stage.play()` renders nothing and `stage.finish()` settles straight to the end state with no hold and no status pulse: a successful write returns the control to `Paste a link here` as soon as the write resolves, and a refused write shows the Copy state at once. The JS branch is needed because the stylesheet's global reduced-motion rule sets `transition: none`, so `transitionend` would never fire and the display would otherwise wait for the 600 ms timeout and then hold
- `#clean-output` is `aria-hidden="true"`: the `output` element is a live region by default, and the status paragraph is the only announcement per clean

Clipboard flow:

- Reads via `navigator.clipboard.readText()` on the paste target path only; paste and drop events carry their own data
- Writes the cleaned output with `navigator.clipboard.writeText(...)` immediately after cleaning, before any other await and before the transformation display renders, so it stays inside the paste or click activation
- `clipboard.writeBack(output)` returns `{ written: true }` on success and `{ written: false }` when `writeText` rejects with `NotAllowedError` or is unavailable; any other rejection propagates to the generic error status
- A refused write-back is not an error: the status stays `All clear!`, and once the animation ends `stage.showCopy()` renders the plain clean string in the output, sets the stage to `done`, switches the control to `Copy` beside it, and selects the output's text through a `Range` on `window.getSelection()`, so a keyboard copy also works. The output is `user-select: text` with pointer events in that state. Paste and drop events do not always carry the activation `writeText` needs, for example Safari's Edit-menu paste or a drop from another window. Verified on an iPhone running iOS 27 on 5 October 2026 with the former text field: a paste chosen from the QuickType suggestion above the keyboard carried no user gesture, so the write-back was refused and `Copy` was needed. That is why the field was replaced by the target: on the tap path the write happens inside the same tap that showed the browser's Paste control, so `Copy` is not expected to appear on iOS at all
- Tapping `Copy` calls `clipboard.copyLast()`, which writes `state.lastResult.output` inside its own click activation, then `input.reset()` hides the output and returns the control to `Paste a link here` with the status unchanged. If that write is refused too, the control stays `Copy` and the blocked status is shown
- A new paste or drop replaces the Copy state
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

The main page heading is a visually hidden `h1` that always reads `Clean My Link`. Below the status, `.clean-stage` with `data-state="idle"` and `data-mode="paste"` holds a hidden `output` element with `aria-hidden="true"` for the transformation display, then the paste target: `<button id="clean-button" class="paste-target clean-button" type="button">` with the `.clean-button-label` span reading `Paste a link here` and the spinner markup. The output comes first in the DOM so the row reads text then button in the Copy state, which matches the visual order and the tab order. There is no form, no label, and no text field, so nothing on the page can open the on-screen keyboard. The settings link sits after `main` in the DOM, so the tab order is the target, the credit link, history links, then settings; it is `position: fixed`, so its place on screen does not change. The status line is `<p id="status-message" class="status-message" role="status">`; `role="status"` gives it polite, atomic live-region semantics, so `ui.setStatus()` only needs to replace `textContent`. The status keeps the former heading's visual style through `.status-message`, including an explicit `font-weight: 700`, because the headline font ships only in weight 400 and the browser synthesizes the bold. `.visually-hidden` is the shared utility for off-screen text.

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
- mobile layout is a flex column: `body` is `height: 100dvh` with `overflow: hidden`, `.app-shell` and `.app-column` are flex columns that fill it, `.history-section` takes the remaining height with `flex: 1 1 auto; min-height: 0; overflow-y: auto`, and `.hero-stage` is `flex: none` at the bottom with the mobile gutters as its only padding. It has no `env(safe-area-inset-bottom)` padding: the viewport meta has no `viewport-fit=cover`, so the inset is always zero, and without `cover` Safari already keeps the page above the home indicator in the browser and in the home-screen app
- the visual order on mobile comes from `order` on `.history-section` and `.hero-stage`, so the DOM keeps the hero first
- below `580px` the hero keeps the mobile gutters; from `580px` the `34rem` column already fits inside the viewport with its gutters, so the hero panel fills the column, which keeps the width the old fixed panel had
- `.settings-page` and the `960px` desktop breakpoint reset `body` to `display: block`, `height: auto`, and `overflow: auto`, so the settings page and the desktop grid scroll normally
- the history section is not an `.app-panel`; its mobile rules are its own, and the `960px` block gives it the panel border, background, shadow, blur, `1.25rem` padding, and `1.2rem` gap directly. Between `540px` and `959px` the section therefore keeps its `3.25rem` top padding, mobile gutters, and `0.9rem` gap, where the old `.app-panel` media rules used to override them
- `.clean-stage` is a flex row aligned to the bottom with a `0.6rem` gap and `min-width: 0`, because the hero panel is a grid and the output's min-content width would otherwise be an unbroken URL. It declares `--field-line` and `--field-padding`, which the output and the target share
- `.clean-output` is the box: `--field-line`, `--field-padding`, a `1px` solid `--line-strong` border, the dark field background, a `16px` monospace font, a single-line minimum height, and a five-line `max-height` with internal scrolling. It takes the remaining width with `flex: 1 1 0`, adds `white-space: pre-wrap` and `overflow-wrap: anywhere`, so line breaks in the source text survive and an unbroken URL wraps instead of widening the panel, and `pointer-events: none`. `.clean-output[hidden]` keeps `display: none` against the block display. Under `.clean-stage[data-mode="copy"]` it gets pointer events and `user-select: text`, so the selected clean string can be copied
- `.paste-target` is the same box as a button: the output's metrics with a `2px` dashed accent border at reduced opacity and the padding reduced by `1px` on each side so the height matches, the muted colour, the copy font at `16px`, left-aligned text with no uppercase, `cursor: pointer`, and the box's own transitions. It overrides the accent typography that `.clean-button` sets for the push-button modes, so it has to stay later in the stylesheet. `:active` makes the border solid in the accent colour and lightens the background one step with no translate; `:focus-visible` shows the shared focus ring; `:disabled` shows the progress cursor. Hover, inside `@media (hover: hover)`, turns the border solid and brighter and brightens the label. The spinner inside it uses accent colours against the dark background, and `.push-button.is-loading` keeps the lighter gradient for the push-button modes only
- `.app-panel-hero.is-dragover .paste-target` switches the dashed border to solid accent while a text drag is over the panel
- `.clean-stage[data-state="cleaning"] .paste-target` and `[data-state="done"] .paste-target` are `display: none`, so the output takes the target's place in the row without moving anything. In `copy` mode the control no longer carries `paste-target`, so it stays visible: `.clean-stage[data-mode="copy"] .clean-button` is `flex: none; width: auto; min-width: 6.5rem` beside the output, and `.clean-stage[data-state="update"] .clean-button` is `flex: 1 1 auto` across the row
- `.tok-removed` starts with a transparent line-through, `.tok-added` starts at `font-size: 0` and `opacity: 0`. Under `.clean-output.is-animating`, removed tokens dim to the muted color and their strike line appears over 160 ms, then removed tokens shrink to `font-size: 0` and fade out while added tokens grow to `1em` and fade in over 240 ms after a 120 ms delay, about 360 ms in total. With the 300 ms reveal and the 500 ms hold the whole display takes about 1.2 s, tuned on the device round to match how fast the status and the history react. Shrinking `font-size` collapses inline text even across wrapped lines, which a width transition cannot do. Both token kinds use `vertical-align: top`, because a zero-size inline box aligned on its baseline would stretch the line box under the fixed `--field-line` height
- `.status-message.is-pulsing` runs a 520 ms `status-pulse` keyframe that tints the status with the accent and scales it by 3% from its left edge, for unchanged results
- `.app-panel-hero.is-dragover` highlights the panel border while a text drag is over it
- one `.push-button` class carries the blue gradient, border, shadow, pressed, hover, focus-visible, and disabled-cursor rules for the control in its `copy` and update modes, the settings link, and the settings save button. `.clean-button` only adds its size and typography, `.settings-link` and `.settings-save-button` only add the square icon sizing and their own positioning or disabled opacity
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
- import safety, startup history loading, malformed history fallback, history expiry pruning, history de-duplication, history limit enforcement, clipboard URL/text cleaning, unchanged-input status, unexpected clipboard failure handling, the transformation display with its transitionend and timeout endings, hold, cancellation, and reduced-motion branch, the refused write-back Copy fallback with the output selection, the paste target in idle and after a clean, the hint when `readText` is unavailable, document paste including whitespace-only pastes, drop sources, responsive history ordering, saved-link share/fallback behavior, PWA update button states, and the control in update mode for [`../src/app.js`](../src/app.js) in [`../test/app.test.js`](../test/app.test.js)
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
