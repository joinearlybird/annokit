/**
 * Where the armed-mode chip (Element / Area, src/aim-overlay.tsx) sits.
 *
 * It starts centred near the top, but the top of a screen is where apps put
 * their headers, titles and back buttons — and a chip over an element is an
 * element nobody can aim at. So it can be DRAGGED anywhere, the way the
 * floating button can (src/fab-drag.ts): a tap still switches the mode, a
 * press that moves past the drag threshold moves the chip instead. It stays
 * where it is left for the rest of the session, and is never left off the
 * screen or under the status bar and home indicator.
 *
 * Pure and react-native-free, like fab-drag.ts, so the geometry is tested.
 */

import type { FabInsets, FabPoint, FabScreen } from "./fab-drag";

export interface ChipSize {
  width: number;
  height: number;
}

/** The chip's first place: centred, just under the status bar. */
export const CHIP_DEFAULT_TOP = 58;

/** Keep-outs: clear of the status bar and island above, the home indicator below. */
export const CHIP_INSETS: FabInsets = { top: 50, right: 8, bottom: 40, left: 8 };

export function defaultChipPosition(screen: FabScreen, size: ChipSize): FabPoint {
  return clampChipPosition({ x: (screen.width - size.width) / 2, y: CHIP_DEFAULT_TOP }, screen, size);
}

/** Pull a position back inside the usable screen. */
export function clampChipPosition(
  point: FabPoint,
  screen: FabScreen,
  size: ChipSize,
  insets: FabInsets = CHIP_INSETS,
): FabPoint {
  const maxX = screen.width - insets.right - size.width;
  const maxY = screen.height - insets.bottom - size.height;
  return {
    x: clamp(point.x, insets.left, Math.max(insets.left, maxX)),
    y: clamp(point.y, insets.top, Math.max(insets.top, maxY)),
  };
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

// ── Session memory ───────────────────────────────────────────────────────────

let remembered: FabPoint | null = null;

/** Where the chip was left, for the life of the JS context (not persisted, like the FAB). */
export function rememberChipPosition(point: FabPoint): void {
  remembered = { ...point };
}

export function recallChipPosition(): FabPoint | null {
  return remembered ? { ...remembered } : null;
}

/** Test seam. */
export function forgetChipPosition(): void {
  remembered = null;
}
