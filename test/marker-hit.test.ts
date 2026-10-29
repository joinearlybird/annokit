/**
 * Marker geometry and marker tap resolution (src/marker-hit.ts).
 *
 * A marker is 22pt of purple sitting on top of the user's app, and tapping
 * it now opens something. That makes three things worth pinning down, none
 * of which can be seen by looking at the rendered dot:
 *
 *  - the TOUCH TARGET is bigger than the dot, and the dot never grows;
 *  - when targets overlap, which annotation opens is a rule (visible dot
 *    beats invisible padding, newest beats older) rather than whichever
 *    sibling react-native handed the touch to;
 *  - markers are inert while ARMED, because a touchable view over the app
 *    would eat the aim gesture before src/capture.tsx could claim it.
 *
 * Plus the deletion case: a detail pane open on an annotation that no
 * longer exists must resolve to nothing, not to stale content.
 */

import { describe, expect, it } from "vitest";
import {
  MARKER_MIN_TOUCH,
  MARKER_SIZE,
  combineMarkers,
  markerAppearance,
  markerWorking,
  markerTouchPadding,
  markerTouchSize,
  markersInteractive,
  pickMarkerAt,
  resolveOpenMarker,
  visibleMarkers,
} from "../src/marker-hit";
import type { MarkerPlacement } from "../src/marker-hit";

const at = (id: string, x: number, y: number, number = 1): MarkerPlacement => ({
  id,
  x,
  y,
  number,
  kind: "annotation",
});
const comment = (id: string, x: number, y: number, number = 1): MarkerPlacement => ({
  id,
  x,
  y,
  number,
  kind: "comment",
});

describe("touch target sizing", () => {
  it("grows the 22pt dot to a 44pt target", () => {
    expect(markerTouchPadding()).toBe(11);
    expect(markerTouchSize()).toBe(MARKER_MIN_TOUCH);
  });

  it("never shrinks a target below the dot it wraps", () => {
    // A dot bigger than the minimum keeps its own size; negative padding
    // would make part of what the user can see untappable.
    expect(markerTouchPadding(60, 44)).toBe(0);
    expect(markerTouchSize(60, 44)).toBe(60);
  });

  it("leaves the visible dot alone", () => {
    // The guard that matters: this constant is what markers.tsx draws, and
    // growing it to fix a touch problem would cover the annotated element.
    expect(MARKER_SIZE).toBe(22);
  });
});

describe("visible markers", () => {
  it("skips annotations with no captured point", () => {
    const out = visibleMarkers([{ id: "a", x: 10, y: 10 }, { id: "b" }, { id: "c", x: 5 }], null);
    expect(out.map((m) => m.id)).toEqual(["a"]);
  });

  it("numbers by position in the visible list, not the input list", () => {
    const out = visibleMarkers(
      [{ id: "a" }, { id: "b", x: 1, y: 1 }, { id: "c", x: 2, y: 2 }],
      null,
    );
    expect(out.map((m) => m.number)).toEqual([1, 2]);
  });

  it("hides markers made on another route", () => {
    const list = [
      { id: "here", x: 1, y: 1, routeName: "/feed" },
      { id: "there", x: 2, y: 2, routeName: "/settings" },
    ];
    expect(visibleMarkers(list, "/feed").map((m) => m.id)).toEqual(["here"]);
  });

  it("shows everything when either side does not know its route", () => {
    const list = [{ id: "a", x: 1, y: 1 }, { id: "b", x: 2, y: 2, routeName: "/settings" }];
    expect(visibleMarkers(list, null)).toHaveLength(2);
    expect(visibleMarkers(list, "/feed").map((m) => m.id)).toEqual(["a"]);
  });
});

describe("one marker per anchored thing", () => {
  // A task made from a team note's message sits on the SAME element as the
  // note, so it gets no mark of its own: the note's marker (with its violet
  // task pip) is the one mark there, and tapping it opens the discussion.

  it("gives a task made from a note no marker of its own", () => {
    const out = visibleMarkers(
      [{ id: "direct", x: 10, y: 10 }, { id: "from-note", x: 10, y: 10, sourceCommentId: "c1" }],
      null,
    );
    expect(out.map((m) => m.id)).toEqual(["direct"]);
  });

  it("keeps a task written directly on the screen", () => {
    const out = visibleMarkers([{ id: "direct", x: 10, y: 10 }], null);
    expect(out.map((m) => m.id)).toEqual(["direct"]);
  });

  it("treats an empty back-link as no back-link", () => {
    // A server that sends "" rather than omitting the field must not make a
    // directly-written task disappear off the screen.
    const out = visibleMarkers([{ id: "a", x: 1, y: 1, sourceCommentId: "" }], null);
    expect(out.map((m) => m.id)).toEqual(["a"]);
  });

  it("numbers the displayed markers 1..N with no gaps", () => {
    // The excluded task must not burn a numeral: a badge reading 1, 3 asks
    // about a marker number 2 that is nowhere on the screen.
    const out = visibleMarkers(
      [
        { id: "a", x: 1, y: 1 },
        { id: "from-note", x: 2, y: 2, sourceCommentId: "c1" },
        { id: "b", x: 3, y: 3 },
        { id: "c", x: 4, y: 4 },
      ],
      null,
    );
    expect(out.map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(out.map((m) => m.number)).toEqual([1, 2, 3]);
  });

  it("resolves a tap at the shared point to the NOTE, not the task", () => {
    // The bug: the task's violet dot stacked on the note's amber square and,
    // by the exact-overlap rule, won every tap — so the note was unreachable.
    const merged = combineMarkers(
      visibleMarkers([{ id: "task", x: 100, y: 100, sourceCommentId: "c1" }], null),
      visibleMarkers([{ id: "c1", x: 100, y: 100 }], null, "comment"),
    );
    expect(merged.map((m) => m.id)).toEqual(["c1"]);
    const picked = pickMarkerAt(merged, 100, 100);
    expect(picked?.id).toBe("c1");
    expect(picked?.kind).toBe("comment");
  });
});

describe("armed gating", () => {
  it("is interactive only when idle", () => {
    expect(markersInteractive(false)).toBe(true);
    expect(markersInteractive(true)).toBe(false);
  });
});

describe("overlap priority", () => {
  it("opens the marker whose dot was tapped", () => {
    const markers = [at("a", 100, 100, 1), at("b", 200, 200, 2)];
    expect(pickMarkerAt(markers, 100, 100)?.id).toBe("a");
    expect(pickMarkerAt(markers, 200, 205)?.id).toBe("b");
  });

  it("hits the grown target well outside the dot", () => {
    const markers = [at("a", 100, 100)];
    // 20pt out: past the 11pt dot radius, inside the 22pt touch half-width.
    expect(pickMarkerAt(markers, 120, 100)?.id).toBe("a");
    expect(pickMarkerAt(markers, 100, 120)?.id).toBe("a");
  });

  it("ignores the corners of the dot's bounding box", () => {
    // Diagonally 10pt out on each axis is inside the 22pt square but
    // outside the round dot — it must not count as a DOT hit.
    const markers = [at("old", 100, 100, 1), at("new", 118, 118, 2)];
    // (110,110) is 14.1pt from `old` (padding only) and 11.3pt from `new`
    // (also padding only): the tie breaks to the newer one.
    expect(pickMarkerAt(markers, 110, 110)?.id).toBe("new");
  });

  it("prefers the dot you can see over an overlapping invisible target", () => {
    // `new` is newer and its 44pt target covers `old`'s dot, but the tap
    // landed on the dot the user was aiming at.
    const markers = [at("old", 100, 100, 1), at("new", 118, 100, 2)];
    expect(pickMarkerAt(markers, 100, 100)?.id).toBe("old");
  });

  it("gives overlapping dots to the newest (topmost) one", () => {
    const markers = [at("old", 100, 100, 1), at("new", 104, 100, 2)];
    // Inside both dots; the newer marker is drawn on top, so it wins.
    expect(pickMarkerAt(markers, 102, 100)?.id).toBe("new");
  });

  it("is deterministic across three stacked markers", () => {
    const markers = [at("a", 100, 100, 1), at("b", 101, 100, 2), at("c", 102, 100, 3)];
    expect(pickMarkerAt(markers, 101, 100)?.id).toBe("c");
    // …and it is the same answer whichever marker asked.
    expect(pickMarkerAt(markers, 101, 100)?.id).toBe("c");
  });

  it("returns null outside every target, so the caller can fall back", () => {
    expect(pickMarkerAt([at("a", 100, 100)], 400, 400)).toBeNull();
    expect(pickMarkerAt([], 100, 100)).toBeNull();
  });

  it("returns null for a touch with no usable coordinates", () => {
    // Web/react-native-web events have been seen without pageX; the caller
    // then opens the marker that was actually pressed rather than nothing.
    expect(pickMarkerAt([at("a", 100, 100)], Number.NaN, 100)).toBeNull();
    expect(pickMarkerAt([at("a", 100, 100)], 100, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("two kinds of marker", () => {
  it("tags each placement with the list it came from", () => {
    expect(visibleMarkers([{ id: "a", x: 1, y: 1 }], null)[0].kind).toBe("annotation");
    expect(visibleMarkers([{ id: "c", x: 1, y: 1 }], null, "comment")[0].kind).toBe("comment");
  });

  it("numbers each kind separately", () => {
    // Comments must not push the annotation numbers along: those numerals
    // are what the user reads in the queue.
    const annotations = visibleMarkers([{ id: "a", x: 1, y: 1 }, { id: "b", x: 2, y: 2 }], null);
    const comments = visibleMarkers([{ id: "c", x: 3, y: 3 }], null, "comment");
    expect(annotations.map((m) => m.number)).toEqual([1, 2]);
    expect(comments.map((m) => m.number)).toEqual([1]);
  });

  it("filters comments by route exactly like annotations", () => {
    const list = [
      { id: "here", x: 1, y: 1, routeName: "/feed" },
      { id: "there", x: 2, y: 2, routeName: "/settings" },
    ];
    expect(visibleMarkers(list, "/feed", "comment").map((m) => m.id)).toEqual(["here"]);
  });

  it("carries the comment status through for the appearance", () => {
    const out = visibleMarkers([{ id: "c", x: 1, y: 1, status: "resolved" }], null, "comment");
    expect(out[0].status).toBe("resolved");
  });
});

describe("appearance", () => {
  it("tells the kinds apart by shape AND colour, not colour alone", () => {
    const annotation = markerAppearance("annotation");
    const commentLook = markerAppearance("comment");
    expect(annotation.shape).toBe("circle");
    expect(commentLook.shape).toBe("square");
    expect(annotation.fill).not.toBe(commentLook.fill);
  });

  it("keeps annotations at full strength (a pending annotation is always live)", () => {
    expect(markerAppearance("annotation").opacity).toBe(1);
    // An annotation has no comment status; passing one changes nothing.
    expect(markerAppearance("annotation", "resolved").opacity).toBe(1);
  });

  it("fades a settled comment rather than hiding it", () => {
    expect(markerAppearance("comment", "open").opacity).toBe(1);
    expect(markerAppearance("comment", "resolved").opacity).toBeLessThan(1);
    expect(markerAppearance("comment", "converted").opacity).toBeLessThan(1);
    // Still drawn: a resolved comment must remain findable and reopenable.
    expect(markerAppearance("comment", "resolved").opacity).toBeGreaterThan(0);
  });

  it("keeps a settled comment recognisable as a comment", () => {
    expect(markerAppearance("comment", "resolved").fill).toBe(markerAppearance("comment").fill);
    expect(markerAppearance("comment", "converted").shape).toBe("square");
  });
});

describe("both kinds, one tap rule", () => {
  it("draws comments under annotations", () => {
    const merged = combineMarkers([at("a", 10, 10)], [comment("c", 20, 20)]);
    expect(merged.map((m) => m.id)).toEqual(["c", "a"]);
  });

  it("gives an exact overlap to the annotation", () => {
    // Both dots contain the point; the annotation is the one the agent will
    // act on, so it must not be the unreachable one.
    const merged = combineMarkers([at("a", 100, 100)], [comment("c", 100, 100)]);
    expect(pickMarkerAt(merged, 100, 100)?.id).toBe("a");
  });

  it("still prefers a comment DOT over an annotation's invisible padding", () => {
    // Tier 1 beats tier 2 regardless of kind: you tapped a dot you can see.
    const merged = combineMarkers([at("a", 118, 100)], [comment("c", 100, 100)]);
    expect(pickMarkerAt(merged, 100, 100)?.id).toBe("c");
  });

  it("opens a comment when only the comment was hit", () => {
    const merged = combineMarkers([at("a", 300, 300)], [comment("c", 100, 100)]);
    expect(pickMarkerAt(merged, 100, 100)?.kind).toBe("comment");
  });

  it("is a plain concatenation when one side is empty", () => {
    expect(combineMarkers([], [comment("c", 1, 1)]).map((m) => m.id)).toEqual(["c"]);
    expect(combineMarkers([at("a", 1, 1)], []).map((m) => m.id)).toEqual(["a"]);
    expect(combineMarkers([], [])).toEqual([]);
  });
});

describe("open detail vs deletion", () => {
  const list = [{ id: "a" }, { id: "b" }];

  it("resolves the open annotation", () => {
    expect(resolveOpenMarker(list, "b")?.id).toBe("b");
  });

  it("resolves to nothing when nothing is open", () => {
    expect(resolveOpenMarker(list, null)).toBeNull();
  });

  it("goes null when the annotation is deleted underneath the detail", () => {
    // Deleted from the queue while its marker detail was open: the pane
    // closes rather than showing a row the server no longer has.
    expect(resolveOpenMarker([{ id: "a" }], "b")).toBeNull();
    expect(resolveOpenMarker([], "b")).toBeNull();
  });
});

describe("markerWorking", () => {
  it("marks a task's own marker while it is working, and not otherwise", () => {
    expect(markerWorking({ id: "a1", kind: "annotation", status: "working" })).toBe(true);
    expect(markerWorking({ id: "a1", kind: "annotation", status: "pending" })).toBe(false);
  });

  it("marks a note whose task is working, since that task has no marker", () => {
    const working = new Set(["c1"]);
    expect(markerWorking({ id: "c1", kind: "comment", status: "open" }, working)).toBe(true);
    expect(markerWorking({ id: "c2", kind: "comment", status: "open" }, working)).toBe(false);
    expect(markerWorking({ id: "c1", kind: "comment", status: "open" })).toBe(false);
  });
});
