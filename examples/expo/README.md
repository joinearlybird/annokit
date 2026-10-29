# Expo example

A new Expo app with the overlay added — nothing else. It was made with the
commands below, and they are the whole setup guide.

## How it was made

```bash
# 1. A new app, exactly as the scaffold makes it (Expo SDK 58).
npx create-expo-app@latest annokit-example-expo --yes

# 2. The overlay, and the optional peers that each switch a feature on.
npx expo install @joinearlybird/annokit \
  react-native-view-shot react-native-svg expo-sensors expo-paste-input
```

3. Wrap the root layout, [`src/app/_layout.tsx`](./src/app/_layout.tsx), in
   `<AnnoKitProvider>`. That is the whole integration: no navigation
   changes, nothing in the components you want to annotate.
4. Name the server and the session in
   [`.env.local.example`](./.env.local.example), as `EXPO_PUBLIC_*`
   variables. Props on the provider would do the same and win if both are
   set.

The same four steps work in an app you already have. One more change here
is housekeeping for a shared example, not setup: the first `npx expo
run:ios` writes a bundle identifier built from your Expo username into
`app.json` and points the `ios`/`android` scripts at `expo run:*`. This
example commits both with a neutral identifier, `com.example.annokit`, so
nobody's first run leaves a diff.

## Run it

```bash
npm install
cp .env.local.example .env.local
npx annokit server   # terminal 1: the stub on :4788, with the first agent installed
npm run ios           # terminal 2, the first time: builds the app, then starts Metro
```

`npm run ios` is `expo run:ios`, a development build with every native
module installed here (`npm run android` likewise). Expo Go lacks some of
them; the overlay falls back without them, but a development build shows
all of it. iOS asks once whether to open the app from the dev server: tap
**Open**.

After the first build, `npm start` and press `i` (or `a` for Android) is
enough. Start them in either order: the overlay keeps trying until the stub
answers, then appears.

**On a physical phone,** start the stub with `HOST=0.0.0.0 npx
annokit server`. It is then open to your network, so it asks for a token:
it prints the `EXPO_PUBLIC_ANNOKIT_ENDPOINT` (your computer's address) and
`EXPO_PUBLIC_ANNOKIT_TOKEN` lines to put in `.env.local`. Restart Metro
after changing it. The Android emulator needs no token: use
`http://10.0.2.2:4788`, which the stub also prints.

**Keep Metro on the default 8081.** Without `expo-dev-client` there is no
dev launcher to point the app somewhere else, and `expo run:ios --port <n>`
does not bake the port into the native project — the build looks for Metro
on 8081 and shows a red *"No script URL provided"* if it is not there.

**Use a simulator or device, not `w` for web.** Component identity comes
from React DevTools' global hook, which Metro installs in a native dev
bundle and which does not exist on web. On web the overlay still mounts,
connects and arms, but aiming reports nothing and marks are position-only.
The console says which mode you are in:

```
[annokit] no DevTools-hook inspector available; annotation will be position-only
```

## What this example demonstrates

- **Env configuration.** `EXPO_PUBLIC_ANNOKIT_ENDPOINT` and
  `EXPO_PUBLIC_ANNOKIT_SESSION_ID` are read as the fallback tier; props win
  if you pass them. Metro inlines these values into the bundle, so they are
  **not secrets**.
- **Component identity.** Annotating a heading reports `ThemedText` with
  its file and line, because the overlay walks React's fiber tree for the
  nearest component you would actually edit.
- **Route-keyed marks.** The template has two tabs. Marks are tagged with
  the pathname, so each screen shows only its own, and opening a note from
  another screen navigates there first. That comes from `expo-router`.
- **Every optional peer installed** — screenshots, vector icons, shake to
  arm, and pasting an image into the composer. The bare example leaves them
  out, to show the fallbacks.

## Assets

**+ Attach → Assets** in the composer lists this app's `assets/` folder,
served by the stub. A picked asset goes to the agent as its repo path, e.g.
`assets/images/icon.png`, which it can open and `require()`. Pasting an
image into the composer saves it to `assets/uploads/`. See
[docs/assets.md](../../docs/assets.md).

## Trying a change to the package

This app installs the published package. To run an unreleased change in it,
from the repository root: `npm run examples:local -- expo`, then restart
Metro with `--clear`. See [the examples guide](../README.md#trying-an-unreleased-change).

## If nothing appears

The overlay is silent by design when it cannot activate. In order:

1. Is the stub running? `curl localhost:4788/health` should return
   `{"status":"ok","protocolVersion":1,…}`.
2. Does `.env.local` exist? Copying it is a separate step from installing.
3. Restart Metro after changing `.env.local` — `EXPO_PUBLIC_*` is inlined at
   bundle time, so an already-running Metro will not pick it up.
4. Check the console. Activation failures are logged with the host redacted,
   never silent.
