/**
 * Scroll-offset capture: which scroll container owns the touched view, and
 * how far it is scrolled at capture time.
 *
 * WHY THIS MATTERS: everything else in the payload is in WINDOW coordinates
 * (the tap point, the touched view frame). On the web the overlay stores
 * document coordinates, so a scrolled page still reconciles; on native
 * there is no document — a note captured 480px down a list reports the same
 * y as a note at the top unless the owning container's offset rides along.
 *
 * ── MECHANISM (and why this one) ─────────────────────────────────────────
 *
 * The offset is MEASURED, not read out of component internals:
 *
 *     offset = (scroll host window origin) − (content view window origin)
 *
 * which is the definition of a scroll container's content offset — the
 * content view is the thing native actually translates when you scroll, so
 * the difference of the two `measureInWindow` results IS `contentOffset`
 * (this also stays correct under a non-zero iOS `contentInset`: at rest with
 * `contentInset.top = 100` the content sits 100px lower and `contentOffset.y`
 * is −100, which is exactly what the subtraction yields).
 *
 * Alternatives considered and rejected, on RN 0.86 (the version this
 * package targets, Expo SDK 57):
 *
 *  - `ScrollView` instance state: there is none. `ScrollView.js` keeps no
 *    last-offset field; `_scrollAnimatedValue` tracks `contentOffset.y` but
 *    is only attached to the native scroll event when `stickyHeaderIndices`
 *    is set (`_updateAnimatedNodeAttachment`), so it reads 0 for the vast
 *    majority of scroll views. Reading it would silently report a WRONG
 *    offset — the one outcome worse than reporting none.
 *  - `VirtualizedList._scrollMetrics.offset`: real and accurate, but only
 *    exists for FlatList/SectionList, is a private field, and would leave
 *    plain ScrollViews unhandled. The measure path covers both (a FlatList
 *    renders a ScrollView, so it has the same host/content pair).
 *  - Last `onScroll` event: the package does not own the host app's
 *    ScrollViews and will not monkey-patch them.
 *
 * `measureInWindow` is the stable, documented host-instance API and exists
 * on both renderers (Paper host components, Fabric public instances).
 *
 * ── FAILURE MODES (all degrade to "no scroll info", never a wrong one) ────
 *
 *  - No scrollable ancestor (a plain screen) → null; the payload keeps
 *    `{ offsetY: 0 }`, which is the truth for an unscrolled surface.
 *  - Fiber shapes this walk does not recognise (custom native scrollers
 *    whose host name has no "ScrollView" in it and whose instance exposes
 *    no scroll-responder method) → null.
 *  - A host instance with no reachable `measureInWindow`, a callback that
 *    never fires (view detached mid-capture), or anything throwing → null
 *    after a short timeout. Capture is never blocked or failed.
 */

/** Owning-container scroll state at capture time. */
export interface ScrollInfo {
  /** Native tag of the scroll host, when resolvable. */
  scrollViewTag?: number;
  /** Vertical content offset in points. */
  offsetY: number;
  /** Horizontal content offset — only sent when non-zero (see docs/protocol.md). */
  offsetX?: number;
}

/** The subset of a fiber this module reads. */
export interface ScrollFiber {
  type?: unknown;
  elementType?: unknown;
  return?: ScrollFiber | null;
  child?: ScrollFiber | null;
  stateNode?: unknown;
}

type MeasureCallback = (x: number, y: number, width: number, height: number) => void;
interface Measurable {
  measureInWindow: (callback: MeasureCallback) => void;
}

const MAX_DEPTH = 200;
/** measureInWindow is a native round-trip; give up rather than stall capture. */
const MEASURE_TIMEOUT_MS = 400;

function hostName(fiber: ScrollFiber): string | null {
  const t = fiber.elementType ?? fiber.type;
  return typeof t === "string" ? t : null;
}

/**
 * Host component names of scroll containers: `RCTScrollView` (iOS + Android
 * vertical) and `AndroidHorizontalScrollView`. Deliberately a substring
 * test so vendor-prefixed variants match — and deliberately NOT matching
 * `RCTScrollContentView`, which is the content view, not the container.
 */
function isScrollHostName(name: string | null): boolean {
  if (!name) return false;
  return /ScrollView$/.test(name) || /ScrollView[^a-z]/.test(name);
}

/**
 * A composite fiber whose instance exposes RN's scroll-responder surface
 * (`ScrollView`, and anything built on it). Used as a fallback entry point
 * when the host name is unfamiliar.
 */
function scrollResponderInstance(fiber: ScrollFiber): Record<string, unknown> | null {
  const sn = fiber.stateNode as Record<string, unknown> | null | undefined;
  if (!sn || typeof sn !== "object") return null;
  const hasResponder =
    typeof sn.getScrollableNode === "function" ||
    typeof sn.getScrollResponder === "function" ||
    typeof sn.scrollResponderGetScrollableNode === "function";
  return hasResponder ? sn : null;
}

/** First host (string-typed) fiber at or below `fiber`, excluding itself. */
function firstHostDescendant(fiber: ScrollFiber | null | undefined): ScrollFiber | null {
  let node = fiber?.child ?? null;
  let depth = 0;
  while (node && depth < MAX_DEPTH) {
    if (hostName(node)) return node;
    node = node.child ?? null;
    depth++;
  }
  return null;
}

/** The measurable host instance behind a fiber (Paper and Fabric shapes). */
function measurable(fiber: ScrollFiber | null | undefined): Measurable | null {
  const sn = fiber?.stateNode as Record<string, unknown> | null | undefined;
  if (!sn || typeof sn !== "object") return null;
  if (typeof sn.measureInWindow === "function") return sn as unknown as Measurable;
  // Fabric: fiber.stateNode is { node, canonical: { publicInstance } }.
  const publicInstance = (sn.canonical as Record<string, unknown> | undefined)?.publicInstance as
    | Record<string, unknown>
    | undefined;
  if (publicInstance && typeof publicInstance.measureInWindow === "function") {
    return publicInstance as unknown as Measurable;
  }
  return null;
}

/** Native tag of a host fiber, if one of the known shapes exposes it. */
function nativeTag(fiber: ScrollFiber | null | undefined): number | undefined {
  const sn = fiber?.stateNode as Record<string, unknown> | null | undefined;
  if (!sn || typeof sn !== "object") return undefined;
  if (typeof sn._nativeTag === "number") return sn._nativeTag; // Paper
  const canonical = sn.canonical as Record<string, unknown> | undefined;
  if (typeof canonical?.nativeTag === "number") return canonical.nativeTag; // Fabric
  const publicInstance = canonical?.publicInstance as Record<string, unknown> | undefined;
  if (typeof publicInstance?.__nativeTag === "number") return publicInstance.__nativeTag;
  return undefined;
}

export interface ScrollTarget {
  /** The scroll container host fiber (RCTScrollView & friends). */
  host: ScrollFiber;
  /** Its content view host fiber — the node native translates on scroll. */
  content: ScrollFiber;
  /** Tag from the scroll responder, when the host fiber has none. */
  responderTag?: number;
}

/**
 * Nearest scrollable ancestor of `start` on the fiber RETURN chain — the
 * same walk the inspector already does for names/testIDs.
 */
export function findScrollTarget(start: ScrollFiber | null | undefined): ScrollTarget | null {
  let fiber: ScrollFiber | null | undefined = start;
  let depth = 0;
  const seen = new Set<ScrollFiber>();
  while (fiber && depth < MAX_DEPTH && !seen.has(fiber)) {
    seen.add(fiber);
    let host: ScrollFiber | null = null;
    let responderTag: number | undefined;

    if (isScrollHostName(hostName(fiber))) {
      host = fiber;
    } else {
      const instance = scrollResponderInstance(fiber);
      if (instance) {
        host = firstHostDescendant(fiber);
        const getTag = instance.getScrollableNode as (() => unknown) | undefined;
        if (typeof getTag === "function") {
          try {
            const tag = getTag.call(instance);
            if (typeof tag === "number") responderTag = tag;
          } catch {
            /* dev-only nicety */
          }
        }
      }
    }

    if (host) {
      const content = firstHostDescendant(host);
      if (content) return { host, content, responderTag };
    }
    fiber = fiber.return;
    depth++;
  }
  return null;
}

interface MeasuredRect {
  x: number;
  y: number;
  /** Absent when the platform callback did not report a size. */
  width?: number;
  height?: number;
}

/**
 * The nearest fiber around `start` whose instance can actually be measured:
 * itself, a host descendant, or a host ancestor (composite fibers have no
 * native instance — measuring THEM is what silently failed on device).
 */
export function nearestMeasurableFiber(
  start: ScrollFiber | null | undefined,
): ScrollFiber | null {
  let fiber: ScrollFiber | null | undefined = start;
  let depth = 0;
  while (fiber && depth < 50) {
    if (measurable(fiber)) return fiber;
    const below = firstHostDescendant(fiber);
    if (below && measurable(below)) return below;
    fiber = fiber.return;
    depth++;
  }
  return null;
}

/**
 * Window rect of any host fiber's instance — the AnnoKit package's one
 * measurement primitive (the anchor registry re-measures annotated
 * elements with it; this module uses it for scroll-offset math).
 */
export function measureFiberRect(target: ScrollFiber): Promise<MeasuredRect | null> {
  return measureInWindow(target);
}

function measureInWindow(target: ScrollFiber): Promise<MeasuredRect | null> {
  const instance = measurable(target);
  if (!instance) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: MeasuredRect | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => settle(null), MEASURE_TIMEOUT_MS);
    try {
      instance.measureInWindow((x, y, width, height) => {
        settle(
          typeof x === "number" && typeof y === "number"
            ? {
                x,
                y,
                width: typeof width === "number" && Number.isFinite(width) ? width : undefined,
                height: typeof height === "number" && Number.isFinite(height) ? height : undefined,
              }
            : null,
        );
      });
    } catch {
      settle(null);
    }
  });
}

/** Kill float noise from the two native measurements. */
function round(value: number): number {
  const r = Math.round(value * 100) / 100;
  return r === 0 ? 0 : r; // normalise -0
}

/**
 * The capture-time handle for re-measuring later: the same two host fibers
 * the offset came from. CLIENT-SIDE ONLY — live node references, never
 * serialized, never sent. This is what lets a marker stick to scrolled
 * content: measure the same pair again and the offset DELTA is how far the
 * content moved since capture.
 */
export interface ScrollAnchor {
  host: ScrollFiber;
  content: ScrollFiber;
}

/** A capture-time resolution: the wire info plus the re-measure handle. */
export interface ScrollCapture {
  info: ScrollInfo;
  anchor: ScrollAnchor;
}

/** The container's on-screen viewport, when the platform reported a size. */
export interface AnchorViewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Current offset of an anchor's pair — same math as capture, any time
 * later — plus the container's window viewport when measurable, which is
 * what lets a marker HIDE while its element is scrolled out of it.
 */
export async function measureAnchorOffset(
  anchor: ScrollAnchor,
): Promise<{ offsetY: number; offsetX: number; viewport?: AnchorViewport } | null> {
  try {
    const [hostRect, contentRect] = await Promise.all([
      measureInWindow(anchor.host),
      measureInWindow(anchor.content),
    ]);
    if (!hostRect || !contentRect) return null;
    const viewport =
      hostRect.width !== undefined && hostRect.height !== undefined
        ? { x: hostRect.x, y: hostRect.y, width: hostRect.width, height: hostRect.height }
        : undefined;
    return {
      offsetY: round(hostRect.y - contentRect.y),
      offsetX: round(hostRect.x - contentRect.x),
      viewport,
    };
  } catch {
    return null;
  }
}

/**
 * Resolve the owning scroll container's offset for a touched fiber.
 * Resolves null (never throws, never hangs) when there is no scrollable
 * ancestor or the offset cannot be measured — the caller then reports no
 * scroll info rather than a guess.
 */
export async function resolveScrollCapture(
  start: ScrollFiber | null | undefined,
): Promise<ScrollCapture | null> {
  try {
    const target = findScrollTarget(start);
    if (!target) return null;
    const measured = await measureAnchorOffset({ host: target.host, content: target.content });
    if (!measured) return null;
    const { offsetY, offsetX } = measured;
    const tag = nativeTag(target.host) ?? target.responderTag;
    const info: ScrollInfo = { offsetY };
    if (tag !== undefined) info.scrollViewTag = tag;
    // Horizontal offset is free here but off-contract for most consumers:
    // only send it when it actually carries information.
    if (offsetX !== 0) info.offsetX = offsetX;
    return { info, anchor: { host: target.host, content: target.content } };
  } catch {
    return null;
  }
}

/** The wire info alone, for callers with no use for the anchor. */
export async function resolveScrollInfo(
  start: ScrollFiber | null | undefined,
): Promise<ScrollInfo | null> {
  return (await resolveScrollCapture(start))?.info ?? null;
}
