---
name: annokit-setup
description: Set up AnnoKit (@joinearlybird/annokit), the dev-only in-app annotation overlay, in an Expo or bare React Native app. Installs the package and its optional peers, wraps the app root in AnnoKitProvider, points it at a server, and starts the bundled stub server. Use when the user asks to add, install, set up or configure AnnoKit / annokit / AnnoKitProvider (formerly annotate-react-native), or wants to annotate their React Native app for a coding agent.
---

# Set up AnnoKit

The package is a development-only overlay: the user taps an element in their
running app, writes what should change, and the note goes to a server that
hands it to a coding agent. It is inert outside `__DEV__`, so there is
nothing to strip for production.

Work in the app's root (the directory with its `package.json`). Make the
edits yourself, show the user the diff of the root file, and stop before
building unless they asked you to run the app.

## 1. Look at the project

Decide two things before touching anything:

- **Expo or bare.** It is Expo if `package.json` depends on `expo`. Bare
  React Native has `react-native` and no `expo`.
- **The root component.** Exactly one `AnnoKitProvider` is mounted, as high
  as possible.
  - Expo Router: the root layout, `src/app/_layout.tsx` or `app/_layout.tsx`
    (check `package.json` `main` is `expo-router/entry`).
  - Otherwise: the component registered in `index.js` / `index.ts`, usually
    `App.tsx`.

Also check the package manager from the lockfile (`package-lock.json`,
`yarn.lock`, `pnpm-lock.yaml`, `bun.lock`) and use the same one throughout.
If `@joinearlybird/annokit` is already a dependency and an
`AnnoKitProvider` already exists, skip to step 3 and check the config.

If the app has the old package, `@joinearlybird/annotate-react-native`,
migrate it instead: uninstall it, install `@joinearlybird/annokit` as in
step 2, then rename the import path, `AnnotateProvider` and any other
`Annotate*` imports to `AnnoKit*` (and `useAnnotate` to `useAnnoKit`), `EXPO_PUBLIC_ANNOTATE_*` to
`EXPO_PUBLIC_ANNOKIT_*` (in `.env*` files too), and `annotate-server` to
`annokit server` in scripts. Nothing else changes.

Requirements: `react >=18`, `react-native >=0.69`. If the app is older,
stop and tell the user.

## 2. Install

**Expo** — `npx expo install` picks the peer versions that match the SDK:

```bash
npx expo install @joinearlybird/annokit \
  react-native-view-shot react-native-svg expo-sensors expo-paste-input
```

**Bare** — the package alone works; add peers the user wants:

```bash
npm install @joinearlybird/annokit react-native-view-shot
```

Every peer is optional and switches one feature on. Without one, the
overlay falls back rather than failing:

| Optional peer | Adds |
|---|---|
| `react-native-view-shot` | Screenshots in the composer |
| `react-native-svg` | Vector icons (text glyphs without it) |
| `expo-router` | Markers per screen, jumping to a note on another screen |
| `expo-sensors` | Shake to arm |
| `expo-paste-input` | Paste an image into the composer |

Do not add `expo-router` just for this; use it only if the app already does.
In a bare app, the native peers need `cd ios && pod install` (or
`bundle exec pod install` if there is a `Gemfile`).

## 3. Wrap the root

Import the provider and make it the outermost element the root returns,
around any existing providers. Keep everything else as it was:

```tsx
import { AnnoKitProvider } from '@joinearlybird/annokit';

export default function RootLayout() {
  return (
    <AnnoKitProvider>
      {/* the existing tree, unchanged */}
    </AnnoKitProvider>
  );
}
```

If the root returns a fragment or several providers, wrap all of it. Do not
mount a second provider in a nested layout or screen.

## 4. Point it at a server

The overlay does nothing until an endpoint and a session id resolve.

**Expo** — put them in `.env.local`. Create it if missing, and append to it
if it exists; never overwrite other variables:

```bash
EXPO_PUBLIC_ANNOKIT_ENDPOINT=http://localhost:4788
EXPO_PUBLIC_ANNOKIT_SESSION_ID=dev
```

Check that `.gitignore` covers `.env*.local` (the Expo template does).
These values are inlined into the dev bundle and are not secrets.

**Bare** — there is no `EXPO_PUBLIC_*`, so pass props. Android emulators
reach the host at `10.0.2.2`, not `localhost`:

```tsx
import { Platform } from 'react-native';

const ANNOTATE_ENDPOINT = Platform.select({
  android: 'http://10.0.2.2:4788',
  default: 'http://localhost:4788',
});

<AnnoKitProvider endpoint={ANNOTATE_ENDPOINT} sessionId="dev">
```

Props always win over the env. Which address to use:

| Where the app runs | Endpoint |
|---|---|
| iOS Simulator | `http://localhost:4788` |
| Android emulator | `http://10.0.2.2:4788` |
| Physical device | `http://<computer's LAN IP>:4788`, plus a token (below) |

Other props are optional: `author={{ name }}`, `outputDetail`
(`"minimal" | "standard" | "full"`), `screenshots={false}`,
`enabled={false}`. The full list is in the package's
`docs/configuration.md`.

## 5. Run it

The package ships a stub server, run from the app's root:

```bash
npx annokit server     # terminal 1: the stub on :4788
npx expo run:ios        # terminal 2 (bare: npm start, then npm run ios)
```

Tell the user, rather than running these yourself unless asked: both are
long-running. Then: tap the floating pencil (or shake the device), tap an
element, and write what should change.

What the stub does with a task:

- By default it hands each task to the first coding agent on `PATH`
  (Claude Code, Codex, Cursor, OpenCode, Gemini CLI, Grok), running headless
  in the current directory. **It edits the user's files**; say so.
- `npx annokit server --worktree` runs each task on its own branch.
- `npx annokit server --no-agent` only stores tasks.
- `--port <n>` or `PORT` changes the port; update the endpoint to match.

**Physical device:** `HOST=0.0.0.0 npx annokit server` opens the stub to
the network. It then requires a token and prints the
`EXPO_PUBLIC_ANNOKIT_ENDPOINT` and `EXPO_PUBLIC_ANNOKIT_TOKEN` lines to
use (bare apps pass `token` as a prop). Restart Metro after changing
`.env.local`.

## 6. Check it worked

- The app needs a **native rebuild** after installing native peers
  (`npx expo run:ios`, or a new dev client build). A JS reload is not
  enough.
- To check your edits, use what the project already has (`npx tsc
  --noEmit`, or `npx expo export --platform ios` to bundle). Do not run
  `expo lint` in a project without ESLint: it installs it. Templates can
  carry type errors of their own, so only errors in files you changed are
  yours.
- The stub logs each request. If the overlay never appears, run
  `curl http://localhost:4788/health` to see whether the stub is up.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| No pencil appears | No endpoint or session id resolved, `__DEV__` is false, or the stub is not reachable from the device. Check the env or props, then the address table above. The overlay keeps retrying, so start order does not matter. |
| `.env.local` change ignored | Metro inlines env at bundle time. Restart Metro with `npx expo start -c`. |
| Red "unimplemented component" boxes | The dev client was built before a native peer was added. Rebuild the native app. |
| `401 missing or wrong token` in the app | The stub runs with `HOST=0.0.0.0`. Set `EXPO_PUBLIC_ANNOKIT_TOKEN` (or the `token` prop) to the token it printed. |
| Notes are "position-only", no component names | Running on web. Component identity needs a native dev build on a simulator or device. |
| "No script URL provided" | Metro is not on 8081. Keep the default port. |
| Some features missing in Expo Go | Expo Go lacks some native modules. Use a development build (`npx expo run:ios`). |
| Port 4788 in use | Another stub is running. Stop it, or use `--port` and update the endpoint. |
