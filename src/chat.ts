/**
 * WHAT MAKES A LIST OF MESSAGES READ AS A CONVERSATION.
 *
 * Both detail panes hold a thread — you and the agent on a task, you and
 * your team on a note — and both used to draw one flat run of text per
 * message. Nothing said who was speaking except a small label, nothing said
 * where one turn ended and the next began, and a burst of three lines from
 * the same person read as three separate events (product owner, device
 * testing: "make it actually look like a chat").
 *
 * A chat gets that from three rules, and all three are pure:
 *
 *   SIDE      — is this mine, someone else's, or the agent's? It decides
 *               which edge the bubble sits on and how it is tinted.
 *   GROUPING  — consecutive messages from the SAME author inside a short
 *               window are one turn: one name, one timestamp, tight spacing
 *               inside, generous spacing to the next turn.
 *   TIME      — quiet and relative; a thread read minutes after it happened
 *               should not make anyone parse an ISO string.
 *
 * They live here rather than in the components because "did that burst
 * collapse into one turn" is invisible in a screenshot and obvious in a
 * test — the same split thread-scroll.ts, thread.ts and comments.ts use.
 * src/chat-thread.tsx draws what this decides.
 */

import { authorName } from "./comments";
import type { CommentMessage } from "./comments";
import type { ThreadMessage } from "./thread";
import { isOwnAuthor } from "./viewer";
import type { ViewerIdentity } from "./viewer";

/**
 * Whose message it is. Three, not two: the AGENT is neither you nor a
 * teammate, and a thread where it looked like one would be a lie about who
 * is going to act on what was said.
 */
export type ChatSide = "own" | "other" | "agent";

/** One message, in the only shape the chat renderer needs. */
export interface ChatMessage {
  id: string;
  content: string;
  side: ChatSide;
  /** Stable identity for grouping — two messages group only if these match. */
  authorKey: string;
  /** What the group header says. */
  authorName: string;
  avatarUrl?: string;
  /** ISO-8601, server-stamped. Absent on an optimistic local message. */
  at?: string;
}

/** Consecutive messages from one author, drawn as a single turn. */
export interface ChatGroup {
  key: string;
  side: ChatSide;
  authorKey: string;
  authorName: string;
  avatarUrl?: string;
  /** The turn's timestamp: its first message's, when it has one. */
  at?: string;
  messages: ChatMessage[];
}

/**
 * How long a turn stays open. Long enough that "wait — and the padding" a
 * beat after the first line is still the same thought, short enough that a
 * reply the next morning gets its own name and time.
 */
export const CHAT_GROUP_WINDOW_MS = 5 * 60_000;

/** Milliseconds for an ISO stamp, or null when it is missing or garbage. */
export function chatTimeMs(at: string | undefined): number | null {
  if (!at) return null;
  const ms = new Date(at).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Should this message continue the previous one's turn?
 *
 * Same author, and close enough in time. A message with NO timestamp
 * continues — that is the optimistic copy of the reply you just sent, and
 * splitting your own burst in half the moment you hit Send would be a
 * flicker with no meaning behind it.
 */
export function continuesGroup(
  previous: ChatMessage,
  next: ChatMessage,
  windowMs = CHAT_GROUP_WINDOW_MS,
): boolean {
  if (previous.authorKey !== next.authorKey) return false;
  if (previous.side !== next.side) return false;
  const a = chatTimeMs(previous.at);
  const b = chatTimeMs(next.at);
  if (a === null || b === null) return true;
  return Math.abs(b - a) <= windowMs;
}

/** The turns a flat message list makes. Order is preserved throughout. */
export function groupChatMessages(
  messages: readonly ChatMessage[],
  windowMs = CHAT_GROUP_WINDOW_MS,
): ChatGroup[] {
  const groups: ChatGroup[] = [];
  for (const message of messages) {
    const open = groups[groups.length - 1];
    const last = open?.messages[open.messages.length - 1];
    if (open && last && continuesGroup(last, message, windowMs)) {
      open.messages.push(message);
      // A turn that started on an optimistic message takes the first real
      // stamp that lands in it rather than staying timeless.
      if (!open.at && message.at) open.at = message.at;
      continue;
    }
    groups.push({
      key: message.id,
      side: message.side,
      authorKey: message.authorKey,
      authorName: message.authorName,
      avatarUrl: message.avatarUrl,
      at: message.at,
      messages: [message],
    });
  }
  return groups;
}

// ── Adapters: the two thread shapes, into the one the renderer reads ──────

/**
 * An AGENT TASK thread. `role` is server-assigned and unambiguous — a
 * client reply is always recorded as `"user"` — so ownership here needs no
 * identity resolution at all.
 */
export function threadChatMessages(messages: readonly ThreadMessage[]): ChatMessage[] {
  return messages.map((m, i) => ({
    id: m.id || `msg-${i}`,
    content: m.content,
    side: m.role === "agent" ? ("agent" as const) : ("own" as const),
    authorKey: m.role === "agent" ? "agent" : "you",
    authorName: m.role === "agent" ? "Agent" : "You",
    at: m.timestamp,
  }));
}

/**
 * A TEAM NOTE thread. What a message SAYS about its author is always the
 * server's — this only decides which of them are OURS, from whatever
 * identity src/viewer.ts resolved (host prop, server echo, or the name the
 * user typed). With one in hand the very first message is already on the
 * right side; with none, every message is somebody else's, which is the safe
 * way to be wrong: a neutral thread, never someone else's words in your
 * colour.
 *
 * A bare id is still accepted for the old call shape (and its tests).
 */
export function commentChatMessages(
  messages: readonly CommentMessage[],
  viewer: ViewerIdentity | string | null,
): ChatMessage[] {
  const identity: ViewerIdentity =
    typeof viewer === "string"
      ? { id: viewer, name: null, avatarUrl: null, source: null }
      : (viewer ?? { id: null, name: null, avatarUrl: null, source: null });
  return messages.map((m, i) => {
    const id = m.author?.id ?? "";
    const own = isOwnAuthor(m.author, identity);
    return {
      id: m.id || `msg-${i}`,
      content: m.content,
      side: own ? ("own" as const) : ("other" as const),
      authorKey: id || `name:${authorName(m.author)}`,
      authorName: own ? "You" : authorName(m.author),
      avatarUrl: m.author?.avatarUrl,
      at: m.createdAt,
    };
  });
}

// ── Time, quietly ─────────────────────────────────────────────────────────

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function clock(d: Date): string {
  const h = d.getHours();
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/**
 * A turn's timestamp, as a person would say it.
 *
 * Hand-formatted rather than `toLocaleString`: this is one muted line whose
 * exact wording is asserted in tests, and a device-locale-dependent string
 * would make those tests a coin toss. Empty string for a message with no
 * stamp — an optimistic reply shows no time rather than "Invalid Date".
 */
export function formatChatTime(at: string | undefined, now: Date = new Date()): string {
  const ms = chatTimeMs(at);
  if (ms === null) return "";
  const d = new Date(ms);
  const time = clock(d);
  if (sameDay(d, now)) return time;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(d, yesterday)) return `Yesterday ${time}`;
  const date =
    d.getFullYear() === now.getFullYear()
      ? `${MONTHS[d.getMonth()]} ${d.getDate()}`
      : `${MONTHS[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}`;
  return `${date}, ${time}`;
}

/** The letter an avatar falls back to when the server sent no image. */
export function chatInitial(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.slice(0, 1).toUpperCase() : "?";
}
