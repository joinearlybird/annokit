# AnnoKit Protocol v1

All routes are relative to one **base URL** (`endpoint`). JSON bodies,
UTF-8. Auth is optional: a client configured with a token sends
`Authorization: Bearer <token>` on every request; servers may accept
unauthenticated calls (treating the base URL as an unguessable capability
URL) or require the bearer on mutating routes.

**Responses.** On the routes that only report "done" (creating an
annotation, sending, a thread reply, a delete, an upload) any `2xx` is
success and the body is optional. The routes whose answer IS the data (every
read, and the comment routes, which return the updated comment) need their
JSON body. Never redirect,
not even to add a trailing slash: the client refuses every `3xx` and every
response that arrived through a redirect. Requests also carry same-origin
cookies (`credentials: "same-origin"`), so a server behind a cookie-based
gateway on the same origin works without a token. Responses over 4 MiB are
discarded. Requests time out after 10s for reads, 15s for writes and 30s for
uploads; a host can change those with the provider's `timeouts` prop.

## Versioning

`GET /health` → `200 {"status":"ok","protocolVersion":1}`

Servers bump `protocolVersion` on any breaking change to routes or payload
semantics. Clients MUST check it at startup and disable themselves loudly
(dev-log warning, no crash) on mismatch.

A `/health` that answers `{"status":"ok"}` with **no** `protocolVersion` is
not a mismatch: this client reads it as an
[agentation-mcp](https://github.com/benjitaylor/agentation) server and
switches to a compatibility mode that maps its captures onto that server's
shapes. Any `protocolVersion` at all, even a malformed one, means an AnnoKit
Protocol server and goes through the version check.

**`queuesTasks: true` — optional, additive.** A server that accepts a new
task while another is `working`, and runs it when its turn comes, says so
here: `{"status":"ok","protocolVersion":1,"queuesTasks":true}`. The overlay
then lets Send through while a task is in flight (see
[`working`](#annotations)). Absent or anything but `true` means "assume it
does not".

## Viewer

`GET /me` → who the server believes is holding this device, answered from
the credentials of **that request**.

```jsonc
{ "id": "u1", "name": "Ada", "avatarUrl": "https://…" }   // someone
{ "id": null }                                               // nobody
```

**OPTIONAL, and "nobody" is not an error.** A server with no authentication
(a standalone deployment, a local stub) answers `200 {"id": null}`, or omits
the route entirely. Either way the client falls through to its next identity
tier. `{"id": null}` is silent; a `404` costs one line in the dev log at
startup (`[annokit] GET …/me — HTTP 404`) and nothing else. Do **not**
answer `401`: that reads as a broken server rather than an open one.

Per-request, deliberately: identity handed to the app at boot (an env
variable baked into a preview container) describes whoever *opened* the
session, so the moment a second device opens the same one it would claim the
first device's messages. This route cannot be wrong that way. The Earlybird
platform answers it from the verified credentials on the request.

Additive: `protocolVersion` stays **1**. A v1 client tolerates a 404 here.

## Sessions

- `GET /sessions` → list of annotation sessions.
- `POST /sessions` body `{"id"?: string, "url"?: string, "title"?: string}`
  → `201` with the session. Passing an existing `id` is an idempotent
  register/reuse — this client posts its configured `sessionId` once at
  startup.
- `GET /sessions/:sid` → session with all its annotations,
  `{"id": "…", …, "annotations": [Annotation, …]}`. While team notes are
  loaded, the client reads it alongside the pending list to keep the tasks
  made from a note (those with `sourceCommentId`) after they leave the queue.

## Annotations

`POST /sessions/:sid/annotations` — create. Full payload this client sends:

```jsonc
{
  "id": "3f1c…",                    // client-generated UUID
  "comment": "Make this button green",
  "kind": "feedback",                // v1 clients send feedback only
  "platform": "native",              // capture surface; absent/web = DOM capture
  "element": "PrimaryButton",        // nearest user component name
  "componentStack": ["HomeScreen", "Card", "PrimaryButton"], // root→leaf, framework internals filtered; [] below Full detail
  // `element` is always the LAST entry of the fiber parent chain — React
  // wrapper display names (ForwardRef/Memo, unwrapped when they name an
  // inner component), styling-interop names (CSS(…)/CssInterop*) and
  // navigation hosts (RNSScreen*, RNCSafeAreaView) are filtered out, and
  // owner-chain names the parent walk missed are folded in as context at
  // the FRONT of the stack, never after the touched component.
  "source": { "file": "app/src/Card.tsx", "line": 4 },       // symbolicated definition site (dev builds; optional)
  "testID": "card-cta",              // nearest testID in the touched subtree (optional)
  "routeName": "/home",              // router pathname (optional)
  "x": 120, "y": 340,                // tap point, window coordinates
  "boundingBox": { "x": 52, "y": 179.7, "width": 62, "height": 17 }, // touched view frame, window coords
  "nearbyText": "Get started",       // string children near the touch (optional; Standard and Full detail)
  "selectedText": "Get  started",    // exact substring the user quoted (optional; user-authored, never trimmed by Output Detail). NOT sent by this client since 2026-09-22 — nearbyText now rides at Standard instead. Other clients (the web overlay) still send it, so servers should keep accepting it.
  "computedStyles": "{\"backgroundColor\":\"#888\",\"opacity\":0.4}", // flattened style of the touched view, compact JSON (optional; Full detail only)
  "accessibility": "{\"label\":\"Get started\",\"role\":\"button\"}", // a11y identity {label, role, hint, state}, compact JSON (optional; Full detail only)
  "scroll": { "scrollViewTag": 42, "offsetY": 480, "offsetX": 0 }, // owning scroll container
  // Area captures (the armed-mode chip's Area mode): boundingBox is the DRAWN
  // RECTANGLE, element is the component sampled at its center ("Area" when the
  // region is empty), and any other sampled components ride in elements[].
  "isMultiSelect": true,             // present (true) only when the annotation covers >1 element
  "elements": [                      // every covered element, primary first (only with isMultiSelect)
    { "element": "PrimaryButton", "componentStack": ["…"], "source": { "file": "…", "line": 4 },
      "testID": "card-cta", "boundingBox": { "x": 52, "y": 179.7, "width": 62, "height": 17 },
      "nearbyText": "Get started" }
  ],
  "references": [                    // attached context (optional, see below)
    { "type": "asset", "value": "/api/assets/brand/logo.png", "label": "logo.png" },
    { "type": "api", "value": "POST /api/data/todos", "label": "Todos — Add new entries" }
  ],
  "agent": { "id": "claude", "model": "opus", "effort": "high" }  // optional, see Agent → Per task
}
```

**Output Detail.** The user picks how much of the capture leaves the
device (Settings → **Output detail**), and the body is trimmed before it is
sent:

| Level | What is sent |
|---|---|
| **Full** | everything above |
| **Standard** (default) | no `computedStyles` or `accessibility`, and `componentStack` is `[]` (also in each `elements[]` entry) |
| **Minimal** | Standard, and also no `nearbyText`, `source` or `testID` (also in each `elements[]` entry) |

`componentStack` is always present, so an empty one means "not sent", not
"no components". When the touch hit nothing the client can name, `element`
is `"Screen"` and `boundingBox` is a zero-size box at the tap point.

**`scroll`** — window coordinates carry no document scroll on native, so
`x`/`y`/`boundingBox` alone are ambiguous on a scrolled screen; this is what
lets a consumer reconcile them.

- `offsetY` (required, number) — vertical content offset of the scroll
  container that owns the touched view, in points, at capture time.
- `scrollViewTag` (optional, number) — native tag of that container, so
  several scrollers on one screen stay distinguishable.
- `offsetX` (optional, number) — horizontal offset; sent **only when
  non-zero** (horizontal carousels/pagers). The reference server stores the
  `scroll` object as received but does not type or read `offsetX` today, so
  consumers must treat it as advisory.

Clients that cannot determine the offset MUST send `{"offsetY": 0}` rather
than a guess: a fabricated offset is worse than none, because a consumer
cannot tell it apart from a real one. This client measures the offset as
(scroll container window origin − content view window origin) and omits
`scrollViewTag`/`offsetX` when it could not read them.

Web-capture clients send the same route with DOM-flavored identity fields
(`elementPath`, `cssClasses`, `url`, …) instead of the native ones; servers
accept both — every field beyond `id`/`comment`/`kind` is advisory
identity/anchoring metadata.

Any `2xx` means created; a body is optional, and when it carries an `id`
the client re-keys to it. A
retry of the same capture repeats the same `id`, so a server SHOULD treat a
POST with an id it already holds as the same annotation rather than a
second one — the request it is repeating may have timed out after it was
stored.

- `GET /sessions/:sid/pending` → pending (unsent) annotations for the
  session, either `[…]` or `{"annotations":[…]}` (clients accept both).
- `POST /annotations/send` body `{"annotationIds": ["…"]}` — hand the
  selected annotations to the agent/consumer. An **empty array means "send
  all pending"**. This client always sends the ids that are ticked and never
  `[]`, but other clients may rely on it. The route names
  no session, so a server with more than one scopes "all" to what the caller
  is authorized to send. Any `2xx` is success; a body is optional (the stub
  answers `{"sent": 2}`).

**`status: "working"` — optional, additive.** A server that actually runs an
agent may set this while one has the task, and clear it when the run ends.
The overlay reads it to show a banner at the top naming the task ("Working on
“Fix the button label”"), so the device that asked for a change can tell the
difference between *handed over*, *being worked on* and *nothing happening*.
The task's marker, or the note's if the task came from one, and the collapsed
pencil button also pulse in the agent's colour. Tapping the banner opens the
task, or the queue when several are in flight. A server that only stores
annotations never sets it and none of this appears — nothing else depends
on it.

**`progress` — optional, additive.** While a task is `working`, a server may
set `progress` to one short line saying what the agent is doing right now
(`"Editing app/components/PrimaryButton.tsx"`), and send an
`annotation.updated` event when it changes. The overlay shows it under the
banner, on the task's row in the queue, and in its detail pane, cut to 120
characters. It is ignored on a task that is not `working`, so a stale line
can never outlive the run, but a server should still clear it when the run
ends.

### The task lifecycle a server owes the client

Three client behaviours read `status`, so a server that runs agents has
obligations beyond storing it. The values are not a state machine the
protocol enforces — they are what the overlay believes.

| `status` | What the overlay does |
|---|---|
| `pending` | In the queue, sendable. `GET /sessions/:sid/pending` returns it |
| `working` | Banner at the top naming the task (tap to open it), with `progress` under it; its marker and the pencil button pulse; marked **Working…** in the queue, with no checkbox and not counted by Send; Send refused for other tasks while **One task at a time** is on (see below); detail pane reads "With the agent" and shows `progress`. Still returned by `/pending` — it is not finished |
| anything else | Detail pane reads "With the agent" and will not send it again |

**Clear `working` on EVERY exit path.** Success, failure, timeout, an agent
that crashed, and the server's own restart. This is the one obligation that
bites: a task left `working` blocks Send indefinitely and leaves a banner
claiming work that stopped hours ago, and the client has no way to discover
it is wrong — it believes you. Give runs a deadline and sweep anything still
`working` when the process comes back up.

**Completion is leaving `pending`.** There is no "done" value the client
looks for; it asks for pending work and shows what it gets. Use whatever
your system means by finished (`sent`, `resolved`, your own), and know only
that the task drops out of the queue and its detail pane stops offering
Send. Report the outcome in the thread rather than in the status — see
below.

**Say what happened in `thread[]`.** `POST`-ing a `role: "agent"` message is
how the answer reaches the device the request came from; a status change
alone tells someone the task is over but not what was done, and the phone is
not where the agent's terminal output goes. An agent reply MUST NOT reopen
the task (see [Reopening a task](#reopening-a-task)).

**Sending an already-`working` task is the client's mistake to avoid, not
the server's to permit.** A server that cannot run two at once should reject
or queue the second rather than start it — the overlay's refusal is one
client's courtesy, and another client, a retry, or a script will not offer
the same.

While a task is `working` the overlay also refuses to send another, because
the common case is one agent editing one working tree, where a second run
overwrites the first. That is a fact about the SERVER rather than the
protocol: one that gives each task its own worktree, or queues them itself,
can take another safely. Such a server says so with `queuesTasks: true` in
[`/health`](#versioning), and the overlay then does not block. Otherwise the
client cannot tell which it is talking to, so
`blockSendWhileWorking` (Settings → This session → **One task at a time**)
hands the judgement to whoever does know. A task in this state should still be
returned by `GET /sessions/:sid/pending`: it is not finished, and dropping
it would empty the queue at the moment it has the most to say.

### Run history

A server that runs agents can keep a record of each run on the task, as
`runs[]` (optional; oldest first). Append an entry when a run starts and
finish it when the run ends; never rewrite a finished one, so a re-run adds
to the record instead of replacing it:

```jsonc
"runs": [
  {
    "id": "a1b2c3d4",                         // unique within the task
    "agent": { "id": "codex", "label": "Codex" },
    "model": "gpt-5.6-terra",                 // absent: the agent's default
    "effort": "high",                         // absent: the model's default
    "startedAt": "2026-10-28T10:00:00.000Z",
    "finishedAt": "2026-10-28T10:01:40.000Z", // absent while it runs
    "outcome": "done",                        // running | done | failed | stopped
    "files": [{ "path": "app/Button.tsx", "added": 3, "removed": 1 }],
    "summary": "Made the button darker.",     // the agent's own one line
    "title": "Darker primary button",         // a few words naming the change
    "resumed": true,                          // continued the agent's session from the run before
    "error": "Timed out after 600s."          // why it failed or stopped
  }
]
```

`title` names the task in the overlay's **Done** list (the newest run that
gave one); the request is in the task's detail. Without it the list shows
the request. The example servers ask the agent to end its reply with a
`Title: …` line, take that line out of the reply, and store it here, so it
costs no second model call.

`resumed` marks a run that continued the agent's own session from the
previous run on the task (its files read, its reasoning) rather than
starting over from the thread. The example servers do this for Claude Code
and Codex when the follow-up uses the same agent and model, in place (not
in a worktree), and fall back to a fresh run, recorded as a failed resumed
run, when the session cannot be continued.

`runs` is the server's, like `status`: drop it from a client's create or
update. The thread still carries the agent's reply; this is the record of
the work behind it. The overlay shows it in the queue panel's **Done** tab,
which lists the session's finished tasks from `GET /sessions/:sid` (anything
not `pending` or `working`), and above the thread in a task's detail. A
server without it loses nothing: Done lists finished tasks by status.

### Other annotation routes

- `POST /annotations/:aid/screenshot` — `multipart/form-data` with a single
  `file` part (PNG) attaching a screenshot to an annotation. Annotation
  routes are not session-prefixed: annotation ids are unique per endpoint.
- `POST /comments/:id/screenshot` — the same upload, for a team note. A
  server that does not implement it answers 404 and the note still stands:
  the client treats the picture as an optional follow-up to something
  already saved, exactly as it does for annotations.

  A comment may carry `references[]` in the annotation's shape, and a
  server that stores the upload should append its own
  `{"type":"screenshot"}` entry there — the client never sends one. That
  entry is what the note detail renders; without it the note reads as it
  always did.

  **Both screenshot uploads go over `XMLHttpRequest`, not `fetch`.** On Expo SDK 57
  the global `fetch` is Expo's WinterCG implementation, which rejects React
  Native's `{uri, name, type}` FormData part outright (`Unsupported
  FormDataPart implementation`); RN's own XHR understands that part and
  streams the file off disk. The client therefore sets no `Content-Type`
  (the XHR/FormData layer writes the multipart boundary), arms a 30s upload
  timeout, and treats a non-2xx, network error, timeout or abort alike as
  "screenshot not attached" — the annotation or note is already saved. A host
  with no `XMLHttpRequest` (SSR, unit tests) falls back to the `fetch` path.

  **The `file` part is built per target.** On react-native-web there is no
  RN FormData: the browser's native one stringifies a `{uri, name, type}`
  object to `[object Object]` (a ~150-byte upload where an image should be),
  so the web branch converts the capture to a real `Blob`/`File` first.
  That works because react-native-view-shot's web implementation renders the
  DOM with html2canvas and hands back a `data:` URL, which `fetch` can read
  (the client asks for `result: "data-uri"` explicitly rather than relying on
  view-shot's `tmpfile` default, which is unimplemented on web); a `blob:`
  URL is read the same way. A `file://` URI is **never** fetched — on native
  that silently resolves against the Metro dev server and uploads Expo's HTML
  index instead of the screenshot — so native keeps the untouched
  `{uri, name, type}` part and the XHR path above. A capture that cannot be
  converted is dropped with a warning: the annotation itself is already
  saved.
- `DELETE /annotations/:aid` — remove an annotation. The queue panel's
  per-row `×` and the detail view's **Delete** both call it, removing the
  row and its marker optimistically and restoring them if the server does
  not answer 2xx. A detail view whose annotation disappears — deleted here
  or from the queue behind it — closes itself rather than showing a row the
  server no longer has.
- `GET /annotations/:aid` — the full stored annotation, **including its
  `thread[]`** (the pending list carries none). The detail view reads it
  when it opens (from a queue row or from the annotation's marker); a
  failed read keeps whatever is on screen rather than blanking the pane.

## References (attach panel)

`references[]` is advisory context the consuming agent resolves alongside
the comment. Each entry is `{ "type", "value", "label"?, "open"? }`, where
the optional `open` says where the agent can look at the thing when that is
not `value` itself (a path in its checkout, a URL, `s3://…`). How assets in
particular work, and how a server stores them, is in [assets.md](./assets.md). The known types
are `screenshot` | `url` | `asset` | `api`, and the union is deliberately
**open** — a host may mint its own, provided its consuming agent is taught
to resolve them (see the design rule below).

**A reference never grants access — it points at something the agent can
already reach.** The annotation stays a handful of strings; each type's
`value` resolves through a channel the agent already has:

| type | `value` | how the agent reaches it |
|---|---|---|
| `api` | `"<METHOD> /api/data/<slug>[/:id\|/events]"` | **already in its repo** — a symbolic pointer it maps onto the generated manifest/hooks in the working tree it edits; no network involved |
| `asset` | the asset's **stable** `/api/assets/{path}` URL | **embed verbatim** — the value belongs in generated code; the running app resolves it |
| `screenshot` | short-TTL presigned image URL | **server-granted** — appended by the server when the upload lands; fetched as visual context, never embedded. The overlay's task and note detail panes render it as a thumbnail that opens full size, so the TTL wants to outlive a pane someone leaves open; an expired link shows a "could not be loaded" state rather than a broken image |
| `url` | external link | fetched directly |

The consuming server's system prompt is the other half of the contract: it
is where each type's resolution rule is taught. A custom type is only as
useful as the prompt (or the `label`) that explains it.

```jsonc
{ "type": "asset", "value": "/api/assets/brand/logo.png", "label": "logo.png" }
{ "type": "api",   "value": "GET /api/data/todos",        "label": "Todos — Show the list" }
```

`references` is **omitted** (not `[]`) when nothing was attached, and never
carries a `screenshot` entry from the client: the server appends that itself
when the multipart upload lands.

### Attachment sources (host-extensible)

The composer's **+ Attach** panel is generic: it renders `AttachmentSource`s
and knows nothing about any source's domain. A source lists pickable items;
a picked item contributes exactly one `references[]` entry:

```ts
interface AttachmentItem {
  id: string;              // toggle/dedupe identity
  title: string;           // row title and chip text
  subtitle?: string;       // muted second line
  thumbnailUri?: string;   // display-only preview (short-TTL URLs are fine)
  group?: string;          // rows sharing a group render under one heading
  reference: AnnotationReference; // what actually rides on the annotation
}

interface AttachmentSource {
  key: string;             // stable — tabs, caching and testIDs hang off it
  title: string;           // tab title
  emptyText: string;       // one-line copy when list() resolves empty
  list(transport: AttachmentTransport): Promise<AttachmentItem[]>;
}
```

The package ships **one built-in source** — the app's asset library
(`assetsSource`, exported) — because its route is part of this protocol:

- `GET /assets` → `{"assets": [{path, name, publicPath, agentPath?,
  previewUrl?, size, uploaded}]}`. `previewUrl` is present for images only,
  and is never a reference's `value` — an `asset` reference's `value` is
  always the stable `publicPath`, and its `open` is `agentPath` when the
  server gives one. An image asset's reference also carries the
  `previewUrl` as `preview`, display only, so the task and note panes can
  draw it like a screenshot; it may expire, and then shows as "could not be
  loaded". Optional `POST /assets` and `DELETE /assets/<path>` let
  a server accept uploads ([assets.md](./assets.md#routes)).

Everything else is a host concern, registered on the provider:

```tsx
<AnnoKitProvider attachmentSources={[assetsSource, mySource]}>
```

(The Earlybird platform, for example, adds a **Data APIs** source that reads
its app's generated data-API manifest from `GET /tables` and offers each
enabled operation as an `api` reference — that code lives in the host app,
not in this package, and any host can do the equivalent for its own domain.)

Sources are fail-soft by contract: `list()` resolving empty, rejecting, or
hitting a route the server does not implement all render the same one-line
`emptyText` — the picker never blocks the composer and never shows an error
state. Skip malformed entries rather than guessing at them, and never mint a
reference the consuming agent cannot resolve (a pointer to a route that
404s is worse than no reference at all).

**End-to-end walkthrough** — wiring a custom source against your own server
and your own agent, including the screenshot upload and the agent-prompt
half of the contract: [extending-attachments.md](./extending-attachments.md).

## Headless capture (bring your own UI)

The whole composer is replaceable: pass `onCapture` to the provider and the
package hands you the capture (element identity, source file:line, testID,
area, screenshot URI) plus helpers that speak the protocol — `submitAgent`,
`submitComment`, `buildBody` for own-backend hosts, and `dismiss`. Return
truthy to take over; falsy taps the pipeline passively. The helpers run the
SAME submit path as the built-in sheet, so markers, anchors and compat mode
behave identically. Full walkthrough:
[headless-capture.md](./headless-capture.md).

## UI overrides (replace a surface, keep the flow)

The middle ground: `renderComposer` swaps just the composer sheet for your
own — the props hand you the decisions pre-made (`canComment` + its reason,
close-on-success submits) — and `onOpenTask`/`onOpenComment` route marker
taps into your own detail panes. Markers, anchors, queue and realtime stay
package-run. Walkthrough: [ui-overrides.md](./ui-overrides.md).

## Threads

An annotation can carry a follow-up conversation. Tapping a queue row opens
the detail view, which reads `GET /annotations/:aid` for the current
annotation (status **and** `thread[]`) and posts replies to:

`POST /annotations/:aid/thread` body `{"content": "…"}` → the whole updated
annotation. An empty `2xx` also counts as taken: the client keeps its own
copy of the reply until the next read.

**`role` is server-assigned** — a client reply is always recorded as
`"user"` — as are `id` and `timestamp`. A stored message is
`{id, content, role: "user"|"agent", timestamp}`; the route answers with the
whole updated annotation. The client appends the reply optimistically and
removes it again (restoring the text to the input) if the server does not
take it. Messages are rendered with user and agent visually distinguished.

**An OPEN detail re-reads `GET /annotations/:aid`** on the same lazy cadence
as the comment list (30s, `src/poll.ts`), because the agent answers into this
thread and a reply landing while the pane is up was otherwise invisible until
it was closed and reopened. Only an open pane polls — nothing refreshes a task
nobody is looking at — and the timer stops the first time the read fails, and
while the [event stream](#events-optional) is live.
A poll never blanks the pane on a failed read, never overwrites a reply still
in flight, and never scrolls a reader who has moved up into the history
(they get a "new replies" affordance instead). No socket is required; a
realtime channel would replace the timer, not the reads around it.

## Agent (optional)

A server that runs agents can say which ones it has, which is in use and on
which model, and what each one's models and effort levels are. The overlay
shows this in the composer's agent pill and in **Settings → Agent**, and
puts the person's choice on each task (**Per task**, below). The routes
are server-wide, not per session, like the agent itself.

`GET /agent` (`?refresh=1` asks the server to look for agents again):

```jsonc
{
  "enabled": true,            // false: the server runs no agent at all
  "perTask": true,            // runs each task on the agent it carries (Per task, below)
  "current": { "id": "claude", "label": "Claude Code", "model": "sonnet", "shell": false },
  "error": null,              // why "current" is null, in one line
  "working": 0,               // tasks it is working on now
  "agents": [
    { "id": "claude", "label": "Claude Code", "installed": true, "connected": true, "version": "2.1.312" },
    { "id": "gemini", "label": "Gemini CLI", "installed": false, "shell": true }
  ]
}
```

- **`current.model`:** `null` means the agent's own default.
- **`shell`:** the agent's edits are auto-approved with shell access, not
  file tools only. The overlay says so under the status.
- **Agents not installed:** list them with `installed: false`. The overlay
  shows them disabled rather than hiding them.
- **`connected`:** installed and signed in. `false` means its tasks would
  fail; the overlay lists it with a red dot, asks for none of its models,
  and never sends it a task. Absent: installed is taken to mean usable.

`GET /agent/models?agent=<id>` (`&refresh=1` asks the agent's CLI again
rather than answering from a cache) → `{"ok": true, "models": [{"id", "label",
"description"?, "default"?, "efforts"?, "defaultEffort"?}], "defaultLabel"?,
"note"?, "efforts"?, "defaultEffort"?}`, or `{"ok": false, "message"}`. A server should ask the agent's own CLI rather
than keep a list, which goes stale. An empty list is fine: the overlay then
offers only **Default**. List the models in the CLI's order of preference:
the pill offers the first three.

`efforts` is the effort levels a model takes, lowest first (`["low",
"medium", "high"]`), and `defaultEffort` the one it runs at when none is
asked for — per model, since they differ (an older model may take none:
`[]`). The top-level pair is the Default model's, and stands for any model
that does not carry its own. The overlay has no "Default" level: it shows
the default one as chosen, and a task on it carries that level by name.

`PATCH /agent` with `{"agent"?: "<id>", "model"?: "<id>" | null}` switches,
and answers with the same shape as `GET /agent`. Choosing a different agent
resets the model to its default. A run already in progress keeps the agent
and model it started with. A server should send an event (any name, e.g.
`agent.updated`) so other clients re-read.

**Per task.** A server that sends `"perTask": true` in `GET /agent`
promises to honour the `agent` a task carries; only then does the overlay
draw the pill or send `agent` at all. Without it, Settings → Agent falls
back to `PATCH /agent` (one agent for every task, no effort), so a choice
is never shown and then quietly ignored.

A task carries the agent it should run on — what the pill
showed when it was created, chosen or not, with the effort spelled out:

```jsonc
"agent": { "id": "codex", "model": "gpt-6", "effort": "high" }  // model, effort optional
```

Run the task on that agent, model and effort when the agent is installed;
otherwise, and when `agent` is absent (an older client, or a server
whose models were not loaded yet), on the current agent. A missing `model`
means that agent's Default model; a missing `effort`, its default level. Treat the values as
untrusted: check them against what the agent accepts and pass each as one
argument, never through a shell.

A server without these routes answers 404. The overlay asks once per
session, then shows neither the pill nor the Agent row.

## Events (optional)

`GET /sessions/:sid/events` → `text/event-stream`. Named events, one per
change, for example:

```
: connected

event: annotation.updated
data: {"id":"3f1c…"}

```

**An event carries no state.** It only tells the client to re-read: the
pending list, the team notes for the current route, and the task detail
pane if one is open. Event names are advisory: any event on a session means
"something changed", so unknown names are still acted on. `id:` lines are
accepted and ignored, and `Last-Event-ID` resume is not implemented. A
comment line every ~15s keeps proxies from closing an idle stream.

**Without events, some changes wait.** The team notes and an open task pane
also poll every 30 seconds, so for them a missing or missed event costs at
most one poll. **The pending list does not poll.** Without events it is
re-read only when the overlay starts, after this client's own changes, and
when an open task pane's poll sees its task change, so a status the server
changes on its own (`working` ending, a task finishing) can stay out of
date on the device until one of those happens. A server
that runs agents should implement this route.

The client reads the stream over `XMLHttpRequest`, because React Native
has neither `EventSource` nor a streaming `fetch`. It reconnects with
backoff and gives up for the session after 5 failures in a row. Comment
lines (including `: connected`) are not events: a stream that closes having
sent only comments counts as a failure. A frame over 256 KiB is dropped
rather than buffered, and a single connection reads at most 4 MiB before
reconnecting (see [Server obligations](#server-obligations), item 8).

**While the stream is live, the polls stop.** Live means bytes are
arriving — any line, comments included — not that a socket is open, because
a proxy that buffers the stream holds the connection and delivers nothing. A
stream silent for 45 seconds (three missed keepalives) counts as down, and
the 30-second polls resume until bytes arrive again. Each time the stream
comes back, the client re-reads the pending list and the notes once, to catch
whatever it missed while it was down. A server that sends no keepalives
simply keeps the polls.

Additive: `protocolVersion` stays **1**.

## Reopening a task

**A human reply makes a task actionable again.** `POST /annotations/:aid/thread`
with a **user** message on an annotation that is neither `pending` nor
`working` MUST put it back to `pending`, and SHOULD stamp:

```jsonc
{
  "status": "pending",
  "reopenedAt": "2026-08-10T09:41:07.221Z",  // when the last human reply reopened it
  "reopenCount": 2                            // how many times that has happened
}
```

- **A reply during a run reopens the task when the run ends.** The run
  started before the reply, so its prompt did not include it. Marking the
  task finished would leave the reply unanswered; the server SHOULD set it
  back to `pending` (with the stamps) when that run ends, instead of to its
  finished status.
- **No new status value.** `pending` is what every consumer already filters
  on — this client's queue, `GET /sessions/:sid/pending`, and the agent-side
  tooling that asks the server for pending work. A `"reopened"` status would
  have to be taught to each of them, and any one that was missed would
  silently drop refined work on the floor. `reopenedAt`/`reopenCount` are
  **additive**: a server that does not send them is simply a server whose
  reopened tasks look like ordinary pending ones, and `protocolVersion`
  stays **1**.
- **An AGENT reply MUST NOT reopen.** Agent replies are written from inside
  a turn (a clarifying question, a resolution note); a reply that re-queued
  its own annotation would re-trigger the agent with itself.
- **Reopening does not start a turn.** It re-queues; a human still presses
  send — from the queue, or from the task's own detail pane, which posts
  `POST /annotations/send {"annotationIds": ["…"]}` for that one task. A
  refinement is typed a sentence at a time and often in several messages, and
  starting work on each of them would set the agent off on half a thought.
- **The instruction of a reopened task is its `thread[]`,** not its `comment`
  — the comment is the original request the agent may already have addressed.
  A server building a prompt for the hand-over should say so.

## Comments

A **comment** is human-to-human discussion anchored to an element — the
same capture, a different audience. **The agent never sees comments.** They
are not annotations, they are not in the pending queue, and `POST
/annotations/send` does not touch them. The one crossing is **making an
agent task out of one of a note's messages** (below).

> **Wire words vs UI words.** This section documents the protocol, where
> the two kinds are `annotation` and `comment`. The interface never uses
> those words — they read as synonyms — and says **agent task** and **team
> note** instead. The mapping is exactly one-to-one and nothing on the wire
> changed when the copy did (`src/destination.ts`).

| | Annotation (UI: *agent task*) | Comment (UI: *team note*) |
|---|---|---|
| Audience | the AI agent | your teammates |
| Lives in | the pending queue | the comment list for a route |
| Marker | blue circle, numbered | orange rounded square, quote glyph |
| Author | this session | resolved **server-side** per message |
| Extras | screenshot, assets, Data-API references | screenshot only (see below) |
| Chosen | at submit time, in the composer | at submit time, in the same composer |
| Listed in | **Queue** (this session's pending) | **Comments** (every route, every note) |
| Ends by | being sent to the agent, or deleted | being resolved, or deleted (never by producing a task) |

**Finding a note again.** Markers are per-screen, so the **Comments**
toolbar entry lists every note in the app — the same `GET /comments` read
with NO `routeName`, grouped by route with the current screen first.
Tapping a row goes to the note: on the current route it opens the detail;
on another route the overlay navigates there first (via the OPTIONAL
expo-router integration in `src/router.ts`) and then opens it, and the
note's marker pulses briefly on arrival so it can be spotted among the
others. Where expo-router is not installed there is no jump — the row still
opens the note, and the row's plan says why it could not travel
(`noteJumpPlan`, `src/notes-list.ts`). Resolved and converted notes stay in
the list at 45%, matching their markers.

Routes (same base URL as everything else):

- `GET /comments?routeName=/home` → `{"comments": [Comment, …]}`. The
  overlay filters markers by route the same way annotations are filtered.
  Omit `routeName` for the whole app — what the **Comments** list reads.
- `POST /comments` → `{"comment": Comment}`. Body:

```jsonc
{
  "routeName": "/home",
  "content": "Is this the right label? @dana thoughts?",
  "element": "FeedRow",                                   // nearest user component
  "componentStack": ["RootLayout", "HomeScreen", "FeedRow"],
  "source": { "file": "app/src/app/_layout.tsx", "line": 7 },
  "testID": "feed-row-1",
  "x": 150, "y": 310,
  "boundingBox": { "x": 17.6, "y": 306.3, "width": 367, "height": 68.6 },
  "scroll": { "scrollViewTag": 1654, "offsetY": 0 },
  "authorName": "Ada"                                  // ADVISORY, optional — see below
}
```

  The identity fields are deliberately the annotation's, minus the
  agent-only apparatus (`kind`, `platform`, `references`, `nearbyText`,
  `computedStyles`, `accessibility`, `isMultiSelect` and `elements`) — a
  comment that is later sent to the agent must target as precisely as one
  written directly. Unlike an annotation the body is **not** trimmed by
  Output Detail, so `componentStack`, `source` and `testID` are always
  sent. An Area capture's drawn rectangle is not used: `boundingBox` is the
  frame of the element sampled at its centre. There is no `id`: **the
  server names comments.**
- `GET /comments/:id` → `{"comment": Comment}` — the authoritative thread;
  the detail view reads it when it opens.
- `POST /comments/:id/messages` body `{"content": "…", "authorName"?: "…"}`
  → `{"comment": Comment}` (the whole updated comment).
- `PATCH /comments/:id` body `{"status": "open"|"resolved"}` (`"converted"` is
  still accepted for old clients; this one never sends it) →
  `{"comment": Comment}`.
- `DELETE /comments/:id` → any `2xx` (`{"ok": true}` is conventional).

Every route here except `DELETE` and the screenshot upload needs a JSON
body in its answer: the client reads an empty `2xx` as a failure.

```jsonc
// Comment
{
  "id": "cmt-…",
  "routeName": "/home",
  "element": "FeedRow", "componentStack": ["…"], "source": {…}, "testID": "…",
  "x": 150, "y": 310, "boundingBox": {…}, "scroll": {…},
  "status": "open",                                  // | resolved | converted (legacy)
  "author": { "id": "u1", "name": "Ada", "avatarUrl": "https://…" },
  "messages": [
    { "id": "cmsg-1", "content": "…", "author": { "id": "u1", "name": "Ada" },
      "createdAt": "2026-08-10T21:43:16.153Z" }
  ],
  "references": [                                    // optional: only what the server appended
    { "type": "screenshot", "value": "https://…", "label": "Screenshot" }
  ],
  "createdAt": "…", "updatedAt": "…"
}
```

**Authors are resolved SERVER-side.** The client never sends a user id and
has no user directory; every name and avatar on screen came back from the
server. A message whose author the server could not resolve renders as
"Someone" rather than inventing one.

### Who you are

A chat has to know whose messages to put on the right. The client resolves
that from the first of these that answers — **highest first**:

| # | Tier | Where it comes from | Notes |
|---|---|---|---|
| 1 | **Host** | `<AnnoKitProvider author={{id, name}} />` | An app that knows its signed-in user says so. Nothing is ever asked. |
| 2 | **Viewer endpoint** | `GET /me` | Per **request**, so it is right even when several devices share one session. Fetched once at startup, beside `/health`. |
| 3 | **Env** | `EXPO_PUBLIC_ANNOKIT_AUTHOR_ID` / `_NAME` | A bootstrap convenience only. It is baked per *container*, so it names whoever opened the preview — which is why it ranks **below** `/me` and is discarded the moment `/me` answers with a different id. |
| 4 | **Echo** | the author the server put on our own writes | The original mechanism, kept for servers with no `/me`. |
| 5 | **Prompted** | the user, once, inline | Only when nothing above answered. |

Two rules hold across all five:

- **The server is authoritative for what is DISPLAYED.** Every name and
  avatar on screen is the one the server sent back with the message; nothing
  the client holds ever relabels it. A message whose author the server could
  not resolve reads "Someone" rather than inventing one.
- **A tier that loses the id loses the person.** Name and avatar are only
  ever taken from the tier that supplied the id, or a higher one — otherwise
  a stale env *name* could end up beside a different user's id.

With any tier resolved, own-message detection is **immediate**: your first
message is already on your side. With none, every message renders as
somebody else's — a calm neutral thread, rather than a teammate's words in
your colour.

**The prompt.** When nothing else answers, the user's first attempt to post a
team note (or a reply) opens one inline row — a line of explanation, a text
field, a confirm — instead of posting; confirming resumes the post. It is
never a blocking modal, and it appears only at the moment the answer is
needed. The name can be changed later from the quiet *"Posting as … ·
Change"* line above the reply box, which is shown **only** for a name this
device chose (a host's or a server's identity is not ours to edit).

**`authorName` is ADVISORY.** When this device has a display name from any
tier above, including one the server itself returned from `/me`, team-note
writes carry it as `authorName` (at most 40 characters). A
server that authenticates its writers **MUST ignore it** and attribute the
write to the authenticated user — the Earlybird platform
does, taking the acting user from the verified session. A server with no authentication **should** use
it to label the message; that is the only reason it exists. It is additive,
so `protocolVersion` stays **1**.

**Persistence is session memory only.** A typed name lives in module state —
no `async-storage` peer for a dev overlay — so a reload asks again. The
tradeoff is deliberate: one extra question after a refresh, against a
dependency and a stale identity surviving a change of user.

**A screenshot, but no references.** A note may carry its capture — see
`POST /comments/:id/screenshot` — because "look at this" is most of what
people mean when they point at something on a screen, and making the
picture agent-only was a distinction the agent cared about rather than the
team. Picked `references` still ride with an agent task only: a reference
exists to point something that will ACT at context it cannot see, which a
teammate reading a note does not need. Both controls stay in the composer
either way; tapping **Comment** simply leaves the references behind.

### Make an agent task (the bridge)

The one place the two halves meet — inside a note's detail view, never the
bulk send (a checked team note that quietly did nothing would be worse than
no checkbox at all, so team rows have none).

**The unit of work is a MESSAGE, not the thread.** The bridge used to
flatten a whole discussion into one task and mark the note `converted`,
after which it offered nothing further. On the device that read as: unclear
what was being sent, the wrong unit (one line in a discussion is usually
the actual request), and a dead end. So:

- **Create agent task**, in the note's action row, starts the flow: the
  messages become checkboxes for a request that spans a couple of replies,
  the bottom bar becomes a box for the instruction itself, and the confirm
  names the count it will quote. (A per-message quick action — a sparkle on
  every row — was tried and retired: it cluttered every line to serve the
  occasional tap. Long-press on a message survives as a *shortcut* into the
  same flow with that message already ticked; nothing depends on it.)
- **The note is never consumed.** No status is written, so there is nothing
  to half-fail and nothing to get stuck in: it stays an open discussion and
  can produce another task tomorrow.

What it does, per task:

1. **re-reads** `GET /comments/:id`, so the text quoted is the server's
   (a failed re-read falls back to what is on screen — a slightly stale
   quote beats refusing to send), and refuses if there is nothing left to
   send: no instruction was typed and every selected message has since
   vanished from the thread;
2. builds the task's `comment`: the typed instruction first, then, if any
   messages were ticked, a blank line, `From the discussion:` and the
   SELECTED messages in thread order as `"Author: message"` with a blank
   line between. A discussion is unreadable to the agent without its
   speakers, and the rest of the conversation is not sent. With no
   instruction the quotes are the whole comment; with no ticked messages
   the instruction is;
3. POSTs it to `POST /sessions/:sid/annotations` as an ordinary protocol-v1
   annotation carrying the note's captured identity (element,
   componentStack, source, testID, routeName, coordinates, boundingBox,
   scroll) **plus `sourceCommentId`, and `sourceMessageIds` when messages
   were ticked**. The body is trimmed by Output Detail like any other task,
   so at the default level `componentStack` is `[]`. As with any create,
   any `2xx` means made, and an `id` in the answer replaces the client's.

```jsonc
{
  "id": "ced2c4a6-…", "kind": "feedback", "platform": "native",
  "comment": "Change the label to Start\n\nFrom the discussion:\n\nDana: Agreed — change it to Start",
  "element": "FeedRow", "componentStack": [],          // [] at the default Output Detail
  "source": { "file": "app/src/app/_layout.tsx", "line": 7 },
  "testID": "feed-row-1", "routeName": "/",
  "x": 150, "y": 310, "boundingBox": {…}, "scroll": {…},
  "sourceCommentId": "cmt-1786398196153",
  "sourceMessageIds": ["cmsg-2"]                    // ADDITIVE — see below
}
```

**`sourceMessageIds` is additive; `protocolVersion` stays 1.** It is
optional in both directions. A server that stores it lets the overlay mark
the exact bubbles a task came from *on any device, after any reload*; a
server that drops it loses nothing but that precision — the task itself is
already a complete annotation, `sourceCommentId` still ties it to the
discussion, and the client falls back to a session-local link (the bubble
is still marked, it just cannot be opened from there). The Earlybird
platform stores it.

**`converted` is LEGACY.** It was the terminal status the old bridge wrote.
Nothing writes it any more. It is still *read* — old notes carry it, they
still open, still fade like a resolved one, and **Reopen** now works on
them rather than leaving them stranded.

**Where the relationship is visible**, from all three directions:

| Surface | What it shows |
|---|---|
| The thread | the marked message wears an **Agent task** chip on the far right of its author line, and the chip opens that task (a plain, non-interactive mark when the link cannot be resolved — old data, or a server that did not keep it) |
| The note detail's **Tasks (N)** tab | the roll-up: every task this discussion produced, with its text, status, time and which message(s) it quoted; tapping one opens the ordinary task detail. Sent tasks stay listed: the tab reads the pending list plus the note-made tasks from `GET /sessions/:sid`. The tab stays visible at zero with a calm empty state rather than appearing later and moving **Conversation** under your thumb |
| The screen | the note's **existing** orange marker gains a small blue pip. There is deliberately no second marker: a blue dot at the same coordinates would be two marks for one thing |
| The queue, and the task detail | the task row says *From a team note* and taps back to the discussion |

### Refresh and degradation

Comments are refetched on the events that matter — **route change**,
**arming the capture gesture**, and **after creating a note** — backstopped by a
lazy **30-second poll** for a teammate's reply arriving while you sit on a
screen, which stands down while the [event stream](#events-optional) is live.
A reply, status change or delete applies the comment the server
answers with instead of re-reading the list. An open note detail reads
`GET /comments/:id` when it opens and does not poll. Events and the poll
refresh both the current route's notes and the app-wide **Comments** list
(which is also what the toolbar's note count reads). No websockets in v1; the fetch layer (`src/comments.ts`) is the
seam a realtime channel replaces, and the event-driven refetches are
correctness rather than a polling workaround.

A comments read that fails is `null`, never `[]`: the overlay marks
comments **unavailable** (the composer says so), empties the list, and
**stops polling** so a server without these routes is not 404ed every 30
seconds. Annotations, aiming, the toolbar and the queue are untouched by
any comment failure — a server that has not shipped `/comments` yet loses
comments and nothing else.

## Client obligations

- Never activate in production builds (`__DEV__`-gated).
- Fail soft: any transport/protocol failure logs and degrades; the host app
  must never crash or block on the overlay.
- Generate annotation ids client-side (UUID), so a retried create repeats
  the same id and the server can recognise it as the same annotation.

## Server obligations

**The client is not a security boundary.** It is dev-only tooling that
fails soft by design: it never throws into the host app, it degrades when a
route is missing, and every limit it applies is for the user's benefit and
its own memory, not for yours. Anything below that a server does not
enforce is not enforced. These are normative for an AnnoKit Protocol
implementation.

**1. Authorize every operation, and never from an identifier.** Session
create and read; annotation create, read and delete; comment create, read,
update and delete; thread append; screenshot upload; send-to-agent. Each
one, independently.

Annotation and comment ids are **identifiers, never capabilities**.
Annotation ids are generated on the client, and only as unpredictable as that runtime
allows — Hermes guarantees no cryptographic source, so the package tries
`crypto.randomUUID`, then `crypto.getRandomValues`, then falls back to
`Math.random` so the overlay keeps working (`makeId` in
`src/transport.ts`). Treating possession of an id as proof of anything
makes that fallback your authorization story. Authorize the caller, then
check the id belongs to the session they are authorized for.

If you issue **capability URLs** — where the unguessable endpoint *is* the
credential — treat the whole URL as a secret: HTTPS only, never logged,
revocable, scoped to a single session, and short-lived. The client holds up
its end (it redacts the URL from every log line and shows only the host in
its settings panel), but a URL in a bug report or a proxy access log is out
of its hands.

**2. Bound every input.** Request bodies, individual text fields, list
lengths, attachment counts, and SSE frame sizes. For reference, the client
limits itself to (`src/limits.ts`, `src/viewer.ts`):

- 4000 characters of text (`TEXT_MAX`) in the built-in composer and reply
  boxes. The headless `submitAgent` and `submitComment` helpers do not
  clamp what a host passes them.
- 20 references per capture (`REFERENCES_MAX`), 200 items per attachment
  source (`ATTACHMENT_ITEMS_MAX`) and 2000 characters per item title,
  subtitle and group (`FIELD_MAX`).
- 40 characters for a typed display name.

Enforce your own limits at or below those, and remember that a client limit
is bypassed by anything that is not this client — curl included.

**3. Verify uploaded screenshots by content, not by claim.** The multipart
part carries a filename and a content type chosen by the caller; neither is
evidence. Sniff the magic bytes, reject anything that is not the image type
it claims, cap both byte size and pixel dimensions, and never echo a
response content type derived from the request. Consider stripping
metadata: a capture is a full-screen grab and its EXIF is one more thing to
leak.

**4. Ignore client identity hints once you have authentication.**
`authorName` exists for the unauthenticated local-development case, where
nothing else knows who is typing. If your server knows the caller,
attribute from the authenticated session and drop the field — otherwise
anyone can post as anyone.

**5. Rate limit per session and per principal.** Sizing note from device
testing: **iOS retries an XHR roughly three times at the socket level**
before surfacing a single failure to JavaScript, so a server sees about 3x
the connection count this client believes it is making. A limit tuned to
the client's arithmetic will trip at a third of the intended traffic.

**6. Treat every reference as hostile, and defend against SSRF.** `url`,
`api` and any custom reference type are attacker-influenceable strings that
a server or a downstream agent may later fetch. Before any fetch:
allowlist the scheme and host, block loopback, link-local and cloud
metadata addresses (`169.254.169.254` and friends), refuse redirects that
leave the allowlist, and resolve DNS once and connect to that address so a
name cannot rebind between check and use.

**7. Have a retention, deletion and access policy — and say what it is.**
The whole question lands here because the client answers none of it: it
captures, uploads, deletes its temp file and keeps no copy, cache or index
(see [Where a screenshot lives](./security-and-privacy.md#where-a-screenshot-lives)). Retention is a policy call about your
data on your infrastructure, not a default dev tooling should pick for
you. A
screenshot is the whole screen, not the selected element: notifications,
another app behind a transparent surface, a password field mid-type,
whatever personal data was on the page. Team conversations are ordinary
personal data too. Decide who can read them, how long they are kept, how a
deletion propagates to attachments, and whether access is audited.

**8. Conformance: a compliant server rejects all of these.** Worth wiring
into a test suite, since every one of them is something this client can be
made to send by anything that is not this client:

| Request | Expected |
|---|---|
| Body over the server's size limit | 413, nothing stored |
| Annotation text over the text limit | 400 or truncation, never unbounded storage |
| More references than the list limit | 400 or clamp |
| Screenshot upload whose bytes are not the declared image type | 415, file discarded |
| Screenshot upload over the byte or dimension cap | 413 |
| Read or mutate an annotation belonging to another session | 403/404, and identical timing either way |
| A valid id presented by an unauthorized caller | 403/404 — never "the id exists, so you may" |
| `authorName` set on an authenticated request | ignored, attribution from the session |
| Reference `url` pointing at `127.0.0.1`, `169.254.169.254`, or a private range | refused before any fetch |
| Malformed JSON, or an SSE frame never terminated | rejected without unbounded buffering |
