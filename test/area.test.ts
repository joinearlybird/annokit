/**
 * Area selection geometry + sampling (src/area.ts): rect normalization from
 * any drag direction, the meaningful-size floor, sample-point placement and
 * the contained-hit dedupe.
 */

import { describe, expect, it } from "vitest";
import {
  AREA_MIN_SIZE,
  AREA_SAMPLE_INSET,
  areaLabel,
  areaRectFrom,
  areaSamplePoints,
  dedupeAreaHits,
  isAreaMeaningful,
} from "../src/area";

describe("areaRectFrom", () => {
  it("normalizes every drag direction to the same rectangle", () => {
    const expected = { x: 10, y: 20, width: 30, height: 40 };
    expect(areaRectFrom({ x: 10, y: 20 }, { x: 40, y: 60 })).toEqual(expected); // ↘
    expect(areaRectFrom({ x: 40, y: 60 }, { x: 10, y: 20 })).toEqual(expected); // ↖
    expect(areaRectFrom({ x: 40, y: 20 }, { x: 10, y: 60 })).toEqual(expected); // ↙
    expect(areaRectFrom({ x: 10, y: 60 }, { x: 40, y: 20 })).toEqual(expected); // ↗
  });
});

describe("isAreaMeaningful", () => {
  it("rejects slivers and wobbly taps on either axis", () => {
    expect(isAreaMeaningful({ x: 0, y: 0, width: AREA_MIN_SIZE, height: AREA_MIN_SIZE })).toBe(true);
    expect(isAreaMeaningful({ x: 0, y: 0, width: AREA_MIN_SIZE - 1, height: 500 })).toBe(false);
    expect(isAreaMeaningful({ x: 0, y: 0, width: 500, height: AREA_MIN_SIZE - 1 })).toBe(false);
    expect(isAreaMeaningful({ x: 0, y: 0, width: 3, height: 3 })).toBe(false);
  });
});

describe("areaSamplePoints", () => {
  it("center first, then four inset corners", () => {
    const pts = areaSamplePoints({ x: 100, y: 200, width: 200, height: 100 });
    expect(pts[0]).toEqual({ x: 200, y: 250 });
    expect(pts.slice(1)).toEqual([
      { x: 100 + AREA_SAMPLE_INSET, y: 200 + AREA_SAMPLE_INSET },
      { x: 300 - AREA_SAMPLE_INSET, y: 200 + AREA_SAMPLE_INSET },
      { x: 100 + AREA_SAMPLE_INSET, y: 300 - AREA_SAMPLE_INSET },
      { x: 300 - AREA_SAMPLE_INSET, y: 300 - AREA_SAMPLE_INSET },
    ]);
  });

  it("shrinks the inset for small regions so corners stay inside", () => {
    const pts = areaSamplePoints({ x: 0, y: 0, width: 32, height: 32 });
    // inset = min(12, 8, 8) = 8
    expect(pts[1]).toEqual({ x: 8, y: 8 });
    expect(pts[4]).toEqual({ x: 24, y: 24 });
  });
});

describe("areaLabel", () => {
  it("names the region by its rounded size", () => {
    expect(areaLabel({ x: 0, y: 0, width: 239.6, height: 180.2 })).toBe("Area 240×180");
  });
});

describe("dedupeAreaHits", () => {
  const hit = (element: string, x: number, y: number, testID?: string) => ({
    element,
    testID,
    frame: { x, y, width: 100, height: 40 },
  });

  it("drops nulls, keeps first appearance (center wins primary)", () => {
    const center = hit("Card", 0, 0);
    const cornerSameCard = hit("Card", 0.4, -0.2);
    cornerSameCard.frame = { x: 0.4, y: -0.2, width: 99.8, height: 40.1 };
    const other = hit("Badge", 0, 100);
    other.frame = { x: 0, y: 100, width: 100, height: 40 };
    const out = dedupeAreaHits([center, null, cornerSameCard, other, null]);
    expect(out.map((h) => h.element)).toEqual(["Card", "Badge"]);
    expect(out[0]).toBe(center);
  });

  it("same name at different positions is two elements", () => {
    const a = hit("Card", 0, 0);
    const b = hit("Card", 0, 200);
    b.frame = { x: 0, y: 200, width: 100, height: 40 };
    expect(dedupeAreaHits([a, b])).toHaveLength(2);
  });

  it("an all-null sample set is an empty region, not a crash", () => {
    expect(dedupeAreaHits([null, null])).toEqual([]);
  });
});
