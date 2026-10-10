## Product scope

Clean My Link is a mobile-first web app and installable PWA for iOS, Android, and desktop browsers. Its job is to clean whatever text the user most recently copied, then immediately write the cleaned result back to the clipboard.

The app is intentionally single-purpose:

- one primary action button
- one live status message
- one local recent-links list
- no accounts, sync, or server-side state

## Primary user flow

Default UI copy:

- Status: `Remove junk parameters from any URL you paste or drop in.`
- Button: `Click to paste a link here`

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
- If writing to clipboard fails, a Copy button appears.

## Clipboard transformation rules

### URL detection

- The app trims the clipboard text first.
- It removes all whitespace from the candidate URL before parsing so split URLs such as line-wrapped copied links can still be recognized.
- Only successfully parsed `http:` and `https:` URLs are treated as links.

### Generic URL cleanup

Generic rules run on every HTTP(S) link, before any site-specific rule, in this order: unwrap, strip parameters, strip fragments.

#### Redirect unwrapping

Many copied links are wrappers whose real destination sits inside a query parameter. The app replaces the wrapper with that destination without any network request.

- A wrapper is recognised by host and path, not by host alone. `google.com/url` is a wrapper, `google.com/search` is not.
- The destination is read from the wrapper's known parameter. The app accepts it only when it parses as an `http:` or `https:` URL; otherwise the link is left as it was.
- Unwrapping repeats on the result until no wrapper matches, up to four times, so nested wrappers such as a mail safe link around a search redirect are fully resolved.
- The unwrapped destination then goes through every other rule as if it had been pasted directly.
- Short links with an opaque ID, such as `t.co`, `bit.ly`, `lnkd.in`, and `amzn.to`, cannot be unwrapped offline. The app leaves them unchanged.

Known wrappers:

| Host and path | Parameter |
| --- | --- |
| `google.com/url`, `www.google.com/url` | `q`, then `url` |
| `googleadservices.com/pagead/aclk` | `adurl` |
| `l.facebook.com/l.php`, `lm.facebook.com/l.php` | `u` |
| `l.instagram.com/` | `u` |
| `youtube.com/redirect`, `www.youtube.com/redirect` | `q` |
| `out.reddit.com/` | `url` |
| `duckduckgo.com/l/` | `uddg` |
| `linkedin.com/safety/go`, `www.linkedin.com/safety/go` | `url` |
| `slack-redir.net/link` | `url` |
| `steamcommunity.com/linkfilter/` | `url` |
| `*.safelinks.protection.outlook.com/` | `url` |
| `linkprotect.cudasvc.com/url` | `a` |
| `medium.com/r/` | `url` |
| `getpocket.com/redirect` | `url` |

#### Tracking parameters

Parameter names are matched case-insensitively.

Remove parameters whose names start with any of these prefixes:

- `utm_`
- `ref_`
- `mtm_` and `pk_` (Matomo)
- `hsa_` (HubSpot ads)
- `_bta_` (Bronto)

Remove these parameters when present:

- `ref`
- Google and Bing ads: `gclid`, `gclsrc`, `gbraid`, `wbraid`, `gad_source`, `gad_campaignid`, `dclid`, `srsltid`, `msclkid`, `_ga`, `_gl`
- Social platforms: `fbclid`, `fb_action_ids`, `fb_ref`, `fb_source`, `igshid`, `igsh`, `ttclid`, `twclid`, `li_fat_id`, `yclid`
- Email and marketing: `mc_cid`, `mc_eid`, `_hsenc`, `_hsmi`, `mkt_tok`, `oly_anon_id`, `oly_enc_id`, `vero_id`, `ml_subscriber`, `ml_subscriber_hash`, `elqTrackId`, `elqTrack`, `_openstat`, `vgo_ee`
- Publishers and analytics: `smid`, `s_cid`, `sc_cid`, `cmpid`, `wickedid`, `spm`, `scm`
- Affiliate and click IDs: `irclickid`, `rb_clickid`, `cjevent`, `_branch_match_id`, `click_id`, `clickid`

Parameters that are not on these lists are kept, even when they look like noise. Site-specific rules handle the rest.

#### Fragments

- Remove a text fragment (`#:~:text=...`).
- Remove tracking fragments: `#xtor=...` and a fragment that is itself a known tracking parameter, such as `#fbclid=...`.
- Remove a bare trailing `#`.
- Any other fragment is kept, because it may be an anchor or an in-page route.

Example outcomes:

- `https://example.com/?utm_source=x&keep=1` -> `https://example.com/?keep=1`
- `https://www.google.com/url?q=https://example.com/a%3Futm_medium%3Dmail&sa=D` -> `https://example.com/a`
- `https://example.com/page#:~:text=quoted%20words` -> `https://example.com/page`
- `https://example.com/docs#install` -> `https://example.com/docs#install`
- `https://t.co/AbC123` -> `https://t.co/AbC123`

### Site-specific URL rules

Current custom rules:

- `x.com` links that are not article URLs are rewritten to `fxtwitter.com`.
- `reddit.com` links are rewritten to `redlib.freedit.eu`.
- `youtube.com` and `youtu.be` URLs remove all query parameters, then keep only `v` and `t` when those parameters exist. `v` is the video, `t` is the start time the sender chose, and both are part of what the link means.

Example outcomes:

- `https://example.com/?utm_source=x&keep=1` -> `https://example.com/?keep=1`
- `https://x.com/user/status/42?utm_source=x` -> `https://fxtwitter.com/user/status/42`
- `https://www.youtube.com/watch?v=abc123&utm_source=x&t=90` -> `https://www.youtube.com/watch?v=abc123&t=90`

### Plain-text cleanup

If the text contains exactly one distinct HTTP(S) URL, extract and clean that instead of treating it as plain text.
If the clipboard text is not an `http` or `https` URL:

- replace line breaks with spaces
- collapse repeated whitespace
- trim the result
- if the text has at least two letters and all letters are uppercase, convert it to sentence case

Example:

- `HELLO   WORLD.\nTHIS IS FINE.` -> `Hello world. This is fine.`

## History behavior

- Only cleaned HTTP(S) URLs are stored in history.
- History is saved locally on the user's device.
- Entries expire after 72 hours.
- Invalid or expired entries are discarded before rendering.
- Duplicate URLs are de-duplicated so the newest clean wins.
- History is capped at 100 entries.
- Each item opens in a new tab with safe external-link attributes if a share API isn't available. The link is shared otherwise.

Ordering rules:

- Saved order is newest first.
- Desktop UI renders newest first.
- Mobile UI renders the same data in reverse order and scrolls to the bottom so the newest entry sits closest to the action area.

## Layout and interaction requirements

- Mobile-first presentation is the default.
- On small screens, the hero panel stays fixed near the bottom and the history list scrolls behind it.
- At `960px` and above, the app switches to a two-column desktop layout with history on the left and the primary action panel on the right.
- The settings shortcut sits in the top-right corner on mobile and in the bottom-right corner on desktop.
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
