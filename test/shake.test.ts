/**
 * Shake to arm (src/shake.ts): the debounce logic as a pure function, and
 * the optional-peer degradation (expo-sensors absent ⇒ silent no-op).
 *
 * The detector is deliberately sensor-free and clock-free — samples and
 * timestamps are handed to it — so this suite needs no native module.
 */

import { describe, expect, it, vi } from "vitest";
import {
  createShakeDetector,
  DEFAULT_SHAKE_DEBOUNCE_MS,
  DEFAULT_SHAKE_THRESHOLD,
  shakeAvailable,
  subscribeToShake,
} from "../src/shake";

/** A sample whose magnitude is exactly `g` (all of it on one axis). */
function sample(g: number) {
  return { x: g, y: 0, z: 0 };
}

describe("shake detection threshold", () => {
  it("ignores a device at rest (~1g of gravity)", () => {
    const d = createShakeDetector();
    expect(d.feed({ x: 0, y: -1, z: 0 }, 0)).toBe(false);
    expect(d.feed({ x: 0.02, y: -0.99, z: 0.05 }, 100)).toBe(false);
  });

  it("ignores ordinary handling below the threshold", () => {
    const d = createShakeDetector();
    expect(d.feed(sample(DEFAULT_SHAKE_THRESHOLD - 0.01), 0)).toBe(false);
  });

  it("fires on a deliberate shake", () => {
    const d = createShakeDetector();
    expect(d.feed(sample(2.5), 0)).toBe(true);
  });

  it("uses the vector magnitude, not a single axis", () => {
    const d = createShakeDetector();
    // 1.2² * 3 ≈ 4.32 ⇒ magnitude ≈ 2.08, over threshold although no axis is.
    expect(d.feed({ x: 1.2, y: 1.2, z: 1.2 }, 0)).toBe(true);
  });

  it("honours a custom threshold", () => {
    const d = createShakeDetector({ threshold: 5 });
    expect(d.feed(sample(3), 0)).toBe(false);
    expect(d.feed(sample(6), 100)).toBe(true);
  });
});

describe("debounce", () => {
  it("fires once per shake, not once per over-threshold sample", () => {
    const d = createShakeDetector();
    // One physical shake at 100Hz: a burst of samples over ~400ms.
    const fired = [0, 100, 200, 300, 400].map((t) => d.feed(sample(3), t));
    expect(fired).toEqual([true, false, false, false, false]);
  });

  it("re-arms after the debounce window", () => {
    const d = createShakeDetector();
    expect(d.feed(sample(3), 0)).toBe(true);
    expect(d.feed(sample(3), DEFAULT_SHAKE_DEBOUNCE_MS - 1)).toBe(false);
    expect(d.feed(sample(3), DEFAULT_SHAKE_DEBOUNCE_MS)).toBe(true);
  });

  it("honours a custom debounce window", () => {
    const d = createShakeDetector({ debounceMs: 50 });
    expect(d.feed(sample(3), 0)).toBe(true);
    expect(d.feed(sample(3), 49)).toBe(false);
    expect(d.feed(sample(3), 60)).toBe(true);
  });

  it("does not start the window on sub-threshold samples", () => {
    const d = createShakeDetector();
    expect(d.feed(sample(1), 0)).toBe(false);
    expect(d.feed(sample(3), 10)).toBe(true);
  });

  it("each detector keeps its own state", () => {
    const a = createShakeDetector();
    const b = createShakeDetector();
    expect(a.feed(sample(3), 0)).toBe(true);
    expect(b.feed(sample(3), 0)).toBe(true);
  });
});

describe("malformed samples", () => {
  it("ignores missing / non-numeric / non-finite readings instead of throwing", () => {
    const d = createShakeDetector();
    expect(d.feed(undefined as never, 0)).toBe(false);
    expect(d.feed({ x: 1 } as never, 0)).toBe(false);
    expect(d.feed({ x: "3" as never as number, y: 0, z: 0 }, 0)).toBe(false);
    expect(d.feed({ x: Number.NaN, y: 0, z: 0 }, 0)).toBe(false);
  });
});

describe("expo-sensors integration (optional peer)", () => {
  it("reports shake unavailable when expo-sensors is not installed", () => {
    expect(shakeAvailable()).toBe(false);
  });

  it("subscribing is a silent no-op that still returns an unsubscribe", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onShake = vi.fn();
    const unsubscribe = subscribeToShake(onShake);
    expect(typeof unsubscribe).toBe("function");
    expect(() => unsubscribe()).not.toThrow();
    expect(onShake).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
