# High-priority security and privacy findings

Audit date: 2026-08-19

Audit baseline: `6a066f4ef7a915650499a0426cd94b5513934fb7`

This document tracks the security and privacy work that should be completed
before a public package release. Items are ordered by priority. File references
describe the code at the time of the audit and may move as fixes land.

## Device verification (2026-08-19)

Everything below was validated on a real iOS simulator — the `annokit-test`
device (iOS 18.6) running the `rn-harness` dev client against the harness's
AnnoKit Protocol stub — after syncing the packed tarball into
`rn-harness/packages/annotate`. Unit tests cannot reach any of it.

- **Redaction is live and complete.** The harness's own Metro log shows the
  before/after across the sync in one file: `[annokit] GET
  http://localhost:4788/me -> 404` becomes `[annokit] GET localhost:4788
  /me — HTTP 404`. Counted mechanically: ZERO `[annokit]` lines carrying a
  full URL after the redacted build started, out of 1320 log lines.

- **Screenshot release, with a control.** Confirming a capture created
  `tmp/ReactNative/<uuid>.png`; leaving the composer open for 20s left it in
  place (so nothing else on the device is cleaning that directory); tapping
  dismiss deleted it and closed the sheet. Repeated twice with different
  captures. Before this work a leaked capture from an earlier session was
  still sitting in that directory — the bug was real, not theoretical.

- **Release after upload.** Submitting an agent task with the screenshot
  switch ON moved the stub from 3 to 4 pending annotations, wrote a
  252,798-byte PNG server-side, and left the temp directory EMPTY — the
  release fires after the upload completes, which is the ordering the code
  intends.

- **The URL builder against a real server.** The same submit exercised
  `POST /sessions/:id/annotations` and the multipart
  `POST /annotations/:id/screenshot`; both routed correctly and the uploaded
  image is a valid full-size PNG rather than the truncated garbage a
  mis-built multipart part produces.

- **SSE reconnect and give-up** (2026-08-20). Verified against a proxy that
  dropped only the event stream: exactly five attempts at 4/8/16/30s, one
  warning, no sixth attempt, polling continuing throughout. Details in
  [Performance and correctness](./performance-correctness.md).

- **iOS retries each XHR ~3x at the socket level** before surfacing one
  JS-level failure. Not this package's behavior, but it means a server sees
  roughly three times the connection count the client thinks it is making —
  size the rate limits and abuse controls in "Specify server-side validation
  obligations" accordingly.

Not yet device-verified: redirect behavior (needs a redirecting server),
`AppState` background/foreground, and the anchor cadence under real
scrolling.

## P0 — Clean up screenshot files and define URI ownership

Current behavior:

- `src/index.tsx` captures the entire screen whenever a selection is confirmed.
- Capture happens before the user enables the screenshot switch or chooses a
  destination.
- A screenshot is therefore created when the user later cancels, creates a
  text-only team note, leaves the switch off, or hands the capture to a custom
  `onCapture` callback.
- `src/screenshot.ts` does not expose or call `releaseCapture`, so native
  temporary files have no explicit lifecycle.

Risk context: `src/env.ts` makes `__DEV__` an absolute activation gate, so this
does not expose screenshots from production/store builds or ordinary end
users. It can still retain sensitive content from developers' own dev builds,
and repeated captures can accumulate temporary files during a long session.
The undefined cleanup and headless-API ownership are the P0 lifecycle issue.

Work:

- [x] Add a cleanup helper backed by `react-native-view-shot`'s release API.
- [x] Release unused native captures on cancel, team-note submission,
      screenshot-off submission, failed/abandoned flows, and provider unmount.
- [x] Release uploaded captures after the upload has completed.
- [x] Define URI ownership for headless `onCapture` consumers: either the
      package retains cleanup responsibility or the callback receives an
      explicit `releaseScreenshot` helper.
- [x] Add tests covering every exit path and ensuring cleanup runs once.
- [x] Add a short privacy notice explaining that screenshots may contain
      credentials, personal data, notifications, and content outside the
      selected element.

Relevant code: `src/index.tsx` (`openComposer`), `src/screenshot.ts`,
`src/submit.ts`, `src/capture-flow.ts`.

DONE. `releaseScreenshot` in `src/screenshot.ts` wraps view-shot's
`releaseCapture`: null-safe, web-safe (a `data:`/`blob:` capture is memory
the GC owns), safe without the peer installed, and idempotent through a
bounded set of already-released URIs — which is what makes "cleanup runs
once" true rather than merely intended, since the exits legitimately
overlap (a submit releases, and the flow closing behind it releases again).

Released at every exit: `submitAgentCapture` after the upload attempt and
also when the switch was off; `submitCommentCapture`, whose note never
carries one; `closeComposer` for Cancel and the backdrop; the capture
pipeline's own failure path, where nothing downstream ever saw the file;
and the `[configKey]` teardown, which covers both an endpoint change and
unmount-with-a-composer-open. A FAILED submit deliberately keeps the file —
the sheet is still open with the user's words and a retry needs it; the
eventual dismissal releases it.

Ownership for headless hosts is now explicit: `CaptureHelpers` and
`ComposerSlotProps` both carry `releaseScreenshot()`, `dismiss()` releases,
and both submit helpers release for you — documented under "Who owns the
screenshot" in docs/headless-capture.md.

Tests: `test/screenshot.test.ts` (release semantics, double-release, web,
missing peer, a throwing peer, bounded memory) and `test/submit.test.ts`
(after-upload, switch-off, team-note, and the two keep-it-on-failure
cases). README gains "What a screenshot contains".

Definition of done: no abandoned or text-only flow leaves a package-created
native screenshot behind, and a screenshot cannot be uploaded without an
explicit user or host decision.

## P1 — Make eager screenshot capture an explicit product decision

Current behavior: capture happens before the screenshot switch or destination
choice because the composer would otherwise cover the screen. The switch
controls upload, not whether pixels are captured locally. This behavior is
limited to configured development builds by the absolute `__DEV__` gate.

Work:

- [x] Decide whether capture can happen only after explicit screenshot opt-in,
      for example by briefly hiding the composer before capture.
- [x] ~~If eager capture remains necessary, make the distinction between local
      capture and upload clear in the UI and documentation.~~ Moot: eager
      capture is gone.
- [x] Let hosts disable screenshot capture entirely without uninstalling the
      peer dependency.
- [x] Verify that the choice also applies to headless and custom-composer APIs.

Relevant code: `src/index.tsx`, `src/composer.tsx`, `src/capture-flow.ts`.

DECIDED AND DONE, 2026-08-20: **the screenshot is taken when the switch
goes on**, not before the sheet opens. Off now means never captured, rather
than captured and withheld — which is the only version of "off" that is
true on disk.

How it works: confirming an aim no longer captures anything. The composer
draws its Screenshot switch from a new `canScreenshot` fact (peer resolved,
host has not disabled screenshots, server has the route) rather than from
"a shot exists", because keying it to the latter would mean it never
appeared — nothing to flip, so nothing taken, so nothing to flip. Flipping
it on asks the provider, which hides the sheet for two frames (`hidden`,
`visible={!hidden}` rather than unmounting, so the typed text and picked
attachments survive), captures the app underneath, and stores the URI on
the capture. The switch shows a busy state while that happens and says so
if the capture fails, rather than silently attaching nothing.

Headless and custom-composer hosts get the same thing rather than a
different one: `captureScreenshot()` on both `CaptureHelpers` and
`ComposerSlotProps`, documented in docs/headless-capture.md — a host that
never calls it never puts a screenshot on disk.

The cost, stated plainly: the capture now reflects the screen at the moment
you flip the switch, not at the moment you aimed. For the overwhelmingly
common case those are the same screen. The tooltip and README no longer
claim the shot predates the sheet.

DEVICE-VERIFIED (2026-08-20), driven on the `annokit-test` simulator
against the harness stub:

| Step | Captures in `tmp/ReactNative` |
|---|---|
| Aim confirmed, composer open | **0** — was 1 under eager capture |
| Screenshot switch flipped on | **1** |
| Composer dismissed | **0** — released |

The switch is drawn with nothing captured yet, which is `canScreenshot`
doing its job: under the old "a shot exists" rule it could not have
appeared at all. And the captured FILE was inspected, not just the
thumbnail — it shows the app, with the aim highlight and its
`FeedRow · FeedRow.tsx:5` label as context, and NO composer sheet anywhere
in it. The sheet stepped out for the capture and stepped back with the
switch still on and the preview rendered.

Two observations from the run, neither a defect:

- The floating action button DOES appear in the capture. That is unchanged
  from eager capture (the confirm bar was hidden for the shot; the FAB
  never was), so it is pre-existing rather than a regression — but taking
  the shot while the composer is up makes it more visibly a choice. Worth
  deciding separately whether the FAB should hide for the capture too.
- Flipping the switch off and on again does not re-capture; the existing
  URI is reused, so one capture means one file, and the exits still release
  it.

Definition of done: developers can understand and control when a local
screenshot is created, separately from whether it is uploaded.

## P0 — Redact capability URLs from transport logs

Current behavior:

- The endpoint may be an unguessable capability URL whose path or query is a
  credential.
- `src/settings-view.ts` deliberately shows only the host for that reason.
- `src/transport.ts` logs the complete request URL on HTTP, network, and upload
  failures.

Risk: credentials can appear in Metro, device, CI, crash-reporting, or shared
support logs.

Work:

- [x] Centralize log formatting in a small logger/redaction utility.
- [x] Log only method, sanitized host, stable route label, status, and a safe
      error category.
- [x] Remove userinfo, path capabilities, query strings, fragments, bearer
      tokens, request bodies, and raw response bodies.
- [x] Avoid logging raw error objects when a runtime may attach request data.
- [x] Add tests using endpoints with userinfo, secret paths, and query tokens.
- [x] Document what diagnostic data the package emits.

Relevant code: `src/transport.ts`, `src/settings-view.ts`.

Definition of done: tests prove that configured secrets and capability
components never appear in logs, including failure paths.

DONE. `src/log.ts` owns redaction (`endpointHost`, `routeLabel`,
`requestLabel`, `errorCategory`, `warnRequestFailed`) and is the only thing
the transport prints through; `src/settings-view.ts` re-exports
`endpointHost` from it so both surfaces apply one rule. A failure line is
now `[annokit] GET host /sessions/:id/pending — HTTP 500`. Route labels
come from an allowlist of protocol words, so an unrecognised segment
degrades to `:id` rather than being printed. `test/log.test.ts` and the "log
redaction" block in `test/transport.test.ts` assert absence of the
capability path, query token, userinfo, bearer and session id across every
failure path, error objects included. README: "What the package logs".

## P1 — Add timeouts, cancellation, and stale-request protection

Current behavior:

- JSON requests use bare `fetch` without a timeout or abort signal.
- A hung health check can leave activation unresolved indefinitely.
- A hung submit can leave the composer or queue stuck in a busy state.
- Only multipart upload currently has a timeout.
- Requests started for an old endpoint or session are not actively cancelled.

Work:

- [x] Add a central request timeout using `AbortController`.
- [x] Choose documented defaults for handshake, reads, mutations, and uploads.
- [x] Allow a host to override timeouts if necessary.
- [x] Abort requests when the provider unmounts or endpoint/session config
      changes.
- [x] Use a runtime generation/request ID so late responses cannot update a
      newer configuration.
- [x] Apply sequencing to pending, route-scoped comments, all comments, and
      open-detail reads so a slower older response cannot replace newer data.
- [x] Coalesce identical in-flight reads where practical.
- [x] Preserve optimistic mutation rules while rejecting stale refreshes.
- [x] Internally distinguish timeout, cancellation, network, HTTP, and invalid
      JSON failures while keeping the public fail-soft behavior.
- [x] Add tests for never-resolving fetches, aborts, and late responses.

Relevant code: `src/transport.ts`, `src/index.tsx`, `src/handshake.ts`.

PARTIALLY DONE — the transport half has landed, the runtime half has not.

Done: every request now carries an `AbortController` ceiling
(`DEFAULT_TIMEOUTS` = read 10s / mutate 15s / upload 30s, the handshake
riding the read ceiling), overridable per-host through the provider's new
`timeouts` prop. `AnnoKitTransport.dispose()` aborts everything in flight
and refuses to start anything new; `src/index.tsx` disposes the previous
transport when `env` changes and on unmount, so endpoint A's reads cannot
land after endpoint B is active. Timeout, cancellation, network and HTTP
failures are distinguished internally and reported as separate categories.
Tests cover never-resolving fetches, abort-mid-flight, per-method refusal
after dispose, and lingering-timer leaks.

Sequencing has since landed too — see "Isolate endpoint and session
changes" below.

UPDATE: the open-detail read is sequenced too. `src/thread-view.tsx` takes
a ticket per read and drops stale answers whole — `gone` included, since
"it was deleted a moment ago" is not news about now. Three things drive
that read (the open effect, the backstop timer and any server event) and
they routinely overlap, so an older answer could otherwise put back a
status the agent had since changed, or a thread missing the reply that had
just arrived. The sequencer resets when the pane changes subject.

Still open: distinguishing invalid-JSON from other failures internally.

Definition of done: no request can leave the UI busy forever, and an old
request cannot update or disclose data into a new endpoint/session runtime.

## P1 — Define and test redirect behavior for authenticated requests

Current behavior: the transport does not state a redirect policy. This is a
cross-platform consistency gap rather than a confirmed cross-origin bearer
replay in the audited stack:

- React Native 0.86.2 on iOS rebuilds redirect headers from cookies in
  `RCTHTTPRequestHandler.mm`, dropping the explicit bearer header.
- React Native 0.86.2's Android dependency is OkHttp 4.9.2, which removes
  authorization when a redirect cannot reuse the original connection but can
  retain it for same-origin redirects.
- Browser Fetch also strips authorization on cross-origin redirects.

The practical risks are relying on runtime-specific behavior, unexpected auth
failure after redirects, and future regressions in a security-sensitive path.

Work:

- [x] Decide whether protocol endpoints may redirect at all; preferring direct,
      final HTTPS endpoints is the simplest contract.
- [x] Reject origin or scheme changes before sending credentials where the
      runtime exposes enough control.
- [x] Do not assume `redirect: "manual"` works consistently across React Native
      fetch and XHR; verify every supported platform.
- [ ] Test same-origin, cross-origin, HTTP-to-HTTPS, HTTPS-to-HTTP, and redirect
      loop behavior for JSON fetch, multipart XHR, and SSE XHR.
- [x] Document the supported redirect contract for server implementers.

Relevant code: `src/transport.ts`, `src/events.ts`, React Native 0.86.2
`Libraries/Network/RCTHTTPRequestHandler.mm`, OkHttp 4.9.2
`RetryAndFollowUpInterceptor.kt`.

References:

- Fetch redirect algorithm: https://fetch.spec.whatwg.org/#http-redirect-fetch
- OkHttp 4.9.2 redirect implementation: https://github.com/square/okhttp/blob/parent-4.9.2/okhttp/src/main/kotlin/okhttp3/internal/http/RetryAndFollowUpInterceptor.kt

PARTIALLY DONE. The contract is now decided and enforced on the fetch
paths: a protocol endpoint is expected to be the FINAL URL, and a response
whose origin differs from the request's — scheme changes included, so an
https→http downgrade is refused — is dropped fail-soft with
`refused: cross-origin redirect`. Checked after the fact via `res.url`
rather than `redirect: "manual"`, which RN's fetch implementations do not
honour consistently; a runtime that leaves `res.url` empty makes the check
abstain rather than break every request. `src/url.ts` `originOf`/`sameOrigin`
+ tests in `test/url.test.ts` and the "redirect policy" block in
`test/transport.test.ts`. README: "What the package logs".

UPDATE: the guard now covers all three transports. `sameOriginOrUnknown`
in `src/url.ts` is the single predicate, shared by the fetch path, the
multipart XHR (`responseURL` on load) and the SSE stream (`responseURL` on
first drain — which aborts and gives up rather than reconnecting into
someone else's stream), so the three cannot drift apart. A runtime that
omits the final URL makes the check abstain rather than fail every request.

Still open: the per-platform verification matrix. The claims about
iOS/OkHttp/browser behavior above are from reading their source, not from a
device test against a redirecting server.

Definition of done: redirect handling and bearer retention/stripping are
intentional, consistent with the documented contract, and covered on every
supported platform.

## P1 — Isolate endpoint and session changes

Current behavior: when `endpoint`, `sessionId`, or token props change, a new
transport is created but existing runtime state remains enabled while the new
handshake runs. The previous effective session ID, pending tasks, comments,
open panes, anchors, server flavor, viewer, and negotiated protocol version can
remain visible or active during the transition.

Risk: a previous session identifier may be sent to a new endpoint, and data
from one server or tenant can be displayed under another configuration.

Work:

- [x] Disable the runtime immediately when endpoint-scoped config changes.
- [x] Reset effective session ID and all server-derived UI state.
- [x] Close open sheets and clear live anchors.
- [x] Reset negotiated protocol flavor/version and viewer state.
- [x] Abort the old event stream, polls, and in-flight requests.
- [x] Complete the new handshake before starting reads or server push.
- [ ] Add a test that switches between two endpoints with delayed responses.

Relevant code: `src/index.tsx`, `src/agentation.ts`, `src/handshake.ts`,
`src/viewer.ts`, `src/anchor-registry.ts`.

DONE, with the mounted test still owed.

`src/sequence.ts` is the new pure core: `createSequencer()` (responses are
applied in ISSUE order, never arrival order; `reset()` invalidates
everything in flight at once) and `configKey()` (endpoint + sessionId +
token, length-prefixed so no field can smuggle a delimiter and hide a
config change).

`src/index.tsx` resets on a config change DURING RENDER rather than in an
effect — an effect-based reset commits one frame of the old server's
markers, panes and task detail under the new endpoint first, and lets the
`enabled`-gated effects fire a read against it. The adjustment drops
`enabled` first (it gates every read, poll and push subscription), then the
effective session id, both comment lists, the pending list, every open
sheet/pane/marker seed, and the in-progress aim. A `[key]`-scoped effect
clears the module singletons — `forgetServerFlavor`, `forgetProtocolVersion`,
`clearScrollAnchors` — on the same transition and on unmount, and the
existing viewer effect already reset identity. The old transport is
disposed (aborting in-flight requests) by the effect added with the
timeouts work, and `enabled: false` tears down the old event stream and
polls. Reads only resume when the new handshake sets `enabled` again.

All three list reads (`refreshPending`, `refreshComments`,
`refreshAllComments`) now take a ticket before they start and present it
before they write state, so a slow read for the previous endpoint — or the
previous ROUTE, since the comments callback is rebuilt per route — is
dropped instead of drawn. Optimistic mutation paths are untouched: they
write state directly and never present a ticket.

Still owed: the mounted "switch between two endpoints with delayed
responses" test. It needs a rendered component tree, which the suite cannot
do yet — tracked as "Expand tests across actual package and native
boundaries" in the open-source readiness doc. The pure ordering core it
depends on is covered by `test/sequence.test.ts` (15 cases, including the
endpoint-swap interleaving and the delimiter-collision that would silently
skip a reset).

Definition of done: endpoint A data and identifiers are never rendered or sent
after endpoint B becomes the active configuration.

## P1 — Centralize safe URL construction

Current behavior:

- Some comment and annotation route helpers encode IDs correctly.
- Pending and submission routes interpolate session IDs directly.
- The screenshot route interpolates an ID returned by the server directly.
- Routes are appended with string concatenation, which is unreliable when a
  capability endpoint contains a query string or fragment.

Work:

- [x] Add one URL builder for base endpoints, routes, and query parameters.
- [x] Encode every dynamic path segment, including session and annotation IDs.
- [x] Preserve capability query parameters without corrupting route paths.
- [x] Reject or normalize fragments and malformed endpoints.
- [x] Test slashes, spaces, Unicode, `%`, `?`, `#`, userinfo, IPv6, and existing
      base queries.
- [x] Reuse the same builder for fetch, upload, and event-stream URLs.

Relevant code: `src/transport.ts`, `src/events.ts`, `src/index.tsx`,
`src/submit.ts`, `src/comments.ts`, `src/thread.ts`, `src/pending.ts`.

DONE. `src/url.ts` is the one builder: `joinUrl` puts the route on the PATH
and merges the endpoint's query with the route's own (so
`https://h/cap?k=secret` + `/health` is now
`https://h/cap/health?k=secret`, not the old
`https://h/cap?k=secret/health`), and drops fragments from both sides.
`seg()` encodes every dynamic segment; the four hand-interpolated
session/annotation routes are now `sessionAnnotationsPath`,
`sessionPendingPath`, `sessionEventsPath` and `annotationScreenshotPath`,
used by `src/submit.ts`, `src/index.tsx`, `src/message-task.ts` and
`src/events.ts` (the SSE URL included). `test/url.test.ts` covers slashes,
spaces, Unicode, `%`, `?`, `#`, userinfo, IPv6, traversal ids and base
queries.

Definition of done: callers cannot change the intended route through an ID,
and capability parameters survive route construction without being logged.

## P1 — Document and enforce the client trust model

Current behavior: the package accepts `EXPO_PUBLIC_ANNOKIT_TOKEN`, permits
HTTP endpoints, and documents unauthenticated capability endpoints. The root
`.gitignore` ignores only `node_modules/` and `package-lock.json`.

Work:

- [x] Ignore `.env`, `.env.*`, local credential files, and allow a sanitized
      `!.env.example` if one is added.
- [x] State plainly that `EXPO_PUBLIC_*` values are embedded in the client and
      must not be treated as long-lived secrets.
- [x] Recommend short-lived, scoped, revocable credentials.
- [x] Require HTTPS by default, with an explicit localhost/development escape
      hatch.
- [x] Document that the `__DEV__` gate prevents store activation but does not
      protect data sent from development builds.
- [x] Add a security configuration section to the README.

Relevant code: `.gitignore`, `src/env.ts`, `README.md`.

DONE, as README "Security configuration".

States plainly that `EXPO_PUBLIC_*` values are inlined into the bundle by
Metro and can be read out of the app — as can the `token` prop, because
there is no safe place in a client for a long-lived secret. Recommends
short-lived, narrowly scoped, revocable credentials, and notes that the
same rules apply to a capability URL because it IS the credential.

HTTPS is recommended rather than enforced, with the reason stated: a local
stub on `http://localhost:4788` is the normal development case and refusing
it would break every harness. The cross-origin and downgrade refusals
already in the transport are cross-referenced.

The `__DEV__` paragraph draws the line the audit asked for: the gate is
absolute and no prop or variable can activate the overlay in a production
bundle, but it protects the STORE BUILD, not the data — a dev build pointed
at a real endpoint uploads real screenshots to whoever can read that
server.

Definition of done: a new adopter can configure the package without assuming
that a public environment variable is secret or accidentally committing one.

## P1 — Specify server-side validation obligations

The client is not a security boundary. A public protocol should explicitly
require servers and downstream agents to treat all annotation content,
references, identities, and uploads as untrusted.

Work:

- [x] Require authentication and authorization on every applicable session,
      annotation, comment, thread, upload, and send operation.
- [x] Require request, text, list, attachment, and SSE frame size limits.
- [x] Require screenshot MIME/content verification rather than trusting the
      filename or client-provided type.
- [x] Require rate limiting and abuse controls.
- [x] Require servers with authentication to ignore client `authorName` hints.
- [x] Require reference URL allowlists and SSRF defenses before a server or
      agent resolves `url`, `api`, or custom reference types.
- [x] Document retention, deletion, audit, and access policies for screenshots
      and team conversations.
- [x] Add conformance tests for rejected malformed and oversized payloads.

Relevant documentation: `README.md` protocol section,
`docs/extending-attachments.md`.

DONE, as README "Server obligations" — normative prose in the place
implementers actually read, rather than a separate document the published
package would not even ship (`files` omits `docs/`).

Eight requirements, each with the reason it exists: authorize every
operation and never from an identifier; bound every input; verify uploaded
screenshots by content rather than by the caller's claim; ignore
`authorName` once authenticated; rate limit per session and per principal;
treat every reference as hostile and defend against SSRF; and have a
retention, deletion and access policy.

Two things carried in from this audit's own findings. The ID section states
plainly that ids are identifiers and never capabilities, and explains why:
they are client-generated, and Hermes guarantees no cryptographic source,
so treating an id as authorization makes the `Math.random` fallback the
authorization story. The rate-limiting section carries the device finding
that iOS retries an XHR ~3x at the socket level, so a server sees roughly
three times the connections this client believes it is making — a limit
tuned to the client's arithmetic trips at a third of the intended traffic.

The conformance box is answered as a table of ten requests a compliant
server must reject, each one something this client can be made to send by
anything that is not this client. It is a specification for someone else's
test suite; this package cannot run it.

Definition of done: protocol implementers receive explicit, testable security
requirements instead of inferring them from client behavior.

The retention requirement is stated the way it is because the client stores
NOTHING — it captures, uploads, deletes its temp file, and keeps no copy,
cache or index (README, "Where a screenshot lives"). That is a deliberate
boundary, not an omission: where a screenshot lives and who may read it are
policy calls about an adopter's own data on their own infrastructure, and a
dev-tooling client picking defaults for them would be the wrong party
deciding.

## P2 — Bound user and server-controlled content

Current behavior: annotation text, replies, task instructions, attachment
items, references, and SSE data do not have consistent size limits.

Work:

- [x] Define protocol maximums for all string and collection fields.
- [x] Add `TextInput` limits with visible remaining/error feedback where useful.
- [x] Clamp or reject oversized attachment-source results and references.
- [x] Cap SSE parser buffers and individual frames. DONE — plus the
      cumulative `responseText` ceiling on the streaming XHR itself; see
      [Performance and correctness](./performance-correctness.md), "Make SSE
      connection termination idempotent".
- [x] Keep the stricter enforcement on the server; client limits are UX and
      resilience, not authorization.
- [x] Add boundary and over-limit tests.

Relevant code: `src/composer.tsx`, `src/comment-view.tsx`,
`src/thread-view.tsx`, `src/attachments.ts`, `src/events.ts`.

MOSTLY DONE. `src/limits.ts` holds the maximums (`TEXT_MAX` 4000,
`AUTHOR_NAME_MAX` 80, `REFERENCES_MAX` 20, `ATTACHMENT_ITEMS_MAX` 200,
`FIELD_MAX` 2000) plus `clampText`/`clampList`/`withinLimit`. `clampText`
counts by code POINT, so truncation never splits a surrogate pair into a
lone half — the route by which a cut emoji becomes a replacement character
or a JSON encoding error downstream.

Applied: `maxLength` on all four composer/reply/task inputs; attachment
source results trimmed in both count and per-item strings (a source is host
code reading a server, and neither end is trusted to be bounded); and
`buildReferences` bounded on the way out, since a headless host can pick
programmatically. SSE parser and stream bounds landed earlier.

The numbers are deliberately generous — the point of a cap is that it
exists, not that it pinches — and the file says plainly that none of this
is a security control: a client limit is trivially bypassed by anything
that is not this client.

Still open: visible remaining/over-limit FEEDBACK in the UI (the inputs
stop accepting silently at the cap), and the server-side enforcement that
actually matters, which lives in the server-obligations item.

Definition of done: oversized or unterminated input cannot grow memory or block
the overlay without a deterministic failure path.

## P2 — Use a deliberate logging policy and verbosity control

Current behavior: logging is spread across transport, handshake, marker,
re-anchoring, screenshot, router, shake, and inspector modules. Several
`console.log` calls report routine registration or measurement activity, and
`src/screenshot.ts` logs a rejected local web capture URI. The URI is not the
same capability-credential exposure as the P0 transport finding, but local
paths and high-volume diagnostics still do not belong in default logs.

Work:

- [x] Route all output through one logger with `error`, `warn`, `info`, and
      `debug` levels.
- [x] Default to actionable warnings; require an explicit diagnostics option
      for anchor registration, re-measurement, and compatibility details.
- [x] Apply redaction rules to every level, including local file and blob URIs.
- [x] Prevent repeated failures from flooding logs; aggregate or warn once.
- [x] Add tests for level filtering, redaction, and repeated-event suppression.

Relevant code: `src/transport.ts`, `src/handshake.ts`, `src/markers.tsx`,
`src/reanchor.ts`, `src/anchor-registry.ts`, `src/screenshot.ts`.

MOSTLY DONE.

The seven unconditional `console.log` calls are now `debugLog` /
`debugLogOnce` in `src/log.ts`, off by default and enabled by the
provider's new `debug` prop or `EXPO_PUBLIC_ANNOKIT_DEBUG=1`. Failures
stay on `console.warn` and are always shown — the split is
"failure vs diagnostic", not a severity ladder.

`debugLogOnce` exists because the worst offender was not volume per se but
a STEADY STATE reported as an event: a mark whose stored testID matches a
differently-sized element is correctly refused by the wrong-element guard,
and that refusal was re-logged on every list refresh for as long as the
screen stayed open. A harness session accumulated 895 copies of that one
line. It is now said once per mark, and only when diagnostics are on.

Redaction gaps closed with it: `src/screenshot.ts` logged a rejected web
capture URI (now the scheme only — the useful half — with the device path
withheld) and `src/router.ts` logged a raw error object (now a category).

Measured on device: after re-syncing and relaunching, the 25 seconds
following launch produced exactly ONE `[annokit]` line, and it was a real
warning (`GET localhost:4788 /me — HTTP 404`, the stub having no /me
route). The same window previously carried a steady stream of re-anchor
and registration lines.

UPDATE: repeated failures are now aggregated too. `warnRequestFailed`
prints the same failure at occurrences 1, 2, 4, 8, 16 … with a count — a
poll against a down server used to warn every 30 seconds forever — and a
DIFFERENT failure resets the streak, because the change is the news.
Malformed bodies are now their own reported category ("invalid JSON in
response") rather than being silently indistinguishable from no answer,
which is what made an HTML error page from a proxy hard to tell from a
dropped connection.

Still open: there is no four-level `error/warn/info/debug` enum, and the
remaining `console.warn` call sites outside the transport still print
directly rather than through a single injectable sink, so a host cannot
redirect or silence them. Two tiers plus aggregation cover every current
call site; the enum would be scaffolding until someone needs it.

Definition of done: normal use emits no high-volume informational logs, and no
log level exposes credentials, local paths, request bodies, or user content.

## P2 — Strengthen client-generated IDs without treating them as authorization

Current behavior: `makeId()` uses `crypto.randomUUID()` when available and
falls back to a UUID-shaped value generated with `Math.random()`. The fallback
is not cryptographically unpredictable and has weaker collision guarantees.

Work:

- [x] Prefer a supported cryptographic random source on every target runtime.
- [x] If a non-cryptographic compatibility fallback remains, document and
      isolate it, and have the server reject collisions safely.
- [x] State in the protocol that annotation IDs are identifiers, never
      capabilities or authorization decisions.
- [ ] Ensure every read and mutation is authorized independently of ID
      guessability.
- [x] Test missing/throwing crypto implementations and collision handling.

Relevant code: `src/transport.ts` (`makeId`), `src/submit.ts`, protocol docs.

PARTIALLY DONE — the client half.

`makeId()` now has three tiers instead of two: `crypto.randomUUID()`, then
`crypto.getRandomValues()` formatted into a v4 by hand (the tier that
matters in practice — many RN apps already ship
react-native-get-random-values for other libraries), then `Math.random()`.
Hermes guarantees none of them, so the last tier stays; it is documented at
the function as producing ids that are "unguessable-ish, not unguessable",
with the RFC 4122 version/variant bits applied whatever the byte source
returned. Tested: each tier, a throwing crypto at either tier, the bit
fixups against an all-zero source, and 2000 ids without a collision.

Still open: the two server-side boxes. Nothing in this package can make a
server authorize reads and mutations independently of id guessability —
that belongs with the server-obligations item.

Definition of done: supported runtimes generate collision-resistant IDs, and
server security never depends on an identifier being secret or unpredictable.
