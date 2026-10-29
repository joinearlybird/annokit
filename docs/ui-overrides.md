# UI overrides: replace a surface, keep the flow

Two override tiers exist. [Headless capture](./headless-capture.md)
(`onCapture`) replaces **everything after the capture** — right for hosts
with their own feedback system. This page is the other tier: keep the
package's whole flow (markers, anchors, queue, detail panes, realtime) and
swap ONE surface for your own.

## `renderComposer` — your sheet, our flow

```tsx
import { AnnoKitProvider } from "@joinearlybird/annokit";
import type { ComposerSlotProps } from "@joinearlybird/annokit";

<AnnoKitProvider
  endpoint="…" sessionId="…"
  renderComposer={(slot: ComposerSlotProps) => <MySheet slot={slot} />}
>
```

When a capture confirms, the package renders YOUR element instead of the
built-in composer — and keeps running everything around it. The props hand
you the decisions pre-made:

| prop | contract |
|---|---|
| `capture` | the full `PendingCapture` (identity, box, screenshot URI…) |
| `canComment` | false when this server has no comment routes — disable that commit |
| `commentsUnavailableReason` | the user-facing sentence for that, else null |
| `submitAgent(comment, opts?)` | creates the task; **on success the package closes the flow** (aim + capture) and refreshes its lists — resolve means "done, sheet gone". Null = failure: nothing closes, keep the user's words |
| `submitComment(comment, name?)` | same close-on-success contract, notes side |
| `buildBody(comment, opts?)` | the protocol body, for own-backend submits (no network, no close) |
| `dismiss()` | close without posting — your Cancel/backdrop |
| `attachmentSources` | the sources in force (built-in assets + host extras; empty in agentation compat) |

Because the submits close the flow themselves, a slot sheet holds no
open/close state — render, call, done. Precedence: `onCapture` outranks the
slot (a host claiming captures at tier 1 never sees tier 2 render).

**Known trade:** a replaced composer reports no covered height, so PUSH MODE
stays off — the app will not auto-lift to keep the annotated element clear
of your sheet. Keep your sheet low or translucent, or accept the overlap.

## `onOpenTask` / `onOpenComment` — your detail panes

```tsx
<AnnoKitProvider
  onOpenTask={(id) => openMyTaskPane(id)}
  onOpenComment={(id) => openMyNotePane(id)}
>
```

When provided, tapping a marker calls you with the record's id instead of
opening the built-in pane. Read/reply/resolve through the protocol routes
(`GET /annotations/:id`, `POST /annotations/:id/thread`, `PATCH
/annotations/:id` — see [the protocol](./protocol.md)). Note: the open-marker boundary
highlight keys off the built-in panes' state, so intercepted opens draw no
boundary — that experience is yours to provide.

## What has no slot, on purpose

The FAB, aim overlay, and markers are not replaceable: the capture
experience is the product. A host that wants those different is not
customizing — that is a fork, or a feature request.
