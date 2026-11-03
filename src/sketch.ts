/**
 * SKETCHES — strokes drawn over the live app, as geometry.
 *
 * Draw mode (the armed-mode chip's third segment) lets a finger say what a
 * sentence struggles with: "this card, as a carousel, sliding this way",
 * "move this up here", a circle round the thing that is wrong. The strokes
 * are kept as VECTORS in window coordinates — the same space as the tap
 * point and the bounding box — so they travel on the wire, survive a
 * screenshot being resized, and can be drawn again over the app when the
 * task is opened.
 *
 * Two tools: PEN (freehand, a polyline) and ARROW (a straight shaft from
 * tail to tip; the head is drawn at render time and never stored). A
 * rectangle is not a tool, because Area mode already is one.
 *
 * Everything here is pure: a stroke in, a stroke or a number out. The
 * rendering half (src/sketch-layer.tsx) turns strokes into SVG paths and
 * the provider (src/index.tsx) owns the gesture. The one constant shared
 * with Area mode is the meaningful size: a stroke shorter than
 * AREA_MIN_SIZE is a wobbly tap, not a drawing.
 */

import type { AimRect } from "./aim";
import { AREA_MIN_SIZE } from "./area";

export type SketchTool = "pen" | "arrow";

export interface SketchPoint {
  x: number;
  y: number;
}

export interface SketchStroke {
  tool: SketchTool;
  /** Window points. An arrow has exactly two: tail, then tip. */
  points: SketchPoint[];
}

export interface Sketch {
  strokes: SketchStroke[];
}

/** Drawn and sent at this width, in points. */
export const SKETCH_STROKE_WIDTH = 3;
/** A stroke shorter than this (path length) is a wobbly tap, not a drawing. */
export const SKETCH_MIN_LENGTH = AREA_MIN_SIZE;
/** Touch samples closer than this to the last kept point are dropped. */
export const SKETCH_MIN_POINT_GAP = 2;
export const SKETCH_MAX_STROKES = 20;
/** Per stroke, after simplification. */
export const SKETCH_MAX_POINTS = 400;
/** Simplification tolerance (Ramer–Douglas–Peucker), in points. */
export const SKETCH_SIMPLIFY_TOLERANCE = 1.5;
export const ARROW_HEAD_LENGTH = 14;
export const ARROW_HEAD_ANGLE = Math.PI / 6;

const tenth = (n: number) => Math.round(n * 10) / 10;

export function startStroke(tool: SketchTool, point: SketchPoint): SketchStroke {
  return { tool, points: [{ x: point.x, y: point.y }] };
}

/**
 * The stroke with the finger's next position. A pen keeps the point when it
 * has moved at least SKETCH_MIN_POINT_GAP from the last one; an arrow has
 * only a tip, which this moves.
 */
export function extendStroke(stroke: SketchStroke, point: SketchPoint): SketchStroke {
  if (stroke.tool === "arrow") {
    return { tool: "arrow", points: [stroke.points[0]!, { x: point.x, y: point.y }] };
  }
  const last = stroke.points[stroke.points.length - 1]!;
  if (Math.hypot(point.x - last.x, point.y - last.y) < SKETCH_MIN_POINT_GAP) return stroke;
  return { tool: "pen", points: [...stroke.points, { x: point.x, y: point.y }] };
}

/** The path length of a stroke, in points. */
export function strokeLength(stroke: SketchStroke): number {
  let length = 0;
  for (let i = 1; i < stroke.points.length; i++) {
    const a = stroke.points[i - 1]!;
    const b = stroke.points[i]!;
    length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return length;
}

/**
 * Length, not bounding box: a straight horizontal line has a zero-height
 * box and is still a drawing. A deliberate tick shorter than the minimum is
 * lost, the same way a wobbly tap is in Area mode.
 */
export function isStrokeMeaningful(stroke: SketchStroke): boolean {
  return strokeLength(stroke) >= SKETCH_MIN_LENGTH;
}

/** Ramer–Douglas–Peucker: drop points that stay within `tolerance` of the line between their neighbours. */
function simplify(points: SketchPoint[], tolerance: number): SketchPoint[] {
  if (points.length <= 2) return points;
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [from, to] = stack.pop()!;
    const a = points[from]!;
    const b = points[to]!;
    let worst = -1;
    let worstAt = -1;
    for (let i = from + 1; i < to; i++) {
      const d = distanceToSegment(points[i]!, a, b);
      if (d > worst) {
        worst = d;
        worstAt = i;
      }
    }
    if (worst > tolerance && worstAt > 0) {
      keep[worstAt] = true;
      stack.push([from, worstAt], [worstAt, to]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function distanceToSegment(p: SketchPoint, a: SketchPoint, b: SketchPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * The stroke as it is kept and sent: simplified, capped, rounded to a tenth
 * of a point. Endpoints always survive. An arrow is left as its two points.
 */
export function finishStroke(stroke: SketchStroke): SketchStroke {
  let points = stroke.tool === "arrow" ? stroke.points.slice(0, 2) : simplify(stroke.points, SKETCH_SIMPLIFY_TOLERANCE);
  if (points.length > SKETCH_MAX_POINTS) {
    const step = (points.length - 1) / (SKETCH_MAX_POINTS - 1);
    points = Array.from({ length: SKETCH_MAX_POINTS }, (_, i) => points[Math.round(i * step)]!);
  }
  return { tool: stroke.tool, points: points.map((p) => ({ x: tenth(p.x), y: tenth(p.y) })) };
}

export function strokeBounds(stroke: SketchStroke): AimRect {
  const xs = stroke.points.map((p) => p.x);
  const ys = stroke.points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * The box a sketch is about: every stroke's bounds, padded by half the
 * stroke width so a straight line is not a zero-height box (which push mode
 * treats as "nothing to push for", src/push.ts).
 */
export function sketchBounds(sketch: Sketch, pad: number = SKETCH_STROKE_WIDTH / 2): AimRect {
  const points = sketch.strokes.flatMap((s) => s.points);
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  return { x: tenth(x), y: tenth(y), width: tenth(Math.max(...xs) - x + pad), height: tenth(Math.max(...ys) - y + pad) };
}

/** The centre of the sketch's bounds: where its element is looked for. */
export function sketchCentre(sketch: Sketch): SketchPoint {
  const b = sketchBounds(sketch, 0);
  return { x: tenth(b.x + b.width / 2), y: tenth(b.y + b.height / 2) };
}

/** The two wing points of an arrow head at `tip`, pointing away from `tail`. */
export function arrowHead(tail: SketchPoint, tip: SketchPoint): [SketchPoint, SketchPoint] {
  const angle = Math.atan2(tip.y - tail.y, tip.x - tail.x);
  const wing = (side: 1 | -1): SketchPoint => ({
    x: tip.x - ARROW_HEAD_LENGTH * Math.cos(angle + side * ARROW_HEAD_ANGLE),
    y: tip.y - ARROW_HEAD_LENGTH * Math.sin(angle + side * ARROW_HEAD_ANGLE),
  });
  return [wing(1), wing(-1)];
}

/**
 * One SVG `d` per stroke. A pen is a polyline; an arrow is its shaft and a
 * head drawn as two more lines from the tip. `offset` is subtracted, for a
 * layer whose origin is not the window's.
 */
export function strokePath(stroke: SketchStroke, offset: SketchPoint = { x: 0, y: 0 }): string {
  const pt = (p: SketchPoint) => `${round(p.x - offset.x)} ${round(p.y - offset.y)}`;
  const [first, ...rest] = stroke.points;
  if (!first) return "";
  if (stroke.tool === "arrow") {
    const tip = rest[0] ?? first;
    const [a, b] = arrowHead(first, tip);
    return `M ${pt(first)} L ${pt(tip)} M ${pt(a)} L ${pt(tip)} L ${pt(b)}`;
  }
  if (rest.length === 0) return `M ${pt(first)} L ${pt(first)}`;
  return `M ${pt(first)} ${rest.map((p) => `L ${pt(p)}`).join(" ")}`;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** "Sketch", or "Sketch · 3 strokes" for the confirm bar. */
export function sketchLabel(sketch: Sketch): string {
  const n = sketch.strokes.length;
  return n > 1 ? `Sketch · ${n} strokes` : "Sketch";
}

/** The sketch with one more stroke, or null when it is at the cap. */
export function appendStroke(sketch: Sketch, stroke: SketchStroke): Sketch | null {
  if (sketch.strokes.length >= SKETCH_MAX_STROKES) return null;
  return { strokes: [...sketch.strokes, stroke] };
}

/** The sketch without its last stroke, or null when there is nothing left. */
export function undoStroke(sketch: Sketch): Sketch | null {
  if (sketch.strokes.length <= 1) return null;
  return { strokes: sketch.strokes.slice(0, -1) };
}

/**
 * A sketch from untrusted data (a server's stored record): the right
 * shape, finite numbers, known tools, within the caps — or null.
 */
export function readSketch(value: unknown): Sketch | null {
  if (!value || typeof value !== "object") return null;
  const raw = (value as { strokes?: unknown }).strokes;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > SKETCH_MAX_STROKES) return null;
  const strokes: SketchStroke[] = [];
  for (const s of raw) {
    const tool = (s as { tool?: unknown })?.tool;
    const points = (s as { points?: unknown })?.points;
    if ((tool !== "pen" && tool !== "arrow") || !Array.isArray(points)) return null;
    if (points.length === 0 || points.length > SKETCH_MAX_POINTS) return null;
    if (tool === "arrow" && points.length !== 2) return null;
    const clean: SketchPoint[] = [];
    for (const p of points) {
      const x = (p as { x?: unknown })?.x;
      const y = (p as { y?: unknown })?.y;
      if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return null;
      clean.push({ x, y });
    }
    strokes.push({ tool, points: clean });
  }
  return { strokes };
}

/** The sketch moved by (dx, dy): what the marker layer draws when its element has scrolled. */
export function shiftSketch(sketch: Sketch, dx: number, dy: number): Sketch {
  if (dx === 0 && dy === 0) return sketch;
  return { strokes: sketch.strokes.map((s) => ({ tool: s.tool, points: s.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) })) };
}
