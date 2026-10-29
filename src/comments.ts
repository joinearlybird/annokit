/**
 * COMMENTS — the second thing this overlay can anchor to an element, and
 * the one the agent does not read.
 *
 * ANNOTATION vs COMMENT, because everything here follows from it:
 *
 *   An ANNOTATION is an instruction for the AI agent. It goes in the
 *   pending queue and is handed over with "Send to agent".
 *   A COMMENT is a conversation between PEOPLE reviewing the screen —
 *   "is this copy right?", "@design, spacing?" — anchored to the same
 *   element, with the same capture quality, and invisible to the agent.
 *
 * The two meet in exactly one place: MAKE AN AGENT TASK on one (or a few)
 * of a note's MESSAGES — src/message-task.ts, which quotes just those
 * messages, carries the note's captured identity (`commentToCapture`, here)
 * so the agent targets the same element it would have got from a direct
 * annotation, and tags the result `sourceCommentId` + `sourceMessageIds`.
 * The note itself is NOT consumed: it stays an open discussion that can
 * spawn another task later, so nothing in this module writes a status on
 * its behalf.
 *
 * AUTHORS ARE SERVER-SIDE. Every author on screen came back from the server,
 * always. The one thing the client may add is an ADVISORY `authorName` hint
 * on its own writes, for a server that has no way to know who is typing (a
 * standalone deployment with no auth); a server that authenticates ignores
 * it, and nothing here ever lets the hint outrank what came back.
 *
 * Route/wire logic lives here rather than in the components so the payload
 * shapes and the status rules are unit-testable
 * without rendering the RN tree (the same split payload.ts, thread.ts and
 * pending.ts already use). It is also the seam a realtime channel would
 * replace: the components only ever ask this module for a list.
 */
import { seg } from "./url";

import type { AnnotationReference } from "./attachments";
import { OVERLAY_POLL_INTERVAL_MS, shouldPoll } from "./poll";
import type { PollState } from "./poll";
import type { PendingCapture } from "./types";
import { rememberViewer, viewerFromCreatedComment, viewerFromEcho } from "./viewer";

/** Whoever wrote a comment or a message. Resolved by the SERVER. */
export interface CommentAuthor {
  id: string;
  name?: string;
  avatarUrl?: string;
}

/** One message in a comment thread. `id`/`createdAt` are server-assigned. */
export interface CommentMessage {
  id: string;
  content: string;
  author: CommentAuthor;
  createdAt?: string;
}

/**
 * Comment lifecycle.
 *
 * `open` and `resolved` are the two a client produces. `converted` is
 * LEGACY: it was written by the old whole-thread "Ask the agent" bridge,
 * which no longer exists — a note is no longer consumed by handing the
 * agent something. It is still read (older data has it, and those notes must
 * still open, fade and reopen normally) and never written.
 */
export type CommentStatus = "open" | "resolved" | "converted";

/** A comment as the server stores it (see docs/protocol.md "Comments"). */
export interface Comment {
  id: string;
  routeName?: string;
  element?: string;
  componentStack?: string[];
  source?: { file: string; line: number };
  testID?: string;
  x?: number;
  y?: number;
  boundingBox?: { x: number; y: number; width: number; height: number };
  scroll?: { scrollViewTag?: number; offsetY: number; offsetX?: number };
  status: CommentStatus;
  author: CommentAuthor;
  messages: CommentMessage[];
  /**
   * Server-maintained context on the note, in the annotation's shape.
   *
   * The client never sends this: it posts the screenshot to
   * `POST /comments/:id/screenshot` and the server appends the
   * `{type:"screenshot"}` entry with a URL it granted, exactly as it does
   * for an annotation. A server that keeps no such thing simply omits it
   * and the note reads as it always did.
   */
  references?: AnnotationReference[];
  createdAt?: string;
  updatedAt?: string;
}

/** The POST /comments body this client sends. */
export interface CommentBody {
  routeName?: string;
  content: string;
  /**
   * ADVISORY display-name hint (see docs/protocol.md "Who you are"). Sent only when
   * this device holds a name the SERVER did not give it — a host-provided
   * one, or the one the user typed. A server that authenticates its writers
   * MUST ignore it; only a server with no auth should use it to label the
   * message. It is never authoritative here either: what a message shows is
   * always the author the server sent back.
   */
  authorName?: string;
  element?: string;
  componentStack?: string[];
  source?: { file: string; line: number };
  testID?: string;
  x: number;
  y: number;
  boundingBox: { x: number; y: number; width: number; height: number };
  scroll: { scrollViewTag?: number; offsetY: number; offsetX?: number };
  /**
   * Images pasted into the composer, uploaded as assets (src/paste.ts).
   * Picked references still go with tasks only; a pasted picture is for
   * whoever reads the note, as much as a screenshot is.
   */
  references?: AnnotationReference[];
}

/** Just the transport surface this module needs (keeps tests dependency-free). */
export interface CommentTransport {
  getJson(path: string): Promise<unknown>;
  postJson(path: string, body: unknown): Promise<unknown>;
  /** OPTIONAL: the POST with its status, so an empty 2xx counts as taken. */
  postJsonAt?(path: string, body: unknown): Promise<{ status: number; data: unknown }>;
  patchJson(path: string, body: unknown): Promise<unknown>;
  del(path: string): Promise<boolean>;
}

// ── Routes ────────────────────────────────────────────────────────────────

/** `GET|POST /comments`, optionally scoped to one screen. */
export function commentsPath(routeName?: string | null): string {
  if (!routeName) return "/comments";
  return `/comments?routeName=${encodeURIComponent(routeName)}`;
}

/** `GET|PATCH|DELETE /comments/:id`. */
export function commentPath(commentId: string): string {
  return `/comments/${seg(commentId)}`;
}

/**
 * `POST /comments/:id/screenshot` — the same multipart upload annotations
 * use, for a note rather than a task.
 *
 * A team note is a conversation about something on screen, and "look at
 * this" is most of what people mean by that; making the picture agent-only
 * was a distinction the agent cared about, not the team. Servers that
 * predate this route answer 404 and the note is still created — the client
 * treats the upload exactly as it does for annotations, as an optional
 * follow-up to something already saved.
 */
export function commentScreenshotPath(commentId: string): string {
  return `${commentPath(commentId)}/screenshot`;
}

/** `POST /comments/:id/messages`. */
export function commentMessagesPath(commentId: string): string {
  return `${commentPath(commentId)}/messages`;
}

// ── Reading (tolerant: a dev overlay never trusts a shape) ────────────────

function readAuthor(value: unknown): CommentAuthor {
  const a = value as CommentAuthor | null;
  if (!a || typeof a !== "object" || typeof a.id !== "string") {
    // A message with no resolvable author still shows; it just says so.
    return { id: "" };
  }
  return a;
}

function readMessages(value: unknown): CommentMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (m): m is CommentMessage =>
        typeof m === "object" && m !== null && typeof (m as CommentMessage).content === "string",
    )
    .map((m) => ({ ...m, author: readAuthor(m.author) }));
}

function readStatus(value: unknown): CommentStatus {
  return value === "resolved" || value === "converted" ? value : "open";
}

/** One comment out of a server payload, or null if it is not one. */
export function readComment(value: unknown): Comment | null {
  const raw = (value as { comment?: unknown } | null)?.comment ?? value;
  const c = raw as Comment | null;
  if (!c || typeof c !== "object" || typeof c.id !== "string") return null;
  return {
    ...c,
    status: readStatus(c.status),
    author: readAuthor(c.author),
    messages: readMessages(c.messages),
  };
}

/** The comment list out of `{comments: […]}` (or a bare array). */
export function readComments(value: unknown): Comment[] {
  const list = Array.isArray(value) ? value : (value as { comments?: unknown } | null)?.comments;
  if (!Array.isArray(list)) return [];
  const out: Comment[] = [];
  for (const item of list) {
    const c = readComment(item);
    if (c) out.push(c);
  }
  return out;
}

/** First line of a comment — what its list row and marker tooltip show. */
export function commentSummary(comment: Comment): string {
  const first = comment.messages.find((m) => m.content.trim());
  return first ? first.content.trim() : "(empty comment)";
}

/** A display name for an author the server may not have named. */
export function authorName(author: CommentAuthor | undefined): string {
  const name = author?.name?.trim();
  return name || "Someone";
}

// ── Status rules ──────────────────────────────────────────────────────────

/**
 * What the Resolve/Reopen button does next.
 *
 * Two states, and no terminal one. A legacy `converted` note reopens like a
 * resolved one: handing the agent work is no longer something that finishes
 * a discussion, so a note that was closed by the old bridge must not be
 * stuck closed forever.
 */
export function nextCommentStatus(status: CommentStatus): CommentStatus | null {
  if (status === "open") return "resolved";
  return "open";
}

/** Settled comments fade on screen rather than cluttering it (marker-hit.ts). */
export function isCommentSettled(status: CommentStatus): boolean {
  return status === "resolved" || status === "converted";
}

// ── Writing ───────────────────────────────────────────────────────────────

/**
 * The `POST /comments` body for a captured tap.
 *
 * Same identity fields as an annotation and for the same reason: a comment
 * that is later sent to the agent must target as precisely as one written
 * directly. What it does NOT carry is the annotation-only apparatus —
 * `kind`, `platform`, `references`, screenshots — because those are
 * instructions-for-the-agent concepts (see the v1 note in README.md).
 */
export function buildCommentBody(
  capture: PendingCapture,
  content: string,
  authorName?: string | null,
  references?: AnnotationReference[],
): CommentBody {
  const hit = capture.hit;
  const hint = typeof authorName === "string" && authorName.trim() ? authorName.trim() : null;
  return {
    routeName: capture.routeName ?? undefined,
    content,
    // Omitted entirely rather than sent empty: a field that is not there
    // cannot be mistaken for "this person has no name".
    ...(hint ? { authorName: hint } : {}),
    element: hit?.element ?? "Screen",
    componentStack: hit?.componentStack ?? [],
    source: hit?.source,
    testID: hit?.testID,
    x: capture.x,
    y: capture.y,
    boundingBox: hit
      ? { x: hit.frame.x, y: hit.frame.y, width: hit.frame.width, height: hit.frame.height }
      : { x: capture.x, y: capture.y, width: 0, height: 0 },
    scroll: hit?.scroll ?? { offsetY: 0 },
    ...(references && references.length ? { references } : {}),
  };
}

/**
 * A comment's captured identity, back in the shape `buildAnnotationBody`
 * consumes. This is what makes a converted comment as well-targeted as a
 * direct annotation instead of "an annotation at some coordinates".
 */
export function commentToCapture(comment: Comment): PendingCapture {
  const box = comment.boundingBox;
  const x = typeof comment.x === "number" ? comment.x : (box?.x ?? 0);
  const y = typeof comment.y === "number" ? comment.y : (box?.y ?? 0);
  return {
    x,
    y,
    hit: comment.element
      ? {
          element: comment.element,
          componentStack: comment.componentStack ?? [],
          frame: box ?? { x, y, width: 0, height: 0 },
          testID: comment.testID,
          source: comment.source,
          scroll: comment.scroll,
        }
      : null,
    routeName: comment.routeName ?? null,
    // Comments never captured one (see the v1 note above).
    screenshotUri: null,
  };
}

// ── Network (fail-soft; null everywhere means "the server did not answer") ─

/**
 * `GET /comments?routeName=…` → the comments on this screen, or NULL when
 * the read failed. Null is load-bearing: a server that has not shipped the
 * comment routes 404s, and the overlay must then say "comments unavailable"
 * and leave annotations, aiming and the toolbar untouched — not show an
 * empty list that looks like "nobody has commented".
 */
export async function fetchComments(
  transport: CommentTransport,
  routeName: string | null,
): Promise<Comment[] | null> {
  const data = await transport.getJson(commentsPath(routeName));
  if (!data) return null;
  return readComments(data);
}

/**
 * REFRESH CADENCE. Comments are a slow, human conversation, so the overlay
 * refetches on the EVENTS that matter — route change, entering comment
 * mode, and after every mutation — and only backstops those with a lazy
 * poll for a teammate's reply arriving while you sit on a screen.
 *
 * The cadence and the "stop once the endpoint proves absent" rule are
 * src/poll.ts, shared with the agent-task thread pane: the two surfaces wait
 * for someone else to speak in exactly the same way, and tuning one without
 * the other is how they drift apart. These two names stay because they are
 * what the comment call sites read as.
 */
export const COMMENTS_POLL_INTERVAL_MS = OVERLAY_POLL_INTERVAL_MS;

/**
 * Whether the backstop timer should run at all. It stops the moment the
 * endpoint proves absent — a server with no comment routes would otherwise
 * collect a 404 every interval forever, and the log is the only place a dev
 * overlay gets to be loud.
 */
export function shouldPollComments(state: PollState): boolean {
  return shouldPoll(state);
}

/** `GET /comments/:id` → the authoritative thread, or null if unreadable. */
export async function fetchComment(
  transport: CommentTransport,
  commentId: string,
): Promise<Comment | null> {
  const data = await transport.getJson(commentPath(commentId));
  if (!data) return null;
  return readComment(data);
}

/**
 * `POST /comments` → the created comment, or null (the composer stays open).
 *
 * The server's answer names its author, and its author is US — that is the
 * one place a client with no user directory learns who it is, so the chat
 * can put this device's own messages on their own side (src/viewer.ts).
 */
export async function createComment(
  transport: CommentTransport,
  capture: PendingCapture,
  content: string,
  authorName?: string | null,
  references?: AnnotationReference[],
): Promise<Comment | null> {
  const created = await transport.postJson(
    commentsPath(),
    buildCommentBody(capture, content, authorName, references),
  );
  if (!created) return null;
  const comment = readComment(created);
  rememberViewer(viewerFromCreatedComment(comment));
  return comment;
}

/** `POST /comments/:id/messages` → the updated comment, or null. */
export async function postCommentMessage(
  transport: CommentTransport,
  commentId: string,
  content: string,
  authorName?: string | null,
): Promise<Comment | null> {
  const hint = typeof authorName === "string" && authorName.trim() ? authorName.trim() : null;
  const updated = await transport.postJson(commentMessagesPath(commentId), {
    content,
    ...(hint ? { authorName: hint } : {}),
  });
  if (!updated) return null;
  const comment = readComment(updated);
  // Same echo, other route: the message we just posted comes back with the
  // author the server gave it, which is this device's identity.
  if (comment) rememberViewer(viewerFromEcho(comment.messages, content));
  return comment;
}

/** `PATCH /comments/:id {status}` → the updated comment, or null. */
export async function setCommentStatus(
  transport: CommentTransport,
  commentId: string,
  status: CommentStatus,
): Promise<Comment | null> {
  const updated = await transport.patchJson(commentPath(commentId), { status });
  if (!updated) return null;
  return readComment(updated);
}

/** `DELETE /comments/:id`. True when it stuck. */
export function deleteComment(transport: CommentTransport, commentId: string): Promise<boolean> {
  return transport.del(commentPath(commentId));
}
