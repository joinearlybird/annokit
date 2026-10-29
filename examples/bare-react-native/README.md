# Bare React Native example

A new React Native app, with no Expo anywhere, and the overlay added. It
was made with the commands below, and they are the whole setup guide.

## How it was made

```bash
# 1. A new app, exactly as the React Native CLI makes it (RN 0.88).
npx @react-native-community/cli@latest init AnnoKitExampleBare \
  --directory bare-react-native --skip-git-init --install-pods false

# 2. The overlay, with screenshots. The other optional peers are left out.
npm install @joinearlybird/annokit react-native-view-shot
```

3. Wrap the app in `<AnnoKitProvider>` in [`App.tsx`](./App.tsx), with
   `endpoint` and `sessionId` as props.

That is all. There is no Metro or Babel change: an installed package
resolves like any other dependency.

## The one real difference from Expo

Metro outside Expo does not inline `EXPO_PUBLIC_*`, so there is nothing for
the env fallback to read. You pass `endpoint` and `sessionId` as **props**,
which is the documented first tier anyway:

```tsx
<AnnoKitProvider endpoint={ANNOTATE_ENDPOINT} sessionId="example-session">
```

The endpoint is platform-aware (`Platform.select` in `App.tsx`) because
`localhost` inside an Android emulator is THE EMULATOR — `10.0.2.2` is the
alias for your machine. Pointed at localhost, the overlay silently never
activates, since the health check it gates on cannot resolve. Because
10.0.2.2 is not loopback, the package also warns once that the endpoint is
plaintext to a remote host, which is correct and expected here.

On a **physical device** `localhost` is the device, not your machine — use
your machine's LAN address in `App.tsx`, and start the stub with
`HOST=0.0.0.0 npx annokit server`.

## Run it

```bash
npm install
bundle install && (cd ios && bundle exec pod install)   # once, for iOS

npx annokit server   # terminal 1: the stub on :4788
npm start             # terminal 2: Metro on :8081
npm run ios           # terminal 3 (or npm run android)
```

## Android

Three things that stop a React Native Android build dead without saying so
clearly:

- **A supported JDK.** A JDK newer than React Native supports fails with a
  CMake configure error mentioning "a restricted method in
  java.lang.System", which names neither Java nor the version. Android
  Studio bundles a supported one:
  `JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" npm run android`.
- **CMake new enough to read the SDK.** `[CXX5304] This version only
  understands SDK XML versions up to 3` means the installed CMake predates
  the SDK's package format: `sdkmanager "cmake;4.0.2"`.
- **An emulator that boots.** `-gpu swiftshader_indirect` gets one up when
  the default hangs on QEMU threads.

## What degrades without the optional peers

Nothing breaks. Each capability is checked where it is used, not assumed at
import:

| Missing peer | Effect |
|---|---|
| `expo-router` | One route for every mark; the notes list opens a note where you stand instead of navigating to it |
| `expo-sensors` | Shake-to-arm is inert; the floating button still arms |
| `react-native-svg` | Icons fall back to monochrome text glyphs — the floating button wears a text pencil rather than a vector one |
| `expo-paste-input` | Pasting an image into the composer is not offered |

`react-native-view-shot` **is** installed here, because screenshots are worth
seeing. Remove it and the camera button simply stops appearing.

## Trying a change to the package

This app installs the published package. To run an unreleased change in it,
from the repository root: `npm run examples:local -- bare-react-native`,
then restart Metro with `--reset-cache`. See
[the examples guide](../README.md#trying-an-unreleased-change).
