/**
 * Re-anchoring by testID (src/reanchor.ts): the fiber-tree search and the
 * recover-into-the-registry pass. Fibers here are hand-built objects with
 * measurable stateNodes — the walk reads only child/sibling/memoizedProps,
 * which is exactly why the module can be tested without React.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearScrollAnchors,
  hasScrollAnchor,
  markerPositionTrusted,
  measureAnchorFixes,
} from "../src/anchor-registry";
import { findFibersByTestID, reanchorGrab, reanchorMarkers } from "../src/reanchor";
import type { WalkFiber } from "../src/reanchor";

/** A host fiber whose instance measures at a fixed window rect. */
function hostFiber(
  testID: string | undefined,
  rect: { x: number; y: number; w: number; h: number },
): WalkFiber {
  return {
    memoizedProps: testID ? { testID } : {},
    stateNode: {
      measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) =>
        cb(rect.x, rect.y, rect.w, rect.h),
    },
    child: null,
    sibling: null,
  };
}

/** Chain children/siblings into a tree and return the root. */
function tree(...fibers: WalkFiber[]): WalkFiber {
  const root = hostFiber(undefined, { x: 0, y: 0, w: 400, h: 800 });
  let prev: WalkFiber | null = null;
  for (const f of fibers) {
    if (!prev) root.child = f;
    else prev.sibling = f;
    prev = f;
  }
  return root;
}

function stubHook(roots: unknown[]) {
  vi.stubGlobal("__REACT_DEVTOOLS_GLOBAL_HOOK__", {
    renderers: new Map([[1, {}]]),
    getFiberRoots: () => new Set(roots.map((current) => ({ current }))),
  });
}

beforeEach(() => clearScrollAnchors());
afterEach(() => {
  vi.unstubAllGlobals();
  clearScrollAnchors();
});

describe("findFibersByTestID", () => {
  it("finds the first fiber per wanted testID, depth-first", () => {
    const a = hostFiber("row-1", { x: 0, y: 100, w: 300, h: 40 });
    const b = hostFiber("row-2", { x: 0, y: 160, w: 300, h: 40 });
    const found = findFibersByTestID([tree(a, b)], new Set(["row-2"]));
    expect(found.get("row-2")).toBe(b);
    expect(found.has("row-1")).toBe(false);
  });

  it("stops at the first match for a duplicated testID", () => {
    const first = hostFiber("dup", { x: 0, y: 0, w: 10, h: 10 });
    const second = hostFiber("dup", { x: 0, y: 500, w: 10, h: 10 });
    expect(findFibersByTestID([tree(first, second)], new Set(["dup"])).get("dup")).toBe(first);
  });

  it("answers empty for an empty tree or no wanted ids", () => {
    expect(findFibersByTestID([], new Set(["x"])).size).toBe(0);
    expect(findFibersByTestID([tree()], new Set()).size).toBe(0);
  });
});

describe("reanchorMarkers", () => {
  it("recovers an anchor by testID and the mark becomes trusted at the element's live spot", async () => {
    const row = hostFiber("feed-row-4", { x: 14, y: 300, w: 328, h: 44 });
    stubHook([tree(row)]);
    expect(markerPositionTrusted("cmt-1")).toBe(false);

    const fixed = await reanchorMarkers([
      {
        id: "cmt-1",
        testID: "feed-row-4",
        // Captured 20pt into the element, back when it sat at y=600.
        x: 34,
        y: 620,
        boundingBox: { x: 14, y: 600, width: 328, height: 44 },
      },
    ]);
    expect(fixed).toBe(1);
    expect(markerPositionTrusted("cmt-1")).toBe(true);
    // The recovered anchor measures at the element's CURRENT position,
    // keeping the captured within-element offset (20, 20).
    const fixes = await measureAnchorFixes(["cmt-1"]);
    expect(fixes.get("cmt-1")).toMatchObject({ x: 34, y: 320 });
  });

  it("brings back a mark made on a CHILD of the testID'd element, on the wrapper", async () => {
    // The finger was on the button's label (97×19); the testID is on the
    // button around it (362×47). Seen on a device: every such mark stayed
    // hidden after a reload, because the sizes differ.
    const button = hostFiber("primary-button", { x: 20, y: 561, w: 362, h: 47 });
    stubHook([tree(button)]);
    const fixed = await reanchorMarkers([
      {
        id: "task-1",
        testID: "primary-button",
        x: 200,
        y: 585,
        boundingBox: { x: 152, y: 575, width: 97, height: 19 },
      },
    ]);
    expect(fixed).toBe(1);
    const fixes = await measureAnchorFixes(["task-1"]);
    // Exactly where it was captured.
    expect(fixes.get("task-1")).toMatchObject({ x: 200, y: 585 });
  });

  it("keeps hidden a wrapper that no longer holds the mark where it was", async () => {
    // Same wrapper, but it has moved since the capture: the mark's place
    // inside it is unknown, so no guess.
    const moved = hostFiber("primary-button", { x: 20, y: 300, w: 362, h: 47 });
    stubHook([tree(moved)]);
    const fixed = await reanchorMarkers([
      { id: "task-2", testID: "primary-button", x: 200, y: 585, boundingBox: { x: 152, y: 575, width: 97, height: 19 } },
    ]);
    expect(fixed).toBe(0);
    expect(markerPositionTrusted("task-2")).toBe(false);
  });

  it("skips records with no testID, an existing anchor, or no mounted match", async () => {
    const row = hostFiber("present", { x: 0, y: 0, w: 100, h: 20 });
    stubHook([tree(row)]);
    await reanchorMarkers([{ id: "a", testID: "present" }]);
    expect(hasScrollAnchor("a")).toBe(true);

    const again = await reanchorMarkers([
      { id: "a", testID: "present" }, // already anchored
      { id: "b" }, // no testID on record
      { id: "c", testID: "not-mounted" },
    ]);
    expect(again).toBe(0);
    expect(hasScrollAnchor("b")).toBe(false);
    expect(hasScrollAnchor("c")).toBe(false);
  });

  // Marks saved before the inspector skipped the overlay's own wrapper can
  // carry its testID, and re-anchoring to it would pin them to the whole app.
  it("never re-anchors to the overlay's own wrapper", async () => {
    const layer = hostFiber("annokit-push-layer", { x: 0, y: 0, w: 400, h: 800 });
    stubHook([tree(layer)]);
    await expect(reanchorMarkers([{ id: "old", testID: "annokit-push-layer" }])).resolves.toBe(0);
    expect(hasScrollAnchor("old")).toBe(false);
  });

  it("a missing DevTools hook means 0, never a throw", async () => {
    vi.stubGlobal("__REACT_DEVTOOLS_GLOBAL_HOOK__", undefined);
    await expect(reanchorMarkers([{ id: "x", testID: "y" }])).resolves.toBe(0);
  });

  it("a zero-size measure (virtualized-away element) is not an anchor", async () => {
    const gone = hostFiber("ghost", { x: 0, y: 0, w: 0, h: 0 });
    stubHook([tree(gone)]);
    await expect(reanchorMarkers([{ id: "g", testID: "ghost" }])).resolves.toBe(0);
    expect(hasScrollAnchor("g")).toBe(false);
  });
});

describe("reanchorGrab — trusting a match", () => {
  const box = { x: 100, y: 200, width: 80, height: 20 };

  it("keeps the captured spot inside an element of the same size", () => {
    expect(reanchorGrab({ x: 110, y: 205, boundingBox: box }, { x: 100, y: 400, width: 82, height: 21 }))
      .toEqual({ grabDx: 10, grabDy: 5 });
  });

  it("places the mark where it was inside a wrapper that still contains the capture", () => {
    expect(reanchorGrab({ x: 110, y: 205, boundingBox: box }, { x: 50, y: 190, width: 300, height: 44 }))
      .toEqual({ grabDx: 60, grabDy: 15 });
  });

  it("refuses a larger element that does not contain the capture", () => {
    expect(reanchorGrab({ x: 110, y: 205, boundingBox: box }, { x: 50, y: 500, width: 300, height: 44 })).toBeNull();
  });

  it("refuses an element much smaller than what was captured", () => {
    expect(reanchorGrab({ x: 110, y: 205, boundingBox: box }, { x: 100, y: 200, width: 20, height: 4 })).toBeNull();
  });

  it("uses the centre when the record has no box", () => {
    expect(reanchorGrab({}, { x: 0, y: 0, width: 40, height: 10 })).toEqual({ grabDx: 20, grabDy: 5 });
  });
});
