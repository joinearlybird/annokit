/**
 * The team-notes list (src/notes-list.ts).
 *
 * This list is the reason a note left on another screen is reachable at all,
 * so the cases that matter are: does a note from every route actually get a
 * row, does the screen you are standing on come first, and — the interesting
 * one — what does tapping a row DO. `noteJumpPlan` has three answers (same
 * route, other route with a router, other route without one) and only one of
 * them is the happy path; the other two are the ones that would otherwise
 * fail silently on a host that has no expo-router.
 */

import { describe, expect, it } from "vitest";
import type { Comment } from "../src/comments";
import {
  buildNoteRows,
  groupNotesByRoute,
  noteJumpPlan,
  noteRowLabel,
  notesEmptyText,
  openNoteCount,
  openNoteRows,
  replyCount,
  replyCountLabel,
  routeLabel,
} from "../src/notes-list";

const msg = (id: string, content: string, name = "Ada") => ({
  id,
  content,
  author: { id: "u1", name },
});

const note = (
  id: string,
  routeName: string | undefined,
  status: Comment["status"] = "open",
  messages = [msg(`${id}-m`, `note ${id}`)],
): Comment => ({
  id,
  routeName,
  status,
  element: "Header",
  author: { id: "u1", name: "Ada" },
  messages,
});

describe("the rows", () => {
  it("carries what the row shows: text, author, route, replies, status", () => {
    const row = buildNoteRows([
      note("c1", "/settings", "open", [
        msg("m1", "is this copy right?"),
        msg("m2", "I think so", "Dana"),
      ]),
    ])[0];
    expect(row.text).toBe("is this copy right?");
    expect(row.author).toBe("Ada");
    expect(row.routeName).toBe("/settings");
    expect(row.element).toBe("Header");
    expect(row.replyCount).toBe(1);
    expect(row.status).toBe("Open");
    expect(row.settled).toBe(false);
  });

  it("counts replies AFTER the opening message, ignoring blank ones", () => {
    expect(replyCount({ messages: [msg("m1", "one")] })).toBe(0);
    expect(replyCount({ messages: [] })).toBe(0);
    expect(
      replyCount({ messages: [msg("m1", "one"), msg("m2", "   "), msg("m3", "two")] }),
    ).toBe(1);
    expect(replyCountLabel(0)).toBe("");
    expect(replyCountLabel(1)).toBe("1 reply");
    expect(replyCountLabel(3)).toBe("3 replies");
  });

  it("dims the settled ones rather than hiding them", () => {
    const rows = buildNoteRows([
      note("c1", "/", "open"),
      note("c2", "/", "resolved"),
      note("c3", "/", "converted"),
    ]);
    expect(rows.map((r) => r.settled)).toEqual([false, true, true]);
    // A converted note shows no word at all — dimming is what says it now.
    expect(rows.map((r) => r.status)).toEqual(["Open", "Resolved", ""]);
    // ...but the screen reader, which cannot see dimming, still hears it.
    expect(rows.map((r) => r.statusA11y)).toEqual([
      "Open",
      "Resolved",
      "Given to the agent",
    ]);
    // Still every one of them present: the list is what was SAID, decisions
    // included.
    expect(rows).toHaveLength(3);
    expect(openNoteRows(rows).map((r) => r.id)).toEqual(["c1"]);
  });

  it("never renders a blank row, and skips one with no id", () => {
    const silent = { ...note("c1", "/"), messages: [] };
    const rows = buildNoteRows([silent, null as unknown as Comment]);
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe("(empty comment)");
  });

  it("says something for a note the server stored with no route", () => {
    expect(routeLabel(undefined)).toBe("No screen recorded");
    // ...and the root reads the same word here as it does in a detail pane,
    // rather than heading a group with a single slash.
    expect(routeLabel("/")).toBe("Home");
    expect(routeLabel("/settings")).toBe("/settings");
    expect(buildNoteRows([note("c1", undefined)])[0].routeLabel).toBe("No screen recorded");
  });

  it("reads as one sentence to a screen reader", () => {
    const row = buildNoteRows([
      note("c1", "/settings", "open", [msg("m1", "is this copy right?"), msg("m2", "yes")]),
    ])[0];
    const label = noteRowLabel(row);
    expect(label).toContain("Ada");
    expect(label).toContain("is this copy right?");
    expect(label).toContain("/settings");
    expect(label).toContain("1 reply");
    expect(label).toContain("Open");
  });
});

describe("grouping", () => {
  const notes = [
    note("c1", "/settings"),
    note("c2", "/"),
    note("c3", "/settings"),
    note("c4", "/profile"),
  ];

  it("puts the screen you are standing on first, the rest alphabetically", () => {
    const groups = groupNotesByRoute(buildNoteRows(notes), "/settings");
    expect(groups.map((g) => g.routeName)).toEqual(["/settings", "/", "/profile"]);
    expect(groups[0].current).toBe(true);
    expect(groups[0].rows.map((r) => r.id)).toEqual(["c1", "c3"]);
    expect(groups.slice(1).every((g) => !g.current)).toBe(true);
  });

  it("is stable when you are standing somewhere with no notes", () => {
    const groups = groupNotesByRoute(buildNoteRows(notes), "/nothing-here");
    expect(groups.map((g) => g.routeName)).toEqual(["/", "/profile", "/settings"]);
    expect(groups.some((g) => g.current)).toBe(false);
  });

  it("sinks the routeless notes to the bottom — nothing can be done with them", () => {
    const groups = groupNotesByRoute(
      buildNoteRows([note("c0", undefined), note("c1", "/settings")]),
      null,
    );
    expect(groups.map((g) => g.routeName)).toEqual(["/settings", ""]);
    expect(groups[1].label).toBe("No screen recorded");
  });

  it("counts the OPEN notes for the toolbar, not every note ever left", () => {
    expect(openNoteCount([note("c1", "/"), note("c2", "/", "resolved")])).toBe(1);
    expect(openNoteCount([])).toBe(0);
  });
});

describe("going to a note", () => {
  const here = { routeName: "/settings" };
  const elsewhere = { routeName: "/profile" };

  it("just opens it when it is on this screen — and says so", () => {
    const plan = noteJumpPlan(here, "/settings", true);
    expect(plan).toEqual({
      navigate: false,
      targetRoute: "/settings",
      open: true,
      sameRoute: true,
    });
  });

  it("navigates first when it is somewhere else", () => {
    const plan = noteJumpPlan(elsewhere, "/settings", true);
    expect(plan.navigate).toBe(true);
    expect(plan.targetRoute).toBe("/profile");
    expect(plan.open).toBe(true);
    expect(plan.sameRoute).toBe(false);
  });

  it("still opens the note on a host with no router, and says why it did not jump", () => {
    // The degraded path: reading the note is the point; landing on its
    // screen is the bonus. It must never be the thing that stops the tap.
    const plan = noteJumpPlan(elsewhere, "/settings", false);
    expect(plan.navigate).toBe(false);
    expect(plan.open).toBe(true);
    expect(plan.note).toContain("/profile");
    expect(plan.note?.toLowerCase()).toContain("router");
  });

  it("opens a routeless note without pretending it could navigate", () => {
    const plan = noteJumpPlan({ routeName: "" }, "/settings", true);
    expect(plan.navigate).toBe(false);
    expect(plan.targetRoute).toBeNull();
    expect(plan.open).toBe(true);
    expect(plan.note).toBeTruthy();
  });

  it("treats an unknown current route as 'not here'", () => {
    // No expo-router at all: every note is elsewhere, and none of them can
    // be jumped to either.
    expect(noteJumpPlan(elsewhere, null, false).navigate).toBe(false);
    expect(noteJumpPlan(elsewhere, null, false).open).toBe(true);
  });
});

describe("the empty state", () => {
  it("teaches how a note gets here", () => {
    expect(notesEmptyText(true)).toContain("No team notes yet");
    expect(notesEmptyText(true)).toContain("Team");
  });

  it("distinguishes 'none yet' from 'this server has no comment routes'", () => {
    expect(notesEmptyText(false)).toContain("unavailable");
  });
});
