/**
 * Inspector adapter (src/inspector.ts) driven by the REAL recorded device
 * payloads in test/fixtures/spike-payloads.ts: component-name filtering,
 * the fiber return-chain walk, testID resolution and the frame mapping.
 *
 * Metro symbolication is switched off here (no scriptURL ⇒ no origin) so
 * these assertions are about identity only; see symbolicate.test.ts.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OVERLAY_TEST_IDS,
  inspectAtPoint,
  isUserComponentName,
  resolveComponentName,
  summarizeAccessibility,
  summarizeStyle,
} from "../src/inspector";
import {
  buildFiberChain,
  buildScrolledChain,
  IMAGE_PAYLOAD,
  PRIMARY_BUTTON_PAYLOAD,
  ROW_ITEM_PAYLOAD,
  VIEW_WITH_TESTID_PAYLOAD,
  type FiberSpec,
  type RecordedPayload,
} from "./fixtures/spike-payloads";
import {
  DEVCLIENT_FEED_ROW,
  DEVCLIENT_PRIMARY_BUTTON,
  RECORDED_STACK_FEED_ROW,
  RECORDED_STACK_PRIMARY_BUTTON,
  type DevClientPayload,
} from "./fixtures/devclient-payloads";
import { installInspectorHook, installInspectorPayload, installReactNativeStub, removeInspectorHook } from "./helpers/stubs";

const cleanups: Array<() => void> = [];
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  // No scriptURL ⇒ metroOrigin() is null ⇒ symbolication is skipped.
  cleanups.push(installReactNativeStub({ scriptURL: null }));
});

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
  warn.mockRestore();
});

function hit(payload: RecordedPayload, skip?: Array<string | RegExp>) {
  cleanups.push(installInspectorPayload(payload));
  return inspectAtPoint({}, 100, 200, skip);
}

// ── Name filtering ────────────────────────────────────────────────────────────

describe("isUserComponentName", () => {
  it("keeps app component names", () => {
    for (const name of ["PrimaryButton", "HomeScreen", "Card", "RowItem", "Logo", "SpikeList"]) {
      expect(isUserComponentName(name), name).toBe(true);
    }
  });

  it("drops host components (lowercase + RCT*)", () => {
    for (const name of ["RCTText", "RCTView", "RCTImageView", "RCTScrollView", "div", "view"]) {
      expect(isUserComponentName(name), name).toBe(false);
    }
  });

  it("drops React built-ins", () => {
    for (const name of ["Fragment", "StrictMode", "Suspense", "Profiler", "Activity"]) {
      expect(isUserComponentName(name), name).toBe(false);
    }
  });

  it("drops React Native primitives", () => {
    for (const name of [
      "View", "Text", "Image", "ScrollView", "FlatList", "VirtualizedList",
      "CellRenderer", "Pressable", "TouchableOpacity", "Modal", "SafeAreaView",
    ]) {
      expect(isUserComponentName(name), name).toBe(false);
    }
  });

  it("drops Expo Go / expo-router shell noise observed in the spike", () => {
    for (const name of [
      "withDevTools(App)", "App", "ExpoRoot", "ContextNavigator", "Route", "RouteNode",
      "Screen", "ScreenStack", "NavigationContainer", "SafeAreaProvider", "Slot", "Stack", "Tabs",
    ]) {
      expect(isUserComponentName(name), name).toBe(false);
    }
  });

  it("drops generic infrastructure name shapes", () => {
    for (const name of [
      "ImageAnalyticsTagContext.Consumer", "ThemeContext", "ThemeProvider", "QueryClientProvider",
      "StackNavigator", "MyRouter", "ErrorBoundary", "AnonymousWrapper", "AnimatedComponent",
      "CssInteropView", "AnnoKitProvider", "AnnoKitRuntime",
    ]) {
      expect(isUserComponentName(name), name).toBe(false);
    }
  });

  it("drops React wrapper display names with no inner identity (R6)", () => {
    for (const name of ["ForwardRef", "Memo"]) {
      expect(isUserComponentName(name), name).toBe(false);
    }
  });

  it("unwraps ForwardRef(X) / Memo(X) to the inner identity (R6)", () => {
    expect(resolveComponentName("ForwardRef(PrimaryButton)")).toBe("PrimaryButton");
    expect(resolveComponentName("Memo(FeedRow)")).toBe("FeedRow");
    expect(resolveComponentName("Memo(ForwardRef(FeedRow))")).toBe("FeedRow");
    // …and the unwrapped name is then subject to R1–R5 like any other.
    expect(resolveComponentName("ForwardRef(View)")).toBeNull();
    expect(resolveComponentName("Memo(RCTView)")).toBeNull();
  });

  it("unwraps expo-router route-file names (R6)", () => {
    expect(resolveComponentName("HomeScreen(./index.tsx)")).toBe("HomeScreen");
    expect(resolveComponentName("RootLayout(./_layout.tsx)")).toBe("RootLayout");
  });

  it("drops react-native-css v3 / NativeWind 5 interop names", () => {
    for (const name of ["CSS(View)", "CSS(Pressable)", "CSS(Text)", "CSS(Image)"]) {
      expect(isUserComponentName(name), name).toBe(false);
    }
  });

  it("drops react-native-screens / community host wrappers", () => {
    for (const name of [
      "RNSScreen", "RNSScreenStack", "RNSScreenContentWrapper", "RNCSafeAreaView",
    ]) {
      expect(isUserComponentName(name), name).toBe(false);
    }
    // The RN*-prefix rule is deliberately narrow (RNS/RNC + capital).
    expect(isUserComponentName("RNGauge")).toBe(true);
  });

  it("drops the SDK-57 navigation shell observed on the dev client", () => {
    for (const name of [
      "AppContainer", "NavigationContent", "StaticContainer", "WrappedScreenComponent",
      "NativeStackView", "SafeAreaProviderCompat", "InnerScreen", "DelayedFreeze",
      "Freeze", "Suspender", "DebugContainer", "Route()", "Route(index)", "Content",
    ]) {
      expect(isUserComponentName(name), name).toBe(false);
    }
  });

  it("drops empty / nullish names", () => {
    expect(isUserComponentName(null)).toBe(false);
    expect(isUserComponentName(undefined)).toBe(false);
    expect(isUserComponentName("")).toBe(false);
  });

  it("honours host-supplied extra skips (string exact, RegExp test)", () => {
    expect(isUserComponentName("Logo", ["Logo"])).toBe(false);
    expect(isUserComponentName("Logotype", ["Logo"])).toBe(true);
    expect(isUserComponentName("RowItem", [/^Row/])).toBe(false);
    expect(isUserComponentName("PrimaryButton", ["Logo", /^Row/])).toBe(true);
  });

  it("extra skips only shrink the result set, never grow it", () => {
    // A skipped builtin cannot be re-admitted by the host list.
    expect(isUserComponentName("View", [/^Never/])).toBe(false);
  });
});

// ── Recorded payloads end-to-end ─────────────────────────────────────────────

describe("inspectAtPoint on recorded device payloads", () => {
  it("PrimaryButton-in-Card: user chain root→leaf, internals filtered", async () => {
    const result = await hit(PRIMARY_BUTTON_PAYLOAD);
    expect(result).not.toBeNull();
    expect(result?.componentStack).toEqual(["HomeScreen", "Card", "PrimaryButton"]);
    expect(result?.element).toBe("PrimaryButton");
    expect(result?.componentStack).not.toContain("RCTText");
    expect(result?.componentStack).not.toContain("withDevTools(App)");
    expect(result?.componentStack).not.toContain("Text");
  });

  it("PrimaryButton-in-Card: window frame maps left/top → x/y", async () => {
    const result = await hit(PRIMARY_BUTTON_PAYLOAD);
    expect(result?.frame).toEqual({
      x: 52,
      y: 179.66666793823242,
      width: 62,
      height: 17,
    });
  });

  it("PrimaryButton-in-Card: nearest ancestor testID comes off the fiber chain", async () => {
    const result = await hit(PRIMARY_BUTTON_PAYLOAD);
    expect(result?.testID).toBe("card-cta");
  });

  it("PrimaryButton-in-Card: nearby string children are captured", async () => {
    const result = await hit(PRIMARY_BUTTON_PAYLOAD);
    expect(result?.nearbyText).toBe("Get started");
  });

  it("View-with-testID: deep Text inside a testID'd ancestor still resolves the testID", async () => {
    // Spike finding 5: `hierarchy` is the OWNER chain — the wrapping
    // <View testID="special-box"> is absent from it. Only the fiber
    // return-chain walk can find it.
    expect(VIEW_WITH_TESTID_PAYLOAD.hierarchy.map((h) => h.name)).not.toContain("View");
    expect(VIEW_WITH_TESTID_PAYLOAD.props?.testID).toBeUndefined();

    const result = await hit(VIEW_WITH_TESTID_PAYLOAD);
    expect(result?.testID).toBe("special-box");
    expect(result?.componentStack).toEqual(["SpecialBox"]);
    expect(result?.element).toBe("SpecialBox");
  });

  // Device-observed: a note on a Card with no testID of its own carried
  // "annokit-push-layer", the overlay's wrapper around the whole app.
  it("skips the overlay's own wrapper testID on the way up to the app root", async () => {
    const result = await hit({
      ...VIEW_WITH_TESTID_PAYLOAD,
      closestInstance: buildFiberChain([
        { name: "RCTText", host: true, props: { children: "Try annotating this card" } },
        { name: "Text" },
        { name: "Card" },
        { name: "RCTView", host: true, props: { testID: "annokit-push-layer" } },
        { name: "AnnoKitRuntime" },
      ]),
    });
    expect(result?.testID).toBeUndefined();
    expect(result?.element).toBe("Card");
  });

  it("still finds an app testID above the touched element, below the wrapper", async () => {
    const result = await hit({
      ...VIEW_WITH_TESTID_PAYLOAD,
      closestInstance: buildFiberChain([
        { name: "RCTText", host: true, props: { children: "Try annotating this card" } },
        { name: "Card", props: { testID: "intro-card" } },
        { name: "RCTView", host: true, props: { testID: "annokit-push-layer" } },
      ]),
    });
    expect(result?.testID).toBe("intro-card");
  });

  it("the overlay's wrapper testID in src/index.tsx is the one the inspector skips", () => {
    const index = readFileSync(join(__dirname, "..", "src", "index.tsx"), "utf8");
    for (const [, id] of index.matchAll(/testID="(annokit-[a-z-]*layer)"/g)) {
      expect(OVERLAY_TEST_IDS.has(id)).toBe(true);
    }
    expect(OVERLAY_TEST_IDS.size).toBeGreaterThan(0);
  });

  it("Image: testID on the touched host node wins (arrives in viewData.props)", async () => {
    const result = await hit(IMAGE_PAYLOAD);
    expect(result?.testID).toBe("logo-image");
    expect(result?.element).toBe("Logo");
    expect(result?.componentStack).toEqual(["Logo"]);
    expect(result?.componentStack).not.toContain("ImageAnalyticsTagContext.Consumer");
  });

  it("FlatList-RowItem: virtualization internals are filtered out of the chain", async () => {
    const result = await hit(ROW_ITEM_PAYLOAD);
    expect(result?.componentStack).toEqual(["SpikeList", "RowItem"]);
    expect(result?.element).toBe("RowItem");
    for (const noise of ["FlatList", "VirtualizedList", "CellRenderer", "VirtualizedListCellContextProvider"]) {
      expect(result?.componentStack).not.toContain(noise);
    }
    expect(result?.testID).toBe("row-3");
  });

  it("skipComponents extends the filter for the whole chain", async () => {
    const result = await hit(ROW_ITEM_PAYLOAD, ["SpikeList"]);
    expect(result?.componentStack).toEqual(["RowItem"]);

    const regexFiltered = await hit(ROW_ITEM_PAYLOAD, [/^Row/]);
    expect(regexFiltered?.componentStack).toEqual(["SpikeList"]);
    expect(regexFiltered?.element).toBe("SpikeList");
  });
});

// ── Recorded DEV-CLIENT payloads (Expo SDK 57, react-native-css/NativeWind 5) ─

describe("inspectAtPoint on recorded dev-client payloads", () => {
  function devHit(payload: DevClientPayload, skip?: Array<string | RegExp>) {
    cleanups.push(installInspectorPayload(payload));
    return inspectAtPoint({}, 200, 252, skip);
  }

  it("BUG 1 REGRESSION: PrimaryButton tap labels PrimaryButton, not ForwardRef", async () => {
    // Device-recorded: element "ForwardRef", stack ending
    // […, "Card", "CSS(View)", "PrimaryButton", "CSS(Pressable)",
    //  "CSS(Text)", "ForwardRef"].
    expect(RECORDED_STACK_PRIMARY_BUTTON.at(-1)).toBe("ForwardRef");

    const result = await devHit(DEVCLIENT_PRIMARY_BUTTON);
    expect(result?.element).toBe("PrimaryButton");
    expect(result?.componentStack).toEqual(["RootLayout", "HomeScreen", "Card", "PrimaryButton"]);
    expect(result?.testID).toBe("card-cta");
    expect(result?.nearbyText).toBe("Get started");
  });

  it("BUG 2 REGRESSION: FeedRow tap labels FeedRow, not the HomeScreen owner", async () => {
    // Device-recorded: element "HomeScreen" — an owner appended after the leaf.
    expect(RECORDED_STACK_FEED_ROW.at(-1)).toBe("HomeScreen");

    const result = await devHit(DEVCLIENT_FEED_ROW);
    expect(result?.element).toBe("FeedRow");
    expect(result?.componentStack).toEqual(["RootLayout", "HomeScreen", "FeedRow"]);
    expect(result?.testID).toBe("feed-row-14");
  });

  it("owner-chain names never land after the leaf (they are context, not proximity)", async () => {
    // `hierarchy` here ends with names the walk does not have; they must be
    // folded in BEFORE the spine so `element` stays the touched component.
    const payload: DevClientPayload = {
      ...DEVCLIENT_FEED_ROW,
      hierarchy: [...DEVCLIENT_FEED_ROW.hierarchy, { name: "RootLayout" }, { name: "AppShell" }],
    };
    const result = await devHit(payload);
    expect(result?.element).toBe("FeedRow");
    expect(result?.componentStack).toEqual(["AppShell", "RootLayout", "HomeScreen", "FeedRow"]);
  });

  it("the cleaned stack keeps no wrapper, interop or screens-host names", async () => {
    const result = await devHit(DEVCLIENT_PRIMARY_BUTTON);
    for (const noise of [
      "ForwardRef", "CSS(View)", "CSS(Pressable)", "CSS(Text)", "RNSScreen",
      "RNSScreenStack", "RNSScreenContentWrapper", "RNCSafeAreaView", "AppContainer",
      "NavigationContent", "NativeStackView", "Route()", "Route(index)",
      "WrappedScreenComponent", "Freeze", "DelayedFreeze", "Suspender",
      "SafeAreaProviderCompat", "DebugContainer", "InnerScreen", "StaticContainer",
      "RootLayout(./_layout.tsx)", "HomeScreen(./index.tsx)",
    ]) {
      expect(result?.componentStack, noise).not.toContain(noise);
    }
  });

  it("skipComponents still extends the filter on a dev-client chain", async () => {
    const result = await devHit(DEVCLIENT_PRIMARY_BUTTON, ["PrimaryButton"]);
    expect(result?.componentStack).toEqual(["RootLayout", "HomeScreen", "Card"]);
    expect(result?.element).toBe("Card");

    const byRegex = await devHit(DEVCLIENT_FEED_ROW, [/^Feed/]);
    // The row is filtered out of BOTH chains → the screen is now nearest.
    expect(byRegex?.componentStack).toEqual(["RootLayout", "HomeScreen"]);
    expect(byRegex?.element).toBe("HomeScreen");
  });
});

// ── Return-chain walk specifics ──────────────────────────────────────────────

describe("fiber return-chain walk", () => {
  it("collapses consecutive duplicate names (memo/forwardRef wrappers)", async () => {
    const payload: RecordedPayload = {
      ...PRIMARY_BUTTON_PAYLOAD,
      hierarchy: [{ name: "RCTView" }],
      closestInstance: buildFiberChain([
        { name: "RCTView", host: true },
        { name: "Badge" },
        { name: "Badge" },
        { name: "Badge" },
        { name: "HomeScreen" },
      ]),
    };
    const result = await hit(payload);
    expect(result?.componentStack).toEqual(["HomeScreen", "Badge"]);
  });

  it("takes the NEAREST testID, not the outermost", async () => {
    const payload: RecordedPayload = {
      ...PRIMARY_BUTTON_PAYLOAD,
      props: null,
      closestInstance: buildFiberChain([
        { name: "RCTText", host: true, props: {} },
        { name: "Inner", props: { testID: "inner" } },
        { name: "Outer", props: { testID: "outer" } },
      ]),
    };
    const result = await hit(payload);
    expect(result?.testID).toBe("inner");
  });

  it("leaves testID undefined when nothing in the chain has one", async () => {
    const payload: RecordedPayload = {
      ...PRIMARY_BUTTON_PAYLOAD,
      props: null,
      closestInstance: buildFiberChain([
        { name: "RCTText", host: true, props: {} },
        { name: "Plain" },
      ]),
    };
    const result = await hit(payload);
    expect(result?.testID).toBeUndefined();
  });

  it("survives a missing closestInstance (falls back to the owner chain)", async () => {
    const payload = { ...PRIMARY_BUTTON_PAYLOAD, closestInstance: null };
    cleanups.push(installInspectorPayload(payload));
    const result = await inspectAtPoint({}, 1, 2);
    expect(result?.componentStack).toEqual(["PrimaryButton"]);
    expect(result?.element).toBe("PrimaryButton");
    // testID still comes from the touched host props when present.
    expect(result?.testID).toBeUndefined();
  });

  it("terminates on a cyclic return chain instead of hanging", async () => {
    const leaf = buildFiberChain([
      { name: "RCTView", host: true },
      { name: "Loopy" },
    ]);
    // Close the loop: root.return → leaf.
    let node = leaf;
    while (node.return) node = node.return;
    node.return = leaf;
    const payload = { ...PRIMARY_BUTTON_PAYLOAD, hierarchy: [{ name: "RCTView" }], closestInstance: leaf };
    const result = await hit(payload);
    expect(result?.componentStack).toEqual(["Loopy"]);
  });

  it("truncates absurdly deep chains to 40 entries", async () => {
    const specs: FiberSpec[] = [{ name: "RCTView", host: true }];
    for (let i = 0; i < 60; i++) specs.push({ name: `Deep${i}` });
    const payload = {
      ...PRIMARY_BUTTON_PAYLOAD,
      hierarchy: [{ name: "RCTView" }],
      closestInstance: buildFiberChain(specs),
    };
    const result = await hit(payload);
    expect(result?.componentStack.length).toBe(40);
  });
});

// ── Failure modes ────────────────────────────────────────────────────────────

describe("inspectAtPoint failure modes", () => {
  it("resolves null and warns when no DevTools hook exists (web / prod)", async () => {
    cleanups.push(removeInspectorHook());
    await expect(inspectAtPoint({}, 1, 2)).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("no DevTools-hook inspector"));
  });

  it("resolves null when the hit-test finds nothing (empty hierarchy)", async () => {
    cleanups.push(installInspectorPayload({ hierarchy: [] }));
    await expect(inspectAtPoint({}, 1, 2)).resolves.toBeNull();
  });

  it("resolves null when the callback gets no viewData at all", async () => {
    cleanups.push(installInspectorHook((_v, _x, _y, cb) => cb(undefined as never)));
    await expect(inspectAtPoint({}, 1, 2)).resolves.toBeNull();
  });

  it("resolves null (never rejects) when the inspector fn throws", async () => {
    cleanups.push(
      installInspectorHook(() => {
        throw new Error("findNodeAtPoint exploded");
      }),
    );
    await expect(inspectAtPoint({}, 1, 2)).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("hit-test failed:"), expect.anything());
  });

  it("resolves null via the guard timeout when the callback never fires", async () => {
    vi.useFakeTimers();
    try {
      cleanups.push(installInspectorHook(() => {}));
      const promise = inspectAtPoint({}, 1, 2);
      await vi.advanceTimersByTimeAsync(1500);
      await expect(promise).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("defaults a missing frame to zeros rather than throwing", async () => {
    cleanups.push(
      installInspectorPayload({ hierarchy: [{ name: "PrimaryButton" }], frame: null, props: null }),
    );
    const result = await inspectAtPoint({}, 1, 2);
    expect(result?.frame).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('falls back to "UnknownView" only when there is no identity at all', async () => {
    cleanups.push(
      installInspectorPayload({ hierarchy: [{ name: "RCTView" }, { name: "View" }], props: null }),
    );
    const result = await inspectAtPoint({}, 1, 2);
    expect(result?.element).toBe("UnknownView");
    expect(result?.componentStack).toEqual([]);
  });

  it("prefers a resolved testID over UnknownView when every name was filtered out", async () => {
    // A screen built entirely from RN primitives still has an identity if
    // the author left a testID — that is a better label than "UnknownView".
    cleanups.push(
      installInspectorPayload({
        hierarchy: [{ name: "RCTView" }, { name: "View" }],
        props: { testID: "checkout-total" },
      }),
    );
    const result = await inspectAtPoint({}, 1, 2);
    expect(result?.element).toBe("checkout-total");
    expect(result?.testID).toBe("checkout-total");
    expect(result?.componentStack).toEqual([]);
  });

  it("prefers a testID found on the fiber chain too", async () => {
    cleanups.push(
      installInspectorPayload({
        hierarchy: [{ name: "RCTView" }],
        props: null,
        closestInstance: buildFiberChain([
          { name: "RCTView", host: true },
          { name: "View", props: { testID: "hero-banner" } },
        ]),
      }),
    );
    const result = await inspectAtPoint({}, 1, 2);
    expect(result?.element).toBe("hero-banner");
  });

  it("a real component name still beats a testID", async () => {
    const result = await hit(IMAGE_PAYLOAD);
    expect(result?.testID).toBe("logo-image");
    expect(result?.element).toBe("Logo");
  });
});

// ── Scroll capture (see scroll.test.ts for the mechanism itself) ─────────────

describe("owning scroll container", () => {
  it("rides along on the hit when the touched node sits in a scrolled list", async () => {
    const payload: RecordedPayload = {
      ...ROW_ITEM_PAYLOAD,
      closestInstance: buildScrolledChain({ hostY: 88, contentY: -392, tag: 42 }),
    };
    const result = await hit(payload);
    expect(result?.scroll).toEqual({ scrollViewTag: 42, offsetY: 480 });
  });

  it("is absent (not zero) when there is no scrollable ancestor", async () => {
    const result = await hit(PRIMARY_BUTTON_PAYLOAD);
    expect(result?.scroll).toBeUndefined();
  });

  it("is absent when the offset could not be measured", async () => {
    // The fixture chains carry RCTScrollView fibers with no host instance
    // behind them — found, but unmeasurable.
    const result = await hit(VIEW_WITH_TESTID_PAYLOAD);
    expect(result?.scroll).toBeUndefined();
  });
});

// ── Styles + accessibility (capture enrichment) ──────────────────────────────

describe("summarizeStyle", () => {
  it("flattens nested style arrays with later entries winning, RN-order", () => {
    const style = [
      { backgroundColor: "#111", padding: 8 },
      [{ backgroundColor: "#222" }, { opacity: 0.5 }],
    ];
    expect(summarizeStyle(style)).toEqual({
      backgroundColor: "#222",
      padding: 8,
      opacity: 0.5,
    });
  });

  it("keeps primitives and drops object/function values", () => {
    const style = {
      color: "red",
      flex: 1,
      includeFontPadding: false,
      shadowOffset: { width: 0, height: 2 },
      onWeirdness: () => {},
    };
    expect(summarizeStyle(style)).toEqual({ color: "red", flex: 1, includeFontPadding: false });
  });

  it("keeps a short transform as JSON and drops a bloated one", () => {
    const short = summarizeStyle({ transform: [{ translateY: -4 }] });
    expect(short).toEqual({ transform: '[{"translateY":-4}]' });
    const bloated = summarizeStyle({
      transform: [{ matrix: Array.from({ length: 64 }, (_, i) => i + 0.12345) }],
    });
    expect(bloated).toBeUndefined();
  });

  it("caps the key count at 48", () => {
    const style: Record<string, number> = {};
    for (let i = 0; i < 80; i++) style[`k${i}`] = i;
    expect(Object.keys(summarizeStyle(style) ?? {}).length).toBe(48);
  });

  it("returns undefined for absent, empty, falsy or entirely-dropped styles", () => {
    expect(summarizeStyle(undefined)).toBeUndefined();
    expect(summarizeStyle(null)).toBeUndefined();
    expect(summarizeStyle({})).toBeUndefined();
    expect(summarizeStyle({ shadowOffset: { width: 0, height: 1 } })).toBeUndefined();
    expect(summarizeStyle([false, null, undefined])).toBeUndefined();
  });
});

describe("summarizeAccessibility", () => {
  it("reads the classic RN props, aria-* as fallback, classic winning", () => {
    expect(
      summarizeAccessibility({
        accessibilityLabel: "Buy now",
        "aria-label": "ignored",
        role: "link",
        accessibilityRole: "button",
        accessibilityHint: "Opens checkout",
      }),
    ).toEqual({ label: "Buy now", role: "button", hint: "Opens checkout" });
    expect(summarizeAccessibility({ "aria-label": "Close", role: "button" })).toEqual({
      label: "Close",
      role: "button",
    });
  });

  it("prunes accessibilityState to primitive entries", () => {
    expect(
      summarizeAccessibility({
        accessibilityState: { disabled: true, checked: "mixed", custom: { deep: 1 } },
      }),
    ).toEqual({ state: { disabled: true, checked: "mixed" } });
  });

  it("returns undefined when the props carry no a11y identity", () => {
    expect(summarizeAccessibility(null)).toBeUndefined();
    expect(summarizeAccessibility({})).toBeUndefined();
    expect(summarizeAccessibility({ testID: "x", accessibilityLabel: "   " })).toBeUndefined();
  });
});

describe("inspectAtPoint enrichment", () => {
  it("captures the touched view's style and a11y from the host props", async () => {
    const payload: RecordedPayload = {
      ...PRIMARY_BUTTON_PAYLOAD,
      props: {
        ...(PRIMARY_BUTTON_PAYLOAD.props ?? {}),
        style: [{ backgroundColor: "#888" }, { opacity: 0.4 }],
        accessibilityLabel: "Get started",
        accessibilityRole: "button",
      },
    };
    const result = await hit(payload);
    expect(result?.styles).toEqual({ backgroundColor: "#888", opacity: 0.4 });
    expect(result?.accessibility).toEqual({ label: "Get started", role: "button" });
  });

  it("falls back to the NEAREST fiber ancestor for accessibility (the labelled Pressable)", async () => {
    const payload: RecordedPayload = {
      ...PRIMARY_BUTTON_PAYLOAD,
      props: {},
      closestInstance: buildFiberChain([
        { name: "RCTText", host: true, props: {} },
        { name: "Inner", props: { accessibilityLabel: "Near", accessibilityRole: "button" } },
        { name: "Outer", props: { accessibilityLabel: "Far" } },
      ]),
    };
    const result = await hit(payload);
    expect(result?.accessibility).toEqual({ label: "Near", role: "button" });
  });

  it("skips both in survey mode — the aim label reads neither", async () => {
    const payload: RecordedPayload = {
      ...PRIMARY_BUTTON_PAYLOAD,
      props: {
        style: { backgroundColor: "#888" },
        accessibilityLabel: "Get started",
      },
    };
    cleanups.push(installInspectorPayload(payload));
    const result = await inspectAtPoint({}, 100, 200, undefined, { survey: true });
    expect(result?.styles).toBeUndefined();
    expect(result?.accessibility).toBeUndefined();
  });
});

// ── Host filters are stateless ───────────────────────────────────────────
//
// "The same name and filter always produce the same result, regardless of
// prior calls." (docs/audit/performance-correctness.md)

describe("skipComponents determinism", () => {
  // THE CASE THAT ACTUALLY FLICKERS. A filter is tested against both the
  // raw name and the R6-unwrapped one, which accidentally masks a moving
  // `lastIndex` whenever the two spellings are equal: the second test
  // starts from 0 again and matches. A filter that only matches the
  // WRAPPER spelling gets one real chance per call, and a stateful
  // expression then alternates — the component's identity appears and
  // disappears on every re-inspection.
  it("a global expression that matches only the wrapper name is stable", () => {
    const filter = /Memo\(/g;
    const runs = [1, 2, 3, 4].map(() => resolveComponentName("Memo(FeedRow)", [filter]));
    expect(runs).toEqual([null, null, null, null]);
  });

  it("a sticky expression is equally stateless", () => {
    const filter = /Memo\(/y;
    const runs = [1, 2, 3].map(() => resolveComponentName("Memo(FeedRow)", [filter]));
    expect(runs).toEqual([null, null, null]);
  });

  it("a global expression matches a repeated name every time", () => {
    const filter = /Feed/g;
    const runs = [1, 2, 3].map(() => resolveComponentName("FeedFeedRow", [filter]));
    expect(runs).toEqual([null, null, null]);
  });

  it("a global expression that should NOT match never starts matching", () => {
    const filter = /Nope/g;
    const runs = [1, 2, 3].map(() => resolveComponentName("FeedRow", [filter]));
    expect(runs).toEqual(["FeedRow", "FeedRow", "FeedRow"]);
  });

  it("leaves the host's own lastIndex where it found it", () => {
    // The expression belongs to the host app; it may be mid-iteration with
    // it somewhere else, and we must not be what moves its cursor.
    const filter = /Feed/g;
    filter.lastIndex = 3;
    resolveComponentName("FeedRow", [filter]);
    expect(filter.lastIndex).toBe(3);
  });

  it("ordinary and case-insensitive expressions are unaffected", () => {
    expect(resolveComponentName("FeedRow", [/feed/i])).toBeNull();
    expect(resolveComponentName("FeedRow", [/Feed/])).toBeNull();
    expect(resolveComponentName("FeedRow", [/Other/])).toBe("FeedRow");
  });

  it("string filters still match exactly", () => {
    expect(resolveComponentName("FeedRow", ["FeedRow"])).toBeNull();
    expect(resolveComponentName("FeedRow", ["Feed"])).toBe("FeedRow");
  });

  it("mixed filters do not let a stateful one break the others", () => {
    const filters = [/Nope/g, "AlsoNope", /Memo\(/g];
    const runs = [1, 2, 3].map(() => resolveComponentName("Memo(FeedRow)", filters));
    expect(runs).toEqual([null, null, null]);
  });
});
