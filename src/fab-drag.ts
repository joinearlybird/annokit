/**
 * Draggable-FAB geometry (the rendering lives in src/fab.tsx).
 *
 * The FAB is the only piece of this overlay that is always on screen, so it
 * is also the only piece that can sit on top of something the user wants to
 * see. Making it draggable is therefore not decoration — it is the escape
 * hatch. The behaviour is the standard floating-bubble one: drag anywhere,
 * release, snap to the nearer side, keep the height you left it at.
 *
 * Pure and react-native-free so the rules that are easy to get wrong (stays
 * on screen, snaps to the RIGHT edge, tells a drag from a tap) are unit
 * tested rather than eyeballed on a device.
 */

export interface FabPoint {
  x: number;
  y: number;
}

export interface FabScreen {
  width: number;
  height: number;
}

export interface FabInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const FAB_SIZE = 44;

/**
 * Movement past which a press becomes a drag. Below it the touch belongs to
 * the Pressable underneath, so tap-to-arm and long-press-to-open-the-queue
 * keep working; a bubble that starts sliding on a 2px wobble would eat both.
 */
export const FAB_DRAG_THRESHOLD = 8;

/**
 * Keep-out margins. This package takes no dependency on
 * react-native-safe-area-context (it is not a peer, optional or otherwise),
 * so these are conservative constants rather than measured insets: enough
 * to clear a status bar / dynamic island at the top and a home indicator at
 * the bottom on the phones this overlay actually runs on.
 */
export const FAB_INSETS: FabInsets = { top: 60, right: 12, bottom: 40, left: 12 };

/** Where the FAB starts: the bottom-right corner it has always occupied. */
export function defaultFabPosition(screen: FabScreen, size: number = FAB_SIZE): FabPoint {
  return clampFabPosition(
    { x: screen.width - 16 - size, y: screen.height - 92 - size },
    screen,
    size,
  );
}

/** Pull a position back inside the usable screen. */
export function clampFabPosition(
  point: FabPoint,
  screen: FabScreen,
  size: number = FAB_SIZE,
  insets: FabInsets = FAB_INSETS,
): FabPoint {
  const maxX = screen.width - insets.right - size;
  const maxY = screen.height - insets.bottom - size;
  return {
    x: clamp(point.x, insets.left, Math.max(insets.left, maxX)),
    y: clamp(point.y, insets.top, Math.max(insets.top, maxY)),
  };
}

/**
 * Snap to the nearer vertical edge, keeping the height the user chose.
 * Ties go RIGHT — that is where the FAB lives by default, and where a
 * right-handed thumb expects it.
 */
export function snapFabToEdge(
  point: FabPoint,
  screen: FabScreen,
  size: number = FAB_SIZE,
  insets: FabInsets = FAB_INSETS,
): FabPoint {
  const clamped = clampFabPosition(point, screen, size, insets);
  const leftX = insets.left;
  const rightX = Math.max(insets.left, screen.width - insets.right - size);
  const centre = clamped.x + size / 2;
  const snapLeft = centre < screen.width / 2;
  return { x: snapLeft ? leftX : rightX, y: clamped.y };
}

/** Has this touch moved far enough to be a drag rather than a press? */
export function isFabDrag(dx: number, dy: number, threshold: number = FAB_DRAG_THRESHOLD): boolean {
  return Math.abs(dx) > threshold || Math.abs(dy) > threshold;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

// ── Session memory ───────────────────────────────────────────────────────────

let remembered: FabPoint | null = null;

/**
 * Remember where the user parked the FAB, for the life of the JS context.
 * Deliberately NOT persisted: that would mean an async-storage dependency
 * for a dev-only affordance, and this package stays dependency-free. A full
 * reload puts the button back in its corner.
 */
export function rememberFabPosition(point: FabPoint): void {
  remembered = { ...point };
}

export function recallFabPosition(): FabPoint | null {
  return remembered ? { ...remembered } : null;
}

/** Test seam — module state would otherwise leak between cases. */
export function forgetFabPosition(): void {
  remembered = null;
}
