/**
 * WHAT A CAPTURE IS ABOUT — the one place the four shapes are named.
 *
 * A tap selects an ELEMENT. A press-and-hold pins a POINT: the exact spot
 * under the finger, with the element there kept as context. Area mode draws
 * a region, an AREA. Draw mode leaves strokes, a SKETCH. Each one answers
 * "what is the boundingBox, what is the element called, and how does the
 * UI say it" differently, and before this module every consumer answered
 * for itself: the payload said "Area" where the composer said "Screen",
 * and team notes lost the rectangle altogether. Now the payload, the
 * comment body, the composer's identity line, the detail headers and the
 * list rows all read from here.
 *
 * On the wire the shape is an additive `shape` field, OMITTED for the
 * ordinary element capture (every v1 server stored those without one, and
 * nothing changes for them), present for the other three. A reader that
 * does not know the field treats everything as an element, which is what
 * it always did.
 */

import type { AimRect } from "./aim";
import { readSketch, sketchBounds } from "./sketch";

export type CaptureShape = "element" | "point" | "area" | "sketch";

export function isCaptureShape(value: unknown): value is CaptureShape {
  return value === "element" || value === "point" || value === "area" || value === "sketch";
}

/** The slice of a PendingCapture (or a stored record) that decides its shape. */
export interface ShapedCapture {
  x: number;
  y: number;
  shape?: CaptureShape | string;
  hit?: { element?: string; frame?: AimRect } | null;
  areaRect?: AimRect;
  /** Present on a sketch capture (src/sketch.ts); its bounds are the box. */
  sketch?: { strokes: readonly unknown[] } | null;
}

/**
 * The shape a capture has: what it SAYS it is, else what it carries. An
 * explicit `shape` wins (a comment restored from the server says so), a
 * sketch is a sketch, a rectangle is an area, and everything else is the
 * element under the finger.
 */
export function captureShape(c: ShapedCapture): CaptureShape {
  if (isCaptureShape(c.shape)) return c.shape;
  if (c.sketch && c.sketch.strokes.length > 0) return "sketch";
  if (c.areaRect) return "area";
  return "element";
}

/** The shape for the wire: omitted for an element capture. */
export function wireShape(c: ShapedCapture): Exclude<CaptureShape, "element"> | undefined {
  const shape = captureShape(c);
  return shape === "element" ? undefined : shape;
}

/**
 * The box the annotation is about. A sketch's stroke bounds; an area's
 * drawn rectangle; a point's zero-size box at the finger (the element under
 * it is context, not the subject); an element's frame; and a zero-size box
 * at the tap when nothing was found.
 */
export function captureBoundingBox(c: ShapedCapture): AimRect {
  const shape = captureShape(c);
  if (shape === "sketch") {
    const sketch = readSketch(c.sketch);
    if (sketch) return sketchBounds(sketch);
  }
  if (shape === "area" && c.areaRect) return { ...c.areaRect };
  if (shape === "point") return { x: c.x, y: c.y, width: 0, height: 0 };
  const frame = c.hit?.frame;
  if (frame) return { x: frame.x, y: frame.y, width: frame.width, height: frame.height };
  return { x: c.x, y: c.y, width: 0, height: 0 };
}

/**
 * The `element` field: the component found, else an honest name for what
 * was captured — "Sketch" for strokes over nothing nameable, "Area" for an
 * empty region, "Screen" for a tap or a pin that found nothing.
 */
export function captureElementName(c: ShapedCapture): string {
  const found = c.hit?.element?.trim();
  if (found) return found;
  const shape = captureShape(c);
  return shape === "sketch" ? "Sketch" : shape === "area" ? "Area" : "Screen";
}

/**
 * How the UI names a capture of a given shape, given the element name the
 * server (or the hit) has for it. The element shape is just the name; the
 * others say what was done to it: "This spot on FeedRow", "Area · FeedRow",
 * "Sketch over FeedRow". When the element name is itself the fallback
 * ("Screen", "Area", "Sketch"), the subject is the shape alone.
 */
export function shapeSubject(shape: CaptureShape | string | undefined, element: string | null | undefined): string {
  const name = element?.trim() || "";
  const fallback = name === "" || name === "Screen" || name === "Area" || name === "Sketch";
  switch (isCaptureShape(shape) ? shape : "element") {
    case "point":
      return fallback ? "This spot" : `This spot on ${name}`;
    case "area":
      return fallback ? "Area" : `Area · ${name}`;
    case "sketch":
      return fallback ? "Sketch" : `Sketch over ${name}`;
    default:
      return name;
  }
}

/** The detail pane's title: the subject, or "This screen" for an element capture with no name. */
export function detailTitle(record: { shape?: string; element?: string | null }): string {
  const subject = shapeSubject(record.shape, record.element);
  return subject || "This screen";
}
