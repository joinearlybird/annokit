/** Hold to pin (src/hold.ts): a press that stays put for a beat pins the spot; moving disarms it for good. */

import { describe, expect, it, vi } from "vitest";
import { FAB_DRAG_THRESHOLD } from "../src/fab-drag";
import { HOLD_MS, HOLD_SLOP, createHoldDetector } from "../src/hold";

function detector() {
  const held: [number, number][] = [];
  const hold = createHoldDetector({ onHold: (x, y) => held.push([x, y]) });
  return { hold, held };
}

describe("createHoldDetector", () => {
  it("fires once, with the origin, after the hold time without movement", () => {
    vi.useFakeTimers();
    const { hold, held } = detector();
    hold.down(100, 200);
    vi.advanceTimersByTime(HOLD_MS - 1);
    expect(held).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(held).toEqual([[100, 200]]);
    vi.advanceTimersByTime(HOLD_MS * 3);
    expect(held).toEqual([[100, 200]]);
    expect(hold.up()).toBe(true);
    vi.useRealTimers();
  });

  it("tolerates a wobble inside the slop, and reports the origin not the wobble", () => {
    vi.useFakeTimers();
    const { hold, held } = detector();
    hold.down(100, 200);
    hold.move(100 + HOLD_SLOP - 1, 200 + HOLD_SLOP - 1);
    hold.move(100, 200);
    vi.advanceTimersByTime(HOLD_MS);
    expect(held).toEqual([[100, 200]]);
    vi.useRealTimers();
  });

  it("disarms for the rest of the gesture once the finger moves past the slop, even if it comes back", () => {
    vi.useFakeTimers();
    const { hold, held } = detector();
    hold.down(100, 200);
    hold.move(100 + HOLD_SLOP + 1, 200);
    hold.move(100, 200);
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(held).toEqual([]);
    expect(hold.up()).toBe(false);
    vi.useRealTimers();
  });

  it("a drag after the hold fired hands the release back to the ordinary select", () => {
    vi.useFakeTimers();
    const { hold, held } = detector();
    hold.down(100, 200);
    vi.advanceTimersByTime(HOLD_MS);
    expect(held).toEqual([[100, 200]]);
    // The finger rested, pinned, then set off to survey: the drag's release selects.
    hold.move(100 + HOLD_SLOP + 1, 200);
    hold.move(160, 260);
    expect(hold.up()).toBe(false);
    vi.useRealTimers();
  });

  it("a wobble after the hold fired keeps the pin", () => {
    vi.useFakeTimers();
    const { hold } = detector();
    hold.down(100, 200);
    vi.advanceTimersByTime(HOLD_MS);
    hold.move(100 + HOLD_SLOP - 1, 200);
    expect(hold.up()).toBe(true);
    vi.useRealTimers();
  });

  it("a release before the hold time is an ordinary tap", () => {
    vi.useFakeTimers();
    const { hold, held } = detector();
    hold.down(5, 6);
    vi.advanceTimersByTime(HOLD_MS - 50);
    expect(hold.up()).toBe(false);
    vi.advanceTimersByTime(HOLD_MS);
    expect(held).toEqual([]);
    vi.useRealTimers();
  });

  it("cancel() drops an armed hold, and a new press starts clean", () => {
    vi.useFakeTimers();
    const { hold, held } = detector();
    hold.down(1, 1);
    hold.cancel();
    vi.advanceTimersByTime(HOLD_MS);
    expect(held).toEqual([]);
    expect(hold.up()).toBe(false);
    hold.down(2, 2);
    vi.advanceTimersByTime(HOLD_MS);
    expect(held).toEqual([[2, 2]]);
    vi.useRealTimers();
  });

  it("a second press before the first fired re-arms from the new origin", () => {
    vi.useFakeTimers();
    const { hold, held } = detector();
    hold.down(1, 1);
    vi.advanceTimersByTime(HOLD_MS - 10);
    hold.down(9, 9);
    vi.advanceTimersByTime(HOLD_MS - 10);
    expect(held).toEqual([]);
    vi.advanceTimersByTime(10);
    expect(held).toEqual([[9, 9]]);
    vi.useRealTimers();
  });

  it("takes injected timers, so a host clock can drive it", () => {
    const timers: { fn: () => void; ms: number }[] = [];
    const cleared: unknown[] = [];
    const held: [number, number][] = [];
    const hold = createHoldDetector({
      onHold: (x, y) => held.push([x, y]),
      holdMs: 500,
      setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
      clearTimeout: (h) => cleared.push(h),
    });
    hold.down(3, 4);
    expect(timers[0]?.ms).toBe(500);
    timers[0]!.fn();
    expect(held).toEqual([[3, 4]]);
    hold.down(5, 6);
    hold.cancel();
    expect(cleared).toEqual([2]);
  });

  it("uses the package's one drag threshold as its slop", () => {
    expect(HOLD_SLOP).toBe(FAB_DRAG_THRESHOLD);
    expect(HOLD_MS).toBe(350);
  });
});
