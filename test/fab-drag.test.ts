/**
 * Draggable FAB geometry (src/fab-drag.ts).
 *
 * The FAB is the overlay's only permanent resident, so the rules that keep
 * it usable — never off-screen, always snapped to a side, and never
 * swallowing the tap that arms annotate mode — are worth testing away from
 * a device.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  FAB_INSETS,
  FAB_SIZE,
  clampFabPosition,
  defaultFabPosition,
  forgetFabPosition,
  isFabDrag,
  recallFabPosition,
  rememberFabPosition,
  snapFabToEdge,
} from "../src/fab-drag";

const SCREEN = { width: 390, height: 844 };
const RIGHT_EDGE = SCREEN.width - FAB_INSETS.right - FAB_SIZE;

afterEach(() => {
  forgetFabPosition();
});

describe("default position", () => {
  it("is the bottom-right corner the FAB has always occupied", () => {
    const p = defaultFabPosition(SCREEN);
    expect(p.x).toBe(SCREEN.width - 16 - FAB_SIZE);
    expect(p.y).toBe(SCREEN.height - 92 - FAB_SIZE);
  });

  it("is still on screen on a tiny window", () => {
    const p = defaultFabPosition({ width: 120, height: 120 });
    expect(p.x).toBeGreaterThanOrEqual(FAB_INSETS.left);
    expect(p.y).toBeGreaterThanOrEqual(FAB_INSETS.top);
  });
});

describe("clamping", () => {
  it("keeps the button inside the insets on every side", () => {
    expect(clampFabPosition({ x: -500, y: -500 }, SCREEN)).toEqual({
      x: FAB_INSETS.left,
      y: FAB_INSETS.top,
    });
    expect(clampFabPosition({ x: 9999, y: 9999 }, SCREEN)).toEqual({
      x: RIGHT_EDGE,
      y: SCREEN.height - FAB_INSETS.bottom - FAB_SIZE,
    });
  });

  it("clears the status bar at the top and the home indicator at the bottom", () => {
    const top = clampFabPosition({ x: 100, y: 0 }, SCREEN);
    expect(top.y).toBeGreaterThanOrEqual(52);
    const bottom = clampFabPosition({ x: 100, y: SCREEN.height }, SCREEN);
    expect(bottom.y + FAB_SIZE).toBeLessThanOrEqual(SCREEN.height - 32);
  });

  it("leaves a position that is already fine alone", () => {
    expect(clampFabPosition({ x: 200, y: 400 }, SCREEN)).toEqual({ x: 200, y: 400 });
  });
});

describe("edge snapping", () => {
  it("snaps left from the left half, keeping the height", () => {
    expect(snapFabToEdge({ x: 40, y: 300 }, SCREEN)).toEqual({ x: FAB_INSETS.left, y: 300 });
  });

  it("snaps right from the right half, keeping the height", () => {
    expect(snapFabToEdge({ x: 300, y: 500 }, SCREEN)).toEqual({ x: RIGHT_EDGE, y: 500 });
  });

  it("breaks a dead-centre tie to the right, where the FAB lives", () => {
    const centred = SCREEN.width / 2 - FAB_SIZE / 2;
    expect(snapFabToEdge({ x: centred, y: 200 }, SCREEN).x).toBe(RIGHT_EDGE);
  });

  it("clamps the height it keeps", () => {
    expect(snapFabToEdge({ x: 300, y: 9999 }, SCREEN).y).toBe(
      SCREEN.height - FAB_INSETS.bottom - FAB_SIZE,
    );
  });
});

describe("telling a drag from a tap", () => {
  it("ignores the wobble of a normal press", () => {
    expect(isFabDrag(0, 0)).toBe(false);
    expect(isFabDrag(3, -4)).toBe(false);
    expect(isFabDrag(8, 8)).toBe(false); // the threshold itself is not a drag
  });

  it("takes over once the finger has really moved, in either axis", () => {
    expect(isFabDrag(9, 0)).toBe(true);
    expect(isFabDrag(0, -9)).toBe(true);
  });

  it("honours a custom threshold", () => {
    expect(isFabDrag(5, 0, 2)).toBe(true);
    expect(isFabDrag(5, 0, 20)).toBe(false);
  });
});

describe("session memory", () => {
  it("starts empty, then remembers where the button was parked", () => {
    expect(recallFabPosition()).toBeNull();
    rememberFabPosition({ x: 12, y: 300 });
    expect(recallFabPosition()).toEqual({ x: 12, y: 300 });
  });

  it("hands back a copy, so a caller cannot mutate the memory", () => {
    rememberFabPosition({ x: 12, y: 300 });
    const first = recallFabPosition();
    first!.x = 999;
    expect(recallFabPosition()).toEqual({ x: 12, y: 300 });
  });
});
