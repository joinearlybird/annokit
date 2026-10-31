/**
 * The row vocabulary behind the queue panel: what a row says, which rows can
 * be sent, and what the Send button will actually do.
 *
 * WHAT THE QUEUE IS. The queue is the send-to-the-agent workflow — the list
 * of agent tasks with a Send button under it (product owner). It briefly held
 * team notes too; that made the panel a catch-all inbox, when everything it
 * offers (tick, send, delete) only ever applied to half of what it showed.
 * So `buildTaskRows` is what the panel renders, and team notes stay where
 * they are acted on: their marker and their detail pane.
 *
 * THE MIXED HELPERS STAY. `buildQueueRows`, `filterQueueRows` and
 * `queueFilterChips` still build and segment a both-kinds list; nothing
 * renders them today. They cost nothing, they are covered, and a separate
 * notes list is a plausible next thing to want — which is also why every row
 * still carries its destination badge and a note row still carries the reason
 * it cannot be ticked.
 *
 * SELECTION IS AGENT-ONLY, AND THE TICKS ARE THE TRUTH. "Send to agent"
 * hands pending annotations over, and what goes is exactly what is ticked.
 * Every task starts ticked (`tickedIds`), unticking holds one back, and the
 * label counts the ticks (`sendLabel`). It used to be the other way round —
 * nothing ticked meant "all of them" — which put an EMPTY box beside a task
 * and a button promising to send it, straight after creating it.
 *
 * Pure — no react-native, no transport — because "what does Send send?" is
 * exactly the kind of rule that is invisible until it is wrong.
 */

import type { Comment } from "./comments";
import { destinationBadge } from "./destination";
import type { DestinationPalette } from "./destination";
import { splitTaskBody, taskOriginLine, taskReopenLabel } from "./message-task";
import type { SubmitDestination } from "./destination";
import { WORKING_STATUS, taskProgress } from "./agent-activity";
import type { ServerAnnotation } from "./types";

/** A row in a queue list. `kind` is the destination it went to. */
export interface QueueRow {
  id: string;
  kind: SubmitDestination;
  /** What was written. Never empty — see `rowText`. */
  text: string;
  /** "Element · /route", or "" when neither is known. */
  meta: string;
  /** Destination label ("Agent task" / "Team note") and its colour. */
  badgeLabel: string;
  badgeColor: string;
  /** Lifecycle word, when the item has one worth showing. */
  status?: string;
  /**
   * The team note this task was made from, when it was. The row shows a
   * quiet "From a team note" line that opens the discussion — the reverse
   * of the note's own Tasks tab (src/message-task.ts).
   */
  sourceCommentId?: string;
  /** That line's words, or undefined for a task written directly. */
  originLabel?: string;
  /** The agent has this one right now (status `working`). */
  working?: boolean;
  /** What the agent says it is doing on it, when the server says. */
  progress?: string;
  /** Only agent tasks can be bulk-sent, and only ones the agent has not got. */
  selectable: boolean;
  /** Shown in place of a checkbox on the rows that have none. */
  unselectableReason?: string;
}

/** The filter chips above the list. `all` is the default and the point. */
export type QueueFilter = "all" | "agent" | "team";

const NO_TEXT = "(no text)";

/**
 * The row's line is the request. A task made from a team note carries the
 * quoted discussion under it (src/message-task.ts); that is the agent's
 * context, and in a two-line row it would push the lead-in into the title.
 */
function annotationText(a: ServerAnnotation): string {
  const value = a.comment ?? a.content ?? a.text;
  return typeof value === "string" && value.trim() ? splitTaskBody(value).request : NO_TEXT;
}

function commentText(c: Comment): string {
  const first = c.messages.find((m) => m.content.trim());
  return first ? first.content.trim() : NO_TEXT;
}

function meta(element?: string, routeName?: string): string {
  return [element, routeName].filter(Boolean).join(" · ");
}

/**
 * The team note's lifecycle, in the same vocabulary as everything else —
 * and NOTHING for a converted note.
 *
 * "Given to the agent" was the word for `converted`. It is gone (product
 * owner, device testing: trimming the status vocabulary), and no word
 * replaced it, because renaming was never the ask. What the state still has
 * is BEHAVIOUR: `isCommentSettled` counts converted as settled, so its row
 * and its marker are dimmed to 45% exactly as a resolved one is, and the
 * note detail's Tasks tab lists what it produced. The empty string is the
 * "no word" signal every caller already handles — rows and the detail
 * header both render their status only when it is non-empty.
 *
 * `teamNoteStatusA11y` is the same lifecycle for screen readers, which get
 * neither the dimming nor the tab and so keep all three words.
 */
export function teamNoteStatus(status: Comment["status"]): string {
  if (status === "converted") return "";
  if (status === "resolved") return "Resolved";
  return "Open";
}

/** The lifecycle with nothing left out, for accessibility labels only. */
export function teamNoteStatusA11y(status: Comment["status"]): string {
  if (status === "converted") return "Given to the agent";
  return teamNoteStatus(status);
}

/**
 * What the queue panel renders: the agent's pending tasks, in server order.
 * Rows with no id are skipped rather than rendered as something that cannot
 * be opened.
 *
 * A WORKING TASK IS IN THE LIST, AND SAYS SO. The pending list carries the
 * task an agent is mid-way through (it is not finished), and it used to be
 * drawn exactly like the ones waiting: ticked, counted by Send, and with
 * nothing to say which one the agent had. It is now marked and cannot be
 * ticked — handing the agent a task it already has is not a choice.
 */
export function buildTaskRows(
  annotations: readonly ServerAnnotation[],
  palette?: DestinationPalette,
): QueueRow[] {
  const badge = destinationBadge("agent", palette);
  const rows: QueueRow[] = [];
  for (const a of annotations) {
    if (!a || typeof a.id !== "string") continue;
    const working = a.status === WORKING_STATUS;
    rows.push({
      id: a.id,
      kind: "agent",
      text: annotationText(a),
      meta: meta(a.element, a.routeName),
      badgeLabel: badge.label,
      badgeColor: badge.color,
      // Only a reopened task carries a word here. A task waiting to be sent
      // is what this whole panel is, so labelling every row "Pending" would
      // be a column of noise with the one thing that matters hidden in it.
      status: working ? "Working…" : taskReopenLabel(a),
      sourceCommentId: a.sourceCommentId,
      originLabel: taskOriginLine(a),
      working,
      ...(taskProgress(a) ? { progress: taskProgress(a) } : {}),
      selectable: !working,
      ...(working ? { unselectableReason: "The agent is working on this" } : {}),
    });
  }
  return rows;
}

/** The team's notes as rows — never sendable in bulk, and each says why. */
export function buildNoteRows(
  comments: readonly Comment[],
  palette?: DestinationPalette,
): QueueRow[] {
  const badge = destinationBadge("comment", palette);
  const rows: QueueRow[] = [];
  for (const c of comments) {
    if (!c || typeof c.id !== "string") continue;
    rows.push({
      id: c.id,
      kind: "comment",
      text: commentText(c),
      meta: meta(c.element, c.routeName),
      badgeLabel: badge.label,
      badgeColor: badge.color,
      status: teamNoteStatus(c.status),
      selectable: false,
      unselectableReason: "Open to make a task from a message",
    });
  }
  return rows;
}

/**
 * Both stores as one list: agent tasks first (they are the ones with a Send
 * button under them), team notes after, each keeping its own order so the
 * numbering users read off the markers still lines up.
 *
 * Nothing renders this today — the queue is tasks-only (see the file header).
 * Kept, exported and covered for the notes list that may follow.
 */
export function buildQueueRows(
  annotations: readonly ServerAnnotation[],
  comments: readonly Comment[],
  palette?: DestinationPalette,
): QueueRow[] {
  return [...buildTaskRows(annotations, palette), ...buildNoteRows(comments, palette)];
}

export function filterQueueRows(rows: readonly QueueRow[], filter: QueueFilter): QueueRow[] {
  if (filter === "agent") return rows.filter((r) => r.kind === "agent");
  if (filter === "team") return rows.filter((r) => r.kind === "comment");
  return [...rows];
}

export interface QueueFilterChip {
  key: QueueFilter;
  label: string;
  count: number;
}

/**
 * The chips, always all three (a chip that disappears at zero moves the
 * others under the user's thumb), with All first because it is the default.
 */
export function queueFilterChips(rows: readonly QueueRow[]): QueueFilterChip[] {
  const agent = rows.filter((r) => r.kind === "agent").length;
  const team = rows.length - agent;
  return [
    { key: "all", label: "All", count: rows.length },
    { key: "agent", label: "Agent tasks", count: agent },
    { key: "team", label: "Team notes", count: team },
  ];
}

/**
 * The ticked tasks: every sendable row the user has not unticked.
 *
 * Opt-OUT, so a task is ticked the moment it appears — the one just created,
 * or one that arrives while the panel is open — and a box can never be empty
 * beside a task that Send is about to hand over.
 */
export function tickedIds(rows: readonly QueueRow[], unticked: ReadonlySet<string>): string[] {
  return rows.filter((r) => r.selectable && !unticked.has(r.id)).map((r) => r.id);
}

/** The ids Send would actually hand over: selected AND sendable. */
export function sendableIds(
  rows: readonly QueueRow[],
  selected: ReadonlySet<string>,
): string[] {
  return rows.filter((r) => r.selectable && selected.has(r.id)).map((r) => r.id);
}

/**
 * How many agent tasks there are to send — Send is dead without them. A
 * task the agent is already working on is not one.
 */
export function agentTaskCount(rows: readonly QueueRow[]): number {
  return rows.filter((r) => r.kind === "agent" && !r.working).length;
}

/**
 * What the Send button says, and whether it can be pressed.
 *
 * "Send all" when every task is ticked, "Send selected" when some are held
 * back — no count, the ticks already show it — and a team note is never
 * one of them. Nothing ticked sends nothing: the button says so instead of
 * quietly meaning "everything".
 *
 * `agentBusy` CLOSES IT WHILE AN AGENT IS MID-TASK. The agents this is
 * built for edit a working tree, and two of them let loose on the same one
 * do not queue politely — they both open the same file and the second write
 * wins, so one of the two requests disappears with nothing to show that it
 * did. Refusing the second press is the honest answer, and the button says
 * why rather than going quiet. A server that genuinely runs agents in
 * parallel simply never reports one as `working` while another could start.
 */
export function sendLabel(state: {
  rows: readonly QueueRow[];
  selected: ReadonlySet<string>;
  sending?: boolean;
  agentBusy?: boolean;
}): { label: string; enabled: boolean } {
  const total = agentTaskCount(state.rows);
  const picked = sendableIds(state.rows, state.selected).length;
  if (state.sending) return { label: "Sending…", enabled: false };
  if (state.agentBusy) return { label: "Agent is working…", enabled: false };
  if (total === 0) return { label: "No agent tasks to send", enabled: false };
  if (picked === 0) return { label: "Tick a task to send it", enabled: false };
  return { label: picked === total ? "Send all" : "Send selected", enabled: true };
}

/**
 * SEND THIS ONE, FROM THE TASK ITSELF.
 *
 * The queue's bulk Send was the only way to hand anything over, which made
 * the pane where you actually refine a task a dead end: you typed the
 * clarification the agent asked for, and then had to go back out to a list
 * and find the row again to do anything with it. Worse, after the agent had
 * resolved a task, its row was not in that list at all — the reply reopened
 * it server-side and the only control that could act on it was somewhere the
 * user could no longer see it.
 *
 * So the detail pane gets the same commit, scoped to one task. It is
 * DELIBERATELY a separate press from posting the reply: a reply is typed a
 * sentence at a time and often several in a row, and starting a turn on each
 * one would set the agent off on half a thought.
 *
 * `reopened` only changes the words — the action is the same POST — because
 * "send it again" and "send it" are different promises to a reader who just
 * watched the agent call this finished.
 */
export function detailSendLabel(state: {
  status?: string;
  reopened?: boolean;
  sending?: boolean;
  agentBusy?: boolean;
}): { label: string; enabled: boolean } {
  if (state.sending) return { label: "Sending…", enabled: false };
  // Anything that is not pending is with the agent (or dismissed): there is
  // nothing to hand over, and the button says which rather than vanishing.
  // THIS check comes first so the task being worked on says so about
  // ITSELF, rather than the generic "some agent is busy" below.
  if (state.status && state.status !== "pending") {
    return { label: "With the agent", enabled: false };
  }
  // A DIFFERENT task is in flight — see sendLabel for why a second one may
  // not start.
  if (state.agentBusy) return { label: "Agent is working…", enabled: false };
  return {
    label: state.reopened ? "Send refinement to agent" : "Send to agent",
    enabled: true,
  };
}

/**
 * The empty state, which has to teach as well as report: a first-time user
 * arrives here before they have left anything, and this is the only place
 * that can tell them what the panel is for. `agent` is the one the queue
 * renders; the others belong to the unused mixed list.
 */
export function queueEmptyText(filter: QueueFilter, commentsAvailable = true): string {
  if (filter === "agent") {
    return "No agent tasks yet. Tap Annotate, pick something on the screen, then choose Send to · Agent.";
  }
  if (filter === "team") {
    return commentsAvailable
      ? "No team notes yet — notes are for your teammates; the agent won't act on them."
      : "Team notes are unavailable — this server has no comment routes.";
  }
  return "Nothing here yet. Tap Annotate, pick something on the screen, then choose whether to ask the agent or leave a note for the team.";
}

/**
 * The panel's own title.
 *
 * It says what the panel DOES, because that is the one thing the rows below
 * it cannot: they are a list of tasks, and the point of the list is the Send
 * button under it. It carries no count — the rows and the toolbar's Queue
 * entry both already said it (product owner). The argument is kept because
 * callers pass the rows and a future title may want them again.
 */
export function queueTitle(_rows: readonly QueueRow[]): string {
  return "Send to the agent";
}
