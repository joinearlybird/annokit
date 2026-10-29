/**
 * The rules that make a message list read as a conversation (src/chat.ts).
 *
 * Grouping is the one worth guarding: whether three lines typed in one
 * breath collapse into a single turn is invisible in a screenshot and
 * exactly the thing that made the old list read as a wall of text.
 */

import { describe, expect, it } from "vitest";
import {
  CHAT_GROUP_WINDOW_MS,
  chatInitial,
  chatTimeMs,
  commentChatMessages,
  continuesGroup,
  formatChatTime,
  groupChatMessages,
  threadChatMessages,
} from "../src/chat";
import type { ChatMessage } from "../src/chat";
import type { CommentMessage } from "../src/comments";
import type { ThreadMessage } from "../src/thread";

const T0 = Date.parse("2026-08-10T09:41:00.000Z");
const at = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();

const msg = (over: Partial<ChatMessage> & { id: string }): ChatMessage => ({
  content: "…",
  side: "other",
  authorKey: "u2",
  authorName: "Ada",
  ...over,
});

describe("what continues a turn", () => {
  it("groups the same author inside the window", () => {
    const a = msg({ id: "1", at: at(0) });
    const b = msg({ id: "2", at: at(60_000) });
    expect(continuesGroup(a, b)).toBe(true);
  });

  it("breaks when the author changes", () => {
    const a = msg({ id: "1", at: at(0) });
    const b = msg({ id: "2", at: at(1_000), authorKey: "u3", authorName: "Lin" });
    expect(continuesGroup(a, b)).toBe(false);
  });

  it("breaks when the same author speaks again much later", () => {
    const a = msg({ id: "1", at: at(0) });
    const b = msg({ id: "2", at: at(CHAT_GROUP_WINDOW_MS + 1) });
    expect(continuesGroup(a, b)).toBe(false);
  });

  it("breaks when the side changes even under one key", () => {
    // Defensive: an author id that resolves to you mid-thread must not put
    // someone else's words on your side of the pane.
    const a = msg({ id: "1", at: at(0), side: "other" });
    const b = msg({ id: "2", at: at(1_000), side: "own" });
    expect(continuesGroup(a, b)).toBe(false);
  });

  it("keeps an un-stamped optimistic reply in the same turn", () => {
    const a = msg({ id: "1", side: "own", authorKey: "you", at: at(0) });
    const b = msg({ id: "2", side: "own", authorKey: "you" });
    expect(continuesGroup(a, b)).toBe(true);
  });

  it("takes the window as an argument", () => {
    const a = msg({ id: "1", at: at(0) });
    const b = msg({ id: "2", at: at(90_000) });
    expect(continuesGroup(a, b, 30_000)).toBe(false);
    expect(continuesGroup(a, b, 120_000)).toBe(true);
  });
});

describe("grouping a thread", () => {
  it("has no groups for no messages", () => {
    expect(groupChatMessages([])).toEqual([]);
  });

  it("collapses a burst and starts again on the other speaker", () => {
    const groups = groupChatMessages([
      msg({ id: "1", authorKey: "u2", at: at(0) }),
      msg({ id: "2", authorKey: "u2", at: at(20_000) }),
      msg({ id: "3", authorKey: "u2", at: at(40_000) }),
      msg({ id: "4", authorKey: "u9", authorName: "Lin", at: at(50_000) }),
      msg({ id: "5", authorKey: "u2", at: at(60_000) }),
    ]);
    expect(groups.map((g) => g.messages.length)).toEqual([3, 1, 1]);
    expect(groups.map((g) => g.authorName)).toEqual(["Ada", "Lin", "Ada"]);
  });

  it("keeps every message, in order", () => {
    const input = [
      msg({ id: "1", at: at(0) }),
      msg({ id: "2", at: at(10 * 60_000) }),
      msg({ id: "3", side: "own", authorKey: "you", authorName: "You", at: at(11 * 60_000) }),
    ];
    const flat = groupChatMessages(input).flatMap((g) => g.messages.map((m) => m.id));
    expect(flat).toEqual(["1", "2", "3"]);
  });

  it("takes the turn's identity and time from its first message", () => {
    const [group] = groupChatMessages([
      msg({ id: "1", at: at(0), avatarUrl: "https://x/a.png" }),
      msg({ id: "2", at: at(30_000) }),
    ]);
    expect(group.key).toBe("1");
    expect(group.at).toBe(at(0));
    expect(group.avatarUrl).toBe("https://x/a.png");
  });

  it("adopts the first real stamp when the turn opened on an optimistic message", () => {
    const [group] = groupChatMessages([
      msg({ id: "1", side: "own", authorKey: "you" }),
      msg({ id: "2", side: "own", authorKey: "you", at: at(0) }),
    ]);
    expect(group.at).toBe(at(0));
  });
});

describe("who is speaking, on an agent task", () => {
  const thread: ThreadMessage[] = [
    { id: "m1", content: "Make it amber", role: "user", timestamp: at(0) },
    { id: "m2", content: "Done", role: "agent", timestamp: at(1_000) },
  ];

  it("puts your messages on your side and the agent on its own", () => {
    const chat = threadChatMessages(thread);
    expect(chat.map((m) => m.side)).toEqual(["own", "agent"]);
    expect(chat.map((m) => m.authorName)).toEqual(["You", "Agent"]);
  });

  it("never groups you with the agent", () => {
    expect(groupChatMessages(threadChatMessages(thread))).toHaveLength(2);
  });

  it("survives a message the server sent without an id", () => {
    const chat = threadChatMessages([{ id: "", content: "hi", role: "user" }]);
    expect(chat[0].id).toBe("msg-0");
  });
});

describe("who is speaking, on a team note", () => {
  const messages: CommentMessage[] = [
    { id: "c1", content: "Copy reads odd", author: { id: "u1", name: "Johnny" }, createdAt: at(0) },
    { id: "c2", content: "Agreed", author: { id: "u2", name: "Ada" }, createdAt: at(1_000) },
    { id: "c3", content: "…", author: { id: "" }, createdAt: at(2_000) },
  ];

  it("is mine only when the server has echoed my id back", () => {
    expect(commentChatMessages(messages, "u1").map((m) => m.side)).toEqual([
      "own",
      "other",
      "other",
    ]);
  });

  it("reads as everyone else's while the viewer is unknown", () => {
    // The safe way to be wrong: a neutral thread, never someone else's
    // words in your colour on your side.
    expect(commentChatMessages(messages, null).every((m) => m.side === "other")).toBe(true);
  });

  it("says 'You' rather than your own name on your side", () => {
    expect(commentChatMessages(messages, "u1")[0].authorName).toBe("You");
  });

  it("still names an author the server could not resolve", () => {
    const chat = commentChatMessages(messages, "u1");
    expect(chat[2].authorName).toBe("Someone");
    // …and unnamed strangers do not all collapse into one person.
    expect(chat[2].authorKey).toBe("name:Someone");
  });

  it("carries the server's avatar through", () => {
    const chat = commentChatMessages(
      [{ id: "c1", content: "hi", author: { id: "u2", avatarUrl: "https://x/a.png" } }],
      "u1",
    );
    expect(chat[0].avatarUrl).toBe("https://x/a.png");
  });
});

describe("when it was said", () => {
  // Local-time construction on purpose: the formatter reads the device's
  // clock, so the expectations must be built the same way.
  const now = new Date(2026, 7, 10, 18, 0, 0);
  const iso = (y: number, mo: number, d: number, h: number, mi: number) =>
    new Date(y, mo, d, h, mi).toISOString();

  it("is just the clock for today", () => {
    expect(formatChatTime(iso(2026, 7, 10, 9, 41), now)).toBe("9:41 am");
    expect(formatChatTime(iso(2026, 7, 10, 14, 5), now)).toBe("2:05 pm");
  });

  it("says midnight and noon the way people do", () => {
    expect(formatChatTime(iso(2026, 7, 10, 0, 4), now)).toBe("12:04 am");
    expect(formatChatTime(iso(2026, 7, 10, 12, 0), now)).toBe("12:00 pm");
  });

  it("names yesterday", () => {
    expect(formatChatTime(iso(2026, 7, 9, 22, 30), now)).toBe("Yesterday 10:30 pm");
  });

  it("gives a date once it is older, and a year once it is another one", () => {
    expect(formatChatTime(iso(2026, 7, 3, 9, 41), now)).toBe("Aug 3, 9:41 am");
    expect(formatChatTime(iso(2025, 11, 24, 9, 41), now)).toBe("Dec 24 2025, 9:41 am");
  });

  it("shows nothing rather than 'Invalid Date'", () => {
    expect(formatChatTime(undefined, now)).toBe("");
    expect(formatChatTime("whenever", now)).toBe("");
    expect(chatTimeMs("whenever")).toBe(null);
  });
});

describe("avatar fallback", () => {
  it("is the first letter, capitalised", () => {
    expect(chatInitial("ada")).toBe("A");
    expect(chatInitial("  Johnny")).toBe("J");
  });

  it("never renders an empty circle", () => {
    expect(chatInitial("")).toBe("?");
  });
});

/**
 * OWNERSHIP, IMMEDIATELY. The bug this replaced: with nothing echoed yet,
 * your own opening message rendered left, neutral, as a stranger's.
 */
describe("own-message detection with a resolved identity", () => {
  const msg = (id: string, content: string, author: { id?: string; name?: string }) => ({
    id,
    content,
    author: { id: author.id ?? "", ...(author.name ? { name: author.name } : {}) },
  });

  it("puts the FIRST message on your side when the host named you", () => {
    const [first] = commentChatMessages(
      [msg("m1", "Is this right?", { id: "u1", name: "Johnny" })],
      { id: "u1", name: "Johnny", avatarUrl: null, source: "prop" },
    );
    expect(first).toMatchObject({ side: "own", authorName: "You" });
  });

  it("recognises a message a no-auth server labelled with the name we typed", () => {
    const [first] = commentChatMessages([msg("m1", "hi", { name: "Johnny" })], {
      id: null,
      name: "Johnny",
      avatarUrl: null,
      source: "prompt",
    });
    expect(first).toMatchObject({ side: "own" });
  });

  it("leaves a teammate where they belong, name and all", () => {
    const [first] = commentChatMessages([msg("m1", "hi", { id: "u2", name: "Dana" })], {
      id: "u1",
      name: "Johnny",
      avatarUrl: null,
      source: "prop",
    });
    expect(first).toMatchObject({ side: "other", authorName: "Dana" });
  });

  it("claims nothing when no tier has answered", () => {
    const [first] = commentChatMessages([msg("m1", "hi", { id: "u1", name: "Johnny" })], null);
    expect(first).toMatchObject({ side: "other" });
  });
});
