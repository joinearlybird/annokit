/**
 * ONE MESSAGE (or a few) BECOMES AN AGENT TASK.
 *
 * The old bridge took a whole team note and handed the AGENT the entire
 * discussion, then marked the note `converted` and refused to do it again.
 * Three things were wrong with that, all of them reported from the device:
 *
 *   · nobody could tell what was going to be sent;
 *   · a discussion is mostly context — usually exactly ONE line in it is the
 *     actionable request, and flattening ten replies buries it;
 *   · `converted` read as a dead end. The note was still an open
 *     conversation; the UI said it was finished.
 *
 * So the unit of work is now the MESSAGE. You mark one bubble (or a couple,
 * when the request spans replies) and that becomes a task. The note is not
 * consumed by it: it stays open, it can spawn another task tomorrow, and the
 * bubble that already spawned one carries a small mark that OPENS the task
 * rather than a label saying you may not ask again.
 *
 * AND THE USER GETS TO SAY WHAT THEY WANT. Quoting a discussion tells the
 * agent what was SAID; it does not tell it what to DO — "the padding is
 * wrong" is an observation, and a task built out of observations makes the
 * agent guess the request (product owner, device testing). So the flow has
 * an instruction box of its own: the typed sentence is the request and leads
 * the body, the quoted messages follow it as context under their own lead-in
 * (`composeMessageTaskComment`), and either one alone is enough to send.
 *
 * Everything here is pure except the last function, for the usual reason:
 * "which messages went, in what order, under whose name" is invisible in a
 * screenshot and obvious in a test. src/comment-view.tsx only draws it.
 */

import { formatChatTime } from "./chat";
import { authorName, commentToCapture, fetchComment } from "./comments";
import type { Comment, CommentMessage, CommentTransport } from "./comments";
import { applyOutputDetail, buildAnnotationBody } from "./payload";
import type { AnnotationBody } from "./payload";
import { annoKitPreferences } from "./prefs";
import type { OutputDetail } from "./prefs";
import { sessionAnnotationsPath } from "./url";
import { postAccepted } from "./transport";

// ── Selection ─────────────────────────────────────────────────────────────

/**
 * Tick or untick one message. A plain array rather than a Set: it is the
 * state a component holds, it has to be cheap to compare for React, and the
 * counts involved are a handful.
 */
export function toggleMessageSelection(selected: readonly string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id];
}

/**
 * The selected messages, in THREAD ORDER — never in tap order.
 *
 * The order a task quotes its messages in is the order the conversation
 * happened in; a reply that arrives above its question is a different (and
 * wrong) statement of the same request. Ids that no longer exist, and
 * messages with nothing in them, drop out here rather than at the wire.
 */
export function selectedMessages(
  messages: readonly CommentMessage[],
  selected: readonly string[],
): CommentMessage[] {
  const wanted = new Set(selected);
  return messages.filter((m) => wanted.has(m.id) && m.content.trim());
}

/**
 * Is there anything to send?
 *
 * TWO WAYS TO HAVE SOMETHING, since the flow grew its own input: quoted
 * messages, or an instruction the user typed, or both. Only the empty-empty
 * case is refused — a task with a written request and no quotes is a
 * perfectly ordinary task (it still carries the note's captured element),
 * and a task with quotes and no request is the behaviour this flow shipped
 * with.
 */
export function canMakeMessageTask(
  messages: readonly CommentMessage[],
  selected: readonly string[],
  instruction = "",
): boolean {
  if (instruction.trim().length > 0) return true;
  return selectedMessages(messages, selected).length > 0;
}

/**
 * What the action button says.
 *
 * The count is in the label because the whole complaint about the old flow
 * was not knowing what would be sent — and with none picked it says so
 * rather than counting to zero, because a typed instruction with no quotes
 * is a legitimate task and the button must not read as broken.
 */
export function messageTaskActionLabel(count: number): string {
  if (count <= 0) return "Create agent task";
  if (count === 1) return "Create agent task from 1 message";
  return `Create agent task from ${count} messages`;
}

/** The words on the control that STARTS the flow, in the note's action row. */
export const CREATE_TASK_LABEL = "Create agent task";

/**
 * The hint above the instruction box, which has to teach the two halves of
 * the flow at once: tick messages for context, type what you want done.
 */
export function messageTaskFlowHint(count: number): string {
  if (count === 0) return "Type what the agent should do, and tick any messages for context";
  return count === 1 ? "1 message picked for context" : `${count} messages picked for context`;
}

/** Screen-reader name for a bubble in selection mode. */
export function messageSelectionLabel(author: string, picked: boolean): string {
  return picked ? `${author}: selected for the agent` : `${author}: select for the agent`;
}

// ── The task body ─────────────────────────────────────────────────────────

/** An annotation body that came from one or more team-note messages. */
export interface MessageTaskAnnotationBody extends AnnotationBody {
  /**
   * The discussion it came out of. Unchanged from the whole-thread bridge:
   * it is how a consumer ties the agent's work back to the conversation
   * that asked for it, and how a server tells the two apart.
   */
  sourceCommentId: string;
  /**
   * WHICH messages were quoted — additive to the protocol, and the thing
   * that lets the discussion draw a back-link on the exact bubbles that
   * spawned this task (see `messageTaskMarks`).
   *
   * OMITTED when the user typed a request and ticked nothing: a back-link to
   * zero messages is not a back-link, and an empty array would have every
   * consumer deciding for itself whether that means "none" or "unknown".
   */
  sourceMessageIds?: string[];
}

/**
 * The quoted messages, as the agent reads them.
 *
 * Same shape the whole-thread flatten used — `"Author: what they said"`,
 * blank line between, thread order — because that part was never the
 * problem: a human exchange without its speakers is unreadable ("no, the
 * other one" attributed to nobody). What changed is WHICH messages are in
 * it.
 */
export function messageTaskComment(selected: readonly CommentMessage[]): string {
  return selected
    .filter((m) => m.content.trim())
    .map((m) => `${authorName(m.author)}: ${m.content.trim()}`)
    .join("\n\n");
}

/** The line that separates the request from the discussion it came out of. */
export const TASK_CONTEXT_LEAD_IN = "From the discussion:";

/**
 * THE TASK BODY: what was asked, then what was said.
 *
 * The flow now has two inputs — messages ticked in the thread and a sentence
 * typed in the bottom bar — and their ROLES are different, so their order is
 * not cosmetic. The typed sentence is the REQUEST: it is the thing the agent
 * is being asked to do, and it goes first, unadorned, so an agent reading
 * the first line already knows the job. The quoted messages are CONTEXT:
 * what the team said that led to the request, under a lead-in that names
 * them as such, so a discussion can never be mistaken for the instruction.
 *
 * The three usable combinations:
 *   BOTH      — request, blank line, "From the discussion:", the quotes.
 *   TEXT ONLY — the request alone. Still a real task: the note's captured
 *               element travels with it, so the agent knows what it is about.
 *   QUOTES ONLY — exactly what this flow sent before the input existed, byte
 *               for byte, so nothing regressed for the one-tap bubble action.
 *
 * Null for neither, which is also what the button's disabled state means.
 */
export function composeMessageTaskComment(
  instruction: string,
  selected: readonly CommentMessage[],
): string | null {
  const request = instruction.trim();
  const quoted = messageTaskComment(selected);
  if (request && quoted) return `${request}\n\n${TASK_CONTEXT_LEAD_IN}\n\n${quoted}`;
  if (request) return request;
  return quoted || null;
}

/**
 * The annotation the selected messages become: an ordinary protocol-v1 body
 * carrying the NOTE's captured identity (element, componentStack, source,
 * testID, routeName, coordinates, boundingBox, scroll) — the agent should
 * not be able to tell it from a direct annotation except by the two source
 * fields. Null when nothing sendable was selected.
 *
 * Trimmed to Output Detail like every other task (src/payload.ts): the
 * note kept the full identity, but the setting governs what the AGENT
 * receives, whichever door the task came in through.
 */
export function buildMessageTaskBody(
  comment: Comment,
  messageIds: readonly string[],
  annotationId: string,
  instruction = "",
  outputDetail: OutputDetail = annoKitPreferences().outputDetail,
): MessageTaskAnnotationBody | null {
  const chosen = selectedMessages(comment.messages, messageIds);
  const text = composeMessageTaskComment(instruction, chosen);
  if (text === null) return null;
  const body = applyOutputDetail(
    buildAnnotationBody(commentToCapture(comment), text, annotationId),
    outputDetail,
  );
  return {
    ...body,
    sourceCommentId: comment.id,
    ...(chosen.length > 0 ? { sourceMessageIds: chosen.map((m) => m.id) } : {}),
  };
}

// ── The mark on a bubble that already spawned a task ───────────────────────

/** The little the mark resolver needs off an annotation. */
export interface TaskLinkSource {
  id: string;
  sourceCommentId?: string;
  sourceMessageIds?: string[];
}

/**
 * The tasks a note can point at: the pending list, plus the session's
 * tasks that came from a note but have since left the queue.
 *
 * The pending list alone forgot a task the moment it was sent — exactly
 * when the agent's answer starts to matter — so the note's Tasks tab
 * emptied, its marker lost the pip, and the task could no longer be opened
 * from the note at all. The pending copy wins where both have one: it is
 * the list refreshed most often.
 */
export function mergeTaskLists<T extends { id: string }>(
  pending: readonly T[],
  linked: readonly T[],
): T[] {
  const ids = new Set(pending.map((a) => a.id));
  return [...pending, ...linked.filter((a) => !ids.has(a.id))];
}

/** A task this device created in this session, before any server round-trip. */
export interface LocalTaskLink {
  messageId: string;
  annotationId: string;
}

/** What a marked bubble shows. */
export interface MessageTaskMark {
  annotationId: string;
  /**
   * True when that task can actually be opened — i.e. it is in the list we
   * hold. False degrades the mark to a plain, non-interactive one rather
   * than to a button that opens nothing: older data (before
   * `sourceMessageIds` existed), a server that did not persist the field, or
   * a task already sent and gone from pending all land here.
   */
  openable: boolean;
}

/**
 * WHICH BUBBLES CARRY A MARK, and which of those can be tapped.
 *
 * The durable answer comes from the annotations themselves — a task that
 * says `sourceCommentId` + `sourceMessageIds` is a back-link that survives a
 * reload and is visible to every device. The local links are the fallback
 * for the same session: when the server drops the new field, this device
 * still knows what it just did, and the bubble is still marked (unopenable,
 * because nothing can resolve it later).
 */
export function messageTaskMarks(
  annotations: readonly TaskLinkSource[],
  local: readonly LocalTaskLink[],
  commentId: string,
): Record<string, MessageTaskMark> {
  const marks: Record<string, MessageTaskMark> = {};
  const known = new Set<string>();
  for (const a of annotations) {
    if (!a || typeof a.id !== "string") continue;
    known.add(a.id);
    if (a.sourceCommentId !== commentId || !Array.isArray(a.sourceMessageIds)) continue;
    for (const messageId of a.sourceMessageIds) {
      if (typeof messageId !== "string" || !messageId) continue;
      marks[messageId] = { annotationId: a.id, openable: true };
    }
  }
  for (const link of local) {
    // The server's own answer wins: it is the one another device would see.
    if (marks[link.messageId]?.openable) continue;
    marks[link.messageId] = {
      annotationId: link.annotationId,
      openable: known.has(link.annotationId),
    };
  }
  return marks;
}

/**
 * HOW MANY TASKS EACH NOTE HAS SPAWNED — what the note's own marker shows.
 *
 * The relationship has to be legible from the screen too, not only from
 * inside the thread. It is deliberately NOT a second marker: the note
 * already has an orange square on that element, and a blue circle at the
 * same coordinates would be two marks for one thing, saying almost the same
 * sentence (product owner). So the existing marker gains a quiet indicator
 * and this counts what it indicates.
 */
export function commentTaskCounts(annotations: readonly TaskLinkSource[]): Record<string, number> {
  const counts: Record<string, number> = {};
  const seen = new Set<string>();
  for (const a of annotations) {
    if (!a || typeof a.id !== "string" || typeof a.sourceCommentId !== "string") continue;
    if (!a.sourceCommentId || seen.has(a.id)) continue;
    seen.add(a.id);
    counts[a.sourceCommentId] = (counts[a.sourceCommentId] ?? 0) + 1;
  }
  return counts;
}

/** What the marker's indicator says to a screen reader. */
export function markerTaskCountLabel(count: number): string {
  return count === 1 ? "1 agent task from this note" : `${count} agent tasks from this note`;
}

/** The mark's words — one string, so the badge and its a11y label agree. */
export const MESSAGE_TASK_MARK_LABEL = "Agent task";

/** Screen-reader name for the mark, which says whether it goes anywhere. */
export function messageTaskMarkLabel(mark: MessageTaskMark): string {
  return mark.openable ? "Open the agent task from this message" : "Already an agent task";
}

// ── The reverse link: a task that came out of a discussion ────────────────

/** What a task says about where it came from. */
export const TASK_ORIGIN_LABEL = "From a team note";

/**
 * The origin line for a task row / task detail, or undefined when the task
 * was written directly. One string in one place, so the queue row and the
 * task pane cannot end up saying it differently.
 */
export function taskOriginLine(a: { sourceCommentId?: string } | null | undefined): string | undefined {
  return a && typeof a.sourceCommentId === "string" && a.sourceCommentId
    ? TASK_ORIGIN_LABEL
    : undefined;
}

/** Screen-reader name for the origin line, which says if it goes anywhere. */
export function taskOriginA11yLabel(openable: boolean): string {
  return openable ? "Open the team note this task came from" : TASK_ORIGIN_LABEL;
}

// ── What a discussion produced: the note detail's Tasks tab ───────────────

/**
 * Everything the roll-up needs off a pending annotation. A superset of
 * `TaskLinkSource`, still structural: the tests build these by hand and the
 * provider passes real `ServerAnnotation`s.
 */
export interface TaskSummarySource extends TaskLinkSource {
  comment?: string;
  content?: string;
  text?: string;
  status?: string;
  /** Reopened-by-reply stamps, when the server keeps them. */
  reopenedAt?: string;
  reopenCount?: number;
  createdAt?: string;
  timestamp?: number;
}

/**
 * THE TASK BODY READ BACK APART AGAIN.
 *
 * `composeMessageTaskComment` writes one string, because one string is what
 * the protocol carries and what the agent reads. A person reading the roll-up
 * needs the two halves back: the request is the artifact — the thing that
 * will be acted on — and the quoted discussion is provenance. A card that
 * gave both the same weight would make the reader find the request again
 * every time.
 *
 * A body with no lead-in is entirely the request. That covers the one-tap
 * bubble action, every task made before the instruction box existed, and any
 * task written straight into the composer: in all of them the whole text IS
 * the artifact, and inventing a context section for it would be a lie.
 */
export interface TaskBodyParts {
  /** What is being asked. Never empty for a task that exists. */
  request: string;
  /** The quoted discussion under it, when the body carried one. */
  context?: string;
}

export function splitTaskBody(text: string): TaskBodyParts {
  const marker = `\n\n${TASK_CONTEXT_LEAD_IN}\n\n`;
  const at = text.indexOf(marker);
  if (at === -1) return { request: text.trim() };
  const request = text.slice(0, at).trim();
  const context = text.slice(at + marker.length).trim();
  // A lead-in with nothing under it is not a context section.
  if (!context) return { request };
  return { request, context };
}

/** One card in the Tasks tab. */
export interface NoteTaskRow {
  id: string;
  /** What the task says, whole — the a11y label and any search read this. */
  text: string;
  /** The request, prominent on the card. */
  request: string;
  /** The quoted discussion, quieter, inside the same card. */
  context?: string;
  /** Lifecycle, in the overlay's words. */
  status: string;
  /** When it was made, said the way the thread says times. "" if unknown. */
  at: string;
  /** Which message(s) it quoted — omitted when the link was not persisted. */
  from?: string;
}

const NO_TASK_TEXT = "(no text)";

/**
 * A task's lifecycle in the overlay's vocabulary. `pending` is the only one
 * this client creates; the rest are what a server may report back once the
 * task has been handed over, and an unknown value is shown as-is rather than
 * hidden — a status nobody has a word for is still information.
 */
export function taskStatusLabel(status: string | undefined): string {
  switch (status) {
    case undefined:
    case "":
    case "pending":
      return "Waiting to be sent";
    case "sent":
      return "With the agent";
    case "addressed":
      return "Done";
    case "dismissed":
      return "Dismissed";
    default:
      return status.slice(0, 1).toUpperCase() + status.slice(1);
  }
}

// ── Reopened by a reply ───────────────────────────────────────────────────

/**
 * HAS THIS TASK BEEN REOPENED BY A HUMAN REPLY?
 *
 * A reopened task is `pending` like any other, deliberately: every consumer
 * — this overlay's queue, the server's `/pending`, the agent's
 * `agentation_get_pending` — picks it up with no new status vocabulary to
 * learn, which is precisely why "reply to refine" can work at all. The FACT
 * of the reopen rides along additively in `reopenedAt`.
 *
 * But to a PERSON the two are not the same thing: one has never been sent,
 * the other is work the agent already called finished and that you have just
 * argued with. Without this the queue shows them as identical rows.
 */
export function isReopenedTask(a: { reopenedAt?: string } | null | undefined): boolean {
  return typeof a?.reopenedAt === "string" && a.reopenedAt.length > 0;
}

/**
 * The word for it, or undefined for an ordinary task. It counts past the
 * first, because "reopened three times" is a fact about the conversation the
 * reader is about to have.
 */
export function taskReopenLabel(
  a: { reopenedAt?: string; reopenCount?: number } | null | undefined,
): string | undefined {
  if (!isReopenedTask(a)) return undefined;
  const count = typeof a?.reopenCount === "number" && a.reopenCount > 1 ? a.reopenCount : 0;
  return count > 1 ? `Reopened ×${count}` : "Reopened";
}

/**
 * The lifecycle line for a task in the note's Tasks tab, where the reopen
 * has to REPLACE the plain status rather than sit beside it: "Waiting to be
 * sent" on a task the agent resolved last week and you reopened this morning
 * is true and useless.
 */
export function taskLifecycleLabel(
  a: { status?: string; reopenedAt?: string; reopenCount?: number } | null | undefined,
): string {
  const reopened = taskReopenLabel(a);
  if (reopened && (!a?.status || a.status === "pending")) {
    return `${reopened} — waiting to be sent`;
  }
  return taskStatusLabel(a?.status);
}

/** "From Ada's message" / "From 2 messages" — cheap provenance, when known. */
function fromLine(comment: Comment, ids: readonly string[] | undefined): string | undefined {
  if (!Array.isArray(ids) || ids.length === 0) return undefined;
  if (ids.length > 1) return `From ${ids.length} messages`;
  const message = comment.messages.find((m) => m.id === ids[0]);
  if (!message) return "From 1 message";
  return `From ${authorName(message.author)}'s message`;
}

/**
 * THE ROLL-UP: every task this discussion produced, newest last (server
 * order), so the tab reads in the same direction the conversation does.
 *
 * It is built from the annotations the overlay already holds — no extra
 * route, no second source of truth. A server that never persisted
 * `sourceCommentId` simply produces an empty tab, which is honest.
 */
export function noteTaskRows(
  annotations: readonly TaskSummarySource[],
  comment: Comment,
  now: Date = new Date(),
): NoteTaskRow[] {
  const rows: NoteTaskRow[] = [];
  for (const a of annotations) {
    if (!a || typeof a.id !== "string" || a.sourceCommentId !== comment.id) continue;
    const raw = a.comment ?? a.content ?? a.text;
    const at =
      a.createdAt ??
      (typeof a.timestamp === "number" && Number.isFinite(a.timestamp)
        ? new Date(a.timestamp).toISOString()
        : undefined);
    const text = typeof raw === "string" && raw.trim() ? raw.trim() : NO_TASK_TEXT;
    const parts = splitTaskBody(text);
    rows.push({
      id: a.id,
      text,
      request: parts.request || NO_TASK_TEXT,
      context: parts.context,
      status: taskLifecycleLabel(a),
      at: formatChatTime(at, now),
      from: fromLine(comment, a.sourceMessageIds),
    });
  }
  return rows;
}

/**
 * The tab's label. It carries the count because that IS the information —
 * "has this discussion produced anything yet" is the question the tab
 * answers — and it stays visible at zero: a tab that appears and disappears
 * moves the other one under the user's thumb.
 */
export function noteTasksTabLabel(count: number): string {
  return count > 0 ? `Tasks (${count})` : "Tasks";
}

/** The calm empty state, which also says how to make one. */
export const NOTE_TASKS_EMPTY =
  "No agent tasks from this discussion yet. Pick a message in Conversation and make one.";

// ── The one impure function ───────────────────────────────────────────────

/** What an attempt did. The note is never mutated, so there is no status leg. */
export interface MessageTaskResult {
  ok: boolean;
  /** The annotation created, when one was. */
  annotationId?: string;
  /** The messages it actually quoted (post re-read). */
  messageIds?: string[];
}

/**
 * MAKE A TASK OUT OF THE SELECTED MESSAGES.
 *
 * 0. RE-READ the note first, so the text quoted is the server's and not a
 *    copy from the last refresh (a teammate can edit nothing here, but a
 *    message can be gone, and quoting a deleted message would send the agent
 *    after something nobody said any more). A failed re-read falls back to
 *    what is on screen — sending a slightly stale quote beats refusing.
 * 1. POST the annotation. That is the whole operation: the note keeps its
 *    own status, so there is no second write that can half-fail, and no
 *    terminal state to get stuck in. Doing it twice makes two tasks, which
 *    is a thing a user may legitimately want.
 */
export async function createTaskFromMessages(
  transport: CommentTransport,
  sessionId: string,
  comment: Comment,
  messageIds: readonly string[],
  annotationId: string,
  instruction = "",
): Promise<MessageTaskResult> {
  if (!canMakeMessageTask(comment.messages, messageIds, instruction)) return { ok: false };
  const latest = (await fetchComment(transport, comment.id)) ?? comment;
  const body = buildMessageTaskBody(latest, messageIds, annotationId, instruction);
  // Everything selected has since vanished from the thread: nothing to quote.
  if (!body) return { ok: false };
  // Created is decided by the status, exactly as for a direct capture
  // (src/submit.ts): a body is optional, and an `id` in it is the server's
  // name for the task, which every later read will use.
  const { ok, data } = await postAccepted(transport, sessionAnnotationsPath(sessionId), body);
  if (!ok) return { ok: false };
  const serverId = (data as { id?: unknown } | null)?.id;
  const finalId = typeof serverId === "string" && serverId ? serverId : annotationId;
  return { ok: true, annotationId: finalId, messageIds: body.sourceMessageIds };
}
