/**
 * WHAT A TASK WANTS FROM THE AGENT: a change, or an answer.
 *
 * Most tasks are fixes — "make this green" — and the agent edits. Some are
 * questions — "why is this blue?", "where does this label come from?" — and
 * an agent that edits in reply to one has done the wrong thing well. The
 * composer offers the choice as a small Fix / Question switch, and the task
 * carries it as an additive `intent` field (absent = fix) that a server
 * uses to run the agent read-only and tell it to answer, not edit.
 *
 * Per sheet, never sticky: a question is the exception, and a switch that
 * stayed on Question would turn the next fix into a chat.
 *
 * Pure words and rules, so the composer, the queue, the markers and the
 * detail pane all say the same thing about the same task.
 */

export type TaskIntent = "fix" | "question";

export const DEFAULT_INTENT: TaskIntent = "fix";

export function isTaskIntent(value: unknown): value is TaskIntent {
  return value === "fix" || value === "question";
}

/** The intent a stored task has: `question` when it says so, `fix` for anything else. */
export function readIntent(a: { intent?: unknown } | null | undefined): TaskIntent {
  return a?.intent === "question" ? "question" : "fix";
}

export function intentLabel(intent: TaskIntent): string {
  return intent === "question" ? "Question" : "Fix";
}

/** The primary commit's word. */
export function intentSubmitLabel(intent: TaskIntent, submitting = false): string {
  if (submitting) return "Saving…";
  return intent === "question" ? "Ask the Agent" : "Create Agent Task";
}

export function intentSubmitA11y(intent: TaskIntent): string {
  return intent === "question"
    ? "Ask the agent — it will answer about this element and change nothing"
    : "Create agent task — the agent will make this change";
}

/** The text box's hint. */
export function intentPlaceholder(intent: TaskIntent, canPaste: boolean): string {
  if (intent === "question") return canPaste ? "Ask about this element, or paste an image…" : "Ask about this element…";
  return canPaste ? "Describe the change, or paste an image…" : "Describe the change…";
}

/** The chip a question task wears in lists and on its marker; null for a fix. */
export function intentBadge(intent: TaskIntent): { label: string; glyph: string } | null {
  return intent === "question" ? { label: "Question", glyph: "?" } : null;
}

/** The word for a finished run of this kind of task. */
export function finishedWord(intent: TaskIntent): string {
  return intent === "question" ? "Answered" : "Done";
}

export function intentToggleA11y(intent: TaskIntent, selected: boolean): string {
  const what = intent === "question" ? "Question: the agent answers and changes nothing" : "Fix: the agent makes the change";
  return selected ? `${what}. Selected` : what;
}
