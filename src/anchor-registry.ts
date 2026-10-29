/**
 * Element anchoring — how a marker stays ON the thing it marks.
 *
 * A marker is captured at WINDOW coordinates, and window coordinates go
 * stale the moment anything moves — scrolling first of all. The overlay
 * cannot hear the app's scrolls (RN's onScroll does not bubble, and the
 * overlay does not own the app's ScrollViews), so v1 inferred movement by
 * measuring the owning scroll container and shifting stored coordinates by
 * the offset delta. That was indirect: nested scrollables, layout changes
 * and anything else that moves an element all fell outside the container
 * math.
 *
 * v2 anchors to the ELEMENT ITSELF. The capture already resolved the
 * touched view's fiber; keep it, and a marker's position is simply "where
 * that view is NOW, plus where inside it the finger tapped" — one
 * measurement, correct against every kind of movement at once. The owning
 * scroll container's host is kept only as the VIEWPORT: the region the
 * mark must hide outside of when its element scrolls away (non-virtualized
 * children still measure fine while scrolled out of view, so the element
 * rect alone cannot tell us).
 *
 * LIVE NODE REFERENCES, DELIBERATELY UNSERIALIZED. The registry exists
 * only inside the running app. It cannot survive a reload, and a
 * VIRTUALIZED row (FlatList) that unmounts off-screen kills its node until
 * testID re-resolution exists — in both cases the mark's position cannot
 * be believed, and markerPositionTrusted hides it rather than letting it
 * float over whatever scrolled underneath (device-observed complaint).
 *
 * Positions still arrive by POLLING (plus the app-reported scroll events
 * in src/scroll-reporter.ts, which make reaction near-instant where the
 * host app cooperates), so the settle discipline from v1 stays: quantize
 * to whole points, hide a mark whose position is still changing, show it
 * once the same answer has come back ANCHOR_STABLE_TICKS times.
 */

import { measureFiberRect } from "./scroll";
import { debugLog } from "./log";
import type { AnchorViewport, ScrollFiber } from "./scroll";
import type { InspectorHit } from "./inspector";

interface RegisteredAnchor {
  /** The annotated element's fiber — what gets re-measured. */
  element: ScrollFiber;
  /** Owning scroll container host, when there was one: the hide-outside region. */
  viewport: ScrollFiber | null;
  /** Where inside the element the finger tapped (marker point − element origin). */
  grabDx: number;
  grabDy: number;
}

/** A measured "the marker belongs HERE now" answer. */
export interface AnchorFix {
  x: number;
  y: number;
  /**
   * The element could not be measured or measured ZERO-SIZE — on Fabric an
   * unmounted (virtualized-away) view reports (0,0,0,0), which is a
   * position lie near the window origin. Gone means HIDE, never draw.
   */
  gone?: boolean;
  /** The container's current on-screen viewport, when measurable. */
  viewport?: AnchorViewport;
}

/**
 * Enough for any session anyone actually annotates; oldest pruned first.
 * A pruned marker stops being trusted (hidden), never breaks.
 */
const REGISTRY_LIMIT = 200;

const registry = new Map<string, RegisteredAnchor>();

/**
 * The entry for `id`, unless its element has UNMOUNTED — then the entry is
 * dropped and this answers undefined.
 *
 * A dead entry used to stay forever: the mark still "had an anchor", so
 * testID re-anchoring (src/reanchor.ts) skipped it, and a row annotated,
 * navigated away from and returned to never drew its mark again. Dead
 * entries also filled the limit and pushed out live ones.
 *
 * The signal is React's own: deleting a fiber nulls its `return`, and no
 * mounted fiber below the root has none. A failed or zero-size MEASURE is
 * NOT the signal — a frozen tab or a mid-layout view measures that way and
 * comes back, and an anchor without a testID could never be recovered.
 */
function liveEntry(id: string): RegisteredAnchor | undefined {
  const entry = registry.get(id);
  if (entry && entry.element.return === null) {
    registry.delete(id);
    debugLog(`anchor ${id}: element unmounted, dropped for re-anchoring`);
    return undefined;
  }
  return entry;
}

/** What registration needs from a capture: the point, and the hit's nodes. */
export interface AnchorCapture {
  x: number;
  y: number;
  hit: InspectorHit | null;
}

/**
 * Remember the capture's element node under the id the server will hand
 * back. No-op without an element node — there is nothing to anchor to.
 */
export function registerScrollAnchor(id: string, capture: AnchorCapture | null | undefined): void {
  const hit = capture?.hit;
  if (!capture || !hit?.elementFiber) {
    debugLog(
      `anchor ${id}: not registered (${!capture || !hit ? "no hit" : "no element node"})`,
    );
    return;
  }
  if (registry.size >= REGISTRY_LIMIT) {
    const oldest = registry.keys().next().value;
    if (oldest !== undefined) registry.delete(oldest);
  }
  registry.set(id, {
    element: hit.elementFiber,
    viewport: hit.scrollAnchor?.host ?? null,
    grabDx: capture.x - hit.frame.x,
    grabDy: capture.y - hit.frame.y,
  });
  debugLog(`anchor ${id}: registered (element-node)`);
}

/**
 * Register an anchor RESOLVED AFTER THE FACT (src/reanchor.ts): the element
 * was found again by testID, not captured under a finger. Same registry,
 * same re-measure loop from here on.
 */
export function registerReanchored(
  id: string,
  element: ScrollFiber,
  viewportHost: ScrollFiber | null,
  grabDx: number,
  grabDy: number,
): void {
  if (registry.size >= REGISTRY_LIMIT) {
    const oldest = registry.keys().next().value;
    if (oldest !== undefined) registry.delete(oldest);
  }
  registry.set(id, { element, viewport: viewportHost, grabDx, grabDy });
}

/**
 * The LIVE window rect of an anchored mark's element, or null. The open-
 * marker boundary draws from this — the element as it is, not the capture-
 * time box shifted by arithmetic.
 */
export async function measureAnchorRect(
  id: string,
): Promise<{ x: number; y: number; width: number; height: number } | null> {
  const entry = liveEntry(id);
  if (!entry) return null;
  const rect = await measureFiberRect(entry.element);
  if (!rect || !rect.width || !rect.height) return null;
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

/** Test seam + hygiene: module-level state must be resettable. */
export function clearScrollAnchors(): void {
  registry.clear();
}

/** Which of these ids have an anchor at all — the poll skips the rest. */
export function hasScrollAnchor(id: string): boolean {
  return liveEntry(id) !== undefined;
}

/**
 * Can this marker's position be believed at all?
 *
 * ONE RULE, BOTH KINDS: a marker draws only on a LIVE element anchor.
 * Stored window coordinates are a position lie the moment anything scrolls
 * or relayouts, and "captured outside a scrollable" stopped being a safe
 * exception the day markers had to survive reloads — a re-mounted app owes
 * every mark a re-measure, not a guess. Anchors come from capture
 * (registerScrollAnchor) or are recovered by testID (src/reanchor.ts);
 * a mark with neither stays hidden, reachable through its list.
 */
export function markerPositionTrusted(id: string): boolean {
  return liveEntry(id) !== undefined;
}

/**
 * Measure the current position of every registered id in `ids`. Ids whose
 * element cannot be measured are OMITTED — the track's stickiness absorbs
 * a one-tick hiccup, and a persistently dead element simply stops fixing
 * (its mark hides via the trusted/track rules). Never throws.
 */
export async function measureAnchorFixes(ids: readonly string[]): Promise<Map<string, AnchorFix>> {
  const fixes = new Map<string, AnchorFix>();
  await Promise.all(
    ids.map(async (id) => {
      const entry = liveEntry(id);
      if (!entry) return;
      const [elementRect, viewportRect] = await Promise.all([
        measureFiberRect(entry.element),
        entry.viewport ? measureFiberRect(entry.viewport) : Promise.resolve(null),
      ]);
      if (!elementRect || !elementRect.width || !elementRect.height) {
        fixes.set(id, { x: 0, y: 0, gone: true });
        return;
      }
      const fix: AnchorFix = { x: elementRect.x + entry.grabDx, y: elementRect.y + entry.grabDy };
      if (viewportRect && viewportRect.width !== undefined && viewportRect.height !== undefined) {
        fix.viewport = {
          x: viewportRect.x,
          y: viewportRect.y,
          width: viewportRect.width,
          height: viewportRect.height,
        };
      }
      fixes.set(id, fix);
    }),
  );
  return fixes;
}

// ── Fix tracking: quantized, and settled-before-shown ────────────────────────
//
// A poll can only SAMPLE motion, so drawing every sample makes a mark
// chase its element in late jumps — and at rest, native measurements
// disagree by fractions of a point, so the dot micro-twitches. Fixes are
// rounded to whole points, a mark whose fix changed this tick is mid-move
// and hidden, and it reappears once the same fix has come back
// ANCHOR_STABLE_TICKS times — landing exactly on its element, having never
// been seen to move.

/**
 * Poll cadence when no scroll events arrive (src/scroll-reporter.ts), and
 * something is actually moving.
 */
export const REANCHOR_INTERVAL_MS = 150;

/**
 * Poll cadence once every watched anchor has SETTLED.
 *
 * The measurement loop used to run at 150ms for as long as the marker
 * layer was mounted, whether or not anything was moving: every visible
 * anchor, every tick, each costing an element measurement plus a viewport
 * one. A screen at rest with twenty marks did ~260 native measurements a
 * second forever, for an answer that had not changed since the first tick.
 *
 * It cannot stop ENTIRELY, because not everything that moves an element
 * announces itself: an animation, a layout pass, the keyboard, or a host
 * that never calls `reportAnnoKitScroll` all move marks silently. So a
 * settled screen drops to a slow heartbeat instead — 1/13th of the work —
 * and the moment that heartbeat measures a change, the cadence snaps back
 * to REANCHOR_INTERVAL_MS. Cheap when nothing happens, responsive when
 * something does, and self-correcting either way.
 *
 * (docs/audit/performance-correctness.md, "Replace continuous 150 ms
 * anchor measurement polling")
 */
export const REANCHOR_IDLE_INTERVAL_MS = 2_000;

/** Consecutive identical measurements before a moved mark is shown. */
export const ANCHOR_STABLE_TICKS = 2;

/** What the poll accumulates: latest fixes + how long each has held. */
export interface AnchorTrack {
  fixes: ReadonlyMap<string, AnchorFix>;
  /** Per id: consecutive ticks the fix has been unchanged (capped). */
  stable: ReadonlyMap<string, number>;
}

export function emptyAnchorTrack(): AnchorTrack {
  return { fixes: new Map(), stable: new Map() };
}

/** Whole points: the render grid; sub-point flutter is measurement noise. */
function quantize(f: AnchorFix): AnchorFix {
  const q: AnchorFix = { x: Math.round(f.x), y: Math.round(f.y) };
  if (f.viewport) q.viewport = f.viewport;
  if (f.gone) q.gone = true;
  return q;
}

/**
 * Fold one poll's measurements into the track. Pure; never mutates prev.
 *
 * STICKY across hiccups: an id that measured before but is missing from
 * THIS tick keeps its previous entry — a single failed native measurement
 * must not flap the marker. Genuinely gone ids leave the track when the
 * watch list changes (the caller resets the track then).
 */
export function advanceAnchorTrack(
  prev: AnchorTrack,
  measured: ReadonlyMap<string, AnchorFix>,
): AnchorTrack {
  const fixes = new Map<string, AnchorFix>();
  const stable = new Map<string, number>();
  for (const [id, raw] of measured) {
    const next = quantize(raw);
    const before = prev.fixes.get(id);
    const held = before && before.x === next.x && before.y === next.y && !!before.gone === !!next.gone;
    fixes.set(id, next);
    // Capped, so a long-settled marker reaches a fixed point and the
    // caller's equality gate can stop re-rendering.
    stable.set(id, held ? Math.min((prev.stable.get(id) ?? 0) + 1, ANCHOR_STABLE_TICKS) : 0);
  }
  for (const [id, before] of prev.fixes) {
    if (fixes.has(id)) continue;
    fixes.set(id, before);
    stable.set(id, prev.stable.get(id) ?? 0);
  }
  return { fixes, stable };
}

/** Mid-move: measured, but not yet held long enough to be believed. */
export function anchorMoving(track: AnchorTrack, id: string): boolean {
  if (!track.fixes.has(id)) return false;
  return (track.stable.get(id) ?? 0) < ANCHOR_STABLE_TICKS;
}

/**
 * Is every watched anchor settled — i.e. is there nothing left to see?
 *
 * An id with NO fix counts as settled: it measured as unmeasurable (an
 * unmounted or virtualized-away element), it is not being drawn, and it
 * must not be the reason the whole screen keeps measuring at speed. The
 * slow heartbeat still retries it, so a mark whose element mounts later
 * recovers within one idle interval.
 */
export function anchorsSettled(track: AnchorTrack, ids: readonly string[]): boolean {
  for (const id of ids) {
    if (!track.fixes.has(id)) continue;
    if ((track.stable.get(id) ?? 0) < ANCHOR_STABLE_TICKS) return false;
  }
  return true;
}

/**
 * How far outside the window a marker may sit and still be re-measured.
 *
 * Generous by a screen-ish margin: a marker just above the fold should be
 * measured before it scrolls in, not after, or it appears late and in the
 * wrong place. The saving is not in the near-misses but in the long tail —
 * a 200-marker session where all but a handful are screens away.
 */
export const VIEWPORT_MARGIN = 600;

/**
 * Which of `ids` are worth measuring THIS tick, given where they were last
 * seen.
 *
 * The chicken-and-egg: knowing whether a marker is on screen requires a
 * position, and getting a position is the expensive thing being avoided.
 * The last known fix is the answer — a marker does not teleport, and
 * anything that moves it (a scroll, a layout pass) drives a full burst
 * measurement anyway (src/markers.tsx), so a stale skip self-corrects
 * within one interval.
 *
 * An id with NO fix yet is always measured: never-measured is not the same
 * as far-away, and a marker that has just been registered or re-anchored
 * has to be placed before it can be skipped.
 */
export function idsNearViewport(
  track: AnchorTrack,
  ids: readonly string[],
  windowHeight: number,
  margin: number = VIEWPORT_MARGIN,
): string[] {
  // A nonsense window (0 in a headless test) means "measure everything"
  // rather than "measure nothing" — failing open is the safe direction.
  if (!(windowHeight > 0)) return [...ids];
  const near: string[] = [];
  for (const id of ids) {
    const fix = track.fixes.get(id);
    if (!fix || fix.gone) {
      near.push(id);
      continue;
    }
    if (fix.y >= -margin && fix.y <= windowHeight + margin) near.push(id);
  }
  return near;
}

/** The delay before the next measurement, given what the last one found. */
export function nextAnchorDelay(track: AnchorTrack, ids: readonly string[]): number {
  return anchorsSettled(track, ids) ? REANCHOR_IDLE_INTERVAL_MS : REANCHOR_INTERVAL_MS;
}

/** Same fixes, same hold counts — the poll's "keep the state". */
export function anchorTracksEqual(a: AnchorTrack, b: AnchorTrack): boolean {
  if (a.fixes.size !== b.fixes.size || a.stable.size !== b.stable.size) return false;
  for (const [id, f] of a.fixes) {
    const g = b.fixes.get(id);
    if (!g || g.x !== f.x || g.y !== f.y || !!g.gone !== !!f.gone) return false;
    if (!!f.viewport !== !!g.viewport) return false;
    if (
      f.viewport &&
      g.viewport &&
      (f.viewport.x !== g.viewport.x ||
        f.viewport.y !== g.viewport.y ||
        f.viewport.width !== g.viewport.width ||
        f.viewport.height !== g.viewport.height)
    ) {
      return false;
    }
  }
  for (const [id, n] of a.stable) if (b.stable.get(id) !== n) return false;
  return true;
}

/** Is this window point inside the container's current viewport? */
function insideViewport(x: number, y: number, v: AnchorViewport): boolean {
  return x >= v.x && x <= v.x + v.width && y >= v.y && y <= v.y + v.height;
}

/**
 * Re-positioned copies of whatever carries an id and window coordinates —
 * anchored marks sit where their element is NOW; a mark that is mid-move
 * is hidden (it would otherwise be seen chasing its element in poll-sized
 * jumps), and so is one whose point left its container's viewport.
 * A fix that matches the stored position never hides — a fresh marker
 * must not blink in late. Returns the INPUT ARRAY when nothing changed,
 * so callers can use identity to skip re-renders.
 */
export function applyAnchorFixes<M extends { id: string; x: number; y: number }>(
  markers: readonly M[],
  track: AnchorTrack,
): M[] {
  if (track.fixes.size === 0) return markers as M[];
  let changed = false;
  const out: M[] = [];
  for (const m of markers) {
    const f = track.fixes.get(m.id);
    if (!f) {
      out.push(m);
      continue;
    }
    if (f.gone) {
      changed = true;
      continue;
    }
    if (f.viewport && !insideViewport(f.x, f.y, f.viewport)) {
      changed = true;
      continue;
    }
    const atStored = Math.round(m.x) === f.x && Math.round(m.y) === f.y;
    if (atStored) {
      out.push(m);
      continue;
    }
    if (anchorMoving(track, m.id)) {
      changed = true;
      continue;
    }
    changed = true;
    out.push({ ...m, x: f.x, y: f.y });
  }
  return changed ? out : (markers as M[]);
}
