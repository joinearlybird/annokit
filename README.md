# AnnoKit

**Tap any element in your React Native app, say what should change, and
send it to your AI coding agent — or to your team.**

<p align="center">
  <img src="https://raw.githubusercontent.com/joinearlybird/annokit/main/docs/media/hero.gif" alt="Aiming at the Welcome to Expo title, which is named ThemedText · themed-text.tsx:11, writing Make this say Ship it and sending it to the agent; a Working banner, then the title reads Ship it; then a team note left on the hints card, and the team notes list" width="360">
</p>

AnnoKit is an in-app annotation overlay for React Native and Expo apps in
development.
Tap an element and it lights up with its real component name and source
location. Write what you mean, then choose who it is for: an **agent task**
goes to a coding agent, which acts on it, and a **team note** goes to your
teammates, who discuss it. Both travel over one small HTTP contract, the
[AnnoKit Protocol](https://github.com/joinearlybird/annokit/blob/main/docs/protocol.md),
so any server that implements it works. The Earlybird app builder is the
reference implementation.

## Features

- **Real component identity.** Aiming names the nearest user component —
  `PrimaryButton`, not `View` — symbolicated to its definition site
  (`FeedRow · FeedRow.tsx:9`). Drag to survey before you commit.
- **One mark, two destinations.** Write the sentence first; the button you
  tap to send is the choice: **Comment** for the team, **Create Agent Task**
  for the agent.
- **Context the agent can act on.** Component stack, testID, nearby text,
  an optional screenshot and attached references — trimmed to the
  [Output Detail](https://github.com/joinearlybird/annokit/blob/main/docs/settings.md)
  level you choose.
- **Markers on the element.** Every task and note leaves a marker anchored
  to the element it was made on, re-measured as the screen scrolls.
- **The answer comes back to the device.** Agent replies land in the task's
  thread; reply yourself and the task is reopened for another pass.
- **Development only.** Inert outside `__DEV__`, zero runtime dependencies,
  and every native integration is an optional peer that degrades instead of
  breaking.

## What it looks like

| | | | |
|---|---|---|---|
| <img src="https://raw.githubusercontent.com/joinearlybird/annokit/main/docs/media/toolbar.png" width="180" alt="The toolbar expanded at the bottom of the screen: Annotate, Queue with 2, Comments with 2, Settings and Close, over a screen with two blue task markers and an orange note marker"> | <img src="https://raw.githubusercontent.com/joinearlybird/annokit/main/docs/media/aim-selected.png" width="180" alt="The Welcome to Expo title outlined and labelled ThemedText · themed-text.tsx:11, with an Annotate chip below it and the Element chip at the top of the screen"> | <img src="https://raw.githubusercontent.com/joinearlybird/annokit/main/docs/media/composer-destinations.png" width="180" alt="The composer sheet naming ThemedText · themed-text.tsx:11, the request Make this say Ship it, attach and screenshot controls, an Opus 5.5 agent pill, and Comment and Create Agent Task buttons"> | <img src="https://raw.githubusercontent.com/joinearlybird/annokit/main/docs/media/markers.png" width="180" alt="Blue numbered agent-task markers on the title and the Get started label, and an orange team-note marker on the hints card"> |
| **Toolbar** | **Aim** | **Compose** | **Markers** |
| <img src="https://raw.githubusercontent.com/joinearlybird/annokit/main/docs/media/queue.png" width="180" alt="The queue with Queue 2 and Done tabs: two tasks, each with a checkbox and a delete cross, and a Send all button"> | <img src="https://raw.githubusercontent.com/joinearlybird/annokit/main/docs/media/notes.png" width="180" alt="Team notes grouped by screen: Home (this screen) with Sam's note and 3 replies, then /explore with one note, each marked Open"> | <img src="https://raw.githubusercontent.com/joinearlybird/annokit/main/docs/media/task-detail.png" width="180" alt="An agent task's detail: the request Make this say Ship it under a Reopened chip, the run line Claude Code, Done, 1 file, 33s, the agent's reply naming the line it changed in src/app/index.tsx, a follow-up asking for an exclamation mark, and a Send refinement to agent button"> | <img src="https://raw.githubusercontent.com/joinearlybird/annokit/main/docs/media/note-detail.png" width="180" alt="A team note's detail, expanded: a four-message discussion between You and Dana, an Agent task chip on Dana's last message, a Tasks (1) tab, and Resolve and Create agent task buttons"> |
| **Queue** | **Team notes** | **Task detail** | **Note detail** |

Captured from [`examples/expo`](https://github.com/joinearlybird/annokit/tree/main/examples/expo)
on the iOS Simulator (Expo SDK 58, React Native 0.88, Fabric), talking to
the example stub server with Claude Code as the agent. The agent's replies
and edits are real.
[How it works](https://github.com/joinearlybird/annokit/blob/main/docs/how-it-works.md)
walks through each surface.

## Quick start

From nothing to annotating on the iOS Simulator in about five minutes.
This is exactly how the
[Expo example](https://github.com/joinearlybird/annokit/blob/main/examples/expo)
was made, and `npm run verify:starter -- --fresh` repeats it against the
latest scaffold. Already have an app? Skip the first command; the steps
are the same.

**Using a coding agent?** Install the setup skill, then ask the agent to
"set up AnnoKit in this app". It works with Claude Code, Codex, Cursor
and other agents, and follows the steps below:

```bash
npx skills add joinearlybird/annokit --skill annokit-setup
```

**1. Install.** In a new Expo app:

```bash
npx create-expo-app@latest my-app --yes
cd my-app
npx expo install @joinearlybird/annokit \
  react-native-view-shot react-native-svg expo-sensors expo-paste-input
```

In a bare React Native app, `npm install @joinearlybird/annokit`.
It requires `react >=18` and `react-native >=0.69`. Everything else is
optional, and each one switches a feature on:

| Optional peer | Adds |
|---|---|
| `react-native-view-shot` | Screenshots in the composer |
| `react-native-svg` | Vector icons (text glyphs without it) |
| `expo-router` | Markers per screen, and jumping to a note on another screen |
| `expo-sensors` | Shake to arm |
| `expo-paste-input` | Paste an image into the composer; it is uploaded to the app's assets and attached |

**2. Wrap your app root** in the provider. Mount exactly one. For Expo
Router that is the root layout, `src/app/_layout.tsx` in a new app:

```diff
+import { AnnoKitProvider } from '@joinearlybird/annokit';
 import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
 …
   return (
-    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
-      <AnimatedSplashOverlay />
-      <AppTabs />
-    </ThemeProvider>
+    <AnnoKitProvider>
+      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
+        <AnimatedSplashOverlay />
+        <AppTabs />
+      </ThemeProvider>
+    </AnnoKitProvider>
   );
```

**3. Point it at a server.** The overlay does nothing until an endpoint and
a session id resolve. In Expo, put them in `.env.local`:

```bash
printf 'EXPO_PUBLIC_ANNOKIT_ENDPOINT=http://localhost:4788\nEXPO_PUBLIC_ANNOKIT_SESSION_ID=dev\n' > .env.local
```

Or pass them as props, which win over the env and are the only option
without Expo:
`<AnnoKitProvider endpoint="http://localhost:4788" sessionId="dev">`.
`localhost` works on the iOS Simulator; use `10.0.2.2` on the Android
emulator and your computer's LAN address on a physical device.

**4. Run it.** The package ships a stub server that implements the whole
protocol in memory, using nothing but Node:

```bash
npx annokit server   # terminal 1: the stub on :4788
npx expo run:ios      # terminal 2: builds the app and starts Metro
```

iOS asks once whether to open the app from the dev server: tap **Open**.
Then tap the floating pencil (or shake the device), tap the "Welcome to
Expo" title, and write what should change. On a physical device,
`HOST=0.0.0.0 npx annokit server` opens the stub to your network and
prints the endpoint and token to use.

### Watch an agent act on it

The stub hands each task you send to the first coding agent it finds on
your `PATH` — Claude Code, Codex, Cursor, OpenCode, Gemini CLI or Grok —
running headless in the directory you started it from. That is your app,
so Metro hot-reloads the edit onto the device that asked for it:

```bash
npx annokit server                # edits in place, hot reloads
npx annokit server --worktree     # a branch per task, in parallel
npx annokit server --no-agent     # store tasks only; nothing acts on them
```

It writes to your files, and every run names the ones it changed. It is a
stub for trying this out, not a server to deploy; the
[examples guide](https://github.com/joinearlybird/annokit/blob/main/examples/README.md)
covers the trade-offs, opening pull requests, and plugging in your own agent.

### Coming from annotate-react-native

AnnoKit was published as `@joinearlybird/annotate-react-native` up to
0.7.1. Swap the package:

```bash
npm uninstall @joinearlybird/annotate-react-native
npx expo install @joinearlybird/annokit   # or: npm install @joinearlybird/annokit
```

Then rename what your app refers to: the import path, every `Annotate*`
export to `AnnoKit*` (`AnnotateProvider` is now `AnnoKitProvider`, and
`useAnnotate` is `useAnnoKit`),
`EXPO_PUBLIC_ANNOTATE_*` variables to `EXPO_PUBLIC_ANNOKIT_*`, and
`npx annotate-server` to `npx annokit server`. The protocol is unchanged,
so a server you built keeps working.

## Configuration

The props most apps set. Each has an `EXPO_PUBLIC_ANNOKIT_*` fallback where
noted, and props always win.

| Prop | Meaning |
|---|---|
| `endpoint` | Protocol base URL (`EXPO_PUBLIC_ANNOKIT_ENDPOINT`) |
| `sessionId` | Annotation session id (`EXPO_PUBLIC_ANNOKIT_SESSION_ID`) |
| `token` | Optional bearer token (`EXPO_PUBLIC_ANNOKIT_TOKEN`) — not a secret; see below |
| `author` | Who is using this device: `{ id?, name?, avatarUrl? }` |
| `enabled` | `false` turns the overlay off even when configured |
| `outputDetail` | `"minimal"`, `"standard"` (default) or `"full"` — how much context a task carries |
| `screenshots` | `false` means the screen is never captured at all |

The full list — theme, marker colours, timeouts, attachment sources,
headless capture and UI overrides — is in
[Configuration](https://github.com/joinearlybird/annokit/blob/main/docs/configuration.md).

## Writing a server

Any server that speaks the
[AnnoKit Protocol](https://github.com/joinearlybird/annokit/blob/main/docs/protocol.md)
works. Routes are relative to `endpoint` and bodies are JSON. A client given
a `token` sends `Authorization: Bearer <token>` on every request. The
[stub server](https://github.com/joinearlybird/annokit/blob/main/server/stub-server.mjs)
speaks every route in one file, and a test holds it to the shapes the
client reads, which makes it a good starting point. It keeps everything in
memory and has no authorization, so it is not a server to deploy.

The agent-task routes use the same paths as
[Agentation](#agentation)'s server, `agentation-mcp`, so the overlay can
also talk to one of those. See below for what changes when it does.

Reads and the team-note routes answer with their JSON body; the agent-task
writes only need a `2xx`. Never redirect: the client refuses every redirect.

### Routes

**Agent tasks** (annotations) are the core. Implement these first:

| Route | Request body | Response |
|---|---|---|
| `GET /health` | | `{"status":"ok","protocolVersion":1}` |
| `POST /sessions` | `{"id"?, "url"?, "title"?}` | `201`, the session. An existing `id` is reused, not an error |
| `POST /sessions/:sid/annotations` | [Annotation](#annotation-the-client-sends) | any `2xx`. A body is optional, and an `id` in it replaces the client's |
| `GET /sessions/:sid/pending` | | `[Annotation, …]` or `{"annotations":[…]}` |
| `POST /annotations/send` | `{"annotationIds":["…"]}`, where `[]` means all pending | any `2xx` |
| `GET /annotations/:aid` | | the stored annotation, with `thread[]` |
| `POST /annotations/:aid/thread` | `{"content":"…"}` | the updated annotation |
| `DELETE /annotations/:aid` | | any `2xx` |
| `POST /annotations/:aid/screenshot` | `multipart/form-data`, one `file` part (PNG) | any `2xx`. Append a `{"type":"screenshot","value":"<image URL>"}` reference to the annotation |

**Team notes** (comments) are optional. Without them, notes are switched
off and everything else works:

| Route | Request body | Response |
|---|---|---|
| `GET /comments?routeName=/home` | | `{"comments":[Comment, …]}`. No `routeName` means every note |
| `POST /comments` | the capture fields below, plus `routeName`, `content` and an optional `authorName` | `{"comment": Comment}` |
| `GET /comments/:id` | | `{"comment": Comment}` |
| `POST /comments/:id/messages` | `{"content":"…", "authorName"?:"…"}` | `{"comment": Comment}` |
| `PATCH /comments/:id` | `{"status":"open"\|"resolved"}` | `{"comment": Comment}` |
| `DELETE /comments/:id` | | any `2xx` |
| `POST /comments/:id/screenshot` | the same upload as for annotations | any `2xx` |

**Extras** are optional too. A missing route degrades quietly:

| Route | What it adds |
|---|---|
| `GET /me` → `{"id","name"?,"avatarUrl"?}` or `{"id":null}` | Who is holding the device, for team notes. Never answer `401` |
| `GET /sessions/:sid/events` | Server-sent events. Any event makes the client re-read now. The pending list is not polled, so a server that runs agents needs this for status changes to show up promptly |
| `GET /assets` → `{"assets":[{path, name, publicPath, previewUrl?, size, uploaded}]}` | The asset library in the composer's Attach panel |

### Annotation the client sends

```jsonc
{
  "id": "3f1c…",                        // client-generated UUID: a retry repeats it, so treat a known id as the same annotation
  "comment": "Make this button green",
  "kind": "feedback",
  "platform": "native",
  "element": "PrimaryButton",           // nearest user component
  "componentStack": ["HomeScreen", "Card", "PrimaryButton"],  // root → leaf; [] unless Output Detail is Full
  "source": { "file": "app/src/Card.tsx", "line": 4 },        // optional
  "testID": "card-cta",                 // optional
  "routeName": "/home",                 // optional
  "x": 120, "y": 340,                   // tap point, window coordinates
  "boundingBox": { "x": 52, "y": 179.7, "width": 62, "height": 17 },
  "scroll": { "offsetY": 480 },         // offset of the owning scroll container
  "nearbyText": "Get started",          // optional, from Standard detail up
  "references": [                       // optional; omitted when nothing is attached
    { "type": "asset", "value": "/api/assets/brand/logo.png", "label": "logo.png" }
  ]
}
```

Every field beyond `id`, `comment` and `kind` is context for the agent, so
store what you receive. The spec covers area captures (`elements[]`),
Full-detail fields and tasks created from a team note.

### What the server sends back

A **stored annotation** is the body above plus the fields the server owns:

```jsonc
{
  "id": "3f1c…", "comment": "Make this button green", /* …the captured fields… */
  "status": "pending",                  // pending | working | anything else (finished)
  "thread": [
    { "id": "m1", "content": "Done: it now uses the brand green.", "role": "agent", "timestamp": "2026-10-26T18:40:00.000Z" },
    { "id": "m2", "content": "A little darker?", "role": "user", "timestamp": "2026-10-26T18:42:10.000Z" }
  ]
}
```

A **comment** (team note) is:

```jsonc
{
  "id": "cmt-1", "routeName": "/home", "status": "open",   // open | resolved (older notes may say converted)
  "element": "FeedRow", /* …the same captured fields… */
  "author": { "id": "u1", "name": "Ada", "avatarUrl": "https://…" },
  "messages": [
    { "id": "cmsg-1", "content": "Is this the right label?", "author": { "id": "u1", "name": "Ada" }, "createdAt": "2026-10-26T18:43:16.153Z" }
  ],
  "createdAt": "…", "updatedAt": "…"
}
```

### Rules that matter

- **`status` drives the client.** `pending` and `working` stay in the queue.
  `working` shows a banner and pauses Send. Any other value means finished.
  **Clear `working` on every exit path**, including crashes and restarts, or
  Send stays blocked.
- **Answer in the thread.** Post a `role: "agent"` message to say what was
  done. The server assigns `role`, `id` and `timestamp`, and a client reply is
  always `user`.
- **A user reply reopens the task.** Set it back to `pending`. A reply that
  arrives while the task is `working` should reopen it when the run ends.
  An agent reply must not reopen it.
- **The server owns identity and security.** It resolves authors, ignores
  `authorName` once it authenticates callers, authorizes every request, and
  bounds every input. See the
  [server obligations](https://github.com/joinearlybird/annokit/blob/main/docs/protocol.md#server-obligations).

## Agentation

Inspired by [Agentation](https://github.com/benjitaylor/agentation), which
does this for web pages in a desktop browser. This is not a port or a
clone: a React Native app has no DOM, no CSS selectors and no browser to
host a toolbar, so this overlay is its own project, built for native apps
on a device or simulator, and shares no code with Agentation.

**The two interoperate.** The AnnoKit Protocol's agent-task routes use the
same paths as `agentation-mcp`'s HTTP API: `/sessions`,
`/sessions/:id/annotations`, `/sessions/:id/pending`, `/annotations/:id` and
the `/sessions/:id/events` stream. Point `endpoint` at an `agentation-mcp`
server (port 4747 by default) and the overlay notices: its `/health` has no
`protocolVersion`. It then switches to a compatibility mode that maps each
annotation onto that server's field names, so a Claude Code, Codex or
Gemini CLI session already watching Agentation picks up annotations from
your phone, unchanged. That server has no upload routes and no team notes,
so in that mode screenshots, attachments and team notes are off.

**What this package adds**, beyond running natively:

- **The component and its source line.** On the web, CSS selectors and
  class names find the code; React Native has neither. A tap here names the
  nearest component you would edit, with its file and line, symbolicated on
  the device.
- **Team notes, not just agent tasks.** The same capture can go to your
  teammates instead: a signed discussion pinned to the element, which can be
  resolved, and whose messages can be turned into an agent task later.
- **Pictures.** A screenshot of what you saw, an image pasted from the
  clipboard, or a file from the app's own assets, attached to the task.
- **A server that runs the agent.** With `agentation-mcp`, an agent session
  you keep open watches for annotations. `npx annokit server` starts the
  agent itself for each task you send: Claude Code, Codex, Cursor, OpenCode,
  Gemini CLI or Grok, with the model and effort picked in the app. Each run
  is recorded under the queue's Done tab, a reply continues the same agent
  session, and `--worktree` gives every task its own branch, or a pull
  request with `--pr`.
- **A versioned protocol.** `GET /health` reports a `protocolVersion`, and a
  client that does not match turns itself off with a warning instead of
  misreading a server.

## Privacy and security

- **Development builds only.** The `__DEV__` gate is absolute: no prop or
  environment variable activates the overlay in a production build. It is
  still bundled there, so require it only under `__DEV__` if bundle size
  matters.
- **`EXPO_PUBLIC_*` values ship in the app.** Use short-lived, revocable
  tokens, and HTTPS off the local machine.
- **Screenshots are opt-in per capture and show the whole screen.** Nothing
  is captured until you tap the camera; the temp file is deleted on every
  exit; it is only ever sent to your endpoint.
- **Logs never contain the full URL, the token, or request bodies.**
- **The server owns everything after the upload** — authorization,
  retention and limits are listed in the
  [server obligations](https://github.com/joinearlybird/annokit/blob/main/docs/protocol.md#server-obligations).

Details: [Security and privacy](https://github.com/joinearlybird/annokit/blob/main/docs/security-and-privacy.md).
To report a vulnerability, see
[SECURITY.md](https://github.com/joinearlybird/annokit/blob/main/SECURITY.md).

## Documentation

- [How it works](https://github.com/joinearlybird/annokit/blob/main/docs/how-it-works.md) — the design, surface by surface
- [Configuration](https://github.com/joinearlybird/annokit/blob/main/docs/configuration.md) — every prop, and the peer dependencies
- [Settings](https://github.com/joinearlybird/annokit/blob/main/docs/settings.md) — the in-app panel: theme, colours, Output Detail
- [AnnoKit Protocol v1](https://github.com/joinearlybird/annokit/blob/main/docs/protocol.md) — the HTTP contract, for writing your own server
- [Security and privacy](https://github.com/joinearlybird/annokit/blob/main/docs/security-and-privacy.md)
- [Headless capture](https://github.com/joinearlybird/annokit/blob/main/docs/headless-capture.md) — your own UI over the capture engine
- [UI overrides](https://github.com/joinearlybird/annokit/blob/main/docs/ui-overrides.md) — replace the composer or the detail panes
- [Extending attachments](https://github.com/joinearlybird/annokit/blob/main/docs/extending-attachments.md) — custom reference sources
- [Development](https://github.com/joinearlybird/annokit/blob/main/docs/development.md) — working on this package

## Examples

Two apps in this repository, each made with an official scaffold command
and then the steps above — nothing else. Each one's README lists
the commands that made it, and each installs the package from npm. A
[template repository](#in-a-namespace-devbox) runs one in a cloud devbox.

```bash
git clone https://github.com/joinearlybird/annokit.git
```

Run them on a simulator or a device. On web the overlay mounts, but it
cannot identify components.

### Expo

[`examples/expo`](https://github.com/joinearlybird/annokit/blob/main/examples/expo)
is `create-expo-app` with Expo Router, configured by environment variables,
with every optional peer installed.

```bash
cd annokit/examples/expo
npm install
cp .env.local.example .env.local   # endpoint and session id for the stub
npx annokit server                # terminal 1: the stub on :4788
npm run ios                        # terminal 2: builds the app, starts Metro on :8081
```

Keep Metro on port 8081, because the app looks for it there. On a physical
device, set `EXPO_PUBLIC_ANNOKIT_ENDPOINT` in `.env.local` to your
computer's LAN address.

### Bare React Native

[`examples/bare-react-native`](https://github.com/joinearlybird/annokit/blob/main/examples/bare-react-native)
is the React Native CLI's template with no Expo at all. It is configured by
props and leaves out the optional peers, to show the plain fallbacks.

```bash
cd annokit/examples/bare-react-native
npm install
bundle install && (cd ios && bundle exec pod install)
npx annokit server    # terminal 1: the stub on :4788
npm start              # terminal 2: Metro on :8081
npm run ios            # terminal 3 (or npm run android)
```

### In a Namespace devbox

[**annokit-namespace-example**](https://github.com/joinearlybird/annokit-namespace-example)
is a separate template repository. It runs the Expo app on the iOS Simulator
inside a [Namespace](https://namespace.so) devbox and serves it to your
browser, with a panel that shows the simulator's screen next to every task
and note. Point a Namespace blueprint at it (or at your fork) with the init
command `npm ci && npm run devbox`. Then annotate from the browser, and an
agent on the devbox makes the change.

<p align="center">
  <img src="https://raw.githubusercontent.com/joinearlybird/annokit-namespace-example/main/docs/media/panel.png" alt="The devbox panel in a desktop browser: the simulator showing the app with a green Ship it button, beside an agent task marked Needs review with before and after screenshots and its diff, and a team note thread">
</p>

Each example's README covers the details, including known build issues.
The [examples guide](https://github.com/joinearlybird/annokit/blob/main/examples/README.md)
covers agent mode: a branch per task, opening pull requests, and plugging
in your own agent.

## Contributing

```bash
npm ci && npm run check && npm test
```

Node 22.12 or newer. A pull request that changes the package also runs
`npm run bump patch` (or `minor`/`major`), and merging it publishes the new
version. See
[Development](https://github.com/joinearlybird/annokit/blob/main/docs/development.md)
for the build, package validation and releases.

## Contact

Questions, ideas or a server you have built against the protocol:
[open an issue](https://github.com/joinearlybird/annokit/issues),
or email **founders@joinearlybird.com**.

## License

MIT © Feliz Labs — see [LICENSE](./LICENSE). Icon paths from
[Lucide](https://lucide.dev), ISC.
