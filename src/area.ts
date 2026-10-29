/**
 * Area selection — "this whole region", including the empty part of it.
 *
 * A tap can only say "this element". Some feedback is about a REGION — the
 * spacing between two cards, a group that should align, a stretch of screen
 * where something is missing — and the web overlay answers that with a
 * drag-rectangle. In aim mode a drag already means "survey what is under my
 * finger", so area is its own MODE (the chip the overlay shows while
 * armed): press sets a corner, drag opens the rectangle, release keeps it.
 *
 * What an area captures: the rectangle itself (it becomes the annotation's
 * boundingBox — the region IS the subject), plus the components found by
 * hit-testing a handful of sample points inside it, deduped, so the agent
 * knows what lives there without guessing from coordinates.
 *
 * Pure geometry and list logic; index.tsx owns the gesture and the
 * hit-tests, aim-overlay draws the rectangle.
 */

import type { AimRect } from "./aim";

export interface AreaPoint {
  x: number;
  y: number;
}

/** The rectangle between two corners, whichever way the drag went. */
export function areaRectFrom(origin: AreaPoint, current: AreaPoint): AimRect {
  return {
    x: Math.min(origin.x, current.x),
    y: Math.min(origin.y, current.y),
    width: Math.abs(current.x - origin.x),
    height: Math.abs(current.y - origin.y),
  };
}

/**
 * Smaller than this on either side is a wobbly tap, not a region — treat it
 * as nothing rather than annotating a 3-point sliver.
 */
export const AREA_MIN_SIZE = 24;

export function isAreaMeaningful(rect: AimRect): boolean {
  return rect.width >= AREA_MIN_SIZE && rect.height >= AREA_MIN_SIZE;
}

/**
 * Where to hit-test inside the rectangle: the center first (it is the best
 * "what is this region mostly" answer, and the caller gives it the full
 * capture treatment), then the four corners pulled in by a fixed inset so
 * they land inside the region's own children instead of on whatever
 * borders it.
 */
export const AREA_SAMPLE_INSET = 12;

export function areaSamplePoints(rect: AimRect): AreaPoint[] {
  const inset = Math.min(AREA_SAMPLE_INSET, rect.width / 4, rect.height / 4);
  const left = rect.x + inset;
  const right = rect.x + rect.width - inset;
  const top = rect.y + inset;
  const bottom = rect.y + rect.height - inset;
  return [
    { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
    { x: left, y: top },
    { x: right, y: top },
    { x: left, y: bottom },
    { x: right, y: bottom },
  ];
}

/** What the confirm bar calls the region: its size is its name. */
export function areaLabel(rect: AimRect): string {
  return `Area ${Math.round(rect.width)}×${Math.round(rect.height)}`;
}

/**
 * Dedupe sampled hits: five samples inside one card are one card. Identity
 * matches the multi-select basket's (name + testID + rounded frame), and
 * order keeps the first appearance — the center sample first, so the
 * region's dominant component stays the primary.
 */
export function dedupeAreaHits<H extends { element: string; testID?: string; frame: AimRect }>(
  hits: readonly (H | null)[],
): H[] {
  const seen = new Set<string>();
  const out: H[] = [];
  for (const hit of hits) {
    if (!hit) continue;
    const f = hit.frame;
    const r = (n: number) => Math.round(n);
    const key = `${hit.element}|${hit.testID ?? ""}|${r(f.x)},${r(f.y)},${r(f.width)},${r(f.height)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
  }
  return out;
}
