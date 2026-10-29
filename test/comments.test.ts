/**
 * Comments (src/comments.ts) — the half of the overlay the agent does NOT
 * read.
 *
 * Three things are worth pinning down here, none of them visible by looking
 * at the rendered sheet:
 *
 *  - the POST body is the annotation's identity fields MINUS the
 *    agent-only apparatus (kind/platform/references), because a comment is
 *    for people;
 *  - a note has TWO live states and no terminal one. `converted` is legacy —
 *    it is still read out of older data, but nothing writes it any more and
 *    a note that carries it still reopens (the bridge to the agent is
 *    per-MESSAGE now and never consumes the discussion: test/message-task);
 *  - every read degrades to "unavailable" rather than to "empty", because a
 *    server that has not shipped these routes must not look like a project
 *    where nobody has commented.
 */

import { describe, expect, it, vi } from "vitest";
import {
  COMMENTS_POLL_INTERVAL_MS,
  authorName,
  buildCommentBody,
  commentMessagesPath,
  commentPath,
  commentSummary,
  commentToCapture,
  commentsPath,
  createComment,
  deleteComment,
  fetchComment,
  fetchComments,
  isCommentSettled,
  nextCommentStatus,
  postCommentMessage,
  readComment,
  readComments,
  setCommentStatus,
  shouldPollComments,
} from "../src/comments";
import type { Comment, CommentTransport } from "../src/comments";
import type { InspectorHit } from "../src/inspector";
import type { PendingCapture } from "../src/types";

const HIT: InspectorHit = {
  element: "PrimaryButton",
  componentStack: ["HomeScreen", "Card", "PrimaryButton"],
  frame: { x: 52, y: 179.7, width: 62, height: 17 },
  testID: "card-cta",
  nearbyText: "Get started",
  source: { file: "app/src/Card.tsx", line: 4 },
  scroll: { scrollViewTag: 42, offsetY: 480 },
};

const CAPTURE: PendingCapture = {
  x: 120,
  y: 340,
  hit: HIT,
  routeName: "/home",
  screenshotUri: "file:///tmp/shot.png",
};

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
  ],
};

/** A transport double: every method records its call and returns a scripted value. */
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

/** What the wire actually carries (undefined fields vanish in JSON). */
function wire(body: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
}

describe("routes", () => {
  it("scopes the list to one screen", () => {
    expect(commentsPath("/home")).toBe("/comments?routeName=%2Fhome");
    expect(commentsPath(null)).toBe("/comments");
    expect(commentsPath()).toBe("/comments");
  });

  it("escapes ids and route names that are not URL-safe", () => {
    expect(commentPath("a/b?c")).toBe("/comments/a%2Fb%3Fc");
    expect(commentMessagesPath("a b")).toBe("/comments/a%20b/messages");
    expect(commentsPath("/a b?x")).toBe("/comments?routeName=%2Fa%20b%3Fx");
  });
});

describe("buildCommentBody", () => {
  it("carries the same captured identity an annotation would", () => {
    // The reason: a comment can later become an annotation, and must target
    // just as precisely as one written directly.
    expect(wire(buildCommentBody(CAPTURE, "is this right?"))).toEqual({
      routeName: "/home",
      content: "is this right?",
      element: "PrimaryButton",
      componentStack: ["HomeScreen", "Card", "PrimaryButton"],
      source: { file: "app/src/Card.tsx", line: 4 },
      testID: "card-cta",
      x: 120,
      y: 340,
      boundingBox: { x: 52, y: 179.7, width: 62, height: 17 },
      scroll: { scrollViewTag: 42, offsetY: 480 },
    });
  });

  it("sends none of the agent-only apparatus", () => {
    const sent = wire(buildCommentBody(CAPTURE, "x"));
    for (const key of ["kind", "platform", "references", "nearbyText", "id"]) {
      expect(key in sent).toBe(false);
    }
  });

  it("degrades like the annotation body when the hit-test found nothing", () => {
    expect(
      wire(buildCommentBody({ x: 10, y: 20, hit: null, routeName: null, screenshotUri: null }, "hm")),
    ).toEqual({
      content: "hm",
      element: "Screen",
      componentStack: [],
      x: 10,
      y: 20,
      boundingBox: { x: 10, y: 20, width: 0, height: 0 },
      scroll: { offsetY: 0 },
    });
  });

  it("never sends a user id — authors are resolved server-side", () => {
    const sent = wire(buildCommentBody(CAPTURE, "x"));
    expect("author" in sent).toBe(false);
    expect("userId" in sent).toBe(false);
  });
});

describe("reading server payloads", () => {
  it("unwraps {comment} and {comments} alike", () => {
    expect(readComment({ comment: { id: "c1", status: "open", author: { id: "u" }, messages: [] } })?.id).toBe("c1");
    expect(readComments({ comments: [{ id: "c1", status: "open", author: { id: "u" }, messages: [] }] })).toHaveLength(1);
    // A bare array is accepted too, like the pending list is.
    expect(readComments([{ id: "c1", status: "open", author: { id: "u" }, messages: [] }])).toHaveLength(1);
  });

  it("drops entries that are not comments rather than rendering junk", () => {
    expect(readComments({ comments: [null, 3, { nope: true }, { id: "ok", messages: [] }] }).map((c) => c.id)).toEqual(["ok"]);
    expect(readComment(null)).toBeNull();
    expect(readComment({ comments: [] })).toBeNull();
  });

  it("defaults an unknown status to open (never invents resolved)", () => {
    expect(readComment({ id: "c", status: "wat", messages: [] })?.status).toBe("open");
    expect(readComment({ id: "c", messages: [] })?.status).toBe("open");
    expect(readComment({ id: "c", status: "converted", messages: [] })?.status).toBe("converted");
  });

  it("keeps a message whose author the server could not resolve", () => {
    const c = readComment({ id: "c", messages: [{ id: "m", content: "hi" }] });
    expect(c?.messages).toHaveLength(1);
    expect(authorName(c?.messages[0].author)).toBe("Someone");
  });

  it("survives a garbage messages field", () => {
    expect(readComment({ id: "c", messages: "nope" })?.messages).toEqual([]);
    expect(readComment({ id: "c", messages: [{ content: 3 }] })?.messages).toEqual([]);
  });

  it("summarizes by the first non-empty message", () => {
    expect(commentSummary(COMMENT)).toBe("Is this the right label?");
    expect(commentSummary({ ...COMMENT, messages: [] })).toBe("(empty comment)");
  });
});

describe("status rules", () => {
  it("toggles open and resolved", () => {
    expect(nextCommentStatus("open")).toBe("resolved");
    expect(nextCommentStatus("resolved")).toBe("open");
  });

  it("reopens a LEGACY converted note instead of stranding it", () => {
    // The old whole-thread bridge closed notes it had sent. Handing the
    // agent work no longer finishes a discussion, so a note closed by it
    // must not be stuck closed forever.
    expect(nextCommentStatus("converted")).toBe("open");
  });

  it("counts resolved and converted as settled (the faded markers)", () => {
    expect(isCommentSettled("open")).toBe(false);
    expect(isCommentSettled("resolved")).toBe(true);
    expect(isCommentSettled("converted")).toBe(true);
  });
});

describe("a note's captured identity", () => {
  it("rebuilds the capture from the comment's stored identity", () => {
    // This is what makes a task made from a note as well-targeted as one
    // written directly against the element (src/message-task.ts uses it).
    const capture = commentToCapture(COMMENT);
    expect(capture.hit?.element).toBe("PrimaryButton");
    expect(capture.hit?.frame).toEqual(COMMENT.boundingBox);
    expect(capture.hit?.scroll).toEqual({ scrollViewTag: 42, offsetY: 480 });
    expect(capture.routeName).toBe("/home");
    // Comments capture no screenshot in v1.
    expect(capture.screenshotUri).toBeNull();
  });

  it("targets a position-only comment as well as it can", () => {
    const bare: Comment = {
      id: "c9",
      status: "open",
      author: { id: "u" },
      x: 8,
      y: 9,
      messages: [{ id: "m", content: "here", author: { id: "u", name: "Ada" } }],
    };
    const capture = commentToCapture(bare);
    expect(capture.hit).toBeNull();
    expect(capture.x).toBe(8);
    expect(capture.y).toBe(9);
  });
});

describe("network calls", () => {
  it("reads the comments for one route", async () => {
    const { transport, calls } = fakeTransport({ getJson: { comments: [COMMENT] } });
    await expect(fetchComments(transport, "/home")).resolves.toHaveLength(1);
    expect(calls[0].path).toBe("/comments?routeName=%2Fhome");
  });

  it("posts a comment and hands back the server's copy", async () => {
    const { transport, calls } = fakeTransport({ postJson: { comment: { ...COMMENT, id: "new" } } });
    await expect(createComment(transport, CAPTURE, "hi")).resolves.toMatchObject({ id: "new" });
    expect(calls[0].path).toBe("/comments");
    expect(calls[0].body).toMatchObject({ content: "hi", routeName: "/home" });
  });

  it("posts a reply with content only (id/author/time are the server's)", async () => {
    const { transport, calls } = fakeTransport({ postJson: { comment: COMMENT } });
    await postCommentMessage(transport, "c1", "sure");
    expect(calls[0].path).toBe("/comments/c1/messages");
    expect(calls[0].body).toEqual({ content: "sure" });
  });

  it("patches the status and deletes by id", async () => {
    const { transport, calls } = fakeTransport({ patchJson: { comment: COMMENT }, del: true });
    await setCommentStatus(transport, "c1", "resolved");
    await expect(deleteComment(transport, "c1")).resolves.toBe(true);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "PATCH /comments/c1",
      "DELETE /comments/c1",
    ]);
  });
});

describe("fail-soft: a server without the comment routes", () => {
  it("returns NULL — not [] — when the list read fails", async () => {
    // The distinction the whole degradation rests on: null is "we do not
    // know", [] is "the server says nobody commented".
    const { transport } = fakeTransport({ getJson: null });
    await expect(fetchComments(transport, "/home")).resolves.toBeNull();
    await expect(fetchComment(transport, "c1")).resolves.toBeNull();
  });

  it("still returns [] when the server answers with nothing to show", async () => {
    const { transport } = fakeTransport({ getJson: { comments: [] } });
    await expect(fetchComments(transport, "/home")).resolves.toEqual([]);
  });

  it("returns null from every mutation instead of throwing", async () => {
    const { transport } = fakeTransport();
    await expect(createComment(transport, CAPTURE, "hi")).resolves.toBeNull();
    await expect(postCommentMessage(transport, "c1", "hi")).resolves.toBeNull();
    await expect(setCommentStatus(transport, "c1", "resolved")).resolves.toBeNull();
    await expect(deleteComment(transport, "c1")).resolves.toBe(false);
  });

  it("tolerates a 2xx with a body that is not a comment", async () => {
    const { transport } = fakeTransport({ postJson: { ok: true } });
    await expect(postCommentMessage(transport, "c1", "hi")).resolves.toBeNull();
  });

  it("never touches the annotation routes on a comments failure", async () => {
    const { transport, calls } = fakeTransport({ getJson: null });
    await fetchComments(transport, "/home");
    expect(calls.every((c) => c.path.startsWith("/comments"))).toBe(true);
  });
});

describe("polling cadence", () => {
  it("is lazy — this shares a phone with a Metro bundler", () => {
    expect(COMMENTS_POLL_INTERVAL_MS).toBeGreaterThanOrEqual(15_000);
  });

  it("runs only while the overlay is on AND the endpoint answered", () => {
    expect(shouldPollComments({ enabled: true, available: true })).toBe(true);
    expect(shouldPollComments({ enabled: false, available: true })).toBe(false);
    // A server with no comment routes would otherwise 404 every 30s forever.
    expect(shouldPollComments({ enabled: true, available: false })).toBe(false);
  });
});

describe("author names", () => {
  it("uses the server's name, or says Someone", () => {
    expect(authorName({ id: "u", name: "Ada" })).toBe("Ada");
    expect(authorName({ id: "u", name: "  " })).toBe("Someone");
    expect(authorName(undefined)).toBe("Someone");
  });
});

describe("no accidental network in the pure paths", () => {
  it("builds bodies without any transport at all", () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    buildCommentBody(CAPTURE, "x");
    commentToCapture(COMMENT);
    expect(spy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

/**
 * The ADVISORY authorName hint (README "Who you are"). It exists for one
 * server: the one with no way to know who is typing. Everything about how it
 * is sent is shaped by not wanting it mistaken for authority.
 */
describe("the advisory authorName hint", () => {
  it("is absent from a create when this device holds no name", () => {
    expect(buildCommentBody(CAPTURE, "hi")).not.toHaveProperty("authorName");
    expect(buildCommentBody(CAPTURE, "hi", "  ")).not.toHaveProperty("authorName");
    expect(buildCommentBody(CAPTURE, "hi", null)).not.toHaveProperty("authorName");
  });

  it("rides along on a create when it does", () => {
    expect(buildCommentBody(CAPTURE, "hi", " Johnny ")).toMatchObject({
      content: "hi",
      authorName: "Johnny",
    });
  });

  it("rides along on a reply, beside the content and nothing else", async () => {
    const { transport, calls } = fakeTransport({ postJson: { comment: COMMENT } });
    await postCommentMessage(transport, "c1", "sure", "Johnny");
    expect(calls[0].body).toEqual({ content: "sure", authorName: "Johnny" });
  });

  it("is left off a reply entirely when there is no name", async () => {
    const { transport, calls } = fakeTransport({ postJson: { comment: COMMENT } });
    await postCommentMessage(transport, "c1", "sure", null);
    expect(calls[0].body).toEqual({ content: "sure" });
  });

  it("never becomes what the thread SAYS: the server's author is rendered", async () => {
    const { transport } = fakeTransport({
      postJson: {
        comment: {
          ...COMMENT,
          messages: [
            { id: "m1", content: "sure", author: { id: "u9", name: "J. Feliz" } },
          ],
        },
      },
    });
    const updated = await postCommentMessage(transport, "c1", "sure", "Johnny");
    expect(updated?.messages[0]?.author).toEqual({ id: "u9", name: "J. Feliz" });
  });
});
