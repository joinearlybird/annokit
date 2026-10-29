/**
 * FIXTURES — the component chains a real iOS DEV CLIENT produced, recorded
 * 2026-08-06 (Expo SDK 57 / react-native 0.86.2 / react 19 / Hermes /
 * Fabric, expo-router + react-navigation native-stack +
 * react-native-screens, react-native-css v3 / NativeWind 5 styling interop).
 *
 * Provenance / honesty note: what the device run captured is the annotation
 * the client POSTed — i.e. the ALREADY-MERGED `componentStack` and the
 * `element` label (see the two recorded stacks quoted verbatim below). The
 * live `hierarchy` array and the `closestInstance` fiber that produced them
 * could not be serialized off the device, so they are RECONSTRUCTED here:
 * the fiber chain is the recorded merged stack minus the trailing entries
 * the old merge appended from the owner chain, and `hierarchy` is the
 * shortest owner chain that reproduces exactly those appended entries.
 *
 * These are the regression fixtures for two device-confirmed bugs:
 *   1. `element: "ForwardRef"` — React/interop wrapper display names
 *      (`ForwardRef`, `CSS(View)`, `RNSScreen*`, `RNCSafeAreaView`) were
 *      not filtered, so a wrapper became the "nearest" component.
 *   2. `element: "HomeScreen"` / `"RootLayout"` — owner-chain names were
 *      APPENDED after the leaf, so a root outranked the touched component.
 */

import { buildFiberChain, type FiberLike } from "./spike-payloads";

/**
 * Recorded verbatim — tap on `PrimaryButton` inside `Card`, which reported
 * `element: "ForwardRef"`.
 */
export const RECORDED_STACK_PRIMARY_BUTTON = [
  "AppContainer", "Content", "NavigationContent", "StaticContainer", "Route()",
  "WrappedScreenComponent", "RootLayout(./_layout.tsx)", "NavigationContent",
  "NativeStackView", "SafeAreaProviderCompat", "RNSScreenStack", "InnerScreen",
  "DelayedFreeze", "Freeze", "Suspender", "RNSScreen", "DebugContainer",
  "RNSScreenContentWrapper", "StaticContainer", "Route(index)",
  "WrappedScreenComponent", "HomeScreen(./index.tsx)", "RNCSafeAreaView",
  "CSS(View)", "Card", "CSS(View)", "PrimaryButton", "CSS(Pressable)",
  "CSS(Text)", "ForwardRef",
];

/**
 * Recorded verbatim — tap on a `FeedRow` below the fold, which reported
 * `element: "HomeScreen"`. The last three entries are what the old merge
 * APPENDED from the owner chain (everything before them is the return-chain
 * walk); `HomeScreen` landing last is bug 2 in one line.
 */
export const RECORDED_STACK_FEED_ROW = [
  "AppContainer", "Content", "NavigationContent", "StaticContainer", "Route()",
  "WrappedScreenComponent", "RootLayout(./_layout.tsx)", "NavigationContent",
  "NativeStackView", "SafeAreaProviderCompat", "RNSScreenStack", "InnerScreen",
  "DelayedFreeze", "Freeze", "Suspender", "RNSScreen", "DebugContainer",
  "RNSScreenContentWrapper", "StaticContainer", "Route(index)",
  "WrappedScreenComponent", "HomeScreen(./index.tsx)", "RNCSafeAreaView",
  "CSS(View)", "FeedRow", "CSS(View)", "CSS(Text)",
  // ↓ owner-chain names the old merge appended AFTER the leaf
  "RootLayout", "ForwardRef", "HomeScreen",
];

/** The shell/route chain both taps share, root→leaf. */
const SCREEN_SHELL = [
  "AppContainer", "Content", "NavigationContent", "StaticContainer", "Route()",
  "WrappedScreenComponent", "RootLayout(./_layout.tsx)", "NavigationContent",
  "NativeStackView", "SafeAreaProviderCompat", "RNSScreenStack", "InnerScreen",
  "DelayedFreeze", "Freeze", "Suspender", "RNSScreen", "DebugContainer",
  "RNSScreenContentWrapper", "StaticContainer", "Route(index)",
  "WrappedScreenComponent", "HomeScreen(./index.tsx)", "RNCSafeAreaView",
];

/** Build a fiber chain from a ROOT→LEAF name list (the recorded reading order). */
function chainFromRootToLeaf(
  specs: Array<{ name: string; host?: boolean; props?: Record<string, unknown> }>,
): FiberLike {
  return buildFiberChain([...specs].reverse());
}

export interface DevClientPayload {
  probe: string;
  hierarchy: Array<{ name: string }>;
  frame: { left: number; top: number; width: number; height: number };
  props: Record<string, unknown> | null;
  componentStack: string;
  closestInstance: FiberLike;
}

/**
 * Tap on `<PrimaryButton>` inside `<Card>` — recorded `element:
 * "ForwardRef"`, expected `PrimaryButton`.
 *
 * Nothing was appended from the owner chain in this recording, so the
 * reconstructed `hierarchy` holds only names the walk already had.
 */
export const DEVCLIENT_PRIMARY_BUTTON: DevClientPayload = {
  probe: "devclient/PrimaryButton-in-Card",
  hierarchy: [
    { name: "Card" },
    { name: "PrimaryButton" },
    { name: "ForwardRef" },
    { name: "Text" },
    { name: "RCTText" },
  ],
  frame: {
    left: 162.9999942779541,
    top: 242.00000476837158,
    width: 76.33332824707031,
    height: 21,
  },
  props: { accessible: true, children: "Get started" },
  componentStack: "",
  closestInstance: chainFromRootToLeaf([
    ...SCREEN_SHELL.map((name) => ({ name })),
    { name: "CSS(View)" },
    { name: "Card" },
    { name: "CSS(View)" },
    { name: "PrimaryButton" },
    { name: "CSS(Pressable)", props: { testID: "card-cta" } },
    { name: "CSS(Text)" },
    { name: "ForwardRef" },
    { name: "RCTText", host: true, props: { children: "Get started" } },
  ]),
};

/**
 * Tap on a `<FeedRow>` below the fold — recorded `element: "HomeScreen"`,
 * expected `FeedRow`. `hierarchy` is reconstructed to reproduce the three
 * owner-chain names the old merge appended (`RootLayout`, `ForwardRef`,
 * `HomeScreen`).
 */
export const DEVCLIENT_FEED_ROW: DevClientPayload = {
  probe: "devclient/FeedRow-below-the-fold",
  hierarchy: [
    { name: "RootLayout" },
    { name: "ForwardRef" },
    { name: "HomeScreen" },
    { name: "FeedRow" },
    { name: "Text" },
    { name: "RCTText" },
  ],
  frame: {
    left: 32.66666603088379,
    top: 498.00000071525574,
    width: 188.6666717529297,
    height: 14,
  },
  props: { accessible: true, children: "Row 14 — annotate me below the fold" },
  componentStack: "",
  closestInstance: chainFromRootToLeaf([
    ...SCREEN_SHELL.map((name) => ({ name })),
    { name: "CSS(View)" },
    { name: "FeedRow" },
    { name: "CSS(View)", props: { testID: "feed-row-14" } },
    { name: "CSS(Text)" },
    {
      name: "RCTText",
      host: true,
      props: { children: "Row 14 — annotate me below the fold" },
    },
  ]),
};
