/**
 * Annotation threads (src/thread.ts): the two protocol routes the detail
 * view uses, and the optimistic reply append that must revert when the
 * server refuses.
 *
 * `setThread` here is the real `useState` updater contract (an updater
 * function applied to the previous list), backed by a plain array — no
 * React, no renderer, same style as test/pending.test.ts.
 */

import { describe, expect, it, vi } from "vitest";
import {
  annotationPath,
  annotationThread,
  applyPolledThread,
  fetchAnnotation,
  fetchThread,
  newReplyLabel,
  postThreadReply,
  threadPath,
} from "../src/thread";
import type { ThreadMessage } from "../src/thread";

function store(initial: ThreadMessage[] = []) {
  let list = initial;
  return {
    get list() {
      return list;
    },
    setThread(update: (prev: ThreadMessage[]) => ThreadMessage[]) {
      list = update(list);
    },
  };
}

const USER: ThreadMessage = {
  id: "m1",
  content: "Make it green",
  role: "user",
  timestamp: "2026-08-05T10:00:00.000Z",
};
const AGENT: ThreadMessage = {
  id: "m2",
  content: "Done — updated Card.tsx",
  role: "agent",
  timestamp: "2026-08-05T10:01:00.000Z",
};

/** A transport recording its calls; `get`/`post` decide the answers. */
function transport(options: {
  get?: (path: string) => unknown;
  post?: (path: string, body: unknown) => unknown;
}) {
  const getJson = vi.fn(async (path: string) => options.get?.(path) ?? null);
  const postJson = vi.fn(async (path: string, body: unknown) => options.post?.(path, body) ?? null);
  return { getJson, postJson };
}

describe("thread routes", () => {
  it("reads an annotation at GET /annotations/:aid (not session-prefixed)", () => {
    expect(annotationPath("a1")).toBe("/annotations/a1");
  });

  it("appends at POST /annotations/:aid/thread", () => {
    expect(threadPath("a1")).toBe("/annotations/a1/thread");
  });

  it("escapes ids that are not URL-safe", () => {
    expect(threadPath("a/b?c")).toBe("/annotations/a%2Fb%3Fc/thread");
  });
});

describe("fetchThread — GET /annotations/:aid", () => {
  it("returns the stored annotation's thread", async () => {
    const t = transport({ get: () => ({ id: "a1", comment: "x", thread: [USER, AGENT] }) });
    await expect(fetchThread(t, "a1")).resolves.toEqual([USER, AGENT]);
    expect(t.getJson).toHaveBeenCalledWith("/annotations/a1");
  });

  it("returns [] for an annotation that has no thread yet", async () => {
    const t = transport({ get: () => ({ id: "a1", comment: "x" }) });
    await expect(fetchThread(t, "a1")).resolves.toEqual([]);
  });

  it("returns null when the read failed, so the view keeps what it shows", async () => {
    // Distinct from []: a 404/offline read must not blank an open thread.
    await expect(fetchThread(transport({}), "a1")).resolves.toBeNull();
  });

  it("drops malformed messages rather than rendering an empty bubble", async () => {
    const t = transport({ get: () => ({ id: "a1", thread: [USER, null, { role: "agent" }, 7] }) });
    await expect(fetchThread(t, "a1")).resolves.toEqual([USER]);
  });

  it("tolerates a non-array thread field", async () => {
    const t = transport({ get: () => ({ id: "a1", thread: "corrupt" }) });
    await expect(fetchThread(t, "a1")).resolves.toEqual([]);
  });
});

describe("postThreadReply — optimistic append", () => {
  it("sends only { content } — the server assigns id, role and timestamp", async () => {
    const t = transport({ post: () => ({ id: "a1", thread: [USER] }) });
    await postThreadReply(t, "a1", "Make it green", store().setThread);
    expect(t.postJson).toHaveBeenCalledWith("/annotations/a1/thread", {
      content: "Make it green",
    });
  });

  it("shows the reply before the request resolves", async () => {
    const s = store();
    let release!: (value: unknown) => void;
    const t = {
      getJson: vi.fn(async () => null),
      postJson: vi.fn(() => new Promise<unknown>((resolve) => (release = resolve))),
    };

    const promise = postThreadReply(t, "a1", "hello", s.setThread);
    expect(s.list.map((m) => [m.role, m.content])).toEqual([["user", "hello"]]);

    release({ id: "a1", thread: [USER] });
    await expect(promise).resolves.toBe(true);
  });

  it("replaces the optimistic message with the server's authoritative thread", async () => {
    const s = store([USER]);
    const t = transport({ post: () => ({ id: "a1", thread: [USER, AGENT] }) });
    await expect(postThreadReply(t, "a1", "and again", s.setThread)).resolves.toBe(true);
    expect(s.list).toEqual([USER, AGENT]);
  });

  it("keeps the reply when the server answers an empty 2xx", async () => {
    // A 204 used to read as a refusal: the reply was taken back off the
    // screen and put back in the box, although the server had stored it.
    const s = store();
    const t = { ...transport({}), postJsonAt: vi.fn(async () => ({ status: 204, data: null })) };
    await expect(postThreadReply(t, "a1", "stored", s.setThread)).resolves.toBe(true);
    expect(s.list.map((m) => m.content)).toEqual(["stored"]);
  });

  it("takes the reply back when the server refuses it", async () => {
    const s = store();
    const t = { ...transport({}), postJsonAt: vi.fn(async () => ({ status: 500, data: null })) };
    await expect(postThreadReply(t, "a1", "refused", s.setThread)).resolves.toBe(false);
    expect(s.list).toEqual([]);
  });

  it("keeps the optimistic message when a 2xx carries no thread (partial server)", async () => {
    const s = store();
    const t = transport({ post: () => ({ ok: true }) });
    await expect(postThreadReply(t, "a1", "kept", s.setThread)).resolves.toBe(true);
    expect(s.list.map((m) => m.content)).toEqual(["kept"]);
  });

  it("appends after the existing messages, never before them", async () => {
    const s = store([USER, AGENT]);
    const t = {
      getJson: vi.fn(async () => null),
      postJson: vi.fn(async () => {
        expect(s.list.map((m) => m.content)).toEqual([USER.content, AGENT.content, "third"]);
        return null;
      }),
    };
    await postThreadReply(t, "a1", "third", s.setThread);
  });
});

describe("postThreadReply — revert on failure", () => {
  it("removes the optimistic message when the server refuses", async () => {
    const s = store([USER]);
    await expect(postThreadReply(transport({}), "a1", "lost", s.setThread)).resolves.toBe(false);
    expect(s.list).toEqual([USER]);
  });

  it("leaves messages that arrived mid-flight in place", async () => {
    const s = store([USER]);
    const t = {
      getJson: vi.fn(async () => null),
      postJson: vi.fn(async () => {
        // A refresh lands while the POST is in flight.
        s.setThread((prev) => [AGENT, ...prev]);
        return null;
      }),
    };
    await postThreadReply(t, "a1", "lost", s.setThread);
    expect(s.list).toEqual([AGENT, USER]);
  });

  it("reverts exactly one message even when the same text was sent twice", async () => {
    const s = store();
    const t = transport({ post: () => ({ id: "a1", thread: [] }) });
    await postThreadReply(t, "a1", "same", s.setThread); // 2xx, empty thread → kept
    await postThreadReply(transport({}), "a1", "same", s.setThread); // fails → reverts
    expect(s.list.map((m) => m.content)).toEqual(["same"]);
  });

  it("gives every optimistic message a distinct id", async () => {
    const s = store();
    const t = transport({ post: () => ({ ok: true }) });
    await postThreadReply(t, "a1", "one", s.setThread);
    await postThreadReply(t, "a1", "two", s.setThread);
    expect(new Set(s.list.map((m) => m.id)).size).toBe(2);
  });
});

/**
 * STAYING CURRENT WHILE THE PANE IS OPEN.
 *
 * The agent answers into this thread, and the pane used to read it exactly
 * once: a reply that landed while you were looking at it was invisible until
 * you closed the pane and opened it again. These are the rules that govern
 * what a poll may do to what is already on screen.
 */

describe("fetchAnnotation — the WHOLE annotation, and whether it still exists", () => {
  it("returns the server's annotation", async () => {
    const t = transport({ get: () => ({ id: "a1", status: "pending", thread: [USER] }) });
    await expect(fetchAnnotation(t, "a1")).resolves.toEqual({
      annotation: { id: "a1", status: "pending", thread: [USER] },
      gone: false,
    });
  });

  it("unwraps a {annotation: …} envelope", async () => {
    const t = transport({ get: () => ({ annotation: { id: "a1", status: "resolved" } }) });
    const read = await fetchAnnotation(t, "a1");
    expect(read.annotation?.status).toBe("resolved");
  });

  it("a failed read is NOT 'gone' — the pane must stay open on a blip", async () => {
    await expect(fetchAnnotation(transport({}), "a1")).resolves.toEqual({
      annotation: null,
      gone: false,
    });
  });

  it("a 404 IS 'gone' — the annotation was deleted", async () => {
    const t = {
      getJson: vi.fn(async () => null),
      postJson: vi.fn(async () => null),
      getJsonAt: vi.fn(async () => ({ status: 404, data: null })),
    };
    await expect(fetchAnnotation(t, "a1")).resolves.toEqual({ annotation: null, gone: true });
  });

  it("a status-aware transport still reports a network failure as not-gone", async () => {
    const t = {
      getJson: vi.fn(async () => null),
      postJson: vi.fn(async () => null),
      getJsonAt: vi.fn(async () => ({ status: 0, data: null })),
    };
    await expect(fetchAnnotation(t, "a1")).resolves.toEqual({ annotation: null, gone: false });
  });

  it("rejects a payload that is not an annotation", async () => {
    const t = transport({ get: () => ({ nope: true }) });
    await expect(fetchAnnotation(t, "a1")).resolves.toEqual({ annotation: null, gone: false });
  });
});

describe("annotationThread", () => {
  it("is the annotation's messages", () => {
    expect(annotationThread({ id: "a1", thread: [USER, AGENT] })).toEqual([USER, AGENT]);
  });

  it("is [] for an annotation with no thread, and null for no annotation", () => {
    expect(annotationThread({ id: "a1" })).toEqual([]);
    expect(annotationThread(null)).toBeNull();
  });
});

describe("applyPolledThread", () => {
  it("takes the agent's reply", () => {
    expect(applyPolledThread([USER], [USER, AGENT])).toEqual({
      messages: [USER, AGENT],
      added: 1,
    });
  });

  it("a failed read never blanks the pane", () => {
    expect(applyPolledThread([USER], null)).toEqual({ messages: null, added: 0 });
  });

  it("an unchanged thread is a no-op, so the pane does not re-render every 30s", () => {
    expect(applyPolledThread([USER, AGENT], [USER, AGENT])).toEqual({ messages: null, added: 0 });
  });

  it("never clobbers a reply that is still in flight", () => {
    // The optimistic message is on screen and not yet on the server; taking
    // the server's copy here would make it vanish under the user.
    expect(applyPolledThread([USER], [USER, AGENT], true)).toEqual({ messages: null, added: 0 });
  });

  it("counts only messages the pane has never shown", () => {
    const third: ThreadMessage = { id: "m3", content: "and?", role: "agent" };
    expect(applyPolledThread([USER], [USER, AGENT, third]).added).toBe(2);
  });

  it("takes a thread that SHRANK even though nothing was added", () => {
    expect(applyPolledThread([USER, AGENT], [USER])).toEqual({ messages: [USER], added: 0 });
  });

  it("an empty server thread against an empty pane changes nothing", () => {
    expect(applyPolledThread([], [])).toEqual({ messages: null, added: 0 });
  });
});

describe("newReplyLabel", () => {
  it("counts, and says nothing at zero", () => {
    expect(newReplyLabel(0)).toBe("");
    expect(newReplyLabel(-1)).toBe("");
    expect(newReplyLabel(1)).toBe("1 new reply");
    expect(newReplyLabel(4)).toBe("4 new replies");
  });
});
