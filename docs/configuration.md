# Configuration

## One provider, at the root

**Mount exactly one, at the root.** The overlay is app-wide chrome, like a
status bar: one instance owns the session, the marker anchors, the event
stream and the identity for the whole app. A second provider — nested, or
side by side in a split view — would share and overwrite all of that, so
the package detects it and says so in development rather than failing in
ways that are hard to attribute. Different screens do not need their own;
route-keyed markers already come from `expo-router` (see [Peer
dependencies](#peer-dependencies)).

## Props (props-first, env fallback)

| Prop | Env fallback | Meaning |
|---|---|---|
| `endpoint` | `EXPO_PUBLIC_ANNOKIT_ENDPOINT` | Protocol base URL; all routes below hang off it |
| `sessionId` | `EXPO_PUBLIC_ANNOKIT_SESSION_ID` | Annotation session id |
| `token` | `EXPO_PUBLIC_ANNOKIT_TOKEN` | Optional bearer token |
| `author` | `EXPO_PUBLIC_ANNOKIT_AUTHOR_ID` / `_NAME` | Who is using this device (`{id?, name?, avatarUrl?}`) — see [Who you are](./protocol.md#who-you-are). The prop and the env variables are *different tiers*, not fallbacks for each other |
| `enabled` | — | Explicit off-switch (`false` disables even with config) |
| `skipComponents` | — | Extra component names / RegExps hidden from annotation identity |
| `screenshots` | — | Allow screenshot capture (default `true`). `false` means the screen is never captured at all: no Screenshot switch, no temp file, `screenshotUri` always null |
| `debug` | `EXPO_PUBLIC_ANNOKIT_DEBUG` | Verbose diagnostic logging (anchoring, re-anchoring, protocol flavour). Failures are logged regardless |
| `shakeToToggle` | — | Shake the device to arm/disarm (default on; needs `expo-sensors`) |
| `theme` | — | `"system"` (default), `"light"` or `"dark"` — the host's preferred appearance. See [Settings](./settings.md) |
| `outputDetail` | — | `"minimal"`, `"standard"` (default) or `"full"` — how much context an agent task carries |
| `agentBanner` | — | Show the "agent is working" banner (default `true`). Only ever appears when the server sets `status: "working"`; the settings panel can turn it off for the session |
| `blockSendWhileWorking` | — | Refuse to send a new task while one is `working`. Defaults to `true`, or to `false` when the server's `/health` says `queuesTasks: true`. Turn it off for a server that runs tasks in parallel — one worktree per task — or that queues them but does not say so |
| `agentAccent` / `teamAccent` | — | Default marker colours (`"violet" \| "blue" \| "teal" \| "green" \| "amber" \| "orange" \| "rose"`). They must differ; the team's moves if they collide |
| `textTone` | — | Default text colour: `"neutral"` (default), `"cool"` (Slate), `"warm"` (Stone), `"navy"`, `"forest"`, `"plum"` or `"contrast"`. See [Settings](./settings.md) |
| `timeouts` | — | Request ceilings in ms: `{ read?, mutate?, upload? }` (defaults `10000` / `15000` / `30000`). Unset keys keep their default; a timeout cannot be switched off |
| `attachmentSources` | — | The composer's **+ Attach** tabs, as `AttachmentSource[]`. Defaults to the built-in asset-library source; see [References](./protocol.md#references-attach-panel) for the extension contract |

`outputDetail`, `agentBanner`, `blockSendWhileWorking`, the two accents and
`textTone` are **defaults, not locks**: the settings panel overrides each of them for
the session, exactly like `author` vs the prompted name, and
because nothing is persisted a reload hands control back to these props.

Props always win; the `EXPO_PUBLIC_*` variables are the Earlybird
platform's wiring convention (injected into `app/.env.local` by its dev
sandbox), not part of the protocol. The overlay is a strict no-op —
children rendered untouched, no requests, no listeners — unless
**`__DEV__`** is true AND an endpoint + sessionId resolve. The `__DEV__`
gate is absolute: the overlay never activates in a production/store build.
It is still *bundled* there, though: importing the package statically pulls
in the whole runtime. To keep it out of a release bundle, require it only
under `__DEV__` and render plain children otherwise.

On activation the provider calls `GET {endpoint}/health` once and disables
itself with a `console.warn` if `protocolVersion` differs from the version
it speaks (currently `1`). It never crashes the host app; all transport
errors are logged and swallowed.

## Peer dependencies

Required, with the floors the source actually sets:

- `react >=18.0.0` — `useSyncExternalStore` is used directly, and 18.0 is
  the first release that has it.
- `react-native >=0.69.0` — the first React Native carrying React 18, so the
  line above decides this one. **Derived, not tested:** the verified pair is
  RN 0.86.2 with React 19.2.3, and a compatibility matrix is still open work.

The four below are optional, each resolved by a guarded `require` and
capability-checked function by function, so a missing module — or a version
without one of the functions — degrades instead of breaking. Their ranges
are deliberately left open for that reason.
- `expo-router` — optional; provides route-keyed markers (`usePathname`) and
  the jump from the **Comments** list to a note on another screen
  (`router.navigate`). Without it markers are not filtered per screen and the
  notes list opens a note where you stand instead of travelling to it.
- `react-native-view-shot` — optional; captures the screenshot the composer
  offers behind its camera button. The require is guarded and `captureScreen`
  and `releaseCapture` are checked independently, so a host without it (node
  tests, SSR) degrades to screenshots-off rather than crashing at import, and
  a device build without the native module simply never shows the control.
  It was declared **required** until 2026-09-17, which the guarding had never
  matched.
- `expo-sensors` — optional; enables shake-to-arm (a shake toggles annotate
  mode, debounced to one toggle per gesture). Without it the `shakeToToggle`
  prop is simply inert. The FAB works either way.
- `expo-paste-input` — optional; lets an image be pasted into the composer
  (React Native's own TextInput takes text only). Text still pastes as
  before. A pasted image is uploaded to the server's `POST /assets` when the
  task or note is sent and attached as an `asset` reference, so the agent
  can open it ([assets.md](./assets.md)). It needs `expo` and a native
  rebuild; the overlay checks that the native module is in the build, so a
  JS-only install leaves the composer text-only rather than crashing. A
  server that takes no uploads gets a message, and the send waits.
- `react-native-svg` — optional; draws the overlay's icons as Lucide vector
  paths instead of text glyphs (`src/icon-set.ts`, ISC-licensed path data
  inlined — `lucide-react-native` is deliberately not a dependency). Without
  it every icon falls back to the monochrome character it has always used.
