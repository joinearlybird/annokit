/** The agent asks the user (src/ask.ts): what counts as waiting, what the device says, and the one-tap answer. */

import { describe, expect, it } from "vitest";
import {
  ANSWER_PLACEHOLDER,
  NEEDS_ANSWER,
  answerAction,
  askActivity,
  askActivityA11y,
  askingTasks,
  isAwaitingReply,
  newlyAsking,
  pendingQuestion,
} from "../src/ask";
import type { ThreadMessage } from "../src/thread";

const q = (content: string): ThreadMessage => ({ id: `q-${content.length}`, role: "agent", content, kind: "question" });
const agent = (content: string): ThreadMessage => ({ id: `a-${content.length}`, role: "agent", content });
const user = (content: string): ThreadMessage => ({ id: `u-${content.length}`, role: "user", content });

describe("waiting on an answer", () => {
  it("is exactly what the server says", () => {
    expect(isAwaitingReply({ awaitingReply: true })).toBe(true);
    expect(isAwaitingReply({ awaitingReply: "yes" })).toBe(false);
    expect(isAwaitingReply({})).toBe(false);
    expect(isAwaitingReply(null)).toBe(false);
    expect(askingTasks([{ id: "a", awaitingReply: true }, { id: "b" }, { id: "c", awaitingReply: true }]).map((t) => t.id)).toEqual(["a", "c"]);
  });

  it("finds the question the agent is waiting on: the last question message, only while waiting", () => {
    const thread = [agent("Done."), user("Darker?"), q("Which button?"), user("The left"), q("Left of the two blue ones?")];
    expect(pendingQuestion({ id: "t", awaitingReply: true, thread })?.content).toBe("Left of the two blue ones?");
    expect(pendingQuestion({ id: "t", awaitingReply: false, thread })).toBeNull();
    expect(pendingQuestion({ id: "t", awaitingReply: true, thread: [agent("Made it blue.")] })).toBeNull();
    expect(pendingQuestion({ id: "t", awaitingReply: true })).toBeNull();
    expect(pendingQuestion(null)).toBeNull();
  });
});

describe("the answer button", () => {
  it("posts and continues in one tap, posts only while another task has the agent", () => {
    expect(answerAction({ text: "The left one" })).toEqual({ label: "Answer and continue", enabled: true, continues: true });
    expect(answerAction({ text: "   " })).toEqual({ label: "Answer and continue", enabled: false, continues: true });
    expect(answerAction({ text: "x", agentBusy: true })).toEqual({ label: "Answer", enabled: true, continues: false });
    expect(answerAction({ text: "x", sending: true })).toEqual({ label: "Sending…", enabled: false, continues: false });
    expect(ANSWER_PLACEHOLDER).toBe("Answer the agent…");
    expect(NEEDS_ANSWER).toBe("Needs your answer");
  });
});

describe("the banner", () => {
  it("names the task for one question and counts several", () => {
    expect(askActivity([])).toEqual({ count: 0, label: "" });
    expect(askActivity([{ id: "a", comment: "Make one of these two buttons bigger", awaitingReply: true }])).toEqual({
      count: 1, label: "The agent has a question about “Make one of these two buttons bigger”", taskId: "a",
    });
    expect(askActivity([{ id: "a", awaitingReply: true }]).label).toBe("The agent has a question");
    const long = askActivity([{ id: "a", comment: "x".repeat(80), awaitingReply: true }]).label;
    expect(long).toMatch(/^The agent has a question about “x{47}…”$/);
    expect(askActivity([{ id: "a", awaitingReply: true }, { id: "b", awaitingReply: true }])).toEqual({ count: 2, label: "The agent has 2 questions" });
  });

  it("tells a screen reader where the tap goes", () => {
    expect(askActivityA11y({ count: 1, label: "L" })).toMatch(/Opens the task/);
    expect(askActivityA11y({ count: 3, label: "L" })).toMatch(/Opens the finished tasks/);
  });

  it("appears once per new question: only ids not seen before", () => {
    const tasks = [{ id: "a", awaitingReply: true }, { id: "b", awaitingReply: true }, { id: "c" }];
    expect(newlyAsking(new Set(), tasks)).toEqual(["a", "b"]);
    expect(newlyAsking(new Set(["a"]), tasks)).toEqual(["b"]);
    expect(newlyAsking(new Set(["a", "b"]), tasks)).toEqual([]);
  });
});
