## Product scope

Clean My Link is a mobile-first web app and installable PWA for iOS, Android, and desktop browsers. Its job is to clean whatever text the user most recently copied, then immediately write the cleaned result back to the clipboard.

The app is intentionally single-purpose:

- one primary action button
- one live status message
- one local recent-links list
- no accounts, sync, or server-side state

## Primary user flow

Default UI copy:

- Status: `Remove junk parameters from any URL you've just copied.`
- Button: `Clean My Copied Link`

When the user taps the button:

1. The app shows `Accessing Clipboard`.
2. It reads the current clipboard text.
3. It cleans the value as either a URL or plain text.
4. It writes the cleaned result back to the clipboard.
5. It updates the status message.

Status outcomes:

- Empty clipboard: `No text was found in your clipboard.`
- Successful clean: `All clear!`
- Unchanged but valid input: `All clear!`
- Clipboard permission denied: `Clipboard access is blocked. Try allowing clipboard permissions.`
- Unexpected failure: `Something went sideways while cleaning your clipboard.`

The success burst animation only runs when clipboard text was actually present.

## Clipboard transformation rules

### URL detection

- The app trims the clipboard text first.
- It removes all whitespace from the candidate URL before parsing so split URLs such as line-wrapped copied links can still be recognized.
- Only successfully parsed `http:` and `https:` URLs are treated as links.

### Generic URL cleanup

- Remove query parameters whose names start with `utm_`.
- Remove `ref` and parameters whose names start with `ref_`.
- Remove these known tracking parameters when present:
  - `fbclid`
  - `gclid`
  - `dclid`
  - `msclkid`
  - `ttclid`
  - `twclid`
  - `igshid`
  - `mc_cid`
  - `mc_eid`
  - `_hsenc`
  - `_hsmi`
  - `mkt_tok`
  - `oly_anon_id`
  - `oly_enc_id`
  - `smid`
  - `vero_id`
  - `wickedid`
  - `yclid`

### Site-specific URL rules

Current custom rules:

- `x.com` links that are not article URLs are rewritten to `fxtwitter.com`.
- `reddit.com` links are rewritten to `redlib.freedit.eu`.
- `youtube.com` and `youtu.be` URLs remove all query parameters, then keep only `v` when that parameter exists.

Example outcomes:

- `https://example.com/?utm_source=x&keep=1` -> `https://example.com/?keep=1`
- `https://x.com/user/status/42?utm_source=x` -> `https://fxtwitter.com/user/status/42`
- `https://www.youtube.com/watch?v=abc123&utm_source=x&t=90` -> `https://www.youtube.com/watch?v=abc123`

### Plain-text cleanup

If the clipboard text is not an `http` or `https` URL:

- replace line breaks with spaces
- collapse repeated whitespace
- trim the result
- if the text has at least two letters and all letters are uppercase, convert it to sentence case

Example:

- `HELLO   WORLD.\nTHIS IS FINE.` -> `Hello world. This is fine.`

## History behavior

- Only cleaned HTTP(S) URLs are stored in history.
- History is saved in `localStorage`.
- Entries are stored under the `clean-my-link-history` key.
- Entries expire after 72 hours.
- Invalid or expired entries are discarded before rendering.
- Duplicate URLs are de-duplicated so the newest clean wins.
- History is capped at 100 entries.
- Each item opens in a new tab with safe external-link attributes.

Ordering rules:

- Storage order is newest first.
- Desktop UI renders newest first.
- Mobile UI renders the same data in reverse order and scrolls to the bottom so the newest entry sits closest to the action area.

## Layout and interaction requirements

- Mobile-first presentation is the default.
- On small screens, the hero panel stays fixed near the bottom and the history list scrolls behind it.
- At `960px` and above, the app switches to a two-column desktop layout with history on the left and the primary action panel on the right.
- The design uses a restrained dark palette with a cool blue accent and a subtle grid background.
- Hover is optional; the core interaction must still feel responsive on touch devices.
- Reduced-motion users should not get animated transitions.

## PWA and offline behavior

- The app is installable as a standalone PWA.
- A service worker caches the app shell for offline reuse.
- The app checks for updates on load, focus, visibility return, and when the browser comes back online.
- When an update is waiting:
  - status becomes `A new version for this app is available online.`
  - button label becomes `Update Now`
- If the device is offline during update mode:
  - status becomes `Network went offline, can't update.`
  - button label becomes `Try again`

## Settings

The app has a page where users can specify what URL transformations are on or off for specific domains.

- Only domain-specific URL transformations are configurable.
- Global cleanup rules, including tracking-parameter cleanup, always apply.
- Settings changes are saved only when the user confirms from the settings page.
- The settings save action returns the user to the main cleaning page.
