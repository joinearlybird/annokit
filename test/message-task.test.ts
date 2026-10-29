/**
 * A MESSAGE becomes an agent task (src/message-task.ts).
 *
 * The old bridge took the whole discussion, marked the note `converted` and
 * refused to do it again. What replaced it has to hold four properties that
 * are invisible in a screenshot and obvious here:
 *
 *  - WHAT GETS SENT is exactly the selected message(s) — in thread order,
 *    with their authors — plus the note's captured identity, never the rest
 *    of the conversation;
 *  - THE NOTE IS NOT CONSUMED: making a task writes ONE request, and none
 *    of it touches the comment's status;
 *  - THE BACK-LINK degrades honestly: a bubble whose task cannot be
 *    resolved is marked, but not offered as a button that opens nothing;
 *  - THE ROLL-UP (the note detail's Tasks tab) is derived from the pending
 *    list the overlay already holds, so it cannot disagree with it.
 */

import { describe, expect, it, vi } from "vitest";
import type { Comment, CommentTransport } from "../src/comments";
import {
  CREATE_TASK_LABEL,
  NOTE_TASKS_EMPTY,
  TASK_CONTEXT_LEAD_IN,
  TASK_ORIGIN_LABEL,
  buildMessageTaskBody,
  isReopenedTask,
  taskLifecycleLabel,
  taskReopenLabel,
  composeMessageTaskComment,
  messageTaskFlowHint,
  canMakeMessageTask,
  commentTaskCounts,
  createTaskFromMessages,
  mergeTaskLists,
  markerTaskCountLabel,
  messageSelectionLabel,
  messageTaskActionLabel,
  messageTaskComment,
  messageTaskMarkLabel,
  messageTaskMarks,
  noteTaskRows,
  noteTasksTabLabel,
  selectedMessages,
  splitTaskBody,
  taskOriginA11yLabel,
  taskOriginLine,
  taskStatusLabel,
  toggleMessageSelection,
} from "../src/message-task";

const COMMENT: Comment = {
  id: "c1",
  routeName: "/home",
  element: "PrimaryButton",
  componentStack: ["HomeScreen", "Card", "PrimaryButton"],
  source: { file: "app/src/Card.tsx", line: 4 },
  testID: "card-cta",
  x: 120,
  y: 340,
  boundingBox: { x: 52, y: 179.7, width: 62, height: 17 },
  scroll: { scrollViewTag: 42, offsetY: 480 },
  status: "open",
  author: { id: "u1", name: "Ada" },
  messages: [
    { id: "m1", content: "Is this the right label?", author: { id: "u1", name: "Ada" } },
    { id: "m2", content: "I think it should say Start", author: { id: "u2", name: "Grace" } },
    { id: "m3", content: "and make it green", author: { id: "u2", name: "Grace" } },
  ],
};

function fakeTransport(script: Partial<Record<keyof CommentTransport, unknown>> = {}) {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const answer = (key: keyof CommentTransport, fallback: unknown) =>
    key in script ? script[key] : fallback;
  const transport: CommentTransport = {
    async getJson(path) {
      calls.push({ method: "GET", path });
      return answer("getJson", null);
    },
    async postJson(path, body) {
      calls.push({ method: "POST", path, body });
      return answer("postJson", null);
    },
    async patchJson(path, body) {
      calls.push({ method: "PATCH", path, body });
      return answer("patchJson", null);
    },
    async del(path) {
      calls.push({ method: "DELETE", path });
      return answer("del", false) as boolean;
    },
  };
  return { transport, calls };
}

function wire(body: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
}

describe("selection", () => {
  it("ticks and unticks", () => {
    expect(toggleMessageSelection([], "m1")).toEqual(["m1"]);
    expect(toggleMessageSelection(["m1"], "m2")).toEqual(["m1", "m2"]);
    expect(toggleMessageSelection(["m1", "m2"], "m1")).toEqual(["m2"]);
  });

  it("never mutates the array it was handed (it is React state)", () => {
    const before = ["m1"];
    toggleMessageSelection(before, "m2");
    expect(before).toEqual(["m1"]);
  });

  it("resolves in THREAD order, whatever order they were tapped in", () => {
    // "no, the other one" read backwards is a different request.
    expect(selectedMessages(COMMENT.messages, ["m3", "m1"]).map((m) => m.id)).toEqual([
      "m1",
      "m3",
    ]);
  });

  it("drops ids that are not in the thread, and empty messages", () => {
    expect(selectedMessages(COMMENT.messages, ["nope"])).toEqual([]);
    const blank = { ...COMMENT, messages: [{ id: "b", content: "  ", author: { id: "u" } }] };
    expect(selectedMessages(blank.messages, ["b"])).toEqual([]);
  });

  it("knows when there is nothing to send", () => {
    expect(canMakeMessageTask(COMMENT.messages, [])).toBe(false);
    expect(canMakeMessageTask(COMMENT.messages, ["nope"])).toBe(false);
    expect(canMakeMessageTask(COMMENT.messages, ["m2"])).toBe(true);
  });

  // The four combinations the flow can be in when the confirm is looked at.
  it("enables on EITHER a typed request or picked messages, and neither means no", () => {
    // text + messages
    expect(canMakeMessageTask(COMMENT.messages, ["m2"], "make it green")).toBe(true);
    // text only — a real task: it still carries the note's element.
    expect(canMakeMessageTask(COMMENT.messages, [], "make it green")).toBe(true);
    // messages only — what this flow always did.
    expect(canMakeMessageTask(COMMENT.messages, ["m2"], "")).toBe(true);
    // neither, and whitespace is neither.
    expect(canMakeMessageTask(COMMENT.messages, [], "")).toBe(false);
    expect(canMakeMessageTask(COMMENT.messages, [], "   \n ")).toBe(false);
  });

  it("says what the action will do, with the count", () => {
    // The complaint that started this was not knowing what would be sent.
    // Zero does not count to zero: a typed request with nothing ticked is a
    // legitimate task and the button must not read as broken.
    expect(messageTaskActionLabel(0)).toBe("Create agent task");
    expect(messageTaskActionLabel(1)).toBe("Create agent task from 1 message");
    expect(messageTaskActionLabel(3)).toBe("Create agent task from 3 messages");
  });

  it("names the flow's entry point as an outcome, not a mechanism", () => {
    // It sits in the action row next to Resolve now; "Select" named the
    // gesture and lived in the header, which is not where actions live.
    expect(CREATE_TASK_LABEL).toBe("Create agent task");
  });

  it("teaches the two halves of the flow above the box", () => {
    expect(messageTaskFlowHint(0).toLowerCase()).toContain("type what the agent should do");
    expect(messageTaskFlowHint(0).toLowerCase()).toContain("context");
    expect(messageTaskFlowHint(1)).toBe("1 message picked for context");
    expect(messageTaskFlowHint(4)).toBe("4 messages picked for context");
  });

  it("names the state of a bubble for a screen reader", () => {
    expect(messageSelectionLabel("Ada", false)).toBe("Ada: select for the agent");
    expect(messageSelectionLabel("Ada", true)).toBe("Ada: selected for the agent");
  });
});

describe("the task body", () => {
  it("quotes ONLY the selected messages, with their speakers", () => {
    expect(messageTaskComment(selectedMessages(COMMENT.messages, ["m2", "m3"]))).toBe(
      "Grace: I think it should say Start\n\nGrace: and make it green",
    );
  });

  describe("the request and the context, in that order", () => {
    const picked = selectedMessages(COMMENT.messages, ["m2", "m3"]);

    it("puts what the USER asked for first, then what was said, delimited", () => {
      // The order is the meaning: an agent reading line one must be reading
      // the job, not a teammate's aside about it.
      expect(composeMessageTaskComment("Make the CTA full width", picked)).toBe(
        [
          "Make the CTA full width",
          "",
          TASK_CONTEXT_LEAD_IN,
          "",
          "Grace: I think it should say Start",
          "",
          "Grace: and make it green",
        ].join("\n"),
      );
    });

    it("is the instruction ALONE when nothing was picked", () => {
      expect(composeMessageTaskComment("Make the CTA full width", [])).toBe(
        "Make the CTA full width",
      );
    });

    it("is the quotes alone when nothing was typed — byte for byte what it always sent", () => {
      expect(composeMessageTaskComment("", picked)).toBe(messageTaskComment(picked));
      expect(composeMessageTaskComment("   ", picked)).toBe(messageTaskComment(picked));
    });

    it("is null when there is neither", () => {
      expect(composeMessageTaskComment("", [])).toBeNull();
      expect(composeMessageTaskComment("  \n ", [])).toBeNull();
    });

    it("keeps the note's identity and source link on a typed-only task", () => {
      const body = buildMessageTaskBody(COMMENT, [], "ann-2", "Make the CTA full width");
      expect(body?.comment).toBe("Make the CTA full width");
      expect(body?.element).toBe("PrimaryButton");
      expect(body?.sourceCommentId).toBe("c1");
      // No quotes means no back-link: an empty array would make every
      // consumer guess whether it meant "none" or "not recorded".
      expect(body?.sourceMessageIds).toBeUndefined();
    });

    it("carries both through buildMessageTaskBody when both are given", () => {
      const body = buildMessageTaskBody(COMMENT, ["m2"], "ann-3", "Make the CTA full width");
      expect(body?.comment).toBe(
        `Make the CTA full width\n\n${TASK_CONTEXT_LEAD_IN}\n\nGrace: I think it should say Start`,
      );
      expect(body?.sourceMessageIds).toEqual(["m2"]);
    });
  });

  it("is a real protocol-v1 annotation plus the two source fields", () => {
    const body = buildMessageTaskBody(COMMENT, ["m2"], "ann-1", "", "full");
    expect(wire(body)).toEqual({
      id: "ann-1",
      comment: "Grace: I think it should say Start",
      kind: "feedback",
      platform: "native",
      element: "PrimaryButton",
      componentStack: ["HomeScreen", "Card", "PrimaryButton"],
      source: { file: "app/src/Card.tsx", line: 4 },
      testID: "card-cta",
      routeName: "/home",
      x: 120,
      y: 340,
      boundingBox: { x: 52, y: 179.7, width: 62, height: 17 },
      scroll: { scrollViewTag: 42, offsetY: 480 },
      sourceCommentId: "c1",
      sourceMessageIds: ["m2"],
    });
  });

  // Output Detail governs what the agent receives, whichever door the task
  // came in through — the note keeping its full identity does not change it.
  it("is trimmed to Output Detail like a direct task", () => {
    const standard = buildMessageTaskBody(COMMENT, ["m2"], "ann-1", "", "standard");
    expect(standard?.componentStack).toEqual([]);
    expect(standard?.testID).toBe("card-cta");

    const minimal = buildMessageTaskBody(COMMENT, ["m2"], "ann-1", "", "minimal");
    expect(minimal?.componentStack).toEqual([]);
    expect(minimal?.source).toBeUndefined();
    expect(minimal?.testID).toBeUndefined();
    // The two source fields are what make it a message task; they survive.
    expect(minimal?.sourceCommentId).toBe("c1");
    expect(minimal?.sourceMessageIds).toEqual(["m2"]);
  });

  it("does NOT carry the rest of the conversation", () => {
    const body = buildMessageTaskBody(COMMENT, ["m3"], "ann-1");
    expect(body?.comment).not.toContain("Is this the right label?");
  });

  it("records the ids in thread order too", () => {
    expect(buildMessageTaskBody(COMMENT, ["m3", "m1"], "a")?.sourceMessageIds).toEqual([
      "m1",
      "m3",
    ]);
  });

  it("is null when nothing sendable was selected", () => {
    expect(buildMessageTaskBody(COMMENT, [], "a")).toBeNull();
    expect(buildMessageTaskBody(COMMENT, ["gone"], "a")).toBeNull();
  });

  it("targets a position-only note as well as it can", () => {
    const bare: Comment = {
      id: "c9",
      status: "open",
      author: { id: "u" },
      x: 8,
      y: 9,
      messages: [{ id: "m", content: "here", author: { id: "u", name: "Ada" } }],
    };
    const body = buildMessageTaskBody(bare, ["m"], "ann-9");
    expect(body?.element).toBe("Screen");
    expect(body?.boundingBox).toEqual({ x: 8, y: 9, width: 0, height: 0 });
    expect(body?.sourceCommentId).toBe("c9");
  });
});

describe("making the task", () => {
  it("counts an empty 2xx as made, keeping the client's id", async () => {
    const { transport } = fakeTransport({ getJson: { comment: COMMENT } });
    const withStatus = {
      ...transport,
      postJsonAt: async () => ({ status: 204, data: null }),
    };
    await expect(
      createTaskFromMessages(withStatus, "sess-1", COMMENT, ["m2"], "ann-1"),
    ).resolves.toEqual({ ok: true, annotationId: "ann-1", messageIds: ["m2"] });
  });

  it("takes the server's id when the answer names one", async () => {
    const { transport } = fakeTransport({ getJson: { comment: COMMENT } });
    const withStatus = { ...transport, postJsonAt: async () => ({ status: 201, data: { id: "srv-7" } }) };
    await expect(
      createTaskFromMessages(withStatus, "sess-1", COMMENT, ["m2"], "ann-1"),
    ).resolves.toMatchObject({ ok: true, annotationId: "srv-7" });
  });

  it("is not made when the server refuses", async () => {
    const { transport } = fakeTransport({ getJson: { comment: COMMENT } });
    const withStatus = { ...transport, postJsonAt: async () => ({ status: 500, data: null }) };
    await expect(
      createTaskFromMessages(withStatus, "sess-1", COMMENT, ["m2"], "ann-1"),
    ).resolves.toEqual({ ok: false });
  });

  it("re-reads the note, then posts — and writes NOTHING to the note", async () => {
    const { transport, calls } = fakeTransport({
      getJson: { comment: COMMENT },
      postJson: { id: "ann-1" },
    });
    await expect(
      createTaskFromMessages(transport, "sess-1", COMMENT, ["m2"], "ann-1"),
    ).resolves.toEqual({ ok: true, annotationId: "ann-1", messageIds: ["m2"] });
    // No PATCH: the discussion is not consumed by handing over work.
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /comments/c1",
      "POST /sessions/sess-1/annotations",
    ]);
  });

  it("quotes the SERVER's copy of the message", async () => {
    const edited: Comment = {
      ...COMMENT,
      messages: [{ id: "m2", content: "actually: say Begin", author: { id: "u2", name: "Grace" } }],
    };
    const { transport, calls } = fakeTransport({
      getJson: { comment: edited },
      postJson: { id: "ann-1" },
    });
    await createTaskFromMessages(transport, "sess-1", COMMENT, ["m2"], "ann-1");
    expect((calls[1].body as { comment: string }).comment).toBe("Grace: actually: say Begin");
  });

  it("falls back to the copy on screen when the re-read fails", async () => {
    const { transport, calls } = fakeTransport({ getJson: null, postJson: { id: "ann-1" } });
    await expect(
      createTaskFromMessages(transport, "sess-1", COMMENT, ["m1"], "ann-1"),
    ).resolves.toMatchObject({ ok: true });
    expect((calls[1].body as { comment: string }).comment).toContain("Ada:");
  });

  it("refuses when the selected message is gone from the server's copy", async () => {
    const { transport, calls } = fakeTransport({
      getJson: { comment: { ...COMMENT, messages: [] } },
      postJson: { id: "ann-1" },
    });
    await expect(
      createTaskFromMessages(transport, "sess-1", COMMENT, ["m1"], "ann-1"),
    ).resolves.toEqual({ ok: false });
    expect(calls.map((c) => c.method)).toEqual(["GET"]);
  });

  it("refuses an empty selection without touching the network", async () => {
    const { transport, calls } = fakeTransport({ postJson: { id: "x" } });
    await expect(
      createTaskFromMessages(transport, "sess-1", COMMENT, [], "ann-1"),
    ).resolves.toEqual({ ok: false });
    expect(calls).toEqual([]);
  });

  it("reports failure when the POST did not land", async () => {
    const { transport } = fakeTransport({ getJson: { comment: COMMENT }, postJson: null });
    await expect(
      createTaskFromMessages(transport, "sess-1", COMMENT, ["m1"], "ann-1"),
    ).resolves.toEqual({ ok: false });
  });

  it("can be done twice — a note is never used up", async () => {
    const { transport, calls } = fakeTransport({
      getJson: { comment: COMMENT },
      postJson: { id: "ann" },
    });
    await createTaskFromMessages(transport, "s", COMMENT, ["m1"], "ann-1");
    await createTaskFromMessages(transport, "s", COMMENT, ["m3"], "ann-2");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(2);
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("escapes a session id in the annotation route", async () => {
    const { transport, calls } = fakeTransport({
      getJson: { comment: COMMENT },
      postJson: { id: "a" },
    });
    await createTaskFromMessages(transport, "sess/1", COMMENT, ["m1"], "ann-1");
    expect(calls[1].path).toBe("/sessions/sess%2F1/annotations");
  });
});

describe("the mark on a bubble", () => {
  const task = { id: "ann-1", sourceCommentId: "c1", sourceMessageIds: ["m2", "m3"] };

  it("marks every message a task quoted, and opens it", () => {
    expect(messageTaskMarks([task], [], "c1")).toEqual({
      m2: { annotationId: "ann-1", openable: true },
      m3: { annotationId: "ann-1", openable: true },
    });
  });

  it("ignores tasks from another note", () => {
    expect(messageTaskMarks([{ ...task, sourceCommentId: "other" }], [], "c1")).toEqual({});
  });

  it("ignores older tasks that carry no message ids", () => {
    // Pre-`sourceMessageIds` data: it belongs to the note, but to no bubble.
    expect(messageTaskMarks([{ id: "ann-0", sourceCommentId: "c1" }], [], "c1")).toEqual({});
  });

  it("still marks a bubble the server did not link, WITHOUT offering to open it", () => {
    // The server dropped the new field: this device knows what it just did,
    // so the mark is honest — but nothing could resolve it, so it is not a
    // button that opens nothing.
    expect(
      messageTaskMarks([{ id: "ann-9", sourceCommentId: "c1" }], [{ messageId: "m1", annotationId: "ann-9" }], "c1"),
    ).toEqual({ m1: { annotationId: "ann-9", openable: true } });
    expect(messageTaskMarks([], [{ messageId: "m1", annotationId: "ann-9" }], "c1")).toEqual({
      m1: { annotationId: "ann-9", openable: false },
    });
  });

  it("lets the server's own link win over the local one", () => {
    const marks = messageTaskMarks([task], [{ messageId: "m2", annotationId: "stale" }], "c1");
    expect(marks.m2).toEqual({ annotationId: "ann-1", openable: true });
  });

  it("survives junk in the list", () => {
    const junk = [null, { sourceCommentId: "c1" }, { id: "a", sourceCommentId: "c1", sourceMessageIds: "no" }];
    expect(messageTaskMarks(junk as never, [], "c1")).toEqual({});
  });

  it("says whether the mark goes anywhere", () => {
    expect(messageTaskMarkLabel({ annotationId: "a", openable: true })).toBe(
      "Open the agent task from this message",
    );
    expect(messageTaskMarkLabel({ annotationId: "a", openable: false })).toBe(
      "Already an agent task",
    );
  });
});

describe("the note's marker indicator", () => {
  it("counts the tasks each discussion produced", () => {
    expect(
      commentTaskCounts([
        { id: "a1", sourceCommentId: "c1" },
        { id: "a2", sourceCommentId: "c1" },
        { id: "a3", sourceCommentId: "c2" },
        { id: "a4" },
      ]),
    ).toEqual({ c1: 2, c2: 1 });
  });

  it("counts one task once, however many messages it quoted", () => {
    expect(
      commentTaskCounts([{ id: "a1", sourceCommentId: "c1", sourceMessageIds: ["m1", "m2"] }]),
    ).toEqual({ c1: 1 });
  });

  it("has nothing to say about a note with no tasks", () => {
    expect(commentTaskCounts([])).toEqual({});
    expect(commentTaskCounts([{ id: "a", sourceCommentId: "" }])).toEqual({});
  });

  it("puts the count in words, since the pip carries no numeral", () => {
    expect(markerTaskCountLabel(1)).toBe("1 agent task from this note");
    expect(markerTaskCountLabel(3)).toBe("3 agent tasks from this note");
  });
});

describe("the Tasks tab", () => {
  const now = new Date("2026-08-10T12:00:00.000Z");
  const rows = () =>
    noteTaskRows(
      [
        {
          id: "ann-1",
          sourceCommentId: "c1",
          sourceMessageIds: ["m2"],
          comment: "Grace: I think it should say Start",
          status: "pending",
          createdAt: "2026-08-10T11:30:00.000Z",
        },
        {
          id: "ann-2",
          sourceCommentId: "c1",
          sourceMessageIds: ["m1", "m3"],
          comment: "Ada: …\n\nGrace: …",
          status: "sent",
          timestamp: Date.parse("2026-08-09T09:15:00.000Z"),
        },
        { id: "ann-3", sourceCommentId: "other", comment: "not this one" },
      ],
      COMMENT,
      now,
    );

  it("lists only this note's tasks, in the order the list holds them", () => {
    expect(rows().map((r) => r.id)).toEqual(["ann-1", "ann-2"]);
  });

  it("says what each one is, when it was made, and where it came from", () => {
    const [first, second] = rows();
    expect(first.text).toBe("Grace: I think it should say Start");
    expect(first.status).toBe("Waiting to be sent");
    expect(first.at).not.toBe("");
    expect(first.from).toBe("From Grace's message");
    expect(second.status).toBe("With the agent");
    expect(second.from).toBe("From 2 messages");
  });

  it("takes an epoch-ms stamp when that is all the server sent", () => {
    expect(rows()[1].at).toContain("Yesterday");
  });

  it("omits the provenance line rather than inventing one", () => {
    const [row] = noteTaskRows([{ id: "a", sourceCommentId: "c1", comment: "x" }], COMMENT, now);
    expect(row.from).toBeUndefined();
    expect(row.at).toBe("");
  });

  it("never renders an empty row", () => {
    const [row] = noteTaskRows([{ id: "a", sourceCommentId: "c1" }], COMMENT, now);
    expect(row.text).toBe("(no text)");
    // The card's prominent half is never blank either.
    expect(row.request).toBe("(no text)");
  });

  describe("the two tiers a card draws", () => {
    it("splits the request from the quoted discussion under it", () => {
      const text = composeMessageTaskComment(
        "Make the CTA full width",
        selectedMessages(COMMENT.messages, ["m2"]),
      ) as string;
      const [row] = noteTaskRows(
        [{ id: "a", sourceCommentId: "c1", comment: text }],
        COMMENT,
        now,
      );
      expect(row.request).toBe("Make the CTA full width");
      expect(row.context).toBe("Grace: I think it should say Start");
      // The whole body is still there for the accessibility label.
      expect(row.text).toBe(text);
    });

    it("treats a body with no lead-in as ALL request — no invented context", () => {
      // The one-tap bubble action, and every task made before the
      // instruction box existed: the quotes ARE the artifact there.
      const quotes = messageTaskComment(selectedMessages(COMMENT.messages, ["m2", "m3"]));
      expect(splitTaskBody(quotes)).toEqual({ request: quotes });
      expect(splitTaskBody("Make it green")).toEqual({ request: "Make it green" });
    });

    it("does not open a context tier for a lead-in with nothing under it", () => {
      expect(splitTaskBody(`Do the thing\n\n${TASK_CONTEXT_LEAD_IN}\n\n   `)).toEqual({
        request: "Do the thing",
      });
    });

    it("round-trips what compose wrote, for all three sendable shapes", () => {
      const picked = selectedMessages(COMMENT.messages, ["m2", "m3"]);
      const both = composeMessageTaskComment("Widen it", picked) as string;
      expect(splitTaskBody(both)).toEqual({
        request: "Widen it",
        context: messageTaskComment(picked),
      });
      expect(splitTaskBody(composeMessageTaskComment("Widen it", []) as string)).toEqual({
        request: "Widen it",
      });
      expect(splitTaskBody(composeMessageTaskComment("", picked) as string)).toEqual({
        request: messageTaskComment(picked),
      });
    });
  });

  it("puts a task's lifecycle in the overlay's words, and shows an unknown one", () => {
    expect(taskStatusLabel(undefined)).toBe("Waiting to be sent");
    expect(taskStatusLabel("pending")).toBe("Waiting to be sent");
    expect(taskStatusLabel("sent")).toBe("With the agent");
    expect(taskStatusLabel("addressed")).toBe("Done");
    expect(taskStatusLabel("dismissed")).toBe("Dismissed");
    expect(taskStatusLabel("quarantined")).toBe("Quarantined");
  });

  it("labels the tab with the count, and stays visible at zero", () => {
    expect(noteTasksTabLabel(0)).toBe("Tasks");
    expect(noteTasksTabLabel(2)).toBe("Tasks (2)");
  });

  it("has an empty state that says how to make one", () => {
    expect(NOTE_TASKS_EMPTY).toContain("Conversation");
  });
});

describe("the reverse link", () => {
  it("states where a task came from, and only when it came from somewhere", () => {
    expect(taskOriginLine({ sourceCommentId: "c1" })).toBe(TASK_ORIGIN_LABEL);
    expect(taskOriginLine({})).toBeUndefined();
    expect(taskOriginLine({ sourceCommentId: "" })).toBeUndefined();
    expect(taskOriginLine(null)).toBeUndefined();
  });

  it("only offers to travel when it can", () => {
    expect(taskOriginA11yLabel(true)).toBe("Open the team note this task came from");
    expect(taskOriginA11yLabel(false)).toBe(TASK_ORIGIN_LABEL);
  });
});

describe("no accidental network in the pure paths", () => {
  it("builds and resolves everything without a transport", () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    buildMessageTaskBody(COMMENT, ["m1"], "ann-1");
    messageTaskMarks([], [], "c1");
    noteTaskRows([], COMMENT);
    commentTaskCounts([]);
    expect(spy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

/**
 * REOPENED BY A REPLY (src/message-task.ts). The server keeps a reopened
 * task at `pending` on purpose — every consumer already understands that
 * one word — so the fact rides along in `reopenedAt`, and these are the only
 * places a reader ever learns it happened.
 */

describe("isReopenedTask", () => {
  it("is the presence of a reopenedAt stamp", () => {
    expect(isReopenedTask({ reopenedAt: "2026-08-10T10:00:00.000Z" })).toBe(true);
    expect(isReopenedTask({})).toBe(false);
    expect(isReopenedTask({ reopenedAt: "" })).toBe(false);
    expect(isReopenedTask(null)).toBe(false);
    expect(isReopenedTask(undefined)).toBe(false);
  });
});

describe("taskReopenLabel", () => {
  it("says nothing about a task nobody has reopened", () => {
    expect(taskReopenLabel({})).toBeUndefined();
  });

  it("counts only past the first", () => {
    expect(taskReopenLabel({ reopenedAt: "t", reopenCount: 1 })).toBe("Reopened");
    expect(taskReopenLabel({ reopenedAt: "t" })).toBe("Reopened");
    expect(taskReopenLabel({ reopenedAt: "t", reopenCount: 4 })).toBe("Reopened ×4");
  });
});

describe("taskLifecycleLabel", () => {
  it("is the plain status for a task nobody has reopened", () => {
    expect(taskLifecycleLabel({ status: "pending" })).toBe("Waiting to be sent");
    expect(taskLifecycleLabel({ status: "resolved" })).toBe("Resolved");
  });

  it("REPLACES 'waiting to be sent' — the reopen is the news", () => {
    expect(taskLifecycleLabel({ status: "pending", reopenedAt: "t" })).toBe(
      "Reopened — waiting to be sent",
    );
    expect(taskLifecycleLabel({ reopenedAt: "t", reopenCount: 2 })).toBe(
      "Reopened ×2 — waiting to be sent",
    );
  });

  it("a task that has moved on reports where it is, not its history", () => {
    // Reopened last week, sent, and now with the agent again: the current
    // state is what a reader needs.
    expect(taskLifecycleLabel({ status: "sent", reopenedAt: "t" })).toBe("With the agent");
  });
});

describe("noteTaskRows — reopened tasks in the roll-up", () => {
  it("shows the reopen instead of the plain pending word", () => {
    const rows = noteTaskRows(
      [
        {
          id: "a1",
          comment: "Make it green",
          sourceCommentId: COMMENT.id,
          status: "pending",
          reopenedAt: "t",
        },
      ],
      COMMENT,
    );
    expect(rows[0].status).toBe("Reopened — waiting to be sent");
  });
});

describe("the tasks a note can point at", () => {
  it("keeps a task the note produced after it has left the queue", () => {
    const pending = [{ id: "a1", sourceCommentId: "c1", status: "pending" }];
    const linked = [
      { id: "a1", sourceCommentId: "c1", status: "pending" },
      { id: "a2", sourceCommentId: "c1", status: "sent" },
    ];
    const merged = mergeTaskLists(pending, linked);
    expect(merged.map((a) => a.id)).toEqual(["a1", "a2"]);
    // So the Tasks tab, which used to read the pending list alone, still
    // lists the sent one.
    expect(noteTaskRows(merged, COMMENT).map((r) => r.id)).toEqual(["a1", "a2"]);
  });

  it("prefers the pending copy where both lists have one", () => {
    const merged = mergeTaskLists(
      [{ id: "a1", status: "working" }],
      [{ id: "a1", status: "pending" }],
    );
    expect(merged).toEqual([{ id: "a1", status: "working" }]);
  });
});
