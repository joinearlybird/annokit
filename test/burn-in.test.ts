/** The number the burned-in badge wears (src/marker-hit.ts, nextMarkerNumber): one past the markers on screen. */

import { describe, expect, it } from "vitest";
import { nextMarkerNumber } from "../src/marker-hit";
import { SCREENSHOT_MARKS } from "../src/submit";
import { annotationScreenshotPath, marksQuery } from "../src/url";
import { commentScreenshotPath } from "../src/comments";

const tasks = [
  { id: "a", x: 1, y: 2, routeName: "/home" },
  { id: "b", x: 3, y: 4, routeName: "/home" },
  { id: "c", x: 5, y: 6, routeName: "/other" },
  { id: "d", x: 7, y: 8, routeName: "/home", sourceCommentId: "note-1" },
  { id: "e", routeName: "/home" },
];

describe("nextMarkerNumber", () => {
  it("is one past the markers drawn on this screen", () => {
    expect(nextMarkerNumber(tasks, "/home")).toBe(3);
    expect(nextMarkerNumber(tasks, "/other")).toBe(2);
    expect(nextMarkerNumber([], "/home")).toBe(1);
  });

  it("skips what the marker layer skips: untrusted positions, note-made tasks, other routes, no position", () => {
    expect(nextMarkerNumber(tasks, "/home", (id) => id !== "a")).toBe(2);
    expect(nextMarkerNumber(tasks, "/home", () => false)).toBe(1);
    expect(nextMarkerNumber(tasks, null)).toBe(4);
  });
});

describe("the upload says what was drawn into the shot", () => {
  it("appends the marks as a query, and nothing when there are none", () => {
    expect(marksQuery("badge,outline")).toBe("?marks=badge%2Coutline");
    expect(marksQuery(undefined)).toBe("");
    expect(annotationScreenshotPath("a1", SCREENSHOT_MARKS)).toBe("/annotations/a1/screenshot?marks=badge%2Coutline");
    expect(annotationScreenshotPath("a1")).toBe("/annotations/a1/screenshot");
    expect(commentScreenshotPath("c1", SCREENSHOT_MARKS)).toBe("/comments/c1/screenshot?marks=badge%2Coutline");
    expect(commentScreenshotPath("c1")).toBe("/comments/c1/screenshot");
  });
});
