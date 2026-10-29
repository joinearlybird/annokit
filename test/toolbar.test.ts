/**
 * The expandable FAB toolbar (src/toolbar.ts) — its action list and the
 * geometry of opening it.
 *
 * The toolbar exists because the queue used to be reachable only by
 * long-press, so the first thing worth asserting is that every action is in
 * the list — and, since the two-mode experiment was undone, that there is
 * exactly ONE capture action in it. The rest is edge behaviour that is invisible until it is wrong
 * on a device: a toolbar docked on the right must open LEFT (opening right
 * puts it off the screen), it must stay on screen even when it is wider
 * than the space beside the button, and arming must put it away rather than
 * leave it covering the element the user is aiming at.
 */

import { describe, expect, it } from "vitest";
import { FAB_INSETS, FAB_SIZE } from "../src/fab-drag";
import {
  TOOLBAR_ITEM_MIN_WIDTH,
  TOOLBAR_ITEM_WIDTH,
  collapsedTapAction,
  shouldCollapseToolbar,
  toolbarActions,
  toolbarItemWidth,
  toolbarPlacement,
  toolbarWidth,
} from "../src/toolbar";

const SCREEN = { width: 390, height: 844 };
const idle = { armed: false, pendingCount: 0 };

describe("actions", () => {
  it("offers ONE capture action, plus both lists and collapse", () => {
    // The comment-arming button is gone on purpose: you mark something once
    // and choose the destination in the composer (src/destination.ts).
    // Queue and Comments are two entries because they are two jobs: sending
    // work to the agent, and finding what the team said about a screen.
    expect(toolbarActions(idle).map((a) => a.key)).toEqual([
      "annotate",
      "queue",
      "comments",
      "settings",
      "collapse",
    ]);
  });

  it("has no Agent item: the agent is picked in the composer", () => {
    expect(toolbarActions(idle).map((a) => a.key)).toEqual(["annotate", "queue", "comments", "settings", "collapse"]);
  });

  it("narrows the items to fit six on a small phone, but not below the minimum", () => {
    expect(toolbarItemWidth(5, 402)).toBe(TOOLBAR_ITEM_WIDTH);
    const se = toolbarItemWidth(6, 375);
    expect(se).toBeLessThan(TOOLBAR_ITEM_WIDTH);
    expect(toolbarWidth(6, se)).toBeLessThanOrEqual(375 - 24);
    expect(toolbarItemWidth(6, 200)).toBe(TOOLBAR_ITEM_MIN_WIDTH);
  });

  it("calls the capture action Annotate — the act, not the destination", () => {
    const annotate = toolbarActions(idle)[0];
    expect(annotate.label).toBe("Annotate");
    expect(annotate.accessibilityLabel).toBe("Annotate an element");
  });

  it("puts the pending count on Queue and nowhere else", () => {
    const actions = toolbarActions({ armed: false, pendingCount: 3 });
    const queue = actions.find((a) => a.key === "queue");
    expect(queue?.badge).toBe("3");
    // The toggle carries no counter — the whole point of the change.
    expect(actions.find((a) => a.key === "annotate")?.badge).toBeUndefined();
    expect(queue?.accessibilityLabel).toContain("3");
    // And the two counts never borrow each other's number.
    expect(actions.find((a) => a.key === "comments")?.badge).toBeUndefined();
  });

  it("counts OPEN team notes on Comments, capped the same way", () => {
    const some = toolbarActions({ armed: false, pendingCount: 0, noteCount: 2 });
    const comments = some.find((a) => a.key === "comments");
    expect(comments?.badge).toBe("2");
    expect(comments?.accessibilityLabel).toContain("2");
    expect(comments?.label).toBe("Comments");
    expect(
      toolbarActions({ armed: false, pendingCount: 0, noteCount: 40 }).find(
        (a) => a.key === "comments",
      )?.badge,
    ).toBe("9+");
    expect(some.find((a) => a.key === "queue")?.badge).toBeUndefined();
  });

  it("says the notes list is every screen's, not this one's", () => {
    // The whole reason the entry exists: a note left on another route was
    // unreachable when the queue stopped listing notes.
    const comments = toolbarActions(idle).find((a) => a.key === "comments");
    expect(comments?.accessibilityLabel).toContain("every screen");
  });

  it("caps a long count and drops it entirely at zero", () => {
    expect(toolbarActions({ armed: false, pendingCount: 12 }).find((a) => a.key === "queue")?.badge).toBe("9+");
    expect(toolbarActions(idle).find((a) => a.key === "queue")?.badge).toBeUndefined();
  });

  it("reads as the cancel while armed", () => {
    const annotate = toolbarActions({ armed: true, pendingCount: 0 })[0];
    expect(annotate.label).toBe("Cancel");
    expect(annotate.accessibilityLabel).toBe("Cancel annotate mode");
    // ...and nothing else changes: there is no second armed state to confuse
    // it with.
    expect(toolbarActions({ armed: true, pendingCount: 0 }).map((a) => a.key)).toEqual([
      "annotate",
      "queue",
      "comments",
      "settings",
      "collapse",
    ]);
  });
});

describe("width", () => {
  it("adds up padding, items and the gaps between them", () => {
    expect(toolbarWidth(3)).toBe(5 * 2 + 3 * TOOLBAR_ITEM_WIDTH + 2 * 2);
    expect(toolbarWidth(1)).toBe(5 * 2 + TOOLBAR_ITEM_WIDTH);
    expect(toolbarWidth(0)).toBe(0);
  });
});

describe("opening direction", () => {
  const rightDock = { x: SCREEN.width - FAB_INSETS.right - FAB_SIZE, y: 600 };
  const leftDock = { x: FAB_INSETS.left, y: 600 };

  it("opens left from the right edge, keeping that edge put", () => {
    const place = toolbarPlacement(rightDock, SCREEN, 3);
    expect(place.direction).toBe("left");
    // The button's right edge and the toolbar's right edge coincide.
    expect(rightDock.x + place.offsetX + place.width).toBe(rightDock.x + FAB_SIZE);
  });

  it("opens right from the left edge, without moving", () => {
    const place = toolbarPlacement(leftDock, SCREEN, 3);
    expect(place.direction).toBe("right");
    expect(place.offsetX).toBe(0);
  });

  it("decides by the button's centre, like the edge snap does", () => {
    const justLeft = { x: SCREEN.width / 2 - FAB_SIZE / 2 - 1, y: 400 };
    const justRight = { x: SCREEN.width / 2 - FAB_SIZE / 2 + 1, y: 400 };
    expect(toolbarPlacement(justLeft, SCREEN, 3).direction).toBe("right");
    expect(toolbarPlacement(justRight, SCREEN, 3).direction).toBe("left");
  });

  it("stays on screen when the toolbar is wider than the space beside it", () => {
    // Mid-drag the button is not docked yet: a 5-action toolbar opening
    // right from x=100 would run off the right edge, so it slides back.
    const midDrag = { x: 100, y: 400 };
    const place = toolbarPlacement(midDrag, SCREEN, 5);
    expect(place.direction).toBe("right");
    const left = midDrag.x + place.offsetX;
    expect(left).toBeLessThan(midDrag.x);
    expect(left).toBeGreaterThanOrEqual(FAB_INSETS.left);
    expect(left + place.width).toBeLessThanOrEqual(SCREEN.width - FAB_INSETS.right);
  });

  it("pins to the left margin rather than centring an impossible overflow", () => {
    const narrow = { width: 200, height: 844 };
    const place = toolbarPlacement({ x: 150, y: 400 }, narrow, 5);
    expect(150 + place.offsetX).toBe(FAB_INSETS.left);
  });
});

describe("collapse rules", () => {
  it("collapses an open toolbar when the user arms", () => {
    expect(shouldCollapseToolbar(true, true)).toBe(true);
  });

  it("leaves a closed toolbar and an idle open one alone", () => {
    expect(shouldCollapseToolbar(true, false)).toBe(false);
    expect(shouldCollapseToolbar(false, true)).toBe(false);
  });

  it("makes the collapsed button the cancel while armed, the opener otherwise", () => {
    expect(collapsedTapAction(true)).toBe("disarm");
    expect(collapsedTapAction(false)).toBe("expand");
  });
});
