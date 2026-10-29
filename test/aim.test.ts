/**
 * Aim highlighting (src/aim.ts) — the geometry and the survey tracker.
 *
 * These are the parts that decide whether the user can SEE what they are
 * about to annotate, so they are deliberately pure: placement takes rects
 * and returns rects, and the tracker takes an `inspect` function rather
 * than reaching for the native hit-test. Nothing here renders.
 *
 * The tracker's contract is as much about what it REFUSES to draw — a hit
 * that lost a race, a hit that arrived after the gesture ended, a null hit —
 * as about what it draws: a stale outline is a lie about what the user is
 * selecting.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  aimAnchorTarget,
  aimTargetFromHit,
  composerOccludedTop,
  composerSheetMaxHeight,
  createAimTracker,
  createThrottle,
  formatAimLabel,
  placeAimChrome,
  placeAimConfirm,
  placeAimLabel,
} from "../src/aim";
import type { AimHit, AimSelection } from "../src/aim";

const SCREEN = { width: 390, height: 844 };
const LABEL = { width: 120, height: 24 };

afterEach(() => {
  vi.useRealTimers();
});

describe("label placement", () => {
  it("sits above the frame, centred on it", () => {
    const place = placeAimLabel({ x: 100, y: 400, width: 150, height: 44 }, LABEL, SCREEN);
    expect(place.below).toBe(false);
    expect(place.top).toBe(400 - 6 - 24);
    expect(place.left).toBe(100 + 75 - 60);
  });

  it("flips below when the frame is against the top edge", () => {
    const place = placeAimLabel({ x: 20, y: 8, width: 200, height: 40 }, LABEL, SCREEN);
    expect(place.below).toBe(true);
    expect(place.top).toBe(8 + 40 + 6);
  });

  it("flips below rather than hiding the label under the status bar", () => {
    // Device-observed: a header at y=47 left just enough room to place the
    // label at y=17 — on-screen, and completely lost behind the notch.
    const place = placeAimLabel({ x: 20, y: 47, width: 350, height: 45 }, LABEL, SCREEN);
    expect(place.below).toBe(true);
    expect(place.top).toBeGreaterThanOrEqual(52);
  });

  it("clamps to the left margin for a frame hanging off the left edge", () => {
    const place = placeAimLabel({ x: -40, y: 300, width: 60, height: 30 }, LABEL, SCREEN);
    expect(place.left).toBe(8);
  });

  it("clamps to the right margin for a frame against the right edge", () => {
    const place = placeAimLabel({ x: 330, y: 300, width: 60, height: 30 }, LABEL, SCREEN);
    expect(place.left).toBe(SCREEN.width - 8 - LABEL.width);
  });

  it("pins a label wider than the screen to the left margin rather than centring its overflow", () => {
    const place = placeAimLabel({ x: 0, y: 300, width: 390, height: 30 }, { width: 500, height: 24 }, SCREEN);
    expect(place.left).toBe(8);
  });

  it("keeps a bottom-edge frame's label on screen", () => {
    const place = placeAimLabel({ x: 40, y: 820, width: 200, height: 60 }, LABEL, SCREEN);
    expect(place.top).toBeLessThanOrEqual(SCREEN.height - 8 - LABEL.height);
    expect(place.top).toBeGreaterThanOrEqual(8);
  });

  it("stays above the composer sheet when one is covering the lower half", () => {
    // Frame behind the sheet: the outline is occluded, but the NAME must
    // still be readable while the user types.
    const place = placeAimLabel({ x: 40, y: 700, width: 200, height: 60 }, LABEL, SCREEN, {
      occludedTop: 405,
    });
    expect(place.top + LABEL.height).toBeLessThanOrEqual(405 - 8 + 1);
  });
});

describe("confirm-button placement", () => {
  it("sits below the frame by default, opposite the label", () => {
    const frame = { x: 100, y: 400, width: 150, height: 44 };
    const confirm = placeAimConfirm(frame, { width: 132, height: 34 }, SCREEN);
    const label = placeAimLabel(frame, LABEL, SCREEN);
    expect(confirm.below).toBe(true);
    expect(confirm.top).toBe(400 + 44 + 6);
    expect(confirm.top).toBeGreaterThan(label.top);
  });

  it("flips above when the frame is against the bottom edge", () => {
    const place = placeAimConfirm({ x: 100, y: 790, width: 150, height: 50 }, { width: 132, height: 34 }, SCREEN);
    expect(place.below).toBe(false);
    expect(place.top).toBe(790 - 6 - 34);
  });

  it("flips above the composer sheet rather than hiding behind it", () => {
    const place = placeAimConfirm({ x: 100, y: 300, width: 150, height: 90 }, { width: 132, height: 34 }, SCREEN, {
      occludedTop: 405,
    });
    expect(place.below).toBe(false);
  });
});

describe("label and confirm button together", () => {
  const CONFIRM = { width: 132, height: 34 };
  const overlaps = (a: { top: number; left: number }, aSize: typeof LABEL, b: { top: number; left: number }, bSize: typeof CONFIRM) =>
    a.top < b.top + bSize.height &&
    b.top < a.top + aSize.height &&
    a.left < b.left + bSize.width &&
    b.left < a.left + aSize.width;

  it("keeps them on opposite sides for a frame in open space", () => {
    const frame = { x: 100, y: 400, width: 150, height: 44 };
    const { label, confirm } = placeAimChrome(frame, LABEL, CONFIRM, SCREEN);
    expect(label.below).toBe(false);
    expect(confirm.below).toBe(true);
    expect(overlaps(label, LABEL, confirm, CONFIRM)).toBe(false);
  });

  it("stacks the button UNDER the label when the label had to flip below", () => {
    // Device-observed: a header element pushed the label down onto the
    // button, which then covered the element's own name.
    const frame = { x: 12, y: 47, width: 366, height: 45 };
    const { label, confirm } = placeAimChrome(frame, LABEL, CONFIRM, SCREEN);
    expect(label.below).toBe(true);
    expect(confirm.top).toBeGreaterThanOrEqual(label.top + LABEL.height);
    expect(overlaps(label, LABEL, confirm, CONFIRM)).toBe(false);
  });

  it("stacks them the other way for a frame against the bottom edge", () => {
    const frame = { x: 12, y: 760, width: 366, height: 70 };
    const { label, confirm } = placeAimChrome(frame, LABEL, CONFIRM, SCREEN);
    expect(overlaps(label, LABEL, confirm, CONFIRM)).toBe(false);
  });

  it("never overlaps, wherever the element is", () => {
    for (let y = -20; y < SCREEN.height + 20; y += 17) {
      for (const height of [24, 60, 200]) {
        const { label, confirm } = placeAimChrome({ x: 20, y, width: 200, height }, LABEL, CONFIRM, SCREEN);
        expect(overlaps(label, LABEL, confirm, CONFIRM)).toBe(false);
      }
    }
  });
});

describe("label text", () => {
  it("is the component name alone when the survey had no source", () => {
    expect(formatAimLabel({ element: "PrimaryButton", frame: { x: 0, y: 0, width: 1, height: 1 } })).toBe(
      "PrimaryButton",
    );
  });

  it("appends the source BASENAME and line when the inspector already had it", () => {
    expect(
      formatAimLabel({
        element: "PrimaryButton",
        frame: { x: 0, y: 0, width: 1, height: 1 },
        source: { file: "app/src/components/Card.tsx", line: 3 },
      }),
    ).toBe("PrimaryButton · Card.tsx:3");
  });

  it("falls back to the testID, then to a placeholder", () => {
    const frame = { x: 0, y: 0, width: 1, height: 1 };
    expect(formatAimLabel({ element: "", frame, testID: "feed-row-3" })).toBe("feed-row-3");
    expect(formatAimLabel({ element: "", frame })).toBe("UnknownView");
  });
});

describe("turning a hit into something drawable", () => {
  it("refuses a null hit", () => {
    expect(aimTargetFromHit(null)).toBeNull();
  });

  it("refuses a zero-area frame (a degenerate outline points at nothing)", () => {
    expect(aimTargetFromHit({ element: "X", frame: { x: 10, y: 10, width: 0, height: 40 } })).toBeNull();
    expect(aimTargetFromHit({ element: "X", frame: { x: 10, y: 10, width: 40, height: 0 } })).toBeNull();
  });

  it("keeps the frame verbatim", () => {
    const frame = { x: 10, y: 20, width: 30, height: 40 };
    expect(aimTargetFromHit({ element: "FeedRow", frame })).toEqual({ frame, label: "FeedRow" });
  });

  it("anchors chrome on the tap point when there is no frame to outline", () => {
    // Drawing and anchoring are different questions: there is no outline,
    // but the confirm button still has to appear where the finger went down.
    expect(aimAnchorTarget({ x: 40, y: 90, hit: null, target: null, final: true })).toEqual({
      frame: { x: 40, y: 90, width: 0, height: 0 },
      label: "this spot",
    });
  });

  it("keeps the element's name in the anchor when only the frame is missing", () => {
    const anchor = aimAnchorTarget({
      x: 40,
      y: 90,
      hit: { element: "Spacer", frame: { x: 40, y: 90, width: 0, height: 0 } },
      target: null,
      final: true,
    });
    expect(anchor.label).toBe("Spacer");
  });

  it("passes a real target through untouched", () => {
    const frame = { x: 1, y: 2, width: 30, height: 40 };
    const target = { frame, label: "FeedRow" };
    expect(aimAnchorTarget({ x: 5, y: 5, hit: null, target, final: true })).toBe(target);
  });
});

describe("throttle", () => {
  it("emits the first value immediately", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    createThrottle(fn, 60).call("a");
    expect(fn).toHaveBeenCalledWith("a");
  });

  it("emits at most once per interval", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const t = createThrottle(fn, 60);
    t.call(1);
    for (let i = 2; i <= 20; i++) {
      vi.advanceTimersByTime(3);
      t.call(i);
    }
    // 60ms of 3ms-apart calls: the leading emit plus at most one trailing.
    expect(fn.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("always delivers the FINAL value of a burst", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const t = createThrottle(fn, 60);
    t.call("first");
    t.call("middle");
    t.call("last");
    vi.advanceTimersByTime(60);
    expect(fn).toHaveBeenLastCalledWith("last");
  });

  it("spaces emits across a long drag", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const t = createThrottle(fn, 60);
    for (let i = 0; i < 30; i++) {
      t.call(i);
      vi.advanceTimersByTime(20);
    }
    // 600ms / 60ms ≈ 10 emits, not 30.
    expect(fn.mock.calls.length).toBeLessThanOrEqual(11);
    expect(fn.mock.calls.length).toBeGreaterThan(5);
  });

  it("flush() delivers a pending value now", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const t = createThrottle(fn, 60);
    t.call("a");
    t.call("b");
    t.flush();
    expect(fn).toHaveBeenLastCalledWith("b");
  });

  it("cancel() drops the pending value for good", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const t = createThrottle(fn, 60);
    t.call("a");
    t.call("b");
    t.cancel();
    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("a");
  });
});

// ── Tracker ──────────────────────────────────────────────────────────────────

function hitFor(name: string, y = 100): AimHit {
  return { element: name, frame: { x: 0, y, width: 100, height: 40 } };
}

function makeTracker(inspect: (x: number, y: number, final: boolean) => Promise<AimHit | null>) {
  const seen: (AimSelection | null)[] = [];
  const tracker = createAimTracker({
    inspect,
    onSelection: (s) => seen.push(s),
    throttleMs: 60,
  });
  return { tracker, seen };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

/** A hit-test we can hold open, to model a slow native round-trip. */
function deferredHit() {
  let settle: (h: AimHit | null) => void = () => {};
  const promise = new Promise<AimHit | null>((resolve) => {
    settle = resolve;
  });
  return { promise, settle: (h: AimHit | null) => settle(h) };
}

describe("aim tracker", () => {
  it("surveys the point under the finger", async () => {
    const { tracker, seen } = makeTracker(async (_x, y) => hitFor("FeedRow", y));
    tracker.aim(10, 200);
    await flush();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.target?.label).toBe("FeedRow");
    expect(seen[0]?.final).toBe(false);
  });

  it("marks a release as final and skips the throttle", async () => {
    const calls: boolean[] = [];
    const { tracker, seen } = makeTracker(async (_x, _y, final) => {
      calls.push(final);
      return hitFor("PrimaryButton");
    });
    tracker.aim(10, 100);
    tracker.select(10, 100); // immediately after — a plain tap
    await flush();
    expect(calls).toEqual([false, true]);
    expect(seen[seen.length - 1]?.final).toBe(true);
  });

  it("hides the highlight when a SURVEY hit-test comes back empty", async () => {
    const { tracker, seen } = makeTracker(async () => null);
    tracker.aim(10, 100);
    await flush();
    expect(seen).toEqual([null]);
  });

  it("still commits a selection when a RELEASE hit-test comes back empty", async () => {
    // The bug this guards: a null hit on release used to produce a null
    // selection, so the confirm button never appeared and the composer was
    // unreachable. Since the capture root swallows the tap, the whole
    // gesture did nothing — which is what every build without the dev
    // inspector saw, react-native-web included.
    const { tracker, seen } = makeTracker(async () => null);
    tracker.select(10, 100);
    await flush();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ x: 10, y: 100, hit: null, target: null, final: true });
  });

  it("commits a release over an element whose frame has no area", async () => {
    // Identified, but nothing worth outlining: keep the identity, drop the
    // highlight.
    const { tracker, seen } = makeTracker(async () => ({
      element: "Spacer",
      frame: { x: 10, y: 100, width: 0, height: 0 },
    }));
    tracker.select(10, 100);
    await flush();
    expect(seen[0]?.final).toBe(true);
    expect(seen[0]?.target).toBeNull();
    expect(seen[0]?.hit?.element).toBe("Spacer");
  });

  it("hides the highlight rather than throwing when the inspector blows up", async () => {
    const { tracker, seen } = makeTracker(async () => {
      throw new Error("native hit-test exploded");
    });
    tracker.aim(10, 100);
    await flush();
    expect(seen).toEqual([null]);
  });

  it("drops a response for a position the finger has already left", async () => {
    const slow = deferredHit();
    let call = 0;
    const { tracker, seen } = makeTracker((_x, y) => {
      call++;
      return call === 1 ? slow.promise : Promise.resolve(hitFor("Second", y));
    });
    tracker.select(10, 100);
    tracker.select(10, 300);
    await flush();
    slow.settle(hitFor("First", 100));
    await flush();
    const labels = seen.map((s) => s?.target?.label);
    expect(labels).toContain("Second");
    expect(labels).not.toContain("First");
  });

  it("clears the selection on cancel and ignores work still in flight", async () => {
    const slow = deferredHit();
    const { tracker, seen } = makeTracker(() => slow.promise);
    tracker.aim(10, 100);
    tracker.clear();
    expect(seen).toEqual([null]);
    slow.settle(hitFor("TooLate"));
    await flush();
    // The gesture is over; a highlight must not flash back onto the screen.
    expect(seen).toEqual([null]);
  });

  it("clears a queued survey position too, so it cannot resurrect the highlight", async () => {
    vi.useFakeTimers();
    const { tracker, seen } = makeTracker(async () => hitFor("Ghost"));
    tracker.aim(10, 100);
    tracker.aim(10, 140); // queued behind the throttle window
    await vi.advanceTimersByTimeAsync(1);
    tracker.clear();
    await vi.advanceTimersByTimeAsync(500);
    expect(seen[seen.length - 1]).toBeNull();
    expect(seen.filter((s) => s !== null)).toHaveLength(1);
  });
});

describe("composer sheet metrics", () => {
  it("caps the sheet at ~40% of the window, leaving the rest of the app visible", () => {
    expect(composerSheetMaxHeight(844)).toBe(337);
    expect(composerSheetMaxHeight(844) / 844).toBeLessThanOrEqual(0.4);
  });

  it("reports what the sheet actually covers, not what it was allowed to", () => {
    // Content-sized: a short sheet occludes less than the cap.
    expect(composerOccludedTop(844, 260)).toBe(584);
    expect(composerOccludedTop(844, 337)).toBe(507);
  });

  it("occludes nothing until the sheet has laid out", () => {
    expect(composerOccludedTop(844, null)).toBeUndefined();
    expect(composerOccludedTop(844, 0)).toBeUndefined();
  });
});
