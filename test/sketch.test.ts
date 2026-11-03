/** Sketch geometry (src/sketch.ts): strokes in, strokes, boxes and paths out. */

import { describe, expect, it } from "vitest";
import { AREA_MIN_SIZE } from "../src/area";
import {
  ARROW_HEAD_LENGTH,
  SKETCH_MAX_POINTS,
  SKETCH_MAX_STROKES,
  SKETCH_MIN_LENGTH,
  SKETCH_MIN_POINT_GAP,
  SKETCH_STROKE_WIDTH,
  appendStroke,
  arrowHead,
  extendStroke,
  finishStroke,
  isStrokeMeaningful,
  readSketch,
  shiftSketch,
  sketchBounds,
  sketchCentre,
  sketchLabel,
  startStroke,
  strokeBounds,
  strokeLength,
  strokePath,
  undoStroke,
} from "../src/sketch";
import type { Sketch, SketchStroke } from "../src/sketch";

const pen = (...pts: [number, number][]): SketchStroke => ({ tool: "pen", points: pts.map(([x, y]) => ({ x, y })) });
const arrow = (tail: [number, number], tip: [number, number]): SketchStroke => ({ tool: "arrow", points: [{ x: tail[0], y: tail[1] }, { x: tip[0], y: tip[1] }] });

describe("drawing a stroke", () => {
  it("a pen keeps a point only once the finger has moved the minimum gap", () => {
    let s = startStroke("pen", { x: 10, y: 10 });
    s = extendStroke(s, { x: 10.5, y: 10.5 });
    expect(s.points).toHaveLength(1);
    s = extendStroke(s, { x: 13, y: 10 });
    expect(s.points).toHaveLength(2);
    expect(SKETCH_MIN_POINT_GAP).toBe(2);
  });

  it("an arrow is always its tail and the current tip", () => {
    let s = startStroke("arrow", { x: 0, y: 0 });
    s = extendStroke(s, { x: 50, y: 0 });
    s = extendStroke(s, { x: 80, y: 20 });
    expect(s.points).toEqual([{ x: 0, y: 0 }, { x: 80, y: 20 }]);
  });

  it("measures length along the path, so a flat line counts although its box has no height", () => {
    expect(strokeLength(pen([0, 0], [30, 0]))).toBe(30);
    expect(isStrokeMeaningful(pen([0, 0], [SKETCH_MIN_LENGTH, 0]))).toBe(true);
    expect(isStrokeMeaningful(pen([0, 0], [SKETCH_MIN_LENGTH - 0.1, 0]))).toBe(false);
    expect(isStrokeMeaningful(pen([0, 0], [10, 0], [10, 10], [20, 10]))).toBe(true);
    expect(isStrokeMeaningful(startStroke("pen", { x: 1, y: 1 }))).toBe(false);
  });

  it("shares Area mode's minimum", () => {
    expect(SKETCH_MIN_LENGTH).toBe(AREA_MIN_SIZE);
  });
});

describe("finishStroke", () => {
  it("drops collinear points, keeps the ends, and rounds to a tenth", () => {
    const s = finishStroke(pen([0, 0], [10.04, 0.02], [20, 0], [30, 0.01], [40, 40]));
    expect(s.points[0]).toEqual({ x: 0, y: 0 });
    expect(s.points[s.points.length - 1]).toEqual({ x: 40, y: 40 });
    expect(s.points).toHaveLength(3);
    expect(s.points[1]).toEqual({ x: 30, y: 0 });
  });

  it("caps a long stroke at the maximum point count", () => {
    const zigzag = pen(...Array.from({ length: 2000 }, (_, i): [number, number] => [i, i % 2 ? 10 : 0]));
    const s = finishStroke(zigzag);
    expect(s.points.length).toBeLessThanOrEqual(SKETCH_MAX_POINTS);
    expect(s.points[0]).toEqual({ x: 0, y: 0 });
    expect(s.points[s.points.length - 1]).toEqual({ x: 1999, y: 10 });
  });

  it("leaves an arrow as its two points", () => {
    expect(finishStroke(arrow([0, 0], [10.123, 5.678])).points).toEqual([{ x: 0, y: 0 }, { x: 10.1, y: 5.7 }]);
  });
});

describe("bounds", () => {
  it("a stroke's box, and a sketch's box padded by half the stroke width", () => {
    expect(strokeBounds(pen([10, 20], [40, 60]))).toEqual({ x: 10, y: 20, width: 30, height: 40 });
    const sketch: Sketch = { strokes: [pen([10, 20], [40, 60]), arrow([0, 30], [50, 30])] };
    const pad = SKETCH_STROKE_WIDTH / 2;
    expect(sketchBounds(sketch)).toEqual({ x: 0 - pad, y: 20 - pad, width: 50 + 2 * pad, height: 40 + 2 * pad });
    // A flat line is still a box with height, so push mode has something to push for.
    expect(sketchBounds({ strokes: [pen([0, 10], [40, 10])] }).height).toBe(SKETCH_STROKE_WIDTH);
    expect(sketchBounds({ strokes: [] })).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it("the centre is the middle of the unpadded bounds", () => {
    expect(sketchCentre({ strokes: [pen([10, 20], [40, 60])] })).toEqual({ x: 25, y: 40 });
  });
});

describe("arrows and paths", () => {
  it("draws a symmetric head of the set length, pointing away from the tail", () => {
    const [a, b] = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 });
    expect(a.x).toBeCloseTo(b.x);
    expect(a.y).toBeCloseTo(-b.y);
    expect(Math.hypot(100 - a.x, a.y)).toBeCloseTo(ARROW_HEAD_LENGTH);
    expect(a.x).toBeLessThan(100);
    const [r] = arrowHead({ x: 100, y: 0 }, { x: 0, y: 0 });
    expect(r.x).toBeGreaterThan(0);
  });

  it("a pen is one polyline, an arrow is a shaft and two head lines", () => {
    expect(strokePath(pen([1, 2], [3, 4], [5, 6]))).toBe("M 1 2 L 3 4 L 5 6");
    const d = strokePath(arrow([0, 0], [100, 0]));
    expect(d.startsWith("M 0 0 L 100 0 M ")).toBe(true);
    expect(d.match(/M /g)).toHaveLength(2);
    expect(strokePath(pen([1, 2]))).toBe("M 1 2 L 1 2");
    expect(strokePath(pen([10, 10], [20, 20]), { x: 10, y: 10 })).toBe("M 0 0 L 10 10");
    expect(strokePath({ tool: "pen", points: [] })).toBe("");
  });
});

describe("the sketch as a whole", () => {
  const one: Sketch = { strokes: [pen([0, 0], [30, 0])] };

  it("labels itself by stroke count", () => {
    expect(sketchLabel(one)).toBe("Sketch");
    expect(sketchLabel({ strokes: [one.strokes[0]!, one.strokes[0]!, one.strokes[0]!] })).toBe("Sketch · 3 strokes");
  });

  it("appends up to the cap, and undoes down to one stroke", () => {
    let sketch: Sketch | null = one;
    for (let i = 1; i < SKETCH_MAX_STROKES; i++) sketch = appendStroke(sketch!, one.strokes[0]!);
    expect(sketch!.strokes).toHaveLength(SKETCH_MAX_STROKES);
    expect(appendStroke(sketch!, one.strokes[0]!)).toBeNull();
    expect(undoStroke({ strokes: [one.strokes[0]!, arrow([0, 0], [5, 5])] })).toEqual(one);
    expect(undoStroke(one)).toBeNull();
  });

  it("shifts every point, and hands the same object back for no shift", () => {
    expect(shiftSketch(one, 5, -5)).toEqual({ strokes: [pen([5, -5], [35, -5])] });
    expect(shiftSketch(one, 0, 0)).toBe(one);
  });
});

describe("readSketch — untrusted data", () => {
  it("accepts the shape it writes", () => {
    const sketch: Sketch = { strokes: [pen([0, 0], [30, 0]), arrow([1, 1], [9, 9])] };
    expect(readSketch(JSON.parse(JSON.stringify(sketch)))).toEqual(sketch);
  });

  it("rejects anything else", () => {
    expect(readSketch(null)).toBeNull();
    expect(readSketch("M 0 0")).toBeNull();
    expect(readSketch({ strokes: [] })).toBeNull();
    expect(readSketch({ strokes: [{ tool: "laser", points: [{ x: 0, y: 0 }] }] })).toBeNull();
    expect(readSketch({ strokes: [{ tool: "pen", points: [{ x: "1", y: 0 }] }] })).toBeNull();
    expect(readSketch({ strokes: [{ tool: "pen", points: [{ x: NaN, y: 0 }] }] })).toBeNull();
    expect(readSketch({ strokes: [{ tool: "arrow", points: [{ x: 0, y: 0 }] }] })).toBeNull();
    expect(readSketch({ strokes: [{ tool: "pen", points: Array.from({ length: SKETCH_MAX_POINTS + 1 }, () => ({ x: 0, y: 0 })) }] })).toBeNull();
    expect(readSketch({ strokes: Array.from({ length: SKETCH_MAX_STROKES + 1 }, () => pen([0, 0])) })).toBeNull();
  });
});
