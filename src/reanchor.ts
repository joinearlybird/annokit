/**
 * Re-anchoring by testID — the answer to "the app reloaded and every marker
 * lost its live anchor".
 *
 * THE RULE IT SERVES: a marker draws ONLY on a live element anchor
 * (src/anchor-registry.ts, markerPositionTrusted) — stored window
 * coordinates are a position lie the moment content scrolls, so no anchor
 * means no dot, for tasks and notes alike. Capture registers the anchor at
 * submit time; this module RE-registers it for marks that arrive without
 * one — a reload (in-memory registry emptied), another device's capture, a
 * server-side create — by finding the annotated element again.
 *
 * HOW IT FINDS IT: the stored record carries the element's `testID` (the
 * template's convention puts one on every interactive element precisely so
 * automation and annotations can anchor). The mounted React tree is walked
 * from its fiber roots — reached through the same React DevTools global
 * hook the inspector already depends on — and the first host fiber whose
 * props carry the wanted testID becomes the anchor, re-measured live from
 * then on exactly like a fresh capture's.
 *
 * WHAT IT DOES NOT DO: marks with no testID on record stay hidden after a
 * reload (there is nothing truthful to re-anchor to), and a testID that is
 * not mounted right now simply stays unresolved — callers retry on the
 * next refresh/route change, because the element may be one navigation
 * away. Everything here is fail-soft: no hook, no roots, no matches, a
 * failed measure — all mean "0 re-anchored", never a throw.
 */

import { hasScrollAnchor, registerReanchored } from "./anchor-registry";
import { OVERLAY_TEST_IDS } from "./inspector";
import { debugLog, debugLogOnce } from "./log";
import { measureFiberRect, nearestMeasurableFiber, resolveScrollCapture } from "./scroll";
import type { ScrollFiber } from "./scroll";

/** The walkable slice of a fiber (ScrollFiber plus the sideways pointers). */
export interface WalkFiber extends ScrollFiber {
  sibling?: WalkFiber | null;
  child?: WalkFiber | null;
  memoizedProps?: { testID?: unknown } | null;
}

/** What re-anchoring needs from a stored mark. */
export interface ReanchorRecord {
  id: string;
  testID?: string | null;
  /** Capture-time marker point and element box — restores the marker's
   *  position INSIDE the element (fallback: the element's centre). */
  x?: number;
  y?: number;
  boundingBox?: { x: number; y: number; width: number; height: number } | null;
}

/** Ceiling on tree nodes visited per pass — a runaway-walk backstop. */
const MAX_WALK = 20_000;

/** The DevTools hook's fiber roots, or [] on any host without them. */
function fiberRoots(): WalkFiber[] {
  try {
    const hook = (globalThis as {
      __REACT_DEVTOOLS_GLOBAL_HOOK__?: {
        renderers?: Map<number, unknown>;
        getFiberRoots?: (rendererId: number) => Set<{ current?: WalkFiber | null }>;
      };
    }).__REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (!hook?.getFiberRoots || !hook.renderers) return [];
    const roots: WalkFiber[] = [];
    for (const id of hook.renderers.keys()) {
      for (const root of hook.getFiberRoots(id) ?? []) {
        if (root?.current) roots.push(root.current);
      }
    }
    return roots;
  } catch {
    return [];
  }
}

/**
 * One depth-first pass over every root, collecting the FIRST fiber for each
 * wanted testID. One walk serves the whole batch — re-anchoring runs per
 * refresh, not per marker.
 */
export function findFibersByTestID(
  roots: readonly WalkFiber[],
  wanted: ReadonlySet<string>,
): Map<string, WalkFiber> {
  const found = new Map<string, WalkFiber>();
  let visited = 0;
  for (const root of roots) {
    const stack: WalkFiber[] = [root];
    while (stack.length > 0 && found.size < wanted.size && visited < MAX_WALK) {
      const fiber = stack.pop()!;
      visited++;
      const testID = fiber.memoizedProps?.testID;
      if (typeof testID === "string" && wanted.has(testID) && !found.has(testID)) {
        found.set(testID, fiber);
      }
      if (fiber.sibling) stack.push(fiber.sibling);
      if (fiber.child) stack.push(fiber.child);
    }
    if (found.size >= wanted.size) break;
  }
  return found;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where inside the matched element the marker goes, or null when the match
 * cannot be trusted to be the thing the mark was made on.
 *
 * The stored testID is the NEAREST one up the touched node's ancestors
 * (src/inspector.ts), so the element it names is either the touched view
 * itself or something WRAPPING it — the button around the label that was
 * actually under the finger. Both are honest anchors:
 *
 *  - SAME SIZE as the capture-time box (generous tolerance — layouts
 *    breathe): the touched view itself. The mark keeps its captured spot
 *    inside it.
 *  - LARGER, and still containing the capture-time box where it was: a
 *    wrapper whose layout has not moved since. The mark goes back exactly
 *    where it was, now riding on the wrapper. This is the common case —
 *    the testID is on the Pressable, the finger was on its Text — and
 *    rejecting it hid the mark of every such capture after a reload.
 *
 * Anything else — smaller, or not where the mark was (a scrolled list, a
 * changed layout, an unrelated element sharing the testID) — stays hidden:
 * a marker on the wrong thing is worse than none.
 */
export function reanchorGrab(
  record: Pick<ReanchorRecord, "x" | "y" | "boundingBox">,
  measured: Rect,
): { grabDx: number; grabDy: number } | null {
  const bb = record.boundingBox;
  const centre = { grabDx: measured.width / 2, grabDy: measured.height / 2 };
  if (!bb) return centre;
  const off = (a: number, b: number) => Math.abs(a - b) > Math.max(24, Math.min(a, b) * 0.5);
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
  if (!off(measured.width, bb.width) && !off(measured.height, bb.height)) {
    return record.x !== undefined && record.y !== undefined
      ? { grabDx: clamp(record.x - bb.x, measured.width), grabDy: clamp(record.y - bb.y, measured.height) }
      : centre;
  }
  // A few points of slack: borders, hairlines and rounding between the
  // capture-time measure and this one.
  const SLACK = 4;
  const contains =
    bb.x >= measured.x - SLACK &&
    bb.y >= measured.y - SLACK &&
    bb.x + bb.width <= measured.x + measured.width + SLACK &&
    bb.y + bb.height <= measured.y + measured.height + SLACK;
  if (!contains) return null;
  const px = record.x ?? bb.x + bb.width / 2;
  const py = record.y ?? bb.y + bb.height / 2;
  return { grabDx: clamp(px - measured.x, measured.width), grabDy: clamp(py - measured.y, measured.height) };
}

/**
 * Re-register anchors for every record that lacks one and names a testID.
 * Returns how many were re-anchored (0 on any kind of nothing-to-do).
 */
export async function reanchorMarkers(records: readonly ReanchorRecord[]): Promise<number> {
  // Marks saved before the inspector skipped the overlay's own testIDs can
  // still carry one; it names the wrapper around the whole app, never the
  // element the mark was made on.
  const missing = records.filter(
    (r): r is ReanchorRecord & { testID: string } =>
      typeof r.testID === "string" &&
      r.testID.length > 0 &&
      !OVERLAY_TEST_IDS.has(r.testID) &&
      !hasScrollAnchor(r.id),
  );
  if (missing.length === 0) return 0;

  const roots = fiberRoots();
  if (roots.length === 0) return 0;
  const matches = findFibersByTestID(roots, new Set(missing.map((r) => r.testID)));
  if (matches.size === 0) return 0;

  let count = 0;
  await Promise.all(
    missing.map(async (record) => {
      const fiber = matches.get(record.testID);
      const target = fiber ? nearestMeasurableFiber(fiber) : null;
      if (!target) return;
      const rect = await measureFiberRect(target);
      if (!rect || !rect.width || !rect.height) return;
      const measured = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      const grab = reanchorGrab(record, measured);
      if (!grab) {
        debugLogOnce(
          `size:${record.id}`,
          `re-anchor ${record.id}: testID "${record.testID}" matched an element that is not where the mark was — skipped`,
        );
        return;
      }
      const { grabDx, grabDy } = grab;
      // The scroll container above it, so the anchor hides during flings
      // exactly like a capture-time anchor does. Fail-soft to none.
      const capture = await resolveScrollCapture(target);
      registerReanchored(record.id, target, capture?.anchor?.host ?? null, grabDx, grabDy);
      count++;
    }),
  );
  if (count > 0) debugLog(`re-anchored ${count} marker(s) by testID`);
  return count;
}
