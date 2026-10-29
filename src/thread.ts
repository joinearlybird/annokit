/**
 * Annotation threads — the follow-up conversation attached to one queued
 * annotation (`GET /annotations/:aid` to read, `POST /annotations/:aid/thread`
 * to reply).
 *
 * IT IS A TWO-WAY CONVERSATION, so it refreshes. The agent answers here
 * (`agentation_reply` on the server side appends a `role: "agent"` message),
 * and the pane used to read the thread exactly once, when it opened: a reply
 * that landed while you were looking at it was invisible until you closed
 * the pane and opened it again. So an OPEN pane polls, on the same cadence
 * and with the same stop-on-failure rule as the team-note conversation
 * (src/poll.ts), and `applyPolledThread` decides what a poll is allowed to
 * do to what is on screen.
 *
 * Kept out of the detail component so the optimistic append/revert, and the
 * "did that poll just clobber a message the user is still sending" rules,
 * are unit-testable without rendering the RN tree — the same split pending.ts
 * uses for the optimistic delete.
 */
import { seg } from "./url";

import { fromAgentationThreadMessage, serverFlavor } from "./agentation";
import { OVERLAY_POLL_INTERVAL_MS, shouldPoll } from "./poll";
import type { PollState } from "./poll";
import { makeId, postAccepted } from "./transport";
import type { ServerAnnotation } from "./types";

/**
 * One message of an annotation thread. `role` is assigned by the SERVER
 * (a client reply is always recorded as `"user"`); it is never sent.
 */
export interface ThreadMessage {
  id: string;
  content: string;
  role: "user" | "agent";
  /** ISO-8601, server-stamped. Absent on an optimistic local message. */
  timestamp?: string;
}

/** The `setThread` shape React's `useState` gives us. */
export type ThreadUpdater = (
  update: (prev: ThreadMessage[]) => ThreadMessage[],
) => void;

/** Just the transport surface this module needs (keeps tests dependency-free). */
export interface ThreadTransport {
  getJson(path: string): Promise<unknown>;
  postJson(path: string, body: unknown): Promise<unknown>;
  /**
   * OPTIONAL: the same GET with the HTTP status kept.
   *
   * `getJson` collapses "the server says this annotation is gone" and "the
   * server did not answer" into the same `null`, and an open pane has to
   * treat those opposite ways — close, versus keep showing what is on
   * screen. A transport without it simply never reports "gone", which is the
   * fail-soft leg.
   */
  getJsonAt?(path: string): Promise<{ status: number; data: unknown }>;
  /** OPTIONAL: the POST with its status, so an empty 2xx counts as taken. */
  postJsonAt?(path: string, body: unknown): Promise<{ status: number; data: unknown }>;
}

/** Protocol route for one annotation (not session-prefixed). */
export function annotationPath(annotationId: string): string {
  return `/annotations/${seg(annotationId)}`;
}

/** Protocol route for appending a thread message. */
export function threadPath(annotationId: string): string {
  return `${annotationPath(annotationId)}/thread`;
}

/** Messages out of a stored annotation, tolerating a missing/garbage `thread`. */
function readThread(annotation: unknown): ThreadMessage[] {
  const thread = (annotation as { thread?: unknown } | null)?.thread;
  if (!Array.isArray(thread)) return [];
  const messages = thread.filter(
    (m): m is ThreadMessage =>
      typeof m === "object" && m !== null && typeof (m as ThreadMessage).content === "string",
  );
  // Compat: agentation spells role "human" and stamps ms-epoch numbers —
  // normalised at the read so every renderer keeps one message shape.
  return serverFlavor() === "agentation" ? messages.map(fromAgentationThreadMessage) : messages;
}

/**
 * `GET /annotations/:aid` → the annotation's thread, or null when the read
 * failed (404, offline, …). Null means "keep what is on screen"; `[]` means
 * "the server says there are no messages".
 */
export async function fetchThread(
  transport: ThreadTransport,
  annotationId: string,
): Promise<ThreadMessage[] | null> {
  const annotation = await transport.getJson(annotationPath(annotationId));
  if (!annotation) return null;
  return readThread(annotation);
}

/**
 * `POST /annotations/:aid/thread` with an optimistic local append: the reply
 * shows immediately and is removed again if the server does not take it.
 *
 * The body carries `content` only — the server assigns `id`, `role` and
 * `timestamp`, and answers with the whole updated annotation, so a success
 * replaces the optimistic message with the authoritative thread.
 */
export async function postThreadReply(
  transport: ThreadTransport,
  annotationId: string,
  content: string,
  setThread: ThreadUpdater,
): Promise<boolean> {
  const optimistic: ThreadMessage = { id: makeId(), content, role: "user" };
  setThread((prev) => [...prev, optimistic]);

  // Our server assigns `role`; agentation's takes it in the body (recon
  // doc) — a phone reply is theirs' "human".
  const replyBody =
    serverFlavor() === "agentation" ? { role: "human", content } : { content };
  const { ok, data: updated } = await postAccepted(transport, threadPath(annotationId), replyBody);
  if (!ok) {
    // Revert: drop just our message, leaving anything that arrived meanwhile.
    setThread((prev) => prev.filter((m) => m.id !== optimistic.id));
    return false;
  }

  const authoritative = readThread(updated);
  // A server that answers 2xx without a thread (older/partial impl) keeps the
  // optimistic message rather than blanking the pane.
  if (authoritative.length > 0) setThread(() => authoritative);
  return true;
}

// ── Staying current while the pane is open ────────────────────────────────

/**
 * Backstop cadence for an OPEN task thread — the comment conversation's, on
 * purpose (src/poll.ts). An agent reply is not more urgent than a
 * teammate's; it is the same "someone answered while I was reading".
 */
export const THREAD_POLL_INTERVAL_MS = OVERLAY_POLL_INTERVAL_MS;

/**
 * Should the open pane's timer run?
 *
 * `enabled` here means THIS PANE IS OPEN — nothing polls a task whose
 * detail nobody is looking at, so the cost of this feature is one timer per
 * open sheet, of which there is at most one. `available` goes false the
 * first time the read fails, exactly as the comment poll stops itself.
 */
export function shouldPollThread(state: PollState): boolean {
  return shouldPoll(state);
}

/** The whole annotation as the detail pane holds it, plus "is it still there". */
export interface AnnotationRead {
  /** The server's copy, or null when it did not hand one over. */
  annotation: ServerAnnotation | null;
  /**
   * The server answered, and answered that this annotation does not exist.
   * A network failure is NOT this: it leaves the pane alone.
   */
  gone: boolean;
}

/**
 * `GET /annotations/:aid` → the whole annotation.
 *
 * The pane reads the WHOLE object, not just its `thread[]`, because the
 * annotation's own state moves under it: the agent resolves it (it leaves
 * the pending list, so the list the pane was opened from no longer has it)
 * and a human reply reopens it. A pane that only ever knew the thread had to
 * be closed and reopened to notice either.
 */
export async function fetchAnnotation(
  transport: ThreadTransport,
  annotationId: string,
): Promise<AnnotationRead> {
  const path = annotationPath(annotationId);
  if (transport.getJsonAt) {
    const res = await transport.getJsonAt(path);
    const annotation = readAnnotation(res?.data);
    return { annotation, gone: res?.status === 404 };
  }
  return { annotation: readAnnotation(await transport.getJson(path)), gone: false };
}

/** An annotation out of a server payload, or null if it is not one. */
function readAnnotation(value: unknown): ServerAnnotation | null {
  const a = (value as { annotation?: unknown } | null)?.annotation ?? value;
  if (!a || typeof a !== "object" || typeof (a as ServerAnnotation).id !== "string") return null;
  return a as ServerAnnotation;
}

/** What a poll is allowed to do to the pane. */
export interface PolledThread {
  /** The list to show, or null for "leave what is on screen alone". */
  messages: ThreadMessage[] | null;
  /** How many of them the pane had never shown. */
  added: number;
}

/**
 * WHAT A POLL MAY OVERWRITE.
 *
 * Three refusals, and each one is a bug that happened or would have:
 *
 *   · a failed read (`null`) never blanks a pane — the same fail-soft rule
 *     the initial read follows;
 *   · a read that brings nothing new returns `null` too, so the pane does
 *     not re-render (and, more to the point, does not re-run its
 *     scroll-to-bottom decision) every interval for no reason;
 *   · a poll landing mid-send must not clobber the optimistic message the
 *     user is watching, so the caller passes `busy` and gets a refusal.
 *
 * `added` counts by message id, so it is the number of messages the pane has
 * genuinely never rendered — which is what the "new reply" affordance
 * counts, and what tells the scroll rule this is `incoming` traffic rather
 * than the user's own.
 */
export function applyPolledThread(
  current: readonly ThreadMessage[],
  fetched: ThreadMessage[] | null,
  busy = false,
): PolledThread {
  if (!fetched || busy) return { messages: null, added: 0 };
  const known = new Set(current.map((m) => m.id));
  const added = fetched.filter((m) => !known.has(m.id)).length;
  // Nothing new AND nothing removed: the pane is already correct.
  if (added === 0 && fetched.length === current.length) return { messages: null, added: 0 };
  return { messages: fetched, added };
}

/** The thread out of a whole annotation (tolerating a missing/garbage one). */
export function annotationThread(annotation: ServerAnnotation | null): ThreadMessage[] | null {
  if (!annotation) return null;
  return readThread(annotation);
}

/**
 * The "N new" affordance's words, for a user who has scrolled up into the
 * history while the agent was talking.
 *
 * It exists because the scroll rule deliberately does NOT yank a reader back
 * to the bottom (src/thread-scroll.ts) — which is right, and which means a
 * reply can arrive with no sign of it anywhere on screen. Plain text and a
 * count; the overlay's icons carry the rest.
 */
export function newReplyLabel(count: number): string {
  if (count <= 0) return "";
  return count === 1 ? "1 new reply" : `${count} new replies`;
}
