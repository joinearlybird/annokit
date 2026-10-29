/**
 * Push-mode geometry (src/push.ts).
 *
 * The whole feature is one number — how far up to move the app — and every
 * way of getting it wrong is invisible in code review and obvious on a
 * device: move too little and the sheet still covers the element, too much
 * and the app is dragged off the top of the screen, move at all when the
 * inputs are unknown and the highlight detaches from what it highlights.
 * So the clamps get a case each.
 *
 * There is no mode and no toggle any more (src/push.ts): the geometry alone
 * decides, which makes every "returns 0" case below load-bearing — each one
 * is a moment in which the app must sit perfectly still with nobody having
 * asked it to.
 */

import { describe, expect, it } from "vitest";
import { AIM_TOP_MARGIN, composerSheetMaxHeight } from "../src/aim";
import {
  DETAIL_PUSH_SHEET_MAX_RATIO,
  DETAIL_SHEET_MAX_RATIO,
  PUSH_CLEARANCE,
  PUSH_MAX_RATIO,
  PUSH_SHEET_MAX_RATIO,
  PUSH_TOP_INSET,
  appPushTranslation,
  detailPushFrame,
  detailSheetMaxHeight,
  pushedAimBounds,
  sheetMaxHeight,
  COMPOSER_INPUT_MIN_HEIGHT,
  COMPOSER_INPUT_MIN_HEIGHT_COMPACT,
  composerInputMinHeight,
} from "../src/push";

const SCREEN = { width: 402, height: 874 };
/** A sheet + keyboard covering the bottom 500pt of the window. */
const COVERED_TOP = SCREEN.height - 500; // 374

/** An element of `height` whose bottom edge sits at `bottom`. */
function frameEndingAt(bottom: number, height = 56) {
  return { x: 16, y: bottom - height, width: 300, height };
}

describe("appPushTranslation — when it refuses to move", () => {
  it("does not move an element already clear of the covered strip", () => {
    const frame = frameEndingAt(200);
    expect(appPushTranslation({ frame, coveredTop: COVERED_TOP, screen: SCREEN })).toBe(0);
  });

  it("does not move an element whose bottom is exactly one clearance clear", () => {
    const frame = frameEndingAt(COVERED_TOP - PUSH_CLEARANCE);
    expect(appPushTranslation({ frame, coveredTop: COVERED_TOP, screen: SCREEN })).toBe(0);
  });

  it("moves by one point when it is one point short", () => {
    const frame = frameEndingAt(COVERED_TOP - PUSH_CLEARANCE + 1);
    expect(appPushTranslation({ frame, coveredTop: COVERED_TOP, screen: SCREEN })).toBe(1);
  });

  it("behaves like overlay when there is no frame at all", () => {
    expect(appPushTranslation({ frame: null, coveredTop: COVERED_TOP, screen: SCREEN })).toBe(0);
    expect(appPushTranslation({ coveredTop: COVERED_TOP, screen: SCREEN })).toBe(0);
  });

  it("behaves like overlay for a zero-area frame", () => {
    for (const frame of [
      { x: 0, y: 700, width: 0, height: 40 },
      { x: 0, y: 700, width: 300, height: 0 },
    ]) {
      expect(appPushTranslation({ frame, coveredTop: COVERED_TOP, screen: SCREEN })).toBe(0);
    }
  });

  it("behaves like overlay for a frame with non-finite numbers", () => {
    for (const frame of [
      { x: 0, y: Number.NaN, width: 300, height: 40 },
      { x: 0, y: 700, width: Number.POSITIVE_INFINITY, height: 40 },
    ]) {
      expect(appPushTranslation({ frame, coveredTop: COVERED_TOP, screen: SCREEN })).toBe(0);
    }
  });

  it("behaves like overlay when the sheet has not measured itself yet", () => {
    const frame = frameEndingAt(800);
    expect(appPushTranslation({ frame, coveredTop: null, screen: SCREEN })).toBe(0);
    expect(appPushTranslation({ frame, screen: SCREEN })).toBe(0);
    expect(appPushTranslation({ frame, coveredTop: Number.NaN, screen: SCREEN })).toBe(0);
  });

  it("behaves like overlay when nothing is covered", () => {
    const frame = frameEndingAt(800);
    expect(appPushTranslation({ frame, coveredTop: 0, screen: SCREEN })).toBe(0);
    // A covered-top at (or past) the bottom edge covers no pixels.
    expect(appPushTranslation({ frame, coveredTop: SCREEN.height, screen: SCREEN })).toBe(0);
  });

  it("behaves like overlay for a nonsense screen", () => {
    const frame = frameEndingAt(800);
    expect(appPushTranslation({ frame, coveredTop: COVERED_TOP, screen: { width: 0, height: 0 } })).toBe(0);
    expect(
      appPushTranslation({ frame, coveredTop: COVERED_TOP, screen: { width: 402, height: Number.NaN } }),
    ).toBe(0);
  });

  it("does not move an element that is already at (or above) the top keep-out", () => {
    // A tall element pinned to the top: it needs the room, but lifting it
    // would push the thing we are trying to show under the status bar.
    const frame = { x: 0, y: PUSH_TOP_INSET, width: 402, height: 700 };
    expect(appPushTranslation({ frame, coveredTop: COVERED_TOP, screen: SCREEN })).toBe(0);
    expect(
      appPushTranslation({ frame: { ...frame, y: 0 }, coveredTop: COVERED_TOP, screen: SCREEN }),
    ).toBe(0);
  });
});

describe("appPushTranslation — how far it moves", () => {
  it("moves by exactly what the element needs and no more", () => {
    const frame = frameEndingAt(700); // 644..700
    const expected = 700 + PUSH_CLEARANCE - COVERED_TOP;
    expect(appPushTranslation({ frame, coveredTop: COVERED_TOP, screen: SCREEN })).toBe(expected);
  });

  it("leaves the element's bottom exactly one clearance above the sheet", () => {
    const frame = frameEndingAt(700);
    const push = appPushTranslation({ frame, coveredTop: COVERED_TOP, screen: SCREEN });
    expect(frame.y + frame.height - push).toBe(COVERED_TOP - PUSH_CLEARANCE);
  });

  it("honours a caller's own clearance", () => {
    const frame = frameEndingAt(700);
    expect(appPushTranslation({ frame, coveredTop: COVERED_TOP, screen: SCREEN, clearance: 0 })).toBe(
      700 - COVERED_TOP,
    );
  });

  it("never lifts the element past the top keep-out", () => {
    // Deep element, tiny remaining screen: the need far outruns the
    // headroom. maxRatio is lifted out of the way so this case isolates the
    // headroom clamp (the ratio backstop has a case of its own below).
    // A tall element (200pt) low on the screen, under a sheet covering all
    // but the top 120: no translation can show all of it.
    const frame = frameEndingAt(860, 200); // y = 660
    const push = appPushTranslation({ frame, coveredTop: 120, screen: SCREEN, maxRatio: 1 });
    expect(push).toBe(frame.y - PUSH_TOP_INSET);
    // Clamped: the element ends AT the keep-out line, never above it.
    expect(frame.y - push).toBe(PUSH_TOP_INSET);
    // And accepts partial visibility rather than distorting anything.
    expect(frame.y + frame.height - push).toBeGreaterThan(120);
  });

  it("never moves more than its share of the window", () => {
    // Headroom is plentiful (a very tall window), so the ratio is what binds.
    const tall = { width: 402, height: 2000 };
    const frame = frameEndingAt(1900, 40);
    const push = appPushTranslation({ frame, coveredTop: 200, screen: tall });
    expect(push).toBe(Math.round(tall.height * PUSH_MAX_RATIO));
    expect(push).toBeLessThan(frame.y - PUSH_TOP_INSET);
  });

  it("clears a bottom-row element with the keyboard up on a phone", () => {
    // The case the feature exists for: sheet (~260) + keyboard (~336).
    const covered = 260 + 336;
    const coveredTop = SCREEN.height - covered; // 278
    const frame = frameEndingAt(SCREEN.height - 40, 56); // the last row
    const push = appPushTranslation({ frame, coveredTop, screen: SCREEN });
    expect(push).toBeGreaterThan(0);
    expect(frame.y + frame.height - push).toBeLessThanOrEqual(coveredTop);
    expect(frame.y - push).toBeGreaterThanOrEqual(PUSH_TOP_INSET);
  });

  it("always returns a whole number of points", () => {
    const frame = { x: 0, y: 700.4, width: 300, height: 55.3 };
    const push = appPushTranslation({ frame, coveredTop: 373.7, screen: SCREEN });
    expect(Number.isInteger(push)).toBe(true);
  });

  it("is never negative, whatever it is handed", () => {
    const cases = [
      { frame: frameEndingAt(100), coveredTop: COVERED_TOP },
      { frame: frameEndingAt(870), coveredTop: 10 },
      { frame: { x: 0, y: -200, width: 300, height: 40 }, coveredTop: COVERED_TOP },
    ];
    for (const c of cases) {
      expect(appPushTranslation({ ...c, screen: SCREEN })).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("pushedAimBounds", () => {
  it("is the identity when nothing has moved", () => {
    expect(pushedAimBounds(0, 374)).toEqual({ topMargin: AIM_TOP_MARGIN, occludedTop: 374 });
  });

  it("carries both limits up with the layer", () => {
    // A chip placed at y appears at y - 200, so both bounds shift by 200.
    expect(pushedAimBounds(200, 374)).toEqual({
      topMargin: AIM_TOP_MARGIN + 200,
      occludedTop: 574,
    });
  });

  it("keeps an unknown occlusion unknown", () => {
    expect(pushedAimBounds(200, undefined).occludedTop).toBeUndefined();
  });

  it("ignores a nonsense push rather than shifting by NaN", () => {
    expect(pushedAimBounds(Number.NaN, 374)).toEqual({ topMargin: AIM_TOP_MARGIN, occludedTop: 374 });
    expect(pushedAimBounds(-40, 374)).toEqual({ topMargin: AIM_TOP_MARGIN, occludedTop: 374 });
  });
});

describe("sheetMaxHeight", () => {
  it("is the unchanged composer ceiling when nothing is being pushed", () => {
    expect(sheetMaxHeight(SCREEN.height, false)).toBe(composerSheetMaxHeight(SCREEN.height));
  });

  it("is smaller while pushing, so the app that was moved stays visible", () => {
    const push = sheetMaxHeight(SCREEN.height, true);
    expect(push).toBe(Math.floor(SCREEN.height * PUSH_SHEET_MAX_RATIO));
    expect(push).toBeLessThan(sheetMaxHeight(SCREEN.height, false));
  });

  it("never returns a negative or nonsense ceiling", () => {
    expect(sheetMaxHeight(0, true)).toBe(0);
    expect(sheetMaxHeight(-100, true)).toBe(0);
    expect(sheetMaxHeight(Number.NaN, true)).toBe(0);
  });
});

/**
 * THE DETAIL PANES push against a frame the SERVER stored, not one measured
 * a moment ago, and every way that can be wrong has to end in "do not move
 * the app": an item from another screen, an item the server kept no frame
 * for, a frame from another layout entirely (a rotation, a bigger device on
 * the same session). Nobody opted in, so there is no toggle to blame and no
 * disabled state to explain it — a pane that cannot place its element opens
 * over an app that simply does not move.
 */
describe("detailPushFrame — what a detail pane may push", () => {
  const BOX = { x: 16, y: 620, width: 370, height: 56 };

  it("pushes the stored frame when it is on this screen", () => {
    const frame = detailPushFrame({ routeName: "/feed", boundingBox: BOX }, "/feed", SCREEN);
    expect(frame).toEqual(BOX);
    // And it is a frame `appPushTranslation` will actually act on.
    expect(appPushTranslation({ frame, coveredTop: COVERED_TOP, screen: SCREEN })).toBeGreaterThan(0);
  });

  it("hands back a copy, so nothing can mutate the stored annotation", () => {
    const subject = { routeName: "/feed", boundingBox: { ...BOX } };
    expect(detailPushFrame(subject, "/feed", SCREEN)).not.toBe(subject.boundingBox);
  });

  it("refuses an item captured on another screen", () => {
    const frame = detailPushFrame({ routeName: "/settings", boundingBox: BOX }, "/feed", SCREEN);
    expect(frame).toBeNull();
    // Which is the whole point: nothing can be computed from it.
    expect(appPushTranslation({ frame, coveredTop: COVERED_TOP, screen: SCREEN })).toBe(0);
  });

  it("treats an unknown route on either side as this screen, exactly like the markers", () => {
    // `visibleMarkers` filters only when BOTH sides know their route, so a
    // note that is drawn on this screen can also be pushed on it.
    expect(detailPushFrame({ boundingBox: BOX }, "/feed", SCREEN)).toEqual(BOX);
    expect(detailPushFrame({ routeName: "/feed", boundingBox: BOX }, null, SCREEN)).toEqual(BOX);
  });

  it("refuses when the server kept no frame", () => {
    for (const subject of [{ routeName: "/feed" }, { routeName: "/feed", boundingBox: null }, null, undefined]) {
      expect(detailPushFrame(subject, "/feed", SCREEN)).toBeNull();
    }
  });

  it("refuses a degenerate or non-finite stored frame", () => {
    for (const box of [
      { x: 16, y: 620, width: 0, height: 56 },
      { x: 16, y: 620, width: 370, height: 0 },
      { x: 16, y: Number.NaN, width: 370, height: 56 },
      { x: 16, y: 620, width: Number.POSITIVE_INFINITY, height: 56 },
    ]) {
      expect(detailPushFrame({ routeName: "/feed", boundingBox: box }, "/feed", SCREEN)).toBeNull();
    }
  });

  it("refuses a frame that cannot belong to this window", () => {
    // STALE IN THE ONLY WAY WE CAN DETECT. Scrolling moves a frame without
    // telling us; a rotation, a foldable or a capture from a larger device
    // leaves one that does not fit the window at all, and pushing "far
    // enough to bring it back" would fling the app.
    for (const box of [
      { x: 16, y: SCREEN.height + 40, width: 370, height: 56 }, // entirely below the fold
      { x: SCREEN.width + 10, y: 400, width: 300, height: 56 }, // off to the right
      { x: 16, y: -200, width: 370, height: 100 }, // entirely above the top
      { x: 0, y: 400, width: SCREEN.width * 2, height: 56 }, // a landscape width
      { x: 0, y: 100, width: 300, height: SCREEN.height * 2 }, // a taller screen's element
    ]) {
      expect(detailPushFrame({ routeName: "/feed", boundingBox: box }, "/feed", SCREEN)).toBeNull();
    }
  });

  it("accepts a frame that merely overhangs the edge", () => {
    // Ordinary: a full-bleed row whose last pixels are past the bottom.
    const box = { x: -4, y: SCREEN.height - 20, width: SCREEN.width + 8, height: 56 };
    expect(detailPushFrame({ routeName: "/feed", boundingBox: box }, "/feed", SCREEN)).toEqual(box);
  });

  it("refuses everything when the screen itself is nonsense", () => {
    expect(
      detailPushFrame({ routeName: "/feed", boundingBox: BOX }, "/feed", {
        width: Number.NaN,
        height: 874,
      }),
    ).toBeNull();
  });
});

describe("detailSheetMaxHeight", () => {
  it("keeps the pane's usual ceiling when nothing is being pushed", () => {
    expect(detailSheetMaxHeight(SCREEN.height, false)).toBe(
      Math.floor(SCREEN.height * DETAIL_SHEET_MAX_RATIO),
    );
  });

  it("gives the app room back while pushing", () => {
    const push = detailSheetMaxHeight(SCREEN.height, true);
    expect(push).toBe(Math.floor(SCREEN.height * DETAIL_PUSH_SHEET_MAX_RATIO));
    expect(push).toBeLessThan(detailSheetMaxHeight(SCREEN.height, false));
    // Still a reading surface, unlike the composer's tighter ceiling.
    expect(push).toBeGreaterThan(sheetMaxHeight(SCREEN.height, true));
  });

  it("never returns a nonsense ceiling", () => {
    for (const h of [0, -100, Number.NaN]) {
      expect(detailSheetMaxHeight(h, true)).toBe(0);
      expect(detailSheetMaxHeight(h, false)).toBe(0);
    }
  });
});

describe("the composer's input floor", () => {
  it("starts at three lines when the sheet has its full height", () => {
    expect(composerInputMinHeight(false)).toBe(COMPOSER_INPUT_MIN_HEIGHT);
  });

  it("starts at one line while the app is pushed", () => {
    // The compact ceiling leaves ~100pt of scroll body. A 72pt field plus a
    // 44pt attach row does not fit in it, and what the user saw was the row
    // sliced in half — so the field gives up the two lines it was not using
    // yet. It still grows with the text.
    expect(composerInputMinHeight(true)).toBe(COMPOSER_INPUT_MIN_HEIGHT_COMPACT);
    expect(COMPOSER_INPUT_MIN_HEIGHT_COMPACT).toBeLessThan(COMPOSER_INPUT_MIN_HEIGHT);
  });

  it("leaves the attach row room inside the compact body", () => {
    // The arithmetic the fix turns on, so it cannot rot silently: sheet
    // ceiling, minus the chrome above and the pinned actions below, has to
    // hold the field AND a whole 44pt row.
    const body = sheetMaxHeight(874, true) - COMPOSER_CHROME - PINNED_ACTIONS;
    expect(body).toBeGreaterThanOrEqual(composerInputMinHeight(true) + ATTACH_ROW);
  });
});

/** Grabber + identity line + the sheet's own vertical padding. */
const COMPOSER_CHROME = 65;
/** The destination segments and the submit button, pinned under the body. */
const PINNED_ACTIONS = 100;
/** "+ Attach", the Screenshot switch, and the gap above them. */
const ATTACH_ROW = 44;
