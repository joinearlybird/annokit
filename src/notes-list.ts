/**
 * The team-notes list: what a row says, how the rows are grouped, and what
 * tapping one is supposed to DO.
 *
 * WHY IT EXISTS. The queue is the send-to-the-agent workflow and lists agent
 * tasks only (src/queue.tsx). That left team notes reachable solely by
 * finding their marker on the screen they were left on — a note written on
 * /profile was invisible from /home, which is to say invisible. This module
 * is the other half of that decision: one list of every note in the app,
 * across every route, that can take you to any of them.
 *
 * GROUPED BY ROUTE, CURRENT SCREEN FIRST. A note's route is the single most
 * useful thing about it in a cross-route list — it is both where the note is
 * and what it is about — so it is a heading rather than a field repeated down
 * every row. The screen you are standing on sorts to the top because those
 * are the notes you can see the markers for; the rest follow alphabetically,
 * which is stable across refreshes (a recency order would reshuffle headings
 * under a thumb while someone reads).
 *
 * SETTLED NOTES STAY, FADED. Resolved and converted notes are dimmed to the
 * same 45% the settled markers use (src/marker-hit.ts) rather than hidden
 * behind a toggle: the list is the answer to "what did we say about this
 * screen?", and the answer includes what was decided. One consistent
 * treatment beats a filter chip nobody finds — and if a list ever gets long
 * enough to need one, `openNoteRows` is here for it.
 *
 * NAVIGATION IS A DECISION, NOT A SIDE EFFECT. `noteJumpPlan` answers, in
 * one pure place, the three cases the panel has to get right: the note is on
 * this screen (just open it, and flag its marker), it is elsewhere and we can
 * navigate (go, then open), it is elsewhere and we cannot (open it anyway,
 * and say why the jump did not happen). Pure, so the degraded no-router path
 * is tested rather than discovered on a host without expo-router.
 */

import { authorName, commentSummary, isCommentSettled } from "./comments";
import { routeDisplay } from "./detail-line";
import type { Comment } from "./comments";
import { teamNoteStatus, teamNoteStatusA11y } from "./queue-list";

/** One note in the list. */
export interface NoteRow {
  id: string;
  /** The opening message, trimmed. Never empty. */
  text: string;
  /** Who started the thread. */
  author: string;
  /** The screen it was left on, or "" when the server never had one. */
  routeName: string;
  /** What to show for the route when it is not a heading. */
  routeLabel: string;
  /** The element it is anchored to, when known. */
  element: string;
  /** Replies AFTER the opening message. 0 for a note nobody answered. */
  replyCount: number;
  /** "Open" / "Resolved", or "" for a converted note (no word any more). */
  status: string;
  /**
   * The same lifecycle with the converted case spelled out, for the row's
   * accessibility label. A sighted reader sees the row dimmed; a screen
   * reader gets no dimming, so it still gets the words.
   */
  statusA11y: string;
  /** Resolved or converted: present, but dimmed. */
  settled: boolean;
}

/** Notes under one route heading. */
export interface NoteGroup {
  routeName: string;
  /** The heading. Falls back for a note the server stored with no route. */
  label: string;
  /** True for the screen the user is standing on. */
  current: boolean;
  rows: NoteRow[];
}

const NO_ROUTE = "";
const NO_ROUTE_LABEL = "No screen recorded";

/**
 * The route as a heading.
 *
 * Through `routeDisplay` (src/detail-line.ts) so the root reads "Home" here
 * exactly as it does in the detail panes — a heading that was a single "/"
 * looked like a stray separator in this list too.
 */
export function routeLabel(routeName: string | null | undefined): string {
  return routeDisplay(routeName) || NO_ROUTE_LABEL;
}

/** How many replies followed the opening message. */
export function replyCount(comment: Pick<Comment, "messages">): number {
  const written = comment.messages.filter((m) => m.content.trim()).length;
  return written > 1 ? written - 1 : 0;
}

/** The rows, in server order, one per note. Ids are required to open one. */
export function buildNoteRows(comments: readonly Comment[]): NoteRow[] {
  const rows: NoteRow[] = [];
  for (const c of comments) {
    if (!c || typeof c.id !== "string") continue;
    const route = typeof c.routeName === "string" ? c.routeName.trim() : NO_ROUTE;
    rows.push({
      id: c.id,
      text: commentSummary(c),
      author: authorName(c.author),
      routeName: route,
      routeLabel: routeLabel(route),
      element: typeof c.element === "string" ? c.element : "",
      replyCount: replyCount(c),
      status: teamNoteStatus(c.status),
      statusA11y: teamNoteStatusA11y(c.status),
      settled: isCommentSettled(c.status),
    });
  }
  return rows;
}

/** Just the live ones — for a future "hide settled" toggle. */
export function openNoteRows(rows: readonly NoteRow[]): NoteRow[] {
  return rows.filter((r) => !r.settled);
}

/**
 * The rows as route groups: the current screen first, then the rest by
 * pathname, then the routeless ones last (they can be neither navigated to
 * nor recognised, so they belong at the bottom).
 */
export function groupNotesByRoute(
  rows: readonly NoteRow[],
  currentRoute: string | null,
): NoteGroup[] {
  const current = typeof currentRoute === "string" ? currentRoute.trim() : "";
  const byRoute = new Map<string, NoteRow[]>();
  for (const row of rows) {
    const list = byRoute.get(row.routeName);
    if (list) list.push(row);
    else byRoute.set(row.routeName, [row]);
  }
  const groups: NoteGroup[] = [];
  for (const [route, groupRows] of byRoute) {
    groups.push({
      routeName: route,
      label: routeLabel(route),
      current: !!route && route === current,
      rows: groupRows,
    });
  }
  groups.sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    // Routeless last: nothing can be done with it but read it.
    if (!a.routeName !== !b.routeName) return a.routeName ? -1 : 1;
    return a.routeName.localeCompare(b.routeName);
  });
  return groups;
}

/** How many notes are still open — the toolbar badge's number. */
export function openNoteCount(comments: readonly Comment[]): number {
  return comments.filter((c) => c && !isCommentSettled(c.status)).length;
}

/**
 * What tapping a row does.
 *
 * `open` is always true — reading the note is the point, and it must survive
 * every navigation failure. `navigate` is the extra. `note` is a quiet line
 * for the case where the jump could not be offered, so the panel never just
 * silently lands somewhere the user did not expect (or fails to).
 */
export interface NoteJumpPlan {
  /** Navigate before opening, and to where. */
  navigate: boolean;
  targetRoute: string | null;
  /** Always true: the detail opens either way. */
  open: boolean;
  /** True when the note is on the screen already behind the panel. */
  sameRoute: boolean;
  /** Why there was no jump, when there could have been one. */
  note?: string;
}

export function noteJumpPlan(
  row: Pick<NoteRow, "routeName">,
  currentRoute: string | null,
  canNavigate: boolean,
): NoteJumpPlan {
  const target = row.routeName.trim();
  const current = typeof currentRoute === "string" ? currentRoute.trim() : "";
  if (!target) {
    return {
      navigate: false,
      targetRoute: null,
      open: true,
      sameRoute: false,
      note: "This note has no screen recorded.",
    };
  }
  if (target === current) {
    return { navigate: false, targetRoute: target, open: true, sameRoute: true };
  }
  if (!canNavigate) {
    return {
      navigate: false,
      targetRoute: target,
      open: true,
      sameRoute: false,
      note: `Can't jump to ${target} — this app has no router.`,
    };
  }
  return { navigate: true, targetRoute: target, open: true, sameRoute: false };
}

/** The row's one-line accessibility label — everything the row shows. */
export function noteRowLabel(row: NoteRow): string {
  const parts = [`Team note by ${row.author}`, row.text, `on ${row.routeLabel}`];
  if (row.replyCount > 0) {
    parts.push(row.replyCount === 1 ? "1 reply" : `${row.replyCount} replies`);
  }
  // The a11y lifecycle, not the visible one: the row shows a converted note
  // by dimming it, and dimming does not read aloud.
  parts.push(row.statusA11y);
  return parts.join(". ");
}

/** The reply count as it reads on the row. Empty when there are none. */
export function replyCountLabel(count: number): string {
  if (count <= 0) return "";
  return count === 1 ? "1 reply" : `${count} replies`;
}

/** The panel's heading and its empty state. */
export function notesTitle(): string {
  return "Team notes";
}

export function notesEmptyText(available: boolean): string {
  if (!available) return "Team notes are unavailable — this server has no comment routes.";
  return "No team notes yet. Tap Annotate, pick something on the screen, then choose Send to · Team.";
}
