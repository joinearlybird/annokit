/**
 * The composer's flattened surface: the identity line and the two screenshot
 * booleans (available vs attached) that keep "a shot exists" and "the user
 * wants it sent" from collapsing back into one flag.
 */

import { describe, expect, it } from "vitest";
import { CAPTURE_BUSY_BEAT_MS, SCREENSHOT_ATTACHED_BY_DEFAULT, captureIdentityLine, fileBasename, screenshotAttached, screenshotAvailable, screenshotOffered } from "../src/composer-view";

describe("the identity line", () => {
  it("names the element and where it came from, on one line", () => {
    expect(
      captureIdentityLine({
        hit: { element: "PrimaryButton", source: { file: "app/src/components/Card.tsx", line: 3 } },
      }),
    ).toBe("PrimaryButton · Card.tsx:3");
  });

  it("shortens the path to its basename — a phone truncates the useful half otherwise", () => {
    expect(fileBasename("app/src/components/Card.tsx")).toBe("Card.tsx");
    expect(fileBasename("Card.tsx")).toBe("Card.tsx");
    expect(fileBasename("a\\b\\Card.tsx")).toBe("Card.tsx");
    expect(fileBasename("")).toBe("");
  });

  it("falls back to the testID, then the route, then just the name", () => {
    expect(captureIdentityLine({ hit: { element: "Row", testID: "feed-row" } })).toBe(
      "Row · #feed-row",
    );
    expect(captureIdentityLine({ hit: { element: "Row" }, routeName: "/feed" })).toBe(
      "Row · /feed",
    );
    expect(captureIdentityLine({ hit: { element: "Row" } })).toBe("Row");
  });

  it("says Screen when nothing was hit", () => {
    expect(captureIdentityLine({})).toBe("Screen");
    expect(captureIdentityLine({ hit: null, routeName: "/feed" })).toBe("Screen · /feed");
    expect(captureIdentityLine({ hit: { element: "   " }, routeName: "/feed" })).toBe(
      "Screen · /feed",
    );
  });
});

describe("a screenshot that EXISTS is not a screenshot the user WANTS", () => {
  // The eager capture means every sheet opens with a screenshotUri in hand.
  const captured = { screenshotUri: "file:///tmp/shot.png" };
  const none = { screenshotUri: null };

  it("starts OFF, however available the shot is", () => {
    expect(SCREENSHOT_ATTACHED_BY_DEFAULT).toBe(false);
    // The regression in one line: seeding the switch from the capture is what
    // made every sheet open with a screenshot silently attached.
    expect(screenshotAttached(SCREENSHOT_ATTACHED_BY_DEFAULT, captured)).toBe(false);
  });

  it("separates 'there is one to offer' from 'it rides along'", () => {
    // Available: the switch is drawn at all.
    expect(screenshotAvailable(captured)).toBe(true);
    expect(screenshotAvailable(none)).toBe(false);
    expect(screenshotAvailable({})).toBe(false);
    // Attached: it takes BOTH a shot and a user who asked for it.
    expect(screenshotAttached(true, captured)).toBe(true);
    expect(screenshotAttached(false, captured)).toBe(false);
    // Wanting one that was never taken attaches nothing.
    expect(screenshotAttached(true, none)).toBe(false);
  });
});


// ── Opt-in capture ───────────────────────────────────────────────────────
//
// The shot is taken when the switch goes on, so "the switch is drawn" and
// "a shot exists" are different questions. Conflating them is the bug that
// would make the switch never appear: nothing to flip, so nothing taken, so
// nothing to flip.

describe("screenshotOffered vs screenshotAvailable", () => {
  it("offers the switch before any shot has been taken", () => {
    const capture = { canScreenshot: true, screenshotUri: null };
    expect(screenshotOffered(capture)).toBe(true);
    expect(screenshotAvailable(capture)).toBe(false);
  });

  it("does not offer it where a screenshot is impossible", () => {
    // No peer, host turned them off, or an agentation server with no route.
    const capture = { canScreenshot: false, screenshotUri: null };
    expect(screenshotOffered(capture)).toBe(false);
    expect(screenshotAvailable(capture)).toBe(false);
  });

  it("still offers it for a capture that already carries a shot", () => {
    // A shot in hand is self-evidently possible, whatever the flag says.
    expect(screenshotOffered({ screenshotUri: "file:///tmp/a.png" })).toBe(true);
  });

  it("reports availability once the shot arrives", () => {
    const before = { canScreenshot: true, screenshotUri: null };
    const after = { ...before, screenshotUri: "file:///tmp/a.png" };
    expect(screenshotAvailable(before)).toBe(false);
    expect(screenshotAvailable(after)).toBe(true);
  });

  it("attaches only when the user asked AND a shot exists", () => {
    const taken = { canScreenshot: true, screenshotUri: "file:///tmp/a.png" };
    const notTaken = { canScreenshot: true, screenshotUri: null };
    expect(screenshotAttached(true, taken)).toBe(true);
    expect(screenshotAttached(false, taken)).toBe(false);
    // Switch on but the capture failed: nothing rides along.
    expect(screenshotAttached(true, notTaken)).toBe(false);
  });

  it("defaults to off, so nothing is captured without a deliberate tap", () => {
    expect(SCREENSHOT_ATTACHED_BY_DEFAULT).toBe(false);
  });
});

describe("CAPTURE_BUSY_BEAT_MS", () => {
  it("is long enough to register and short enough to stay one gesture", () => {
    // Feedback for a capture can only exist BEFORE the sheet steps out —
    // anything drawn during the shot is in the shot — so this beat is the
    // whole budget for saying "something is happening".
    expect(CAPTURE_BUSY_BEAT_MS).toBeGreaterThanOrEqual(120);
    expect(CAPTURE_BUSY_BEAT_MS).toBeLessThanOrEqual(400);
  });
});

describe("the switch agrees with the file on disk", () => {
  // The reported bug's shape: a screenshot was taken, but the sheet showed
  // no thumbnail. That can only happen when a URI exists while the switch
  // reads off — so under opt-in capture, a URI must be treated as evidence
  // that someone asked for one.
  it("a capture carrying a URI is attached, not merely available", () => {
    const withShot = { canScreenshot: true, screenshotUri: "file:///tmp/a.png" };
    // Whatever the switch state was seeded from, these two must agree:
    // offered (draw it), available (a shot exists), attached (send it).
    expect(screenshotOffered(withShot)).toBe(true);
    expect(screenshotAvailable(withShot)).toBe(true);
    expect(screenshotAttached(true, withShot)).toBe(true);
  });

  it("a capture with no URI is offered but not attached", () => {
    const noShot = { canScreenshot: true, screenshotUri: null };
    expect(screenshotOffered(noShot)).toBe(true);
    expect(screenshotAttached(true, noShot)).toBe(false);
  });
});
