import { describe, expect, it } from "vitest";
import {
  autoScrollAnimated,
  isNearBottom,
  shouldAutoScroll,
  shouldFollowResize,
} from "../src/thread-scroll";
import type { ScrollMetrics } from "../src/thread-scroll";

const metrics = (offsetY: number, content = 1000, viewport = 400): ScrollMetrics => ({
  layoutMeasurement: { height: viewport },
  contentOffset: { y: offsetY },
  contentSize: { height: content },
});

describe("near the bottom", () => {
  it("is true at the very end", () => {
    expect(isNearBottom(metrics(600))).toBe(true);
  });

  it("tolerates the few pixels a momentum scroll leaves behind", () => {
    expect(isNearBottom(metrics(570))).toBe(true); // 30px short
    expect(isNearBottom(metrics(500))).toBe(false); // 100px short
  });

  it("is true when the content does not even fill the viewport", () => {
    expect(isNearBottom(metrics(0, 200, 400))).toBe(true);
  });

  it("takes the slack as an argument", () => {
    expect(isNearBottom(metrics(500), 8)).toBe(false);
    expect(isNearBottom(metrics(500), 120)).toBe(true);
  });
});

describe("whether to jump to the newest message", () => {
  it("always lands at the bottom on open", () => {
    expect(shouldAutoScroll("open", false)).toBe(true);
    expect(shouldAutoScroll("open", true)).toBe(true);
  });

  it("always follows the user's own reply down", () => {
    expect(shouldAutoScroll("own", false)).toBe(true);
    expect(shouldAutoScroll("own", true)).toBe(true);
  });

  it("follows someone else's message only if the user was already at the bottom", () => {
    expect(shouldAutoScroll("incoming", true)).toBe(true);
    // Reading history: do not yank them back.
    expect(shouldAutoScroll("incoming", false)).toBe(false);
  });
});

describe("whether the jump animates", () => {
  it("does not animate the opening jump — the sheet is already moving", () => {
    expect(autoScrollAnimated("open")).toBe(false);
  });

  it("animates every later jump, so the change is seen happening", () => {
    expect(autoScrollAnimated("own")).toBe(true);
    expect(autoScrollAnimated("incoming")).toBe(true);
  });
});

describe("when the viewport changes size", () => {
  it("stays on the newest message while the list is parked there — the sheet settling after open", () => {
    expect(shouldFollowResize(true)).toBe(true);
  });

  it("leaves a reader who scrolled up into the history where they are", () => {
    expect(shouldFollowResize(false)).toBe(false);
  });
});
