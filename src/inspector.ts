/**
 * Inspector adapter — the one module allowed to touch RN dev-internal APIs.
 *
 * Mechanism (validated by a native hit-test spike on Expo SDK 57 / RN 0.86 /
 * React 19 / Hermes / New Architecture):
 *  1. HOOK-FIRST: `__REACT_DEVTOOLS_GLOBAL_HOOK__.renderers[*].rendererConfig
 *     .getInspectorDataForViewAtPoint` — the stable surface. The RN module
 *     path (react-native/src/private/devsupport/devmenu/elementinspector/…)
 *     is a thin wrapper over it and its deep import is deprecated, so it is
 *     deliberately NOT imported here.
 *  2. React 19 removed `_debugSource`; source file:line comes from the
 *     owner-stack frames in `componentStack`, POSTed to Metro `/symbolicate`
 *     (dev-only; Metro origin derived from the bundle's own scriptURL).
 *  3. `hierarchy` is the OWNER chain, not the parent chain — ancestor user
 *     components and the nearest testID come from a fiber return-chain walk
 *     starting at `closestInstance`. The same walk finds the owning scroll
 *     container (src/scroll.ts) so window coordinates can be reconciled.
 */

import { nearestMeasurableFiber, resolveScrollCapture } from "./scroll";
import type { ScrollAnchor, ScrollFiber, ScrollInfo } from "./scroll";

export interface InspectorHit {
  /** Nearest user component name ("PrimaryButton"), or the host name as fallback. */
  element: string;
  /** Root→leaf user-component chain, internals filtered out. */
  componentStack: string[];
  /** Touched view frame in window coordinates. */
  frame: { x: number; y: number; width: number; height: number };
  /** Nearest testID found on the touched node or its fiber ancestors. */
  testID?: string;
  /** String children of the touched Text subtree, if cheaply reachable. */
  nearbyText?: string;
  /** Metro-symbolicated definition site of the nearest user component. */
  source?: { file: string; line: number };
  /**
   * Flattened style of the TOUCHED view (never an ancestor's — a parent's
   * padding says nothing about why this button looks wrong), pruned to
   * primitive values. The native analogue of the web overlay's computed
   * styles: what the agent reads to answer "why is this gray?" without a
   * screenshot round-trip.
   */
  styles?: Record<string, string | number | boolean>;
  /**
   * Accessibility identity the author wrote — touched node first, nearest
   * fiber ancestor as fallback (a11y props usually sit on the Pressable
   * wrapper, not the host view the finger landed on).
   */
  accessibility?: AccessibilitySummary;
  /**
   * Owning scroll container + its offset at capture time, when the touched
   * node has a scrollable ancestor whose offset could be measured
   * (src/scroll.ts). Absent means "no scroll container, or unreadable" —
   * never a guessed value.
   */
  scroll?: ScrollInfo;
  /**
   * Live re-measure handle for the scroll pair above. CLIENT-SIDE ONLY:
   * payload.ts never reads it, so it never serializes — the anchor
   * registry keeps the host as the marker's hide-outside viewport.
   */
  scrollAnchor?: ScrollAnchor;
  /**
   * The touched view's own fiber — CLIENT-SIDE ONLY, same rule. This is
   * what element anchoring re-measures: the marker sits wherever this
   * view is now (src/anchor-registry.ts).
   */
  elementFiber?: ScrollFiber;
}

/** The accessibility props worth sending — identity, not implementation. */
export interface AccessibilitySummary {
  label?: string;
  role?: string;
  hint?: string;
  /** accessibilityState entries, primitives only ({disabled: true, …}). */
  state?: Record<string, string | number | boolean>;
}

type Fiber = {
  tag?: number;
  type?: unknown;
  elementType?: unknown;
  return?: Fiber | null;
  memoizedProps?: Record<string, unknown> | null;
  pendingProps?: Record<string, unknown> | null;
  stateNode?: unknown;
};

interface TouchedViewData {
  hierarchy?: Array<{ name?: string | null }>;
  selectedIndex?: number | null;
  frame?: { left?: number; top?: number; width?: number; height?: number } | null;
  componentStack?: string;
  props?: Record<string, unknown> | null;
  touchedViewTag?: number;
  closestInstance?: Fiber | null;
}

// ── Component-name filtering ─────────────────────────────────────────────────
//
// PROVENANCE (clean-room): these rules were written for this package from
// first principles plus this project's own Phase-1 spike observations. They
// are NOT derived from, copied from, or paraphrased from any third-party
// fiber-filtering implementation (in particular not the closed-source
// `agentation` npm package or code vendored from it).
//
// The rules, in order:
//  R1. Host components are structure, not identity: names starting with a
//      lowercase letter, or the RCT* native-wrapper prefix.
//  R2. React's own built-ins (public React API surface).
//  R3. React Native's public primitives — documented framework API names;
//      a <View> wrapper says nothing about which user component was hit.
//  R4. Framework shell/navigation plumbing this project OBSERVED at the top
//      of spike owner stacks on Expo Go / expo-router (withDevTools wraps
//      every stack; ExpoRoot/Screen*/Route* et al. are router internals),
//      plus this package's own chrome, which must never self-annotate.
//  R5. Generic infrastructure name shapes: Context/Provider/Consumer/
//      Navigator/Router/Boundary suffixes and anonymous/unnamed wrappers.
//  R6. NAME REWRITES — names that are a wrapper AROUND an identity rather
//      than an identity. Applied BEFORE R1–R5, repeatedly (wrappers nest):
//        `ForwardRef(X)` / `Memo(X)`  → unwrap to X (React's own wrapper
//          display names; the inner name is the component the author wrote)
//        `X(./route.tsx)`             → unwrap to X (expo-router annotates
//          route components with their file)
//      A BARE `ForwardRef` / `Memo` has no inner name to recover and is
//      dropped by R4 instead — it is what an anonymous `forwardRef()` call
//      reports, and it was the (device-observed) cause of `element:
//      "ForwardRef"`.
//
// Hosts can extend (never shrink) the skip set via the provider's
// `skipComponents` option — strings match exactly, RegExps by test(); the
// rules are tried against BOTH the raw and the unwrapped name.

/** Extra skip rules a host app can supply. */
export type ComponentNameFilter = string | RegExp;

// R2 — React built-ins.
const REACT_BUILTINS = new Set([
  "Fragment", "StrictMode", "Suspense", "SuspenseList", "Profiler", "Activity",
]);

// R3 — React Native public primitives (framework API, not user identity).
const RN_PRIMITIVES = new Set([
  "View", "Text", "Image", "ImageBackground", "TextInput", "ScrollView",
  "FlatList", "SectionList", "VirtualizedList", "CellRenderer", "Pressable",
  "TouchableOpacity", "TouchableHighlight", "TouchableWithoutFeedback",
  "TouchableNativeFeedback", "Button", "Switch", "Modal", "StatusBar",
  "ActivityIndicator", "KeyboardAvoidingView", "SafeAreaView", "RefreshControl",
]);

// R4 — shell/navigation noise. The first block was observed in this
// project's Phase-1 spike payloads (Expo Go / expo-router); the second was
// observed on a real iOS dev client (Expo SDK 57 / RN 0.86 / react-navigation
// native-stack + react-native-screens) — these sit BETWEEN the route
// component and the touched node, so leaving them in makes the "nearest
// component" wrong, not merely noisy. Plus our own chrome, which must never
// self-annotate.
const SHELL_NOISE = new Set([
  "App", "withDevTools", "ExpoRoot", "ContextNavigator", "ErrorOverlay",
  "ErrorToastContainer", "Route", "RouteNode", "Slot", "Stack", "Tabs", "Try",
  "Group", "Background", "SceneView", "Screen", "ScreenStack",
  "ScreenContainer", "ScreenContentWrapper", "ScreenStackItem",
  "NavigationContainer", "NavigationContainerInner", "BaseNavigationContainer",
  "SafeAreaProvider", "Pressability",
  "AnnoKitProvider", "AnnoKitRuntime", "AnnoKitCaptureRoot",
  // dev-client observations (SDK 57):
  "AppContainer", "Content", "NavigationContent", "StaticContainer",
  "WrappedScreenComponent", "NativeStackView", "SafeAreaProviderCompat",
  "InnerScreen", "DelayedFreeze", "Freeze", "Suspender", "DebugContainer",
  // R6's bare (un-unwrappable) React wrapper display names:
  "ForwardRef", "Memo",
]);

// R1 + R5 — name-shape rules.
const SHAPE_RULES: RegExp[] = [
  /^RCT/, // R1: native host wrappers
  /^RN[SC][A-Z]/, // R1: react-native-screens (RNSScreen*) / community (RNCSafeAreaView) hosts
  /^[a-z]/, // R1: host components (checked again for callers that pass raw names)
  /Context(\.(Provider|Consumer))?$/, // R5
  /(^|[a-z0-9])(Provider|Consumer)$/, // R5
  /(Navigator|Router|Boundary|BoundaryHandler)$/, // R5
  /^(Anonymous|Unknown|Internal)/, // R5: unnamed/internal wrappers
  /^Animated/, // R1: Animated(View/Text/…) host-adjacent wrappers
  /^CssInterop/, // R1: styling interop wrappers (NativeWind 4)
  /^CSS\(/, // R1: styling interop wrappers (react-native-css v3 / NativeWind 5)
  /^Route\(/, // R4: expo-router route wrappers ("Route()", "Route(index)")
  /^AnnoKit/, // our own chrome, defensive catch-all
];

// R6 — wrapper names that carry an inner identity worth recovering.
const UNWRAP_RULES: RegExp[] = [
  /^(?:ForwardRef|Memo)\((.+)\)$/, // React display names
  /^(.+?)\(\.\/.*\)$/, // expo-router route files: "HomeScreen(./index.tsx)"
];

/** R6: peel wrapper display names down to the identity inside. */
function unwrapComponentName(name: string): string {
  let current = name.trim();
  for (let i = 0; i < 4; i++) {
    const rule = UNWRAP_RULES.find((re) => re.test(current));
    if (!rule) break;
    const inner = current.replace(rule, "$1").trim();
    if (!inner || inner === current) break;
    current = inner;
  }
  return current;
}

/**
 * Test one HOST-SUPPLIED expression against a name, statelessly.
 *
 * `RegExp.prototype.test` advances `lastIndex` on a global (`g`) or sticky
 * (`y`) expression, and resumes from it on the next call — so the same
 * filter tested against the same component alternates between matching and
 * not matching, and a component's identity would flicker as the overlay
 * re-inspects it. These expressions come from the host app's
 * `skipComponents`; nothing stops one carrying `/g` (a plain `/Foo/g`
 * reads perfectly reasonable), so the flag is neutralised here rather than
 * documented away.
 *
 * `lastIndex` is saved and restored rather than merely reset, because the
 * expression belongs to the host: it may be using the same object
 * elsewhere, and this must not be the thing that moves its cursor.
 */
function testFilter(rule: RegExp, name: string): boolean {
  if (!rule.global && !rule.sticky) return rule.test(name);
  const previous = rule.lastIndex;
  rule.lastIndex = 0;
  try {
    return rule.test(name);
  } finally {
    rule.lastIndex = previous;
  }
}

/**
 * Does a host filter name this component?
 *
 * Tested against BOTH spellings (see `resolveComponentName`): the raw
 * display name and the R6-unwrapped one. `React.memo(Foo)` reaches here as
 * both `Foo` and whatever the wrapper called itself, and a host that wrote
 * `/Foo/` means the component either way — so a filter that matches either
 * spelling hides it. The consequence for a stateful expression is that it
 * is tested TWICE per component, which is what made the `lastIndex`
 * flicker reliable rather than rare.
 */
function matchesExtra(name: string, extra: ComponentNameFilter[] | undefined): boolean {
  if (!extra || extra.length === 0) return false;
  return extra.some((rule) => (typeof rule === "string" ? rule === name : testFilter(rule, name)));
}

function isSkipped(name: string): boolean {
  if (REACT_BUILTINS.has(name) || RN_PRIMITIVES.has(name) || SHELL_NOISE.has(name)) return true;
  return SHAPE_RULES.some((re) => re.test(name));
}

/**
 * The name to show for `name`, or null when it is framework noise.
 * This is the single place the R1–R6 rules are applied; every stack the
 * adapter builds goes through it.
 */
export function resolveComponentName(
  name: string | null | undefined,
  extraSkip?: ComponentNameFilter[],
): string | null {
  if (!name) return null;
  const unwrapped = unwrapComponentName(name);
  if (!unwrapped) return null;
  if (isSkipped(unwrapped)) return null;
  if (matchesExtra(name, extraSkip) || matchesExtra(unwrapped, extraSkip)) return null;
  return unwrapped;
}

export function isUserComponentName(
  name: string | null | undefined,
  extraSkip?: ComponentNameFilter[],
): name is string {
  return resolveComponentName(name, extraSkip) !== null;
}

function fiberName(fiber: Fiber): string | null {
  const t = fiber.elementType ?? fiber.type;
  if (typeof t === "function") {
    const fn = t as { displayName?: string; name?: string };
    return fn.displayName || fn.name || null;
  }
  if (typeof t === "string") return t;
  if (t && typeof t === "object") {
    const obj = t as { displayName?: string; render?: { displayName?: string; name?: string }; type?: { displayName?: string; name?: string } };
    return (
      obj.displayName ||
      obj.render?.displayName ||
      obj.render?.name ||
      obj.type?.displayName ||
      obj.type?.name ||
      null
    );
  }
  return null;
}

function fiberProps(fiber: Fiber): Record<string, unknown> | null {
  return fiber.memoizedProps ?? fiber.pendingProps ?? null;
}

// ── Style + accessibility extraction (capture enrichment) ────────────────────
//
// RN's `style` prop is a tree of plain objects and arrays (StyleSheet.create
// has returned the objects themselves since long before anything this
// package supports), so flattening is a local merge — deliberately NOT
// `StyleSheet.flatten`, which would drag a react-native import into a module
// that must stay node-testable. Later entries win, exactly like RN's own
// resolution order.

/** Hard ceiling on style keys sent — a style this big is its own bug report. */
const STYLE_KEY_LIMIT = 48;

function mergeStyle(style: unknown, out: Record<string, unknown>): void {
  if (!style || typeof style !== "object") return;
  if (Array.isArray(style)) {
    for (const entry of style) mergeStyle(entry, out);
    return;
  }
  for (const [key, value] of Object.entries(style as Record<string, unknown>)) {
    if (value !== undefined) out[key] = value;
  }
}

/**
 * Flatten + prune a style prop down to the wire shape: primitive values
 * only, except `transform`, whose array-of-objects form is kept as compact
 * JSON when it stays short (a translate is appearance; a 500-char matrix is
 * noise).
 */
export function summarizeStyle(style: unknown): Record<string, string | number | boolean> | undefined {
  const merged: Record<string, unknown> = {};
  mergeStyle(style, merged);
  const out: Record<string, string | number | boolean> = {};
  let kept = 0;
  for (const [key, value] of Object.entries(merged)) {
    if (kept >= STYLE_KEY_LIMIT) break;
    if (key.startsWith("__")) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
      kept++;
    } else if (key === "transform" && Array.isArray(value)) {
      try {
        const json = JSON.stringify(value);
        if (json && json.length <= 160) {
          out[key] = json;
          kept++;
        }
      } catch {
        /* circular/hostile transform — drop it */
      }
    }
  }
  return kept > 0 ? out : undefined;
}

/**
 * Pull the accessibility identity off a props bag. Reads both the classic
 * RN names and the aria-* aliases RN 0.71+ accepts; classic names win when
 * both are present (they are what RN itself resolves last).
 */
export function summarizeAccessibility(
  props: Record<string, unknown> | null | undefined,
): AccessibilitySummary | undefined {
  if (!props) return undefined;
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : undefined;
  const label = str(props.accessibilityLabel) ?? str(props["aria-label"]);
  const role = str(props.accessibilityRole) ?? str(props.role);
  const hint = str(props.accessibilityHint);
  let state: AccessibilitySummary["state"];
  if (props.accessibilityState && typeof props.accessibilityState === "object") {
    for (const [key, value] of Object.entries(props.accessibilityState as Record<string, unknown>)) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        (state ??= {})[key] = value;
      }
    }
  }
  if (!label && !role && !hint && !state) return undefined;
  const out: AccessibilitySummary = {};
  if (label) out.label = label;
  if (role) out.role = role;
  if (hint) out.hint = hint;
  if (state) out.state = state;
  return out;
}

/**
 * testIDs on the overlay's OWN views that wrap the host app (src/index.tsx).
 * The walk below climbs past the app's root into them, so an element with
 * no testID of its own would otherwise report the overlay's
 * (device-observed: a team note on a Card carried "annokit-push-layer").
 */
export const OVERLAY_TEST_IDS: ReadonlySet<string> = new Set(["annokit-push-layer"]);

/** A testID the host app set, or undefined for none or the overlay's own. */
function appTestID(value: unknown): string | undefined {
  return typeof value === "string" && !OVERLAY_TEST_IDS.has(value) ? value : undefined;
}

/**
 * Walk the fiber return chain from the touched instance: collect the ordered
 * ancestor user-component names (leaf→root, reversed on return), the nearest
 * testID (spike finding 3: hierarchy is the owner chain, so container
 * testIDs are invisible without this walk), and nearby string children.
 */
function walkReturnChain(
  start: Fiber | null | undefined,
  extraSkip?: ComponentNameFilter[],
): {
  stack: string[];
  testID?: string;
  nearbyText?: string;
  accessibility?: AccessibilitySummary;
} {
  const names: string[] = [];
  let testID: string | undefined;
  let nearbyText: string | undefined;
  let accessibility: AccessibilitySummary | undefined;
  let fiber: Fiber | null | undefined = start;
  let depth = 0;
  while (fiber && depth < 200) {
    const props = fiberProps(fiber);
    if (!testID && props) testID = appTestID(props.testID);
    if (!nearbyText && props && typeof props.children === "string" && props.children.trim()) {
      nearbyText = props.children.trim().slice(0, 120);
    }
    // Nearest wins, same rule as testID: the Pressable wrapping the touched
    // view is the identity the author labelled, not some screen-level bag.
    if (!accessibility) accessibility = summarizeAccessibility(props);
    const name = resolveComponentName(fiberName(fiber), extraSkip);
    if (name && names[names.length - 1] !== name) names.push(name);
    fiber = fiber.return;
    depth++;
  }
  return { stack: names.reverse(), testID, nearbyText, accessibility };
}

// ── Hook access ───────────────────────────────────────────────────────────────

type GetInspectorDataForViewAtPoint = (
  inspectedView: unknown,
  locationX: number,
  locationY: number,
  callback: (viewData: TouchedViewData) => boolean | void,
) => void;

function resolveInspectorFn(): GetInspectorDataForViewAtPoint | null {
  const hook = (globalThis as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__ as
    | { renderers?: Map<number, { rendererConfig?: { getInspectorDataForViewAtPoint?: GetInspectorDataForViewAtPoint } }> }
    | undefined;
  if (!hook?.renderers) return null;
  for (const renderer of hook.renderers.values()) {
    const fn = renderer?.rendererConfig?.getInspectorDataForViewAtPoint;
    if (typeof fn === "function") return fn;
  }
  return null;
}

// ── Metro symbolication (spike finding 2) ─────────────────────────────────────

function metroOrigin(): string | null {
  try {
    // The Metro origin is the bundle's own origin — derive it from the
    // script URL, NOT from any platform env.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NativeModules, Platform } = require("react-native");
    if (Platform.OS === "web") return null;
    const scriptURL: string | undefined =
      NativeModules?.SourceCode?.scriptURL ??
      NativeModules?.SourceCode?.getConstants?.()?.scriptURL;
    if (!scriptURL) return null;
    const m = scriptURL.match(/^(https?:\/\/[^/]+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

interface StackFrame {
  file: string;
  methodName: string;
  lineNumber: number;
  column: number;
}

function parseOwnerStack(componentStack: string | undefined): StackFrame[] {
  if (!componentStack) return [];
  const frames: StackFrame[] = [];
  // React 19 owner-stack frames: "at PrimaryButton (http://…/bundle:93078:3)"
  const re = /at ([A-Za-z0-9_$]+) \((.+?):(\d+):(\d+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(componentStack))) {
    frames.push({ methodName: m[1], file: m[2], lineNumber: Number(m[3]), column: Number(m[4]) });
  }
  return frames;
}

/**
 * Trim a symbolicated path down to something short enough to read and safe
 * enough to send.
 *
 * NEVER RETURNS AN ABSOLUTE PATH. This used to fall through to the raw input
 * when no known layout matched, which meant a project that does not keep its
 * components under `src/` shipped the developer's home directory — username,
 * workspace layout and all — to the protocol server inside `source.file`,
 * and rendered as an ellipsised absolute path in the detail chip. The two
 * patterns below describe the Earlybird platform's own layout; an ordinary
 * Expo Router app (`app/` and `components/` at the root) matched neither.
 *
 * The order is most-informative first:
 *   1. A known project layout — the nicest answer when it applies.
 *   2. Anything else — the last two segments. Enough to locate the file in
 *      an editor, never enough to describe the machine it came from.
 *
 * Dependencies need no case of their own: the caller skips any frame under
 * node_modules before it gets here, because an annotation points at the
 * code you would edit, not at a library's internals.
 */
function relativizeSourcePath(file: string): string {
  // Symbolication can hand back a bundle URL rather than a path.
  const path = file.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*\//i, "");

  const layout = path.match(/(?:^|\/)((?:app|packages|api)\/src\/.+)$/);
  if (layout) return layout[1];
  const src = path.match(/(?:^|\/)(src\/.+)$/);
  if (src) return src[1];
  const segments = path.split("/").filter(Boolean);
  return segments.slice(-2).join("/") || path;
}

/**
 * Symbolication results keyed by the owner stack that produced them.
 *
 * The aim survey re-hit-tests several times per second while the finger
 * moves, and a Metro round-trip per position would be both slow and rude.
 * The survey therefore asks for CACHE-ONLY symbolication: it shows
 * `file:line` in the aim label for elements a previous full capture already
 * resolved, and just the component name otherwise. Bounded, and dev-only
 * like everything else here.
 */
const SOURCE_CACHE_LIMIT = 100;
const sourceCache = new Map<string, { file: string; line: number } | undefined>();

/**
 * Test seam: the cache is module-level (it must outlive individual
 * captures), so tests that assert on symbolication have to start from
 * empty or they inherit the previous test's answer.
 */
export function clearSymbolicationCache(): void {
  sourceCache.clear();
}

/**
 * Symbolicate the nearest user-component frame via Metro's /symbolicate.
 * Resolves the component DEFINITION site, not the JSX callsite (spike
 * verified: PrimaryButton → src/Card.tsx:4). Fail-soft with a timeout.
 */
async function symbolicateSource(
  componentStack: string | undefined,
  userStack: string[],
  cacheOnly = false,
): Promise<{ file: string; line: number } | undefined> {
  const cacheKey = componentStack;
  if (cacheKey && sourceCache.has(cacheKey)) return sourceCache.get(cacheKey);
  if (cacheOnly) return undefined;
  const origin = metroOrigin();
  if (!origin) return undefined;
  const frames = parseOwnerStack(componentStack);
  if (frames.length === 0) return undefined;
  // Prefer the deepest frame whose method name is a user component.
  const userNames = new Set(userStack);
  const candidates = frames.filter((f) => userNames.has(f.methodName));
  const toSend = (candidates.length > 0 ? candidates : frames).slice(0, 5);
  try {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 2000) : null;
    const res = await fetch(`${origin}/symbolicate`, {
      method: "POST",
      body: JSON.stringify({ stack: toSend }),
      signal: controller?.signal,
    });
    if (timer) clearTimeout(timer);
    if (!res.ok) return undefined;
    const data = (await res.json()) as { stack?: Array<{ file?: string | null; lineNumber?: number | null }> };
    for (const frame of data.stack ?? []) {
      if (!frame?.file || frame.file.includes("/node_modules/")) continue;
      const source = { file: relativizeSourcePath(frame.file), line: frame.lineNumber ?? 0 };
      if (cacheKey) {
        if (sourceCache.size >= SOURCE_CACHE_LIMIT) sourceCache.clear();
        sourceCache.set(cacheKey, source);
      }
      return source;
    }
  } catch {
    /* dev-only nicety; identity fields still ship without it */
  }
  return undefined;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface InspectOptions {
  /**
   * Survey mode — the throttled hit-test behind the aim highlight, which
   * runs many times per gesture and only needs a name and a frame. It skips
   * the two round-trips a capture can afford but a drag cannot: Metro
   * symbolication (cache-only instead) and the scroll-offset measurement.
   */
  survey?: boolean;
  /** Suppress the "no inspector" warning (a survey would repeat it endlessly). */
  quiet?: boolean;
}

/**
 * Run the dev-inspector hit-test at window coordinates (x, y) and assemble
 * the annotation identity payload. Resolves null when the inspector API is
 * unavailable (e.g. web, prod) or nothing was hit. Never throws.
 */
export function inspectAtPoint(
  inspectedView: unknown,
  x: number,
  y: number,
  extraSkip?: ComponentNameFilter[],
  options: InspectOptions = {},
): Promise<InspectorHit | null> {
  return new Promise((resolve) => {
    const fn = resolveInspectorFn();
    if (!fn) {
      if (!options.quiet && !options.survey) {
        console.warn("[annokit] no DevTools-hook inspector available; annotation will be position-only");
      }
      resolve(null);
      return;
    }
    let settled = false;
    const settle = (hit: InspectorHit | null) => {
      if (!settled) {
        settled = true;
        resolve(hit);
      }
    };
    // The callback may never fire if the point misses every view.
    const guard = setTimeout(() => settle(null), 1500);
    try {
      fn(inspectedView, x, y, (viewData) => {
        clearTimeout(guard);
        if (!viewData || !viewData.hierarchy || viewData.hierarchy.length === 0) {
          settle(null);
          return false;
        }
        void assembleHit(viewData, extraSkip, options).then(settle);
        return true;
      });
    } catch (e) {
      clearTimeout(guard);
      console.warn("[annokit] inspector hit-test failed:", e);
      settle(null);
    }
  });
}

async function assembleHit(
  viewData: TouchedViewData,
  extraSkip?: ComponentNameFilter[],
  options: InspectOptions = {},
): Promise<InspectorHit> {
  // Owner chain from `hierarchy` (has good names for owner components) …
  const ownerNames = (viewData.hierarchy ?? [])
    .map((h) => resolveComponentName(h.name, extraSkip))
    .filter((n): n is string => n !== null);
  // … merged with the return-chain walk (catches wrapping containers +
  // testIDs the owner chain misses).
  const walked = walkReturnChain(viewData.closestInstance, extraSkip);

  // MERGE ORDER — the return chain is the ONLY source of "nearness".
  //
  // It is a true parent chain, so its last entry is genuinely the component
  // closest to the touched node. `hierarchy` is the OWNER chain (spike
  // finding 3): its names are useful context but their position says
  // nothing about proximity — an owner can be the app ROOT. Appending the
  // owner names that the walk missed (what this used to do) therefore put
  // roots like `RootLayout` / `HomeScreen` AFTER the leaf and made them the
  // reported `element` (device-observed). So: the walk is the spine, and
  // owner-only names are folded in as CONTEXT at the FRONT, never after the
  // leaf. The owner chain becomes the spine only when there is no walk at
  // all (no `closestInstance`).
  const spine = walked.stack.length > 0 ? walked.stack : ownerNames;
  const context = walked.stack.length > 0 ? ownerNames.filter((n) => !spine.includes(n)) : [];
  const stack = [...new Set([...context, ...spine])];

  const testID = appTestID(viewData.props?.testID) ?? walked.testID;
  // Enrichment is capture-only: the aim survey runs many times per gesture
  // and its label reads none of this.
  const styles = options.survey ? undefined : summarizeStyle(viewData.props?.style);
  const accessibility = options.survey
    ? undefined
    : (summarizeAccessibility(viewData.props) ?? walked.accessibility);
  // Label preference: nearest user component name (the END of the spine —
  // never a context name folded in above) → the testID (a real,
  // human-meaningful anchor the author wrote) → the "we know nothing"
  // placeholder. A hit whose whole chain is framework primitives still has
  // an identity worth showing if the author left a testID.
  const element = spine[spine.length - 1] ?? testID ?? "UnknownView";

  const frameRaw = viewData.frame ?? {};
  const frame = {
    x: frameRaw.left ?? 0,
    y: frameRaw.top ?? 0,
    width: frameRaw.width ?? 0,
    height: frameRaw.height ?? 0,
  };

  // Both are fail-soft and independent; run them together so a slow Metro
  // does not serialise ahead of the (native round-trip) measurement.
  const [source, scrollCapture] = await Promise.all([
    symbolicateSource(viewData.componentStack, stack, options.survey === true),
    options.survey
      ? Promise.resolve(null)
      : resolveScrollCapture(viewData.closestInstance as ScrollFiber | null | undefined),
  ]);

  return {
    element,
    // Truncate from the ROOT: the entries nearest the touch are the ones a
    // reader (and `element`) cares about.
    componentStack: stack.slice(-40),
    frame,
    testID,
    nearbyText: walked.nearbyText,
    source,
    scroll: scrollCapture?.info,
    scrollAnchor: scrollCapture?.anchor,
    // The MEASURABLE node for the touched element — closestInstance is
    // often a composite fiber with no native instance (device-observed:
    // "0/N measurable"); anchoring needs the host view behind it.
    elementFiber: options.survey
      ? undefined
      : (nearestMeasurableFiber(viewData.closestInstance as ScrollFiber | null) ?? undefined),
    styles,
    accessibility,
  };
}
