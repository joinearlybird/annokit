/**
 * Scroll-offset capture (src/scroll.ts).
 *
 * The offset is the difference of two `measureInWindow` results (scroll host
 * origin − content view origin), so these tests drive fake host instances
 * whose measure callbacks return known window rects — the same "stubs, not
 * jsdom" posture as the inspector tests.
 *
 * The contract under test is as much about what it REFUSES to report as
 * about what it reports: an unreadable offset must come back as null (the
 * payload then carries offsetY 0), never as a guess.
 */

import { describe, expect, it, vi } from "vitest";
import { findScrollTarget, resolveScrollInfo } from "../src/scroll";
import {
  buildFiberChain,
  buildScrolledChain,
  fabricHostInstance,
  paperHostInstance,
  silentHostInstance,
} from "./fixtures/spike-payloads";

describe("finding the owning scroll container", () => {
  it("reports the nearest RCTScrollView ancestor's offset and tag", async () => {
    const leaf = buildScrolledChain({ hostY: 100, contentY: -380, tag: 123 });
    await expect(resolveScrollInfo(leaf)).resolves.toEqual({ scrollViewTag: 123, offsetY: 480 });
  });

  it("reads the Paper renderer's host-instance shape too", async () => {
    const leaf = buildScrolledChain({ hostY: 64, contentY: -136, tag: 9, renderer: "paper" });
    await expect(resolveScrollInfo(leaf)).resolves.toEqual({ scrollViewTag: 9, offsetY: 200 });
  });

  it("reports 0 for a scroll container sitting at the top", async () => {
    const leaf = buildScrolledChain({ hostY: 0, contentY: 0, tag: 4 });
    await expect(resolveScrollInfo(leaf)).resolves.toEqual({ scrollViewTag: 4, offsetY: 0 });
  });

  it("matches Android's horizontal scroll host name", async () => {
    const leaf = buildScrolledChain({
      hostY: 0,
      contentY: 0,
      hostX: 0,
      contentX: -240,
      tag: 7,
      hostName: "AndroidHorizontalScrollView",
    });
    await expect(resolveScrollInfo(leaf)).resolves.toEqual({
      scrollViewTag: 7,
      offsetY: 0,
      offsetX: 240,
    });
  });

  it("omits offsetX for a purely vertical scroller (it carries no information)", async () => {
    const info = await resolveScrollInfo(buildScrolledChain({ hostY: 50, contentY: -50, tag: 1 }));
    expect(info).not.toBeNull();
    expect("offsetX" in (info as object)).toBe(false);
  });

  it("takes the NEAREST scroll container when they nest", async () => {
    const leaf = buildFiberChain([
      { name: "RCTText", host: true },
      { name: "RCTScrollContentView", host: true, stateNode: fabricHostInstance({ x: 0, y: -30 }) },
      { name: "RCTScrollView", host: true, stateNode: fabricHostInstance({ x: 0, y: 0, tag: 2 }) },
      { name: "RCTScrollContentView", host: true, stateNode: fabricHostInstance({ x: 0, y: -900 }) },
      { name: "RCTScrollView", host: true, stateNode: fabricHostInstance({ x: 0, y: 0, tag: 1 }) },
      { name: "HomeScreen" },
    ]);
    await expect(resolveScrollInfo(leaf)).resolves.toEqual({ scrollViewTag: 2, offsetY: 30 });
  });

  it("does not mistake the content view for the container", () => {
    const leaf = buildScrolledChain({ hostY: 10, contentY: -10, tag: 5 });
    const target = findScrollTarget(leaf);
    expect(target?.host.type).toBe("RCTScrollView");
    expect(target?.content.type).toBe("RCTScrollContentView");
  });

  it("falls back to a scroll-responder instance when the host name is unfamiliar", async () => {
    const leaf = buildFiberChain([
      { name: "RCTText", host: true },
      { name: "VendorContentView", host: true, stateNode: fabricHostInstance({ x: 0, y: -75 }) },
      { name: "VendorScroller", host: true, stateNode: fabricHostInstance({ x: 0, y: 25 }) },
      {
        name: "CustomScroller",
        // A composite whose instance speaks RN's scroll-responder surface.
        stateNode: { getScrollableNode: () => 77, getScrollResponder: () => ({}) },
      },
      { name: "HomeScreen" },
    ]);
    await expect(resolveScrollInfo(leaf)).resolves.toEqual({ scrollViewTag: 77, offsetY: 100 });
  });
});

describe("no scroll container", () => {
  it("resolves null for a plain (unscrollable) screen", async () => {
    const leaf = buildFiberChain([
      { name: "RCTText", host: true },
      { name: "Text" },
      { name: "PrimaryButton" },
      { name: "HomeScreen" },
    ]);
    expect(findScrollTarget(leaf)).toBeNull();
    await expect(resolveScrollInfo(leaf)).resolves.toBeNull();
  });

  it("resolves null for a missing fiber", async () => {
    await expect(resolveScrollInfo(null)).resolves.toBeNull();
    await expect(resolveScrollInfo(undefined)).resolves.toBeNull();
  });

  it("terminates on a cyclic return chain instead of hanging", async () => {
    const leaf = buildFiberChain([
      { name: "RCTView", host: true },
      { name: "Loopy" },
    ]);
    let node = leaf;
    while (node.return) node = node.return;
    node.return = leaf;
    await expect(resolveScrollInfo(leaf)).resolves.toBeNull();
  });

  it("resolves null when the container has no content view to measure against", async () => {
    const leaf = buildFiberChain([
      { name: "RCTScrollView", host: true, stateNode: fabricHostInstance({ x: 0, y: 0, tag: 3 }) },
      { name: "HomeScreen" },
    ]);
    await expect(resolveScrollInfo(leaf)).resolves.toBeNull();
  });
});

describe("unreadable offsets degrade to null, never to a wrong number", () => {
  it("resolves null when the host instances expose no measureInWindow", async () => {
    const leaf = buildFiberChain([
      { name: "RCTText", host: true },
      { name: "RCTScrollContentView", host: true, stateNode: { foo: 1 } },
      { name: "RCTScrollView", host: true, stateNode: { _nativeTag: 12 } },
      { name: "HomeScreen" },
    ]);
    // The container WAS found — we just refuse to invent its offset.
    expect(findScrollTarget(leaf)).not.toBeNull();
    await expect(resolveScrollInfo(leaf)).resolves.toBeNull();
  });

  it("resolves null when only one of the two measurements comes back", async () => {
    const leaf = buildFiberChain([
      { name: "RCTText", host: true },
      { name: "RCTScrollContentView", host: true, stateNode: silentHostInstance() },
      { name: "RCTScrollView", host: true, stateNode: paperHostInstance({ x: 0, y: 100, tag: 8 }) },
      { name: "HomeScreen" },
    ]);
    vi.useFakeTimers();
    try {
      const promise = resolveScrollInfo(leaf);
      await vi.advanceTimersByTimeAsync(400);
      await expect(promise).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("resolves null (never rejects) when measureInWindow throws", async () => {
    const exploding = {
      _nativeTag: 5,
      measureInWindow() {
        throw new Error("native bridge is gone");
      },
    };
    const leaf = buildFiberChain([
      { name: "RCTText", host: true },
      { name: "RCTScrollContentView", host: true, stateNode: exploding },
      { name: "RCTScrollView", host: true, stateNode: paperHostInstance({ x: 0, y: 0, tag: 5 }) },
      { name: "HomeScreen" },
    ]);
    await expect(resolveScrollInfo(leaf)).resolves.toBeNull();
  });

  it("survives a scroll responder whose getScrollableNode throws", async () => {
    const leaf = buildFiberChain([
      { name: "RCTText", host: true },
      { name: "VendorContentView", host: true, stateNode: paperHostInstance({ x: 0, y: -40 }) },
      { name: "VendorScroller", host: true, stateNode: paperHostInstance({ x: 0, y: 0 }) },
      {
        name: "CustomScroller",
        stateNode: {
          getScrollableNode() {
            throw new Error("not mounted");
          },
        },
      },
      { name: "HomeScreen" },
    ]);
    // No tag resolvable, but the measured offset still ships.
    await expect(resolveScrollInfo(leaf)).resolves.toEqual({ offsetY: 40 });
  });

  it("omits scrollViewTag rather than sending a bogus one", async () => {
    const untagged = {
      measureInWindow(cb: (x: number, y: number, w: number, h: number) => void) {
        cb(0, 0, 100, 100);
      },
    };
    const leaf = buildFiberChain([
      { name: "RCTText", host: true },
      { name: "RCTScrollContentView", host: true, stateNode: { ...untagged } },
      { name: "RCTScrollView", host: true, stateNode: { ...untagged } },
      { name: "HomeScreen" },
    ]);
    await expect(resolveScrollInfo(leaf)).resolves.toEqual({ offsetY: 0 });
  });

  it("rounds away float noise from the two native measurements", async () => {
    const leaf = buildScrolledChain({ hostY: 0.3333333333, contentY: -479.6666666666, tag: 6 });
    await expect(resolveScrollInfo(leaf)).resolves.toEqual({ scrollViewTag: 6, offsetY: 480 });
  });
});
