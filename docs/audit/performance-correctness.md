# Performance and correctness findings

Audit date: 2026-08-19

Audit baseline: `6a066f4ef7a915650499a0426cd94b5513934fb7`

This document tracks runtime behavior that can cause unnecessary work,
cross-instance interference, inconsistent results, or failures that the
current pure-logic test suite cannot expose.

Transport timeouts, stale-response sequencing, and response-size bounds have a
single home in [High-priority security and privacy](./high-priority-security-privacy.md)
so their priority and completion criteria cannot drift between checklists.

## P1 — Replace continuous 150 ms anchor measurement polling

Current behavior:

- `src/markers.tsx` measures every visible registered anchor every 150 ms while
  the marker layer is active and not paused.
- Each anchor can cause both an element and viewport native measurement.
- The anchor registry permits up to 200 live entries.
- Polling continues while the screen is otherwise stable and does not check
  application foreground/background state.

Impact: a screen with many markers can generate hundreds or thousands of
native measurements per second, consuming JS/native bridge time and battery in
the host application.

Work:

- [ ] Make host-reported scroll/layout events the primary update mechanism.
- [x] Stop polling when the overlay is hidden, the app is backgrounded, the
      route is inactive, or there are no interactive visible markers.
      (Overlay hidden, backgrounded and no-markers are done; "route
      inactive" is not — the layer does not know about inactive routes.)
- [x] Back off aggressively after anchors remain stable.
- [x] Use a short burst only after capture, navigation, layout change, or a
      scroll-settle event.
- [x] Measure only markers intersecting the current viewport.
- [ ] Consider an explicit host integration for lists whose movement cannot be
      observed reliably.
- [ ] Add measurement-count tests and a device benchmark with 1, 20, and 200
      markers.

Relevant code: `src/markers.tsx`, `src/anchor-registry.ts`,
`src/scroll-reporter.ts`.

PARTIALLY DONE — the cadence, not the targeting.

The loop is now a self-scheduling timeout whose delay is chosen after each
measurement from what it found (`nextAnchorDelay` / `anchorsSettled` in
`src/anchor-registry.ts`, pure and tested). A screen where everything has
held still for `ANCHOR_STABLE_TICKS` drops from 150ms to a 2s heartbeat —
about a 13x reduction, so twenty marks go from ~270 native measurements a
second to ~20 — and snaps back to 150ms the moment any measurement differs.

It does NOT stop entirely when settled, deliberately: not everything that
moves an element announces itself (an animation, a layout pass, the
keyboard, or simply a host that never calls `reportAnnoKitScroll`), and a
loop that stopped would leave those marks stranded with no way to notice.
The heartbeat is the floor that makes the whole scheme self-correcting.

Also landed: the loop stops completely while the app is backgrounded or
inactive (`AppState`, through the same guarded require the other optional
RN surfaces use, so a node test or SSR host is unaffected), and a reported
scroll cancels the pending tick so the settle measurement decides the next
cadence rather than racing it. An unmeasurable anchor counts as settled for
cadence purposes — it is not being drawn, so it must not hold the whole
screen at speed; the heartbeat still retries it.

UPDATE: measurement is no longer all-or-nothing. `idsNearViewport` filters
the idle heartbeat to anchors last seen within a screen-ish margin of the
window, so a 200-marker session measures a handful rather than all 200.

The chicken-and-egg — knowing whether a marker is on screen needs a
position, and getting a position is the expensive thing — is resolved with
the LAST KNOWN fix: a marker does not teleport, and everything that moves
one (a scroll settle, the first pass after the watch list changes) asks for
a FULL measurement, so a stale skip self-corrects within one interval. An
id with no fix yet, or one that measured as gone, is always measured:
never-measured is not the same as far-away. A nonsense window height fails
OPEN — measure everything — because failing closed would silently stop
placing markers.

Still open: the numbers here remain arithmetic from the constants rather
than a device benchmark, and the measurement-count and 1/20/200-marker
benchmarks belong with the runtime performance budgets item below.

Definition of done: a stable foreground screen reaches near-zero anchor
measurement work, with documented bounds during scrolling and settling.

## P1 — Make SSE connection termination idempotent

Current behavior: the event stream's `ended()` function can be called by both
`readystatechange` at `DONE` and `onerror`. There is no per-connection settled
guard, so one failed XHR can increment failure state twice and schedule more
than one reconnect.

Impact: duplicate live streams, duplicated refresh traffic, premature fallback
to polling, and a reconnect cascade on runtimes that fire both callbacks.

Work:

- [x] Add a per-XHR `ended`/`settled` boolean.
- [x] Clear handlers or ignore callbacks after the first terminal event.
- [x] Keep at most one reconnect timer and one active XHR.
- [x] Abort the previous XHR before replacing it defensively.
- [x] Add tests where `DONE`, `onerror`, and stop happen in different orders.

SSE buffer and frame bounds are tracked with the other untrusted-content limits
in [High-priority security and privacy](./high-priority-security-privacy.md).

Relevant code: `src/events.ts`, `test/events.test.ts`.

DONE. Each connection now carries a `settled` flag and finishes through one
`finish()` path that clears the previous reconnect timer before scheduling
the next, so the invariant is held by two independent mechanisms rather
than by luck. `discard()` nulls both handlers and aborts, and `connect()`
discards any existing XHR before replacing it; `stop()` uses the same
helpers, so it leaves zero live XHRs and zero timers.

The defect this fixes was not only duplicate reconnects: one dead
connection reported through both `DONE` and `onerror` counted TWO failures,
so the give-up threshold arrived at half the attempts it advertises.
`test/events.test.ts` drives DONE-then-error, error-then-DONE, stop before
and after a terminal callback, double stop, and a late chunk on a settled
connection — through callbacks captured BEFORE settling, so the test proves
the guard rather than the handler-clearing.

Also landed here, from the untrusted-content bounds in
[High-priority security and privacy](./high-priority-security-privacy.md):
`responseText` on a streaming XHR is CUMULATIVE for the life of the
connection, so a session-long stream is an unbounded server-fed buffer. It
is now recycled at a 4MB ceiling (abort, reconnect, fresh empty string —
costing one reconnect and no events, since events only trigger re-reads),
and the parser drops an unterminated frame past 256KB rather than
accumulating it. The stream's open-failure log is redacted through
`src/log.ts` like the transport's.

DEVICE-VERIFIED (2026-08-20), on the `annokit-test` simulator against the
harness stub:

- **Recovery.** Killing the stub mid-session dropped the stream; the app
  reconnected on its own ~15s later (consistent with the 2→4→8s backoff)
  and the stub's own counter reported `EVENTS stream opened (1 total)` — one
  stream, not a duplicate pair.

- **The give-up counter, which is the bug this item is about.** With a
  proxy that let the handshake through but dropped only `/events`, the app
  made EXACTLY FIVE connection attempts, spaced 4s / 8s / 16s / 30s, then
  warned once and stopped. That is `MAX_CONSECUTIVE_FAILURES` with the
  doubling-capped backoff. Before the fix one dead connection counted two
  failures, so give-up arrived at roughly three attempts. No sixth attempt
  followed in the next 93 seconds, and `/comments` polling continued
  throughout — "leaving the polls in charge", as designed.

NEW FINDING, worth knowing beyond this item: **iOS retries each XHR about
three times at the socket level** before surfacing a single JS-level
failure. Every JS attempt above appeared as a cluster of three connections
9ms apart, and the same tripling showed on `/comments`. It is the platform's
networking stack, not this package — one JS failure, one warning, one
reconnect — but it means a server sees ~3x the connection count this client
believes it is making, which matters for the rate-limiting and abuse-control
obligations in
[High-priority security and privacy](./high-priority-security-privacy.md).

Definition of done: one connection attempt can produce at most one reconnect,
and stopping always leaves zero active XHRs and timers.

## P1 — Remove cross-provider module-global state

Current behavior: server flavor, negotiated protocol version, viewer identity,
preferences, event listeners, and live anchors are held in module-level
singletons. Some are reset for tests or server swaps, but they are not owned
and cleaned up consistently by one provider instance.

Impact:

- Two providers can change one another's server flavor, identity, preferences,
  or refresh behavior.
- A server event for one session is broadcast to every listener.
- Provider unmount can retain up to 200 live Fiber references in the anchor
  registry.
- Fast refresh and endpoint changes can preserve state longer than expected.

Work:

- [x] Scope anchors to the provider and clear them on unmount/session change.
- [x] If only one provider will be supported, detect additional providers and
      emit one actionable development warning.

Superseded by the decision below — this item offered two resolutions and the
second was taken:

- ~~Move server flavor and negotiated version into the provider runtime.~~
- ~~Scope the event emitter to one endpoint/session.~~
- ~~Scope viewer and preferences to one provider, or intentionally expose a
  separately created store instance.~~
- ~~Add mounted tests for two providers connected to different fake servers.~~
- [ ] Add a mounted test asserting the multi-provider warning fires, once a
      renderer exists (replaces the two-provider test above).

Relevant code: `src/agentation.ts`, `src/handshake.ts`, `src/events.ts`,
`src/prefs.ts`, `src/viewer.ts`, `src/anchor-registry.ts`, `src/index.tsx`.

DECIDED, 2026-08-20: **one provider, at the app root, is the supported
model.** This item explicitly offered that as an alternative to scoping —
"if only one provider will be supported, detect additional providers and
emit one actionable development warning" — and that is the path taken.

The reasoning, recorded so it is not relitigated: the overlay is app-wide
chrome, like a status bar; two mounted at once is not a shape anyone builds,
and the package now says so out loud when it happens. Scoping the remaining
singletons would touch 11 `serverFlavor()` call sites across six files
including `submit.ts`, whose `SubmitCaptureContext` is public headless API,
with no rendering tests to catch a mistake — real destabilisation risk in
exchange for correctness in a configuration the package tells you not to
create.

What was genuinely broken for the NORMAL single-provider case is fixed and
stays fixed (below). If nested or side-by-side providers are ever wanted,
this decision is the thing to revisit first.

DONE — the lifecycle half, which is what single-provider use needs.

Done: the singletons are now CLEARED on an endpoint/session change and on
unmount (`forgetServerFlavor`, `forgetProtocolVersion`,
`clearScrollAnchors` from a `[configKey]`-scoped effect in `src/index.tsx`,
alongside the existing `forgetViewer`), so a provider no longer leaves its
server's flavour, negotiated version or up-to-200 live Fiber references
behind it. A second mounted provider now emits one actionable development
warning naming exactly what the two of them share. The stale-response half
of this problem — a server event for one session refreshing another's
lists — is bounded by the read sequencers described under "Isolate endpoint
and session changes" in
[High-priority security and privacy](./high-priority-security-privacy.md).

Accepted and documented, not fixed: these remain module-level, so two
providers mounted AT THE SAME TIME would share and overwrite server
flavour, negotiated version, viewer identity, preferences, event listeners
and anchors. The warning names exactly what they would share. That is the
supported contract, not an outstanding defect.

Definition of done (as decided): a single provider's state and events
cannot leak across an endpoint or session change, unmount releases all
retained runtime references, and a second provider is detected and
reported rather than silently supported.

## P2 — Make host RegExp filters deterministic

Current behavior: `skipComponents` calls `RegExp.test` directly. Expressions
with the global (`g`) or sticky (`y`) flag mutate `lastIndex`, so repeated
checks of the same component can alternate between match and no match.

Work:

- [x] Reset `lastIndex` before and after each test, or clone expressions without
      stateful flags.
- [x] Test global, sticky, case-insensitive, and ordinary expressions.
- [x] Document whether matching is against raw names, unwrapped names, or both.

Relevant code: `src/inspector.ts` (`matchesExtra`),
`test/inspector.test.ts`.

DONE. `testFilter` in `src/inspector.ts` neutralises the `g`/`y` flags,
saving and RESTORING `lastIndex` rather than merely resetting it: the
expression belongs to the host app and may be mid-iteration somewhere else,
so this must not be the thing that moves its cursor.

The answer to the third question is BOTH — a filter is tested against the
raw display name and the R6-unwrapped one — and that is now documented at
`matchesExtra`, because it is also why the bug was easy to miss. When the
two spellings are equal the second test restarts from index 0 and matches,
masking the moving cursor entirely. It only shows when a filter matches
just the wrapper spelling: `/Memo\(/g` against `Memo(FeedRow)` returned
null, FeedRow, null, FeedRow on successive calls — a component's identity
appearing and disappearing as the overlay re-inspected it. The tests are
written around that case, and four of them fail against the unfixed code.

Definition of done: the same name and filter always produce the same result,
regardless of prior calls.

## P2 — Add rendered accessibility correctness coverage

Current behavior: many controls have thoughtful accessibility labels, but
several `Pressable` elements lack roles, selected/checked/disabled states, or
button semantics. Pure logic tests cannot verify the rendered accessibility
tree.

Work:

- [x] Give actionable controls an appropriate `accessibilityRole`.
- [x] Expose `accessibilityState` for selected, checked, expanded, disabled,
      busy, and tab states.
- [x] Mark decorative icons and duplicate text appropriately.
- [ ] Verify focus behavior when modals open/close and when navigation lands on
      a marker.
- [ ] Add React Native Testing Library assertions for the major flows.
- [ ] Run VoiceOver and TalkBack smoke tests at large text sizes.

Relevant code: `src/aim-overlay.tsx`, `src/fab.tsx`, `src/queue.tsx`,
`src/notes.tsx`, `src/composer.tsx`, `src/attach-panel.tsx`,
`src/settings.tsx`.

SEMANTICS DONE; the rendered tree and the real screen readers are not.

Every `Pressable` in the package now declares a role or is explicitly
hidden from assistive technology — 61 of them, where 31 carried a role
before and whole surfaces (the floating button, the aim confirm bar, the
attach panel, the notes list, the markers) had none. Roles were chosen per
control rather than sprayed on: the attach tabs are `tab` with `selected`,
the attach rows and queue checkboxes are `checkbox` with `checked`, and a
chat bubble is `text` with a hint, because announcing the message itself as
a button would promise a tap action that does not exist.

State followed the same rule — declared wherever appearance already carried
it. Every control that dims when disabled now says `disabled`, which was
the sharpest gap found: a dimmed-but-unannounced control is exactly the
"why did nothing happen" bug for a screen-reader user. In-flight commits
also report `busy`.

`test/accessibility.test.ts` keeps it that way. It parses the source
brace-aware (so a `>` inside a `{...}` expression does not end a tag early)
and fails with the file and line of any control that loses its role, its
label, or its disabled state. It is a lint in test's clothing, and it
exists because this gap was found by counting rather than by looking. It
also checks itself: a parser that silently matched nothing would make every
assertion vacuously true, which is the failure mode of source-level lints.

Still open, and genuinely needing what the suite cannot do: asserting the
RENDERED accessibility tree (React Native Testing Library), focus behaviour
when modals open and close, and VoiceOver/TalkBack smoke tests at large
text sizes. Source-level semantics are necessary for those to pass and not
sufficient.

Definition of done: every interactive element has correct semantics and state,
and the primary flows are usable with VoiceOver and TalkBack.

## P2 — Establish runtime performance budgets

The current suite validates substantial pure behavior but does not protect
host-app render cost, animation responsiveness, memory retention, network
refresh volume, or native measurement volume.

Work:

- [ ] Define budgets for inactive, enabled-idle, aiming, marker-heavy, composer,
      and live-thread states.
- [ ] Profile render counts and JS frame time on representative iOS and Android
      devices.
- [ ] Check memory before/after repeated capture, navigation, and provider
      unmount cycles.
- [ ] Count polling, event-triggered reads, and anchor measurements.
- [ ] Record a repeatable benchmark scenario in the repository.

Definition of done: release checks can identify a meaningful regression in
host-app overhead rather than relying only on visual device inspection.
