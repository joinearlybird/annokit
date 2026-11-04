/**
 * HOLD TO PIN A SPOT. In element mode a tap selects what is under the
 * finger. Sometimes the point itself is the subject: "something should go
 * HERE", "this gap", a spot on a big container that a tap would only name.
 * Pressing and holding without moving pins that exact spot instead; the
 * element under it is kept as context, not as the subject (src/shape.ts).
 *
 * The detector is pure and timer-injected, like `createThrottle` in
 * src/aim.ts, so the rules below are tested with fake timers:
 *
 *   down(x, y)   arms one timer and remembers the origin
 *   move(x, y)   past `slop` from the origin DISARMS, for the rest of the
 *                gesture — coming back does not re-arm; the user is
 *                surveying, not holding. The same move after the hold has
 *                FIRED hands the gesture back: a finger that rested, then
 *                set off to survey, releases as an ordinary select, not as
 *                the pin it paused on — otherwise the drag's highlight ends
 *                with no confirm bar at all
 *   (timer)      fires `onHold(origin)` once — the ORIGIN, not the last
 *                sub-slop wobble, because that is where the finger meant
 *   up()         ends the gesture; returns true when a hold already fired,
 *                so the caller swallows the release instead of selecting
 *   cancel()     the system took the gesture, or the mode changed
 *
 * The slop is the FAB's drag threshold: one number for "did the finger
 * move" across the package.
 */

import { FAB_DRAG_THRESHOLD } from "./fab-drag";

export const HOLD_MS = 350;
export const HOLD_SLOP = FAB_DRAG_THRESHOLD;

export interface HoldDetector {
  down: (x: number, y: number) => void;
  move: (x: number, y: number) => void;
  /** True when the hold fired during this gesture (the release is spoken for). */
  up: () => boolean;
  cancel: () => void;
}

export interface HoldDetectorOptions {
  onHold: (x: number, y: number) => void;
  holdMs?: number;
  slop?: number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

export function createHoldDetector({
  onHold,
  holdMs = HOLD_MS,
  slop = HOLD_SLOP,
  setTimeout: schedule = (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: unschedule = (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
}: HoldDetectorOptions): HoldDetector {
  let origin: { x: number; y: number } | null = null;
  let timer: unknown = null;
  let fired = false;

  const disarm = () => {
    if (timer !== null) {
      unschedule(timer);
      timer = null;
    }
  };

  return {
    down(x, y) {
      disarm();
      origin = { x, y };
      fired = false;
      timer = schedule(() => {
        timer = null;
        if (!origin) return;
        fired = true;
        onHold(origin.x, origin.y);
      }, holdMs);
    },
    move(x, y) {
      if (!origin || (timer === null && !fired)) return;
      if (Math.abs(x - origin.x) > slop || Math.abs(y - origin.y) > slop) {
        disarm();
        fired = false;
      }
    },
    up() {
      disarm();
      const held = fired;
      origin = null;
      fired = false;
      return held;
    },
    cancel() {
      disarm();
      origin = null;
      fired = false;
    },
  };
}
