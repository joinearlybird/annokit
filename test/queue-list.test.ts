/**
 * The queue's row vocabulary (src/queue-list.ts).
 *
 * `buildTaskRows` is what the panel actually renders — the queue is the
 * send-to-the-agent workflow and lists agent tasks only. The mixed builders
 * below it are still exported (a notes list may want them) and still covered,
 * but nothing draws them today.
 *
 * The dangerous part is the Send button. It sends AGENT TASKS, exactly the
 * ticked ones — so a label that counted rows it would never send, or a box
 * left empty beside a task it would, is a lie the user only discovers after
 * the agent runs. Those are the cases below.
 */

import { describe, expect, it } from "vitest";
import type { Comment } from "../src/comments";
import type { ServerAnnotation } from "../src/types";
import {
  agentTaskCount,
  detailSendLabel,
  buildNoteRows,
  buildQueueRows,
  buildTaskRows,
  filterQueueRows,
  queueEmptyText,
  queueFilterChips,
  queueTitle,
  sendLabel,
  sendableIds,
  tickedIds,
  teamNoteStatus,
  teamNoteStatusA11y,
} from "../src/queue-list";

const task = (id: string, comment = `do ${id}`): ServerAnnotation => ({
  id,
  comment,
  element: "Button",
  routeName: "/",
});

const note = (id: string, status: Comment["status"] = "open", content = `note ${id}`): Comment => ({
  id,
  status,
  author: { id: "u1", name: "Ada" },
  element: "Header",
  routeName: "/settings",
  messages: [{ id: `${id}-m`, content, author: { id: "u1", name: "Ada" } }],
});

describe("the queue's own rows", () => {
  it("holds the agent's tasks, in the order the server sent them", () => {
    const rows = buildTaskRows([task("a1"), task("a2")]);
    expect(rows.map((r) => r.id)).toEqual(["a1", "a2"]);
    expect(rows.every((r) => r.kind === "agent")).toBe(true);
  });

  it("makes every row sendable — there is no second kind in here", () => {
    const rows = buildTaskRows([task("a1"), task("a2")]);
    expect(rows.every((r) => r.selectable)).toBe(true);
    expect(rows.some((r) => r.unselectableReason)).toBe(false);
  });

  it("skips a row with no id rather than rendering an unopenable one", () => {
    const rows = buildTaskRows([task("a1"), { id: undefined } as unknown as ServerAnnotation]);
    expect(rows.map((r) => r.id)).toEqual(["a1"]);
  });

  it("never renders a blank row, whatever the server sent", () => {
    expect(buildTaskRows([{ id: "a1" }])[0].text).toBe("(no text)");
    expect(buildTaskRows([{ id: "a2", content: "from content" }])[0].text).toBe("from content");
    expect(buildTaskRows([{ id: "a3", text: "from text" }])[0].text).toBe("from text");
  });

  it("says where each was left", () => {
    expect(buildTaskRows([task("a1")])[0].meta).toBe("Button · /");
  });

  it("says when a task came out of a team-note discussion, and carries the way back", () => {
    // The reverse of the note detail's Tasks tab: from the queue you must be
    // able to get to the conversation that asked for the change.
    const [fromNote] = buildTaskRows([{ ...task("a1"), sourceCommentId: "c1" }]);
    expect(fromNote.originLabel).toBe("From a team note");
    expect(fromNote.sourceCommentId).toBe("c1");
    // A task written directly against an element says nothing at all.
    const [direct] = buildTaskRows([task("a2")]);
    expect(direct.originLabel).toBeUndefined();
    expect(direct.sourceCommentId).toBeUndefined();
  });

  it("shows only the request of a task made from a note, not the discussion under it", () => {
    const comment = "Remove the reset hint row\n\nFrom the discussion:\n\nDana: The hint row is noise";
    expect(buildTaskRows([{ ...task("a1"), comment, sourceCommentId: "c1" }])[0].text).toBe("Remove the reset hint row");
  });
});

describe("building the mixed list (exported, unrendered)", () => {
  it("is exactly the tasks then the notes", () => {
    expect(buildQueueRows([task("a1")], [note("c1")])).toEqual([
      ...buildTaskRows([task("a1")]),
      ...buildNoteRows([note("c1")]),
    ]);
  });

  it("holds both kinds, agent tasks first", () => {
    const rows = buildQueueRows([task("a1")], [note("c1")]);
    expect(rows.map((r) => r.kind)).toEqual(["agent", "comment"]);
    expect(rows.map((r) => r.id)).toEqual(["a1", "c1"]);
  });

  it("badges every row in words as well as colour", () => {
    const [agent, team] = buildQueueRows([task("a1")], [note("c1")]);
    expect(agent.badgeLabel).toBe("Agent task");
    expect(team.badgeLabel).toBe("Team note");
    expect(agent.badgeColor).not.toBe(team.badgeColor);
  });

  it("shows the note's first written message, not an empty placeholder", () => {
    const empty = note("c1");
    empty.messages = [
      { id: "m0", content: "   ", author: { id: "u1" } },
      { id: "m1", content: "the real one", author: { id: "u1" } },
    ];
    expect(buildQueueRows([], [empty])[0].text).toBe("the real one");
  });

  it("never renders a blank row, whatever the server sent", () => {
    const bare: ServerAnnotation = { id: "a1" };
    const silent = { ...note("c1"), messages: [] };
    expect(buildQueueRows([bare], [silent]).map((r) => r.text)).toEqual([
      "(no text)",
      "(no text)",
    ]);
  });

  it("falls back through the annotation's text fields", () => {
    expect(buildQueueRows([{ id: "a1", content: "from content" }], [])[0].text).toBe("from content");
    expect(buildQueueRows([{ id: "a2", text: "from text" }], [])[0].text).toBe("from text");
  });

  it("skips rows with no id rather than rendering an unopenable one", () => {
    const rows = buildQueueRows(
      [task("a1"), { id: undefined } as unknown as ServerAnnotation],
      [note("c1"), null as unknown as Comment],
    );
    expect(rows.map((r) => r.id)).toEqual(["a1", "c1"]);
  });

  it("says where each was left", () => {
    const [agent, team] = buildQueueRows([task("a1")], [note("c1")]);
    expect(agent.meta).toBe("Button · /");
    expect(team.meta).toBe("Header · /settings");
  });
});

describe("selection", () => {
  it("makes agent tasks selectable and team notes not", () => {
    const [agent, team] = buildQueueRows([task("a1")], [note("c1")]);
    expect(agent.selectable).toBe(true);
    expect(team.selectable).toBe(false);
  });

  it("says why a team note has no checkbox instead of ignoring a tick", () => {
    const team = buildQueueRows([], [note("c1")])[0];
    expect(team.unselectableReason).toBeTruthy();
    // It points at where the crossing actually happens now: inside the note,
    // on a MESSAGE — not at a whole-thread button that no longer exists.
    expect(team.unselectableReason?.toLowerCase()).toContain("message");
  });

  it("hands over only the selected AGENT ids, even if a note id sneaks in", () => {
    const rows = buildQueueRows([task("a1"), task("a2")], [note("c1")]);
    expect(sendableIds(rows, new Set(["a2", "c1"]))).toEqual(["a2"]);
  });

  it("counts agent tasks, not rows", () => {
    expect(agentTaskCount(buildQueueRows([task("a1")], [note("c1"), note("c2")]))).toBe(1);
  });
});

describe("the send button", () => {
  const rows = buildQueueRows([task("a1"), task("a2")], [note("c1")]);

  it("says all when every task is ticked — and counts them", () => {
    expect(sendLabel({ rows, selected: new Set(["a1", "a2"]) })).toEqual({
      label: "Send all",
      enabled: true,
    });
  });

  it("sends nothing when nothing is ticked, and says so", () => {
    // It used to mean "all of them", beside a row of empty boxes.
    expect(sendLabel({ rows, selected: new Set() })).toEqual({
      label: "Tick a task to send it",
      enabled: false,
    });
  });

  it("starts with every task ticked, and keeps what was unticked out", () => {
    const tasks = buildTaskRows([task("a1"), task("a2"), task("a3")]);
    expect(tickedIds(tasks, new Set())).toEqual(["a1", "a2", "a3"]);
    expect(tickedIds(tasks, new Set(["a2"]))).toEqual(["a1", "a3"]);
    expect(sendLabel({ rows: tasks, selected: new Set(tickedIds(tasks, new Set(["a2"]))) }).label).toBe(
      "Send selected",
    );
  });

  it("says selected for a subset, never counting the note in it", () => {
    expect(sendLabel({ rows, selected: new Set(["a1", "c1"]) }).label).toBe("Send selected");
    // A ticked note does not make two agent tasks "all".
    expect(sendLabel({ rows, selected: new Set(["a1", "a2", "c1"]) }).label).toBe("Send all");
  });

  it("is dead when there is nothing for the agent, however many notes there are", () => {
    const onlyNotes = buildQueueRows([], [note("c1"), note("c2")]);
    const send = sendLabel({ rows: onlyNotes, selected: new Set(["c1"]) });
    expect(send.enabled).toBe(false);
    expect(send.label).toBe("No agent tasks to send");
  });

  it("says so while it is sending, and refuses a second press", () => {
    expect(sendLabel({ rows, selected: new Set(), sending: true })).toEqual({
      label: "Sending…",
      enabled: false,
    });
  });

  it("says all for a lone ticked task — it is all of them", () => {
    const one = buildQueueRows([task("a1")], []);
    expect(sendLabel({ rows: one, selected: new Set(["a1"]) }).label).toBe("Send all");
  });
});

describe("filters", () => {
  const rows = buildQueueRows([task("a1"), task("a2")], [note("c1")]);

  it("always offers all three, All first, with counts", () => {
    expect(queueFilterChips(rows)).toEqual([
      { key: "all", label: "All", count: 3 },
      { key: "agent", label: "Agent tasks", count: 2 },
      { key: "team", label: "Team notes", count: 1 },
    ]);
  });

  it("keeps the chips in place at zero rather than moving them under a thumb", () => {
    expect(queueFilterChips([]).map((c) => c.key)).toEqual(["all", "agent", "team"]);
  });

  it("narrows to one kind, and All shows everything", () => {
    expect(filterQueueRows(rows, "agent").map((r) => r.id)).toEqual(["a1", "a2"]);
    expect(filterQueueRows(rows, "team").map((r) => r.id)).toEqual(["c1"]);
    expect(filterQueueRows(rows, "all")).toHaveLength(3);
  });
});

describe("status and empty states", () => {
  it("describes a note's life in the same vocabulary as everything else", () => {
    expect(teamNoteStatus("open")).toBe("Open");
    expect(teamNoteStatus("resolved")).toBe("Resolved");
  });

  it("shows NO word for a converted note — the status text was removed, not renamed", () => {
    // "Given to the agent" is gone (product owner, device testing). Nothing
    // took its place: the state still reads through `settled` (dimmed row,
    // dimmed marker) and through the note's Tasks tab.
    expect(teamNoteStatus("converted")).toBe("");
  });

  it("keeps all three words for screen readers, which get no dimming", () => {
    expect(teamNoteStatusA11y("converted")).toBe("Given to the agent");
    expect(teamNoteStatusA11y("open")).toBe("Open");
    expect(teamNoteStatusA11y("resolved")).toBe("Resolved");
  });

  it("still teaches the two kinds on the unrendered mixed empty state", () => {
    const all = queueEmptyText("all").toLowerCase();
    expect(all).toContain("agent");
    expect(all).toContain("team");
  });

  it("distinguishes 'no notes' from 'notes are not available here'", () => {
    expect(queueEmptyText("team", true)).toContain("No team notes yet");
    expect(queueEmptyText("team", false)).toContain("unavailable");
  });

  it("names the workflow, and never the count", () => {
    // "Everything you've left" described a catch-all the panel no longer is;
    // the count was already on the rows and on the toolbar entry.
    expect(queueTitle(buildTaskRows([task("a1")]))).toBe("Send to the agent");
    expect(queueTitle([])).toBe("Send to the agent");
  });

  it("teaches the first-timer how a task gets here", () => {
    // The only empty state the queue renders now.
    const text = queueEmptyText("agent");
    expect(text).toContain("No agent tasks yet");
    expect(text).toContain("Agent");
  });
});

/**
 * REOPENED WORK, AND THE COMMIT THAT IS NOT THE QUEUE'S.
 *
 * A task a reply put back in the queue is `pending` like every other row —
 * that is what gets it back in front of the agent — so the row itself is the
 * only place the difference can be stated. And the detail pane needs its own
 * hand-over, because for a task the agent had already resolved the bulk Send
 * did not list it at all.
 */

describe("buildTaskRows — reopened rows", () => {
  it("says nothing on an ordinary pending task", () => {
    expect(buildTaskRows([{ id: "a1", comment: "x" }])[0].status).toBeUndefined();
  });

  it("marks a task a reply reopened", () => {
    const rows = buildTaskRows([
      { id: "a1", comment: "x", status: "pending", reopenedAt: "2026-08-10T10:00:00.000Z" },
    ]);
    expect(rows[0].status).toBe("Reopened");
  });

  it("counts repeat reopens", () => {
    const rows = buildTaskRows([
      {
        id: "a1",
        comment: "x",
        reopenedAt: "2026-08-10T10:00:00.000Z",
        reopenCount: 3,
      },
    ]);
    expect(rows[0].status).toBe("Reopened ×3");
  });

  it("a reopened task is still fully sendable — it IS the actionable work", () => {
    const rows = buildTaskRows([{ id: "a1", comment: "x", reopenedAt: "2026-08-10T10:00:00.000Z" }]);
    expect(rows[0].selectable).toBe(true);
    expect(sendableIds(rows, new Set(["a1"]))).toEqual(["a1"]);
    expect(sendLabel({ rows, selected: new Set(["a1"]) }).enabled).toBe(true);
  });
});

describe("one agent at a time", () => {
  const rows = buildTaskRows([
    { id: "a1", comment: "one", element: "A" },
    { id: "a2", comment: "two", element: "B" },
  ] as never);

  it("closes the queue's Send while an agent is working, and says why", () => {
    const busy = sendLabel({ rows, selected: new Set(), agentBusy: true });
    expect(busy).toEqual({ label: "Agent is working…", enabled: false });
    // ...and opens again the moment nothing is in flight.
    expect(sendLabel({ rows, selected: new Set(["a1"]), agentBusy: false }).enabled).toBe(true);
  });

  it("still prefers the local in-flight word over the server's", () => {
    // Both are true while the POST is on the wire; "Sending…" is the one
    // about the press that just happened.
    expect(sendLabel({ rows, selected: new Set(), sending: true, agentBusy: true }).label)
      .toBe("Sending…");
  });

  it("closes the detail pane's Send for a DIFFERENT task", () => {
    expect(detailSendLabel({ status: "pending", agentBusy: true }))
      .toEqual({ label: "Agent is working…", enabled: false });
  });

  it("but a task that is itself with the agent says so about itself", () => {
    // The generic "some agent is busy" would be true and useless here: this
    // task's own status is the more specific answer.
    expect(detailSendLabel({ status: "working", agentBusy: true }).label).toBe("With the agent");
  });
});

describe("detailSendLabel", () => {
  it("offers the hand-over on a pending task", () => {
    expect(detailSendLabel({ status: "pending" })).toEqual({
      label: "Send to agent",
      enabled: true,
    });
  });

  it("treats a task with no status as pending (older servers)", () => {
    expect(detailSendLabel({}).enabled).toBe(true);
  });

  it("names the refinement when the task was reopened", () => {
    expect(detailSendLabel({ status: "pending", reopened: true })).toEqual({
      label: "Send refinement to agent",
      enabled: true,
    });
  });

  it("says where the task is rather than vanishing once it is gone", () => {
    expect(detailSendLabel({ status: "resolved" })).toEqual({
      label: "With the agent",
      enabled: false,
    });
    expect(detailSendLabel({ status: "acknowledged" }).enabled).toBe(false);
    expect(detailSendLabel({ status: "dismissed" }).enabled).toBe(false);
  });

  it("cannot be pressed twice", () => {
    expect(detailSendLabel({ status: "pending", sending: true })).toEqual({
      label: "Sending…",
      enabled: false,
    });
  });
});

describe("a task the agent is working on", () => {
  const working = (id: string): ServerAnnotation => ({ ...task(id), status: "working" });

  it("says so, and cannot be ticked", () => {
    const [w, p] = buildTaskRows([working("a1"), task("a2")]);
    expect(w).toMatchObject({ working: true, status: "Working…", selectable: false });
    expect(w!.unselectableReason).toBeTruthy();
    expect(p).toMatchObject({ working: false, selectable: true });
  });

  it("is not counted by Send, ticked or not", () => {
    const rows = buildTaskRows([working("a1"), task("a2")]);
    expect(tickedIds(rows, new Set())).toEqual(["a2"]);
    expect(sendLabel({ rows, selected: new Set(tickedIds(rows, new Set())) }).label).toBe("Send all");
    expect(sendableIds(rows, new Set(["a1", "a2"]))).toEqual(["a2"]);
  });

  it("carries the agent's latest step, when the server sends one", () => {
    const [w] = buildTaskRows([{ ...working("a1"), progress: "Editing app/Button.tsx" }]);
    expect(w!.progress).toBe("Editing app/Button.tsx");
    const [p] = buildTaskRows([{ ...task("a2"), progress: "stale" }]);
    expect(p!.progress).toBeUndefined();
  });

  it("leaves nothing to send when it is the only one", () => {
    const rows = buildTaskRows([working("a1")]);
    expect(sendLabel({ rows, selected: new Set() })).toEqual({
      label: "No agent tasks to send",
      enabled: false,
    });
  });
});
