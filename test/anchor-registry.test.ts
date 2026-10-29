/**
 * Element anchoring (src/anchor-registry.ts): registration rules, direct
 * element measurement, the settle-before-shown track, and the trusted rule
 * that hides dead-anchored marks instead of letting them float.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  advanceAnchorTrack,
  ANCHOR_STABLE_TICKS,
  anchorMoving,
  anchorsSettled,
  anchorTracksEqual,
  applyAnchorFixes,
  clearScrollAnchors,
  emptyAnchorTrack,
  hasScrollAnchor,
  idsNearViewport,
  markerPositionTrusted,
  measureAnchorFixes,
  nextAnchorDelay,
  REANCHOR_IDLE_INTERVAL_MS,
  REANCHOR_INTERVAL_MS,
  registerScrollAnchor,
} from "../src/anchor-registry";
import type { AnchorFix, AnchorTrack } from "../src/anchor-registry";
import type { InspectorHit } from "../src/inspector";
import type { ScrollFiber } from "../src/scroll";

afterEach(() => clearScrollAnchors());

/** A measurable host fiber whose window rect the test controls (mutable). */
function node(rect: { x: number; y: number; width?: number; height?: number }): ScrollFiber {
  return {
    stateNode: {
      measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) =>
        cb(rect.x, rect.y, rect.width ?? 100, rect.height ?? 40),
    },
  } as unknown as ScrollFiber;
}

/** A broken node: measurement never answers usable numbers. */
function deadNode(): ScrollFiber {
  return { stateNode: {} } as unknown as ScrollFiber;
}

/** A capture: tap at (x,y) on an element whose frame/nodes the test controls. */
function captureOf(
  x: number,
  y: number,
  frame: { x: number; y: number },
  elementFiber: ScrollFiber | undefined,
  viewportHost?: ScrollFiber,
): { x: number; y: number; hit: InspectorHit } {
  return {
    x,
    y,
    hit: {
      element: "FeedRow",
      componentStack: [],
      frame: { x: frame.x, y: frame.y, width: 100, height: 40 },
      scroll: { offsetY: 0 },
      elementFiber,
      scrollAnchor: viewportHost
        ? { host: viewportHost, content: node({ x: 0, y: 0 }) }
        : undefined,
    },
  };
}

describe("registerScrollAnchor", () => {
  it("registers only captures that carry an element node", () => {
    registerScrollAnchor("no-node", captureOf(10, 20, { x: 0, y: 0 }, undefined));
    registerScrollAnchor("no-capture", null);
    expect(hasScrollAnchor("no-node")).toBe(false);
    expect(hasScrollAnchor("no-capture")).toBe(false);

    registerScrollAnchor("ok", captureOf(10, 20, { x: 0, y: 0 }, node({ x: 0, y: 0 })));
    expect(hasScrollAnchor("ok")).toBe(true);
  });

  it("prunes the oldest past the limit instead of growing forever", () => {
    for (let i = 0; i < 201; i++) {
      registerScrollAnchor(`a${i}`, captureOf(0, 0, { x: 0, y: 0 }, node({ x: 0, y: 0 })));
    }
    expect(hasScrollAnchor("a0")).toBe(false);
    expect(hasScrollAnchor("a200")).toBe(true);
  });
});

describe("markerPositionTrusted — no live anchor, no dot", () => {
  it("every mark is trusted only while its live anchor exists — both kinds, one rule", () => {
    registerScrollAnchor("live", captureOf(10, 20, { x: 0, y: 0 }, node({ x: 0, y: 0 })));
    expect(markerPositionTrusted("live")).toBe(true);
    // No anchor (reloaded app / pruned / other-device capture): hidden
    // rather than floating — until src/reanchor.ts recovers it by testID.
    expect(markerPositionTrusted("orphaned")).toBe(false);
  });

  // Annotate a row, navigate away, come back: the row is a NEW fiber. The
  // old entry must go, or re-anchoring skips the mark for the whole run.
  it("drops an anchor whose element unmounted, so re-anchoring can recover it", async () => {
    const parent = node({ x: 0, y: 0 });
    const element = { ...node({ x: 0, y: 0 }), return: parent } as ScrollFiber;
    registerScrollAnchor("row", captureOf(10, 20, { x: 0, y: 0 }, element));
    expect(hasScrollAnchor("row")).toBe(true);

    element.return = null; // what React does to a deleted fiber
    expect(hasScrollAnchor("row")).toBe(false);
    expect(markerPositionTrusted("row")).toBe(false);
    expect((await measureAnchorFixes(["row"])).has("row")).toBe(false);
  });

  it("keeps an anchor that merely fails to measure — a frozen tab comes back", async () => {
    registerScrollAnchor("frozen", captureOf(10, 20, { x: 0, y: 0 }, deadNode()));
    expect((await measureAnchorFixes(["frozen"])).get("frozen")?.gone).toBe(true);
    expect(hasScrollAnchor("frozen")).toBe(true);
  });
});

describe("measureAnchorFixes — the marker sits where its ELEMENT is now", () => {
  it("fix = current element origin + where inside it the finger tapped", async () => {
    const el = node({ x: 30, y: 400 });
    // Tap at (50, 415) on an element captured at (30, 400): grab (20, 15).
    registerScrollAnchor("m1", captureOf(50, 415, { x: 30, y: 400 }, el));
    // The element moved (scroll, layout, anything): now at (30, 150).
    (el as unknown as { stateNode: { measureInWindow: unknown } }).stateNode.measureInWindow = (
      cb: (x: number, y: number, w: number, h: number) => void,
    ) => cb(30, 150, 100, 40);
    const fixes = await measureAnchorFixes(["m1", "unregistered"]);
    expect(fixes.get("m1")).toEqual({ x: 50, y: 165 });
    expect(fixes.has("unregistered")).toBe(false);
  });

  it("carries the container viewport when the capture had one", async () => {
    const viewport = node({ x: 0, y: 100, width: 390, height: 500 });
    registerScrollAnchor(
      "m2",
      captureOf(50, 415, { x: 30, y: 400 }, node({ x: 30, y: 400 }), viewport),
    );
    const fixes = await measureAnchorFixes(["m2"]);
    expect(fixes.get("m2")?.viewport).toEqual({ x: 0, y: 100, width: 390, height: 500 });
  });

  it("an unmeasurable element is GONE — hidden, never guessed", async () => {
    registerScrollAnchor("gone", captureOf(0, 0, { x: 0, y: 0 }, deadNode()));
    const fixes = await measureAnchorFixes(["gone"]);
    expect(fixes.get("gone")?.gone).toBe(true);
  });
});

describe("advanceAnchorTrack / anchorMoving — settle-before-shown", () => {
  const fix = (x: number, y: number): AnchorFix => ({ x, y });

  it("quantizes measurement noise to whole points", () => {
    const t = advanceAnchorTrack(emptyAnchorTrack(), new Map([["a", fix(49.6, 164.7)]]));
    expect(t.fixes.get("a")).toEqual({ x: 50, y: 165 });
  });

  it("a changing fix is MOVING until it holds for the required ticks", () => {
    let t = advanceAnchorTrack(emptyAnchorTrack(), new Map([["a", fix(50, 300)]]));
    expect(anchorMoving(t, "a")).toBe(true); // first sight
    t = advanceAnchorTrack(t, new Map([["a", fix(50, 200)]]));
    expect(anchorMoving(t, "a")).toBe(true); // still changing
    t = advanceAnchorTrack(t, new Map([["a", fix(50, 165)]]));
    t = advanceAnchorTrack(t, new Map([["a", fix(50, 165)]]));
    expect(anchorMoving(t, "a")).toBe(true); // held once — not yet
    t = advanceAnchorTrack(t, new Map([["a", fix(50, 165)]]));
    expect(anchorMoving(t, "a")).toBe(false); // settled
  });

  it("sub-point flutter does NOT reset the hold — that is the quantization working", () => {
    let t = advanceAnchorTrack(emptyAnchorTrack(), new Map([["a", fix(50, 165.2)]]));
    for (let i = 0; i < ANCHOR_STABLE_TICKS; i++) {
      t = advanceAnchorTrack(t, new Map([["a", fix(50, 164.8)]]));
    }
    expect(anchorMoving(t, "a")).toBe(false);
  });

  it("a measurement hiccup is STICKY — the previous entry survives, hold intact", () => {
    let t = advanceAnchorTrack(emptyAnchorTrack(), new Map([["a", fix(50, 165)]]));
    for (let i = 0; i < ANCHOR_STABLE_TICKS; i++) {
      t = advanceAnchorTrack(t, new Map([["a", fix(50, 165)]]));
    }
    expect(anchorMoving(t, "a")).toBe(false);
    const afterHiccup = advanceAnchorTrack(t, new Map());
    expect(afterHiccup.fixes.get("a")).toEqual({ x: 50, y: 165 });
    expect(anchorMoving(afterHiccup, "a")).toBe(false);
  });

  it("the hold count caps, so a settled track reaches a fixed point (render gate)", () => {
    let t = advanceAnchorTrack(emptyAnchorTrack(), new Map([["a", fix(1, 1)]]));
    for (let i = 0; i < 5; i++) t = advanceAnchorTrack(t, new Map([["a", fix(1, 1)]]));
    const again = advanceAnchorTrack(t, new Map([["a", fix(1, 1)]]));
    expect(anchorTracksEqual(t, again)).toBe(true);
  });
});

describe("applyAnchorFixes", () => {
  const markers = [
    { id: "a", x: 50, y: 300 },
    { id: "b", x: 80, y: 500 },
  ];

  /** A track whose every fix has already settled. */
  function settled(entries: Array<[string, AnchorFix]>): AnchorTrack {
    return {
      fixes: new Map(entries),
      stable: new Map(entries.map(([id]) => [id, ANCHOR_STABLE_TICKS])),
    };
  }

  it("moves only the ids that measured elsewhere, and copies — never mutates", () => {
    const out = applyAnchorFixes(markers, settled([["a", { x: 50, y: 150 }]]));
    expect(out[0]).toEqual({ id: "a", x: 50, y: 150 });
    expect(out[1]).toBe(markers[1]);
    expect(markers[0].y).toBe(300);
  });

  it("returns the SAME array when nothing applies — identity is the render gate", () => {
    expect(applyAnchorFixes(markers, emptyAnchorTrack())).toBe(markers);
    expect(applyAnchorFixes(markers, settled([["a", { x: 50, y: 300 }]]))).toBe(markers);
  });

  it("HIDES a mark mid-move instead of drawing it chasing its element", () => {
    const moving = advanceAnchorTrack(emptyAnchorTrack(), new Map([["a", { x: 50, y: 150 }]]));
    const out = applyAnchorFixes(markers, moving);
    expect(out.map((m) => m.id)).toEqual(["b"]);
  });

  it("a fix at the stored position never hides — fresh markers must not blink in late", () => {
    const firstSight = advanceAnchorTrack(emptyAnchorTrack(), new Map([["a", { x: 50, y: 300 }]]));
    expect(applyAnchorFixes(markers, firstSight)).toBe(markers);
  });

  it("HIDES a mark whose point left its container's viewport", () => {
    const viewport = { x: 0, y: 100, width: 400, height: 400 };
    const out = applyAnchorFixes(markers, settled([["a", { x: 50, y: 50, viewport }]]));
    expect(out.map((m) => m.id)).toEqual(["b"]);
  });

  it("keeps a settled mark that is still inside the viewport", () => {
    const viewport = { x: 0, y: 100, width: 400, height: 400 };
    const out = applyAnchorFixes(markers, settled([["a", { x: 50, y: 200, viewport }]]));
    expect(out[0]).toEqual({ id: "a", x: 50, y: 200 });
  });
});

describe("gone elements (virtualized rows) stay hidden", () => {
  it("a zero-size measurement is GONE, not a position near the origin", async () => {
    registerScrollAnchor("v1", captureOf(10, 20, { x: 0, y: 0 }, node({ x: 0, y: 0, width: 0, height: 0 })));
    const fixes = await measureAnchorFixes(["v1"]);
    expect(fixes.get("v1")?.gone).toBe(true);
  });

  it("a gone fix hides the marker even when settled", () => {
    let t = advanceAnchorTrack(emptyAnchorTrack(), new Map([["a", { x: 0, y: 0, gone: true }]]));
    for (let i = 0; i < ANCHOR_STABLE_TICKS; i++) {
      t = advanceAnchorTrack(t, new Map([["a", { x: 0, y: 0, gone: true }]]));
    }
    const out = applyAnchorFixes([{ id: "a", x: 50, y: 300 }], t);
    expect(out).toEqual([]);
  });
});

// ── Cadence ──────────────────────────────────────────────────────────────
//
// "A stable foreground screen reaches near-zero anchor measurement work."
// (docs/audit/performance-correctness.md)

describe("anchorsSettled / nextAnchorDelay", () => {
  const IDS = ["a", "b"];

  /** Measure `n` times with the same fixes, as a still screen would. */
  function hold(fixes: Record<string, { x: number; y: number }>, n: number): AnchorTrack {
    let track = emptyAnchorTrack();
    for (let i = 0; i < n; i++) {
      track = advanceAnchorTrack(track, new Map(Object.entries(fixes)));
    }
    return track;
  }

  it("is unsettled on the first measurement, however still the screen is", () => {
    const track = hold({ a: { x: 10, y: 20 }, b: { x: 30, y: 40 } }, 1);
    expect(anchorsSettled(track, IDS)).toBe(false);
    expect(nextAnchorDelay(track, IDS)).toBe(REANCHOR_INTERVAL_MS);
  });

  it("settles once every anchor has held for the full stable count", () => {
    const track = hold({ a: { x: 10, y: 20 }, b: { x: 30, y: 40 } }, ANCHOR_STABLE_TICKS + 1);
    expect(anchorsSettled(track, IDS)).toBe(true);
    expect(nextAnchorDelay(track, IDS)).toBe(REANCHOR_IDLE_INTERVAL_MS);
  });

  it("one moving anchor keeps the whole screen at the fast cadence", () => {
    let track = hold({ a: { x: 10, y: 20 }, b: { x: 30, y: 40 } }, ANCHOR_STABLE_TICKS + 1);
    expect(anchorsSettled(track, IDS)).toBe(true);
    track = advanceAnchorTrack(track, new Map([["a", { x: 10, y: 20 }], ["b", { x: 30, y: 99 }]]));
    expect(anchorsSettled(track, IDS)).toBe(false);
    expect(nextAnchorDelay(track, IDS)).toBe(REANCHOR_INTERVAL_MS);
  });

  it("snaps back to fast the moment the heartbeat finds movement", () => {
    // The whole point of not stopping entirely: a silent mover (animation,
    // layout pass, a host that never reports scrolls) is caught by the
    // slow tick and the loop speeds up again on its own.
    let track = hold({ a: { x: 1, y: 1 } }, ANCHOR_STABLE_TICKS + 1);
    expect(nextAnchorDelay(track, ["a"])).toBe(REANCHOR_IDLE_INTERVAL_MS);
    track = advanceAnchorTrack(track, new Map([["a", { x: 1, y: 2 }]]));
    expect(nextAnchorDelay(track, ["a"])).toBe(REANCHOR_INTERVAL_MS);
    // ...and settles again once it stops.
    track = advanceAnchorTrack(track, new Map([["a", { x: 1, y: 2 }]]));
    track = advanceAnchorTrack(track, new Map([["a", { x: 1, y: 2 }]]));
    expect(nextAnchorDelay(track, ["a"])).toBe(REANCHOR_IDLE_INTERVAL_MS);
  });

  it("an unmeasurable anchor does not hold the screen at speed", () => {
    // It is not being drawn, so it must not be the reason everything else
    // keeps measuring. The heartbeat still retries it.
    const track = hold({ a: { x: 10, y: 20 } }, ANCHOR_STABLE_TICKS + 1);
    expect(anchorsSettled(track, ["a", "never-measured"])).toBe(true);
  });

  it("a gone anchor settles like any other once it stops changing", () => {
    let track = emptyAnchorTrack();
    for (let i = 0; i < ANCHOR_STABLE_TICKS + 1; i++) {
      track = advanceAnchorTrack(track, new Map([["a", { x: 0, y: 0, gone: true }]]));
    }
    expect(anchorsSettled(track, ["a"])).toBe(true);
  });

  it("an empty watch list is settled", () => {
    expect(anchorsSettled(emptyAnchorTrack(), [])).toBe(true);
    expect(nextAnchorDelay(emptyAnchorTrack(), [])).toBe(REANCHOR_IDLE_INTERVAL_MS);
  });

  it("the idle heartbeat is meaningfully cheaper than the active cadence", () => {
    // Guards the constants against a well-meaning tweak that erases the win.
    expect(REANCHOR_IDLE_INTERVAL_MS).toBeGreaterThanOrEqual(REANCHOR_INTERVAL_MS * 8);
  });
});

describe("idsNearViewport", () => {
  const WINDOW = 800;

  /** A track holding one measured fix per id at the given y. */
  function trackAt(positions: Record<string, number>): AnchorTrack {
    const fixes = new Map(Object.entries(positions).map(([id, y]) => [id, { x: 10, y }]));
    return advanceAnchorTrack(emptyAnchorTrack(), fixes);
  }

  it("keeps markers on screen", () => {
    const t = trackAt({ a: 0, b: 400, c: 799 });
    expect(idsNearViewport(t, ["a", "b", "c"], WINDOW)).toEqual(["a", "b", "c"]);
  });

  it("drops markers screens away", () => {
    const t = trackAt({ near: 400, far: 9_000, above: -9_000 });
    expect(idsNearViewport(t, ["near", "far", "above"], WINDOW)).toEqual(["near"]);
  });

  it("keeps a generous margin, so a marker just off the fold is placed before it arrives", () => {
    const t = trackAt({ justBelow: WINDOW + 100, justAbove: -100 });
    expect(idsNearViewport(t, ["justBelow", "justAbove"], WINDOW)).toEqual([
      "justBelow",
      "justAbove",
    ]);
  });

  it("ALWAYS measures an id it has never seen — unmeasured is not far away", () => {
    // A freshly registered or re-anchored marker has to be placed before it
    // can be skipped.
    const t = trackAt({ known: 400 });
    expect(idsNearViewport(t, ["known", "brand-new"], WINDOW)).toContain("brand-new");
  });

  it("re-measures an anchor that measured as gone, in case it comes back", () => {
    let t = emptyAnchorTrack();
    t = advanceAnchorTrack(t, new Map([["ghost", { x: 0, y: 0, gone: true }]]));
    expect(idsNearViewport(t, ["ghost"], WINDOW)).toEqual(["ghost"]);
  });

  it("fails OPEN on a nonsense window rather than measuring nothing", () => {
    const t = trackAt({ a: 400, b: 9_000 });
    expect(idsNearViewport(t, ["a", "b"], 0)).toEqual(["a", "b"]);
  });

  it("saves real work on a marker-heavy screen", () => {
    // The point of the whole exercise: a long list where all but a handful
    // are screens away.
    const positions: Record<string, number> = {};
    for (let i = 0; i < 200; i++) positions[`m${i}`] = i * 100;
    const t = trackAt(positions);
    const ids = Object.keys(positions);
    const near = idsNearViewport(t, ids, WINDOW);
    expect(near.length).toBeLessThan(20);
    expect(near.length).toBeGreaterThan(0);
  });
});
