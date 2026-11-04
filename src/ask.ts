/**
 * THE AGENT ASKS YOU SOMETHING.
 *
 * An agent that is not sure which of two buttons you meant should ask, not
 * guess. A headless run cannot stop and wait, so the convention is in the
 * prompt: make no edits, and end with a last line `Question: <one
 * sentence>`. The server reads that line the way it reads `Title:`, stores
 * the reply as an agent message with `kind: "question"`, and marks the task
 * `awaitingReply: true` until the next human reply (docs/protocol.md,
 * "Questions"). No new status value: the task leaves `working` as usual,
 * so every consumer that filters on `pending` keeps working.
 *
 * On the device that means: a banner saying the agent has a question, a
 * "?" on the marker, "Needs your answer" on the Done row, the question
 * quoted above the reply box, and one tap — "Answer and continue" — that
 * posts the reply and sends the task again, so the same agent session picks
 * up where it stopped. These are the words and rules for all of that.
 */

import type { ThreadMessage } from "./thread";

export interface AskableTask {
  id: string;
  comment?: string;
  content?: string;
  text?: string;
  awaitingReply?: boolean;
  thread?: ThreadMessage[];
}

export const NEEDS_ANSWER = "Needs your answer";
export const ANSWER_PLACEHOLDER = "Answer the agent…";

export function isAwaitingReply(a: { awaitingReply?: unknown } | null | undefined): boolean {
  return a?.awaitingReply === true;
}

/** The question the agent is waiting on: its last `kind: "question"` message, while the task awaits a reply. */
export function pendingQuestion(a: AskableTask | null | undefined): ThreadMessage | null {
  if (!a || !isAwaitingReply(a) || !Array.isArray(a.thread)) return null;
  for (let i = a.thread.length - 1; i >= 0; i--) {
    const m = a.thread[i]!;
    if (m.role === "agent" && m.kind === "question") return m;
  }
  return null;
}

/**
 * The reply button while the agent waits. The one tap posts the reply and
 * sends the task again — unless another task has the agent, in which case it
 * only posts, and the queue sends when the agent is free.
 */
export function answerAction(state: { text: string; sending?: boolean; agentBusy?: boolean }): {
  label: string;
  enabled: boolean;
  continues: boolean;
} {
  if (state.sending) return { label: "Sending…", enabled: false, continues: false };
  const has = state.text.trim().length > 0;
  if (state.agentBusy) return { label: "Answer", enabled: has, continues: false };
  return { label: "Answer and continue", enabled: has, continues: true };
}

/** The tasks waiting on an answer, in the order given. */
export function askingTasks<T extends { awaitingReply?: unknown }>(all: readonly T[]): T[] {
  return all.filter((a) => isAwaitingReply(a));
}

const taskText = (a: AskableTask) => {
  const value = a.comment ?? a.content ?? a.text;
  return typeof value === "string" && value.trim() ? value.trim() : "";
};

/** What the banner says: one question names its task, several are counted. */
export function askActivity(asking: readonly AskableTask[]): { count: number; label: string; taskId?: string } {
  const count = asking.length;
  if (count === 0) return { count: 0, label: "" };
  if (count === 1) {
    const text = taskText(asking[0]!);
    const short = text.length > 48 ? `${text.slice(0, 47).trimEnd()}…` : text;
    return { count, label: short ? `The agent has a question about “${short}”` : "The agent has a question", taskId: asking[0]!.id };
  }
  return { count, label: `The agent has ${count} questions` };
}

export function askActivityA11y(activity: { count: number; label: string }): string {
  return activity.count === 1 ? `${activity.label}. Opens the task to answer it` : `${activity.label}. Opens the finished tasks`;
}

/** The ids newly waiting on an answer since the last read: what makes a banner appear once per question. */
export function newlyAsking(known: ReadonlySet<string>, tasks: readonly AskableTask[]): string[] {
  return askingTasks(tasks).map((a) => a.id).filter((id) => !known.has(id));
}
