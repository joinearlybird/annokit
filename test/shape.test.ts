/** The four shapes a capture can have (src/shape.ts): one source for the box, the name and the words. */

import { describe, expect, it } from "vitest";
import {
  captureBoundingBox,
  captureElementName,
  captureShape,
  detailTitle,
  isCaptureShape,
  shapeSubject,
  wireShape,
} from "../src/shape";

const FRAME = { x: 52, y: 179.7, width: 62, height: 17 };
const RECT = { x: 40, y: 300, width: 240, height: 160 };
const HIT = { element: "PrimaryButton", frame: FRAME };

describe("captureShape", () => {
  it("is the element by default, and what the capture carries otherwise", () => {
    expect(captureShape({ x: 1, y: 2, hit: HIT })).toBe("element");
    expect(captureShape({ x: 1, y: 2, hit: null })).toBe("element");
    expect(captureShape({ x: 1, y: 2, areaRect: RECT })).toBe("area");
    expect(captureShape({ x: 1, y: 2, sketch: { strokes: [{}] } })).toBe("sketch");
    expect(captureShape({ x: 1, y: 2, sketch: { strokes: [] } })).toBe("element");
  });

  it("an explicit shape wins over what the capture carries", () => {
    expect(captureShape({ x: 1, y: 2, shape: "point", hit: HIT })).toBe("point");
    expect(captureShape({ x: 1, y: 2, shape: "element", areaRect: RECT })).toBe("element");
    expect(captureShape({ x: 1, y: 2, shape: "octagon", areaRect: RECT })).toBe("area");
  });

  it("goes on the wire only when it is not the element", () => {
    expect(wireShape({ x: 1, y: 2, hit: HIT })).toBeUndefined();
    expect(wireShape({ x: 1, y: 2, shape: "point" })).toBe("point");
    expect(wireShape({ x: 1, y: 2, areaRect: RECT })).toBe("area");
    expect(isCaptureShape("sketch")).toBe(true);
    expect(isCaptureShape("Sketch")).toBe(false);
  });
});

describe("captureBoundingBox", () => {
  it("is the frame for an element, zero at the finger for a spot, the rectangle for an area", () => {
    expect(captureBoundingBox({ x: 84, y: 189, hit: HIT })).toEqual(FRAME);
    expect(captureBoundingBox({ x: 84, y: 189, hit: HIT, shape: "point" })).toEqual({ x: 84, y: 189, width: 0, height: 0 });
    expect(captureBoundingBox({ x: 84, y: 189, hit: HIT, areaRect: RECT })).toEqual(RECT);
    expect(captureBoundingBox({ x: 84, y: 189, hit: null })).toEqual({ x: 84, y: 189, width: 0, height: 0 });
  });

  it("is the stroke bounds for a sketch, when the caller supplies them", () => {
    expect(captureBoundingBox({ x: 1, y: 2, sketch: { strokes: [{}] }, sketchRect: RECT })).toEqual(RECT);
    // Without bounds a sketch falls back like an element would.
    expect(captureBoundingBox({ x: 1, y: 2, sketch: { strokes: [{}] }, hit: HIT })).toEqual(FRAME);
  });

  it("hands back a copy, never the capture's own rectangle", () => {
    const box = captureBoundingBox({ x: 1, y: 2, areaRect: RECT });
    expect(box).not.toBe(RECT);
  });
});

describe("captureElementName", () => {
  it("is the component found, else an honest word for what was captured over nothing", () => {
    expect(captureElementName({ x: 1, y: 2, hit: HIT })).toBe("PrimaryButton");
    expect(captureElementName({ x: 1, y: 2, hit: HIT, shape: "point" })).toBe("PrimaryButton");
    expect(captureElementName({ x: 1, y: 2, hit: null })).toBe("Screen");
    expect(captureElementName({ x: 1, y: 2, hit: null, shape: "point" })).toBe("Screen");
    expect(captureElementName({ x: 1, y: 2, hit: null, areaRect: RECT })).toBe("Area");
    expect(captureElementName({ x: 1, y: 2, hit: { element: "  " }, sketch: { strokes: [{}] } })).toBe("Sketch");
  });
});

describe("shapeSubject and detailTitle", () => {
  it("says the shape and the element together", () => {
    expect(shapeSubject(undefined, "FeedRow")).toBe("FeedRow");
    expect(shapeSubject("element", "FeedRow")).toBe("FeedRow");
    expect(shapeSubject("point", "FeedRow")).toBe("This spot on FeedRow");
    expect(shapeSubject("area", "FeedRow")).toBe("Area · FeedRow");
    expect(shapeSubject("sketch", "FeedRow")).toBe("Sketch over FeedRow");
  });

  it("says only the shape when the element is one of the fallback names, or missing", () => {
    expect(shapeSubject("point", "Screen")).toBe("This spot");
    expect(shapeSubject("point", null)).toBe("This spot");
    expect(shapeSubject("area", "Area")).toBe("Area");
    expect(shapeSubject("sketch", "")).toBe("Sketch");
    expect(shapeSubject("octagon", "FeedRow")).toBe("FeedRow");
  });

  it("titles a detail pane, with the old fallback for a nameless element capture", () => {
    expect(detailTitle({ element: "FeedRow" })).toBe("FeedRow");
    expect(detailTitle({})).toBe("This screen");
    expect(detailTitle({ element: "" })).toBe("This screen");
    expect(detailTitle({ shape: "point", element: "FeedRow" })).toBe("This spot on FeedRow");
    expect(detailTitle({ shape: "area", element: "Area" })).toBe("Area");
  });
});
