# Headless capture: bring your own UI over our capture engine

The overlay's capture engine — the fiber-walk inspector (component identity,
source file:line, testID), aim mode, area capture, screenshots, anchored
markers — is the part that is hard to build. The composer sheet is the part
every product team has opinions about. `onCapture` decouples them: your UI,
our capture, and (if you want it) our protocol too.

## The hook

```tsx
import { AnnoKitProvider } from "@joinearlybird/annokit";
import type { CaptureHelpers, PendingCapture } from "@joinearlybird/annokit";

<AnnoKitProvider
  endpoint="http://192.168.1.20:4788"
  sessionId="dev"
  onCapture={(capture: PendingCapture, helpers: CaptureHelpers) => {
    openMySheet(capture, helpers); // render whatever you like
    return true;                   // handled — no built-in composer
  }}
>
```

`onCapture` fires at the exact moment the built-in composer would open:
the aim is confirmed. No screenshot has been taken yet — call
`helpers.captureScreenshot()` if you want one (see below). Two contracts:

- **Return truthy** → the package stands down: the aim clears exactly as
  the composer's dismiss would, and nothing else happens until you say so.
- **Return falsy** → the built-in flow proceeds untouched, which makes the
  hook double as a passive tap into the pipeline (analytics, logging).

## What you receive

`capture: PendingCapture` — the full capture:

| field | meaning |
|---|---|
| `hit.element`, `hit.componentStack` | nearest user component + its chain |
| `hit.source` | symbolicated definition site (`{file, line}`, dev builds) |
| `hit.testID`, `hit.frame`, `hit.nearbyText` | anchor identity + window rect |
| `hit.styles`, `hit.accessibility` | flattened style / a11y summary |
| `extraHits`, `areaRect` | area-capture extras and the drawn rectangle |
| `routeName` | expo-router pathname at capture |
| `screenshotUri` | null until a screenshot is asked for; then a temp `file://` (native) or `data:` (web) |
| `canScreenshot` | whether one COULD be taken here (peer present, host allows, server has the route) |

`helpers: CaptureHelpers` — so your own UI does not force your own
everything:

- `submitAgent(comment, options?)` → creates the agent task through the
  package's transport with everything the built-in composer does: the
  protocol body, Output-Detail trimming, agentation-compat mapping, the
  response-id re-keying, scroll-anchor registration (markers keep working),
  the optional screenshot upload (`options.attachScreenshot`), and the
  pending-list refresh. Resolves to the final id, or null on failure —
  keep your sheet open and the user's words intact.
- `submitComment(comment, authorName?)` → posts a team note (server-signed
  author; notes carry no attachments).
- `buildBody(comment, options?)` → the exact protocol-v1 body
  `submitAgent` would send — for hosts with their **own backend**: take the
  body, POST it wherever you like, and ignore the other helpers entirely.
- `dismiss()` → clear the aim without posting (your sheet's Cancel). Also
  releases the screenshot.
- `captureScreenshot()` → take the screenshot NOW and resolve to its URI,
  or null if it could not be taken. Nothing is captured until something
  asks, so call this before `submitAgent({ attachScreenshot: true })` if
  you want one to ride along. The package hides its own chrome for a beat;
  hide yours too if it covers the screen.
- `releaseScreenshot()` → delete the capture's screenshot temp file. See
  **Who owns the screenshot** below.

`options` on the agent half: `references` (attachment entries — see
[extending-attachments](./extending-attachments.md)), `attachScreenshot`,
`outputDetail`. (`selectedText` was removed on 2026-09-22: the captured text
now travels as `nearbyText` at the default Output Detail level, so a quoted
slice of it is redundant.)

## Who owns the screenshot

On native, `capture.screenshotUri` is a **file** in the OS temp directory,
and it holds whatever was on screen — notifications, another app's content,
a password field mid-type. It is null until something asks for it:
`captureScreenshot()` is what writes it, so a host that never calls it
never puts a screenshot on disk.

The package deletes it at every exit it controls: either `submitAgent` or
`submitComment` (after the upload, when there is one), `dismiss()`, and
provider teardown. A **failed** submit keeps the file, because your sheet
is still open and a retry still needs it.

If you take the capture somewhere else entirely — `buildBody()` plus your
own upload — the file is yours until you say otherwise. Call
`releaseScreenshot()` when you are done with it. It is safe to call twice,
safe to call after a submit already released it, and a no-op on web (a
`data:` capture is memory the GC owns; there is no file).

## Own backend, in full

```tsx
onCapture={(capture, helpers) => {
  const body = helpers.buildBody("");        // identity, box, styles, route…
  void fetch("https://feedback.my.app/capture", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, comment: myComment }),
  });
  helpers.dismiss();
  return true;
}}
```

One trade to know: markers, the queue, and the detail panes render **the
package's server state**. Submissions through `submitAgent`/`submitComment`
appear in all of them; submissions to your own backend do not (there is
nothing of them for the overlay to read back).

## Exported wire pieces

For anything the helpers do not cover, the protocol-speaking internals are
public: `buildAnnotationBody`, `applyOutputDetail`, `buildCaptureBody`,
`submitAgentCapture`, `submitCommentCapture`, `AnnoKitTransport`, and the
`PendingCapture` / `AnnotationBody` / `AgentSubmitOptions` types. The wire
contract itself is the [AnnoKit Protocol v1](./protocol.md).

## Semantics worth knowing

- The helpers run the SAME code path as the built-in composer
  (`src/submit.ts`) — id re-keying, compat mode, and anchoring cannot drift
  between the two.
- In agentation-compat mode `screenshotUri` is always null (their server
  has no upload route) — your UI should treat "no screenshot" as normal.
- `onCapture` is called synchronously; do your async work in your own UI
  and return `true` immediately.
