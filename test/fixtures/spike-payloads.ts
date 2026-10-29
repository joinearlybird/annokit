/**
 * FIXTURES — real `getInspectorDataForViewAtPoint` payloads recorded on a
 * device during the Phase-1 hit-test spike.
 *
 * Provenance: Expo Go 57.0.6 / Expo SDK 57.0.10 / react-native 0.86.2 /
 * react 19.2.3 / Hermes / New Architecture (Fabric), iPhone 17 Pro
 * simulator, 2026-08-04. Six probes x two mechanisms (deep module import
 * and the DevTools hook) produced byte-identical payloads; the values below
 * are the recorded ones (`hierarchy` names, `frame`, `props.testID`,
 * owner-stack `componentStack`).
 *
 * The one part that could NOT be serialized out of the device run is
 * `closestInstance` (a live fiber). Those chains are reconstructed here
 * from the recorded hierarchy + the spike's finding 5 (hierarchy is the
 * OWNER chain, so parent-chain containers and their testIDs only exist on
 * the fiber return chain) using the fiber fields the adapter reads:
 * `elementType`/`type`, `memoizedProps`, `return`.
 */

/** The bundle URL every recorded owner-stack frame points at. */
export const BUNDLE_URL =
  "http://192.168.4.34:8123/index.ts.bundle//&platform=ios&dev=true&hot=false&lazy=true" +
  "&transform.engine=hermes&transform.bytecode=1&transform.routerRoot=app" +
  "&unstable_transformProfile=hermes-stable";

/** Metro origin derived from the bundle scriptURL above. */
export const METRO_ORIGIN = "http://192.168.4.34:8123";

/** One recorded owner-stack frame line ("    at Name (bundle:line:col)"). */
function locFrame(name: string, line: number, column: number): string {
  return `    at ${name} (${BUNDLE_URL}:${line}:${column})`;
}

/** Host frames in React 19 owner stacks carry no location. */
function hostFrame(name: string): string {
  return `    at ${name} (<anonymous>)`;
}

function stack(...lines: string[]): string {
  return "\n" + lines.join("\n") + "\n";
}

// ── Recorded owner stacks (componentStack strings) ────────────────────────────

/** Probe "PrimaryButton-in-Card" — recorded verbatim (frames + line/cols). */
export const OWNER_STACK_PRIMARY_BUTTON = stack(
  hostFrame("RCTText"),
  locFrame("Text", 61121, 18),
  hostFrame("RCTView"),
  locFrame("View", 58448, 3),
  hostFrame("RCTView"),
  locFrame("View", 58448, 3),
  locFrame("Pressable", 59743, 3),
  locFrame("PrimaryButton", 93078, 3),
  hostFrame("RCTView"),
  locFrame("View", 58448, 3),
  locFrame("Card", 93050, 3),
  locFrame("App", 92806, 37),
  locFrame("withDevTools(App)", 92316, 27),
);

/** Probe "Image" — recorded verbatim. */
export const OWNER_STACK_IMAGE = stack(
  hostFrame("RCTImageView"),
  locFrame("Image", 61711, 19),
  locFrame("Logo", 93184, 3),
  hostFrame("RCTScrollContentView"),
  hostFrame("RCTScrollView"),
  locFrame("ScrollView", 63573, 12),
  locFrame("ScrollView", 64138, 27),
  hostFrame("RCTView"),
  locFrame("View", 58448, 3),
  locFrame("App", 92806, 37),
  locFrame("withDevTools(App)", 92316, 27),
);

/** Probe "View-with-testID" — the deep-Text-inside-a-testID'd-View case. */
export const OWNER_STACK_VIEW_WITH_TESTID = stack(
  hostFrame("RCTText"),
  locFrame("Text", 61121, 18),
  hostFrame("RCTView"),
  locFrame("View", 58448, 3),
  hostFrame("RCTScrollContentView"),
  hostFrame("RCTScrollView"),
  locFrame("ScrollView", 63573, 12),
  locFrame("ScrollView", 64138, 27),
  hostFrame("RCTView"),
  locFrame("View", 58448, 3),
  locFrame("App", 92806, 37),
  locFrame("withDevTools(App)", 92316, 27),
);

/** Probe "FlatList-RowItem" — virtualized list cell. */
export const OWNER_STACK_ROW_ITEM = stack(
  hostFrame("RCTText"),
  locFrame("Text", 61121, 18),
  hostFrame("RCTView"),
  locFrame("View", 58448, 3),
  locFrame("RowItem", 93151, 3),
  locFrame("VirtualizedListCellContextProvider", 73201, 3),
  locFrame("CellRenderer", 72900, 3),
  locFrame("VirtualizedList", 72111, 3),
  locFrame("FlatList", 71004, 3),
  locFrame("SpikeList", 93120, 3),
  locFrame("App", 92806, 37),
  locFrame("withDevTools(App)", 92316, 27),
);

// ── Fiber-chain construction (reconstructed; see header) ─────────────────────

export interface FiberLike {
  type?: unknown;
  elementType?: unknown;
  memoizedProps?: Record<string, unknown> | null;
  return?: FiberLike | null;
  /** Set by buildFiberChain (the inverse of `return`) — src/scroll.ts
   *  descends it to reach a scroll container's content view. */
  child?: FiberLike | null;
  stateNode?: unknown;
}

export interface FiberSpec {
  /** Component name; lowercase/RCT* names are treated as host components. */
  name: string;
  /** Host component (string `type`) instead of a function component. */
  host?: boolean;
  props?: Record<string, unknown>;
  /** Host/class instance behind the fiber (measureInWindow, native tag, …). */
  stateNode?: unknown;
}

/**
 * Build a fiber return chain from a LEAF-FIRST spec list and return the leaf
 * (what the inspector payload exposes as `closestInstance`). `child` links
 * are filled in too, so the chain is walkable in both directions like a
 * real fiber tree (single-child spine — enough for the scroll walk).
 */
export function buildFiberChain(specs: FiberSpec[]): FiberLike {
  let child: FiberLike | null = null;
  let leaf: FiberLike | null = null;
  for (const spec of specs) {
    const type: unknown = spec.host
      ? spec.name
      : Object.defineProperty(function Component() {}, "name", { value: spec.name });
    const fiber: FiberLike = {
      type,
      elementType: type,
      memoizedProps: spec.props ?? null,
      return: null,
      child: child ?? null,
      stateNode: spec.stateNode,
    };
    if (child) child.return = fiber;
    else leaf = fiber;
    child = fiber;
  }
  return leaf as FiberLike;
}

// ── Scroll-capture fixtures (src/scroll.ts) ──────────────────────────────────

/**
 * A host instance as the PAPER renderer exposes it: `measureInWindow` and
 * `_nativeTag` straight on `fiber.stateNode`.
 */
export function paperHostInstance(rect: { x: number; y: number; tag?: number }): unknown {
  return {
    _nativeTag: rect.tag,
    measureInWindow(cb: (x: number, y: number, w: number, h: number) => void) {
      cb(rect.x, rect.y, 320, 640);
    },
  };
}

/**
 * The same instance as FABRIC exposes it: `fiber.stateNode` is the internal
 * `{ node, canonical: { nativeTag, publicInstance } }` wrapper and only the
 * public instance carries `measureInWindow`.
 */
export function fabricHostInstance(rect: { x: number; y: number; tag?: number }): unknown {
  return {
    node: {},
    canonical: {
      nativeTag: rect.tag,
      publicInstance: {
        __nativeTag: rect.tag,
        measureInWindow(cb: (x: number, y: number, w: number, h: number) => void) {
          cb(rect.x, rect.y, 320, 640);
        },
      },
    },
  };
}

/** A host instance whose measure callback never fires (view detached). */
export function silentHostInstance(tag?: number): unknown {
  return { _nativeTag: tag, measureInWindow() {} };
}

/**
 * Touched-Text-inside-a-scrolled-ScrollView chain: the scroll host sits at
 * window y=`hostY`, its content view at `contentY`, so the container's
 * offset is `hostY - contentY`.
 */
export function buildScrolledChain(options: {
  hostY: number;
  contentY: number;
  hostX?: number;
  contentX?: number;
  tag?: number;
  renderer?: "paper" | "fabric";
  hostName?: string;
}): FiberLike {
  const make = options.renderer === "paper" ? paperHostInstance : fabricHostInstance;
  return buildFiberChain([
    { name: "RCTText", host: true, props: { children: "Row 42" } },
    { name: "Text", props: { children: "Row 42" } },
    { name: "RowItem" },
    {
      name: "RCTScrollContentView",
      host: true,
      stateNode: make({ x: options.contentX ?? 0, y: options.contentY }),
    },
    {
      name: options.hostName ?? "RCTScrollView",
      host: true,
      stateNode: make({ x: options.hostX ?? 0, y: options.hostY, tag: options.tag }),
    },
    { name: "ScrollView" },
    { name: "HomeScreen" },
    { name: "App" },
  ]);
}

// ── Recorded payloads ─────────────────────────────────────────────────────────

export interface RecordedPayload {
  probe: string;
  hierarchy: Array<{ name: string }>;
  selectedIndex: number;
  frame: { left: number; top: number; width: number; height: number };
  touchedViewTag: number;
  props: Record<string, unknown> | null;
  componentStack: string;
  closestInstance: FiberLike;
}

/**
 * Probe 1 — tap on the label inside `<Card><PrimaryButton/></Card>`.
 * Recorded testID: none (the button has no testID).
 */
export const PRIMARY_BUTTON_PAYLOAD: RecordedPayload = {
  probe: "PrimaryButton-in-Card",
  hierarchy: [
    { name: "withDevTools(App)" },
    { name: "App" },
    { name: "PrimaryButton" },
    { name: "Text" },
    { name: "RCTText" },
  ],
  selectedIndex: 3,
  frame: { left: 52, top: 179.66666793823242, width: 62, height: 17 },
  touchedViewTag: 12,
  props: {
    style: {},
    accessible: true,
    allowFontScaling: true,
    ellipsizeMode: "tail",
    children: "Get started",
  },
  componentStack: OWNER_STACK_PRIMARY_BUTTON,
  closestInstance: buildFiberChain([
    { name: "RCTText", host: true, props: { children: "Get started" } },
    { name: "Text", props: { children: "Get started" } },
    { name: "RCTView", host: true },
    { name: "View" },
    { name: "Pressable", props: { testID: "card-cta" } },
    { name: "PrimaryButton", props: { label: "Get started" } },
    { name: "RCTView", host: true },
    { name: "View" },
    { name: "Card" },
    { name: "HomeScreen" },
    { name: "App" },
    { name: "withDevTools(App)" },
  ]),
};

/**
 * Probe 4 — tap on a deep `<Text>` whose *parent-chain* ancestor carries
 * `testID="special-box"`. The recorded owner `hierarchy` is only
 * [withDevTools(App), App, Text, RCTText]: the testID'd View is invisible
 * there (spike finding 5) and MUST come from the fiber return-chain walk.
 */
export const VIEW_WITH_TESTID_PAYLOAD: RecordedPayload = {
  probe: "View-with-testID",
  hierarchy: [
    { name: "withDevTools(App)" },
    { name: "App" },
    { name: "Text" },
    { name: "RCTText" },
  ],
  selectedIndex: 2,
  frame: { left: 34, top: 372.6666564941406, width: 334, height: 17 },
  touchedViewTag: 56,
  props: {
    style: {},
    accessible: true,
    allowFontScaling: true,
    ellipsizeMode: "tail",
    children: "Inside a testID box",
  },
  componentStack: OWNER_STACK_VIEW_WITH_TESTID,
  closestInstance: buildFiberChain([
    { name: "RCTText", host: true, props: { children: "Inside a testID box" } },
    { name: "Text", props: { children: "Inside a testID box" } },
    { name: "RCTView", host: true, props: { testID: "special-box" } },
    { name: "View", props: { testID: "special-box" } },
    { name: "SpecialBox" },
    { name: "RCTScrollContentView", host: true },
    { name: "RCTScrollView", host: true },
    { name: "ScrollView" },
    { name: "App" },
    { name: "withDevTools(App)" },
  ]),
};

/**
 * Probe 6 — tap on an `<Image testID="logo-image">`. The touched HOST node
 * itself carries the testID, so it arrives in `viewData.props`.
 */
export const IMAGE_PAYLOAD: RecordedPayload = {
  probe: "Image",
  hierarchy: [
    { name: "withDevTools(App)" },
    { name: "App" },
    { name: "Logo" },
    { name: "Image" },
    { name: "ImageAnalyticsTagContext.Consumer" },
    { name: "RCTImageView" },
  ],
  selectedIndex: 4,
  frame: { left: 20, top: 419.6666564941406, width: 64, height: 64 },
  touchedViewTag: 60,
  props: {
    accessibilityState: {},
    testID: "logo-image",
    source: { uri: "logo.png" },
    style: {},
    accessible: true,
    resizeMode: "cover",
  },
  componentStack: OWNER_STACK_IMAGE,
  closestInstance: buildFiberChain([
    { name: "RCTImageView", host: true, props: { testID: "logo-image" } },
    { name: "ImageAnalyticsTagContext.Consumer" },
    { name: "Image", props: { testID: "logo-image" } },
    { name: "Logo" },
    { name: "RCTScrollContentView", host: true },
    { name: "RCTScrollView", host: true },
    { name: "ScrollView" },
    { name: "App" },
    { name: "withDevTools(App)" },
  ]),
};

/** Probe 2 — a FlatList row: virtualization internals must be filtered out. */
export const ROW_ITEM_PAYLOAD: RecordedPayload = {
  probe: "FlatList-RowItem",
  hierarchy: [
    { name: "withDevTools(App)" },
    { name: "App" },
    { name: "SpikeList" },
    { name: "FlatList" },
    { name: "VirtualizedList" },
    { name: "CellRenderer" },
    { name: "RowItem" },
    { name: "Text" },
    { name: "RCTText" },
  ],
  selectedIndex: 7,
  frame: { left: 32, top: 240.6666717529297, width: 338, height: 16.999984741210938 },
  touchedViewTag: 24,
  props: {
    style: {},
    accessible: true,
    allowFontScaling: true,
    ellipsizeMode: "tail",
    children: "Row 3",
  },
  componentStack: OWNER_STACK_ROW_ITEM,
  closestInstance: buildFiberChain([
    { name: "RCTText", host: true, props: { children: "Row 3" } },
    { name: "Text", props: { children: "Row 3" } },
    { name: "RCTView", host: true },
    { name: "View", props: { testID: "row-3" } },
    { name: "RowItem", props: { item: { id: 3 } } },
    { name: "VirtualizedListCellContextProvider" },
    { name: "CellRenderer" },
    { name: "VirtualizedList" },
    { name: "FlatList" },
    { name: "SpikeList" },
    { name: "App" },
    { name: "withDevTools(App)" },
  ]),
};

/** A Metro /symbolicate response shaped like the real one (spike finding 4). */
export function symbolicateResponse(
  frames: Array<{ file: string | null; lineNumber: number | null; methodName?: string }>,
): { stack: Array<{ file: string | null; lineNumber: number | null; methodName: string }> } {
  return {
    stack: frames.map((f) => ({
      file: f.file,
      lineNumber: f.lineNumber,
      methodName: f.methodName ?? "<unknown>",
    })),
  };
}
