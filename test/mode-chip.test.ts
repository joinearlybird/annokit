/**
 * The armed-mode chip's place (src/mode-chip.ts): centred under the status
 * bar to start, dragged anywhere on screen after, never off it, and kept
 * where it was left for the session.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  CHIP_DEFAULT_TOP,
  CHIP_INSETS,
  clampChipPosition,
  defaultChipPosition,
  forgetChipPosition,
  recallChipPosition,
  rememberChipPosition,
} from "../src/mode-chip";

const SCREEN = { width: 402, height: 874 };
const CHIP = { width: 96, height: 30 };

afterEach(() => forgetChipPosition());

describe("the mode chip's place", () => {
  it("starts centred, just under the status bar", () => {
    expect(defaultChipPosition(SCREEN, CHIP)).toEqual({ x: (402 - 96) / 2, y: CHIP_DEFAULT_TOP });
  });

  it("can be dragged anywhere on screen, but not off it", () => {
    expect(clampChipPosition({ x: 120, y: 500 }, SCREEN, CHIP)).toEqual({ x: 120, y: 500 });
    expect(clampChipPosition({ x: -50, y: -50 }, SCREEN, CHIP)).toEqual({ x: CHIP_INSETS.left, y: CHIP_INSETS.top });
    expect(clampChipPosition({ x: 999, y: 9999 }, SCREEN, CHIP)).toEqual({
      x: 402 - CHIP_INSETS.right - 96,
      y: 874 - CHIP_INSETS.bottom - 30,
    });
  });

  it("stays where it was left, for the session", () => {
    expect(recallChipPosition()).toBeNull();
    rememberChipPosition({ x: 20, y: 700 });
    expect(recallChipPosition()).toEqual({ x: 20, y: 700 });
  });
});
