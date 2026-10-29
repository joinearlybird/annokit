/**
 * Marker geometry and marker tap resolution — the session-independent half
 * of src/markers.tsx (which renders it), kept free of react-native imports
 * so it is unit-testable in the node environment, exactly like src/aim.ts.
 *
 * Two problems live here.
 *
 * 1. TOUCH TARGET vs DOT. The dot is 22pt because a bigger one would cover
 *    the thing it annotates. 22pt is also well under the 44pt minimum a
 *    finger can reliably hit, so the TOUCHABLE box is grown around the dot
 *    (`markerTouchPadding`) while the dot itself is untouched. The padding
 *    is invisible, which is what makes problem 2 real.
 *
 * 2. OVERLAP. Grown targets overlap far more often than the dots do, and
 *    react-native's own sibling order would then hand the touch to whoever
 *    happens to be last in the tree. So the markers do not trust which one
 *    of them received the touch: every marker resolves the SAME rule over
 *    the whole set (`pickMarkerAt`), and the rule is:
 *
 *      TIER 1 — a marker whose visible DOT contains the point beats any
 *               marker matched only by its invisible padding. Tapping a dot
 *               you can see must open the annotation you aimed at.
 *      TIER 2 — otherwise, the padding hits.
 *      Within a tier the LAST marker in render order wins — that is the
 *      newest annotation, and it is the one drawn on top, so "topmost wins"
 *      and "newest wins" are the same rule here rather than a coin toss.
 *
 * TWO KINDS SHARE ALL OF IT. Comment markers (human discussion) and
 * annotation markers (agent instructions) are the same geometry and the
 * same tap rule — only their appearance differs (`markerAppearance`). The
 * two lists are merged by `combineMarkers` in ONE documented order —
 * comments first, annotations last — so the tie-break above resolves an
 * exact overlap in favour of the annotation: the thing the agent is going
 * to act on must never be the one you cannot reach.
 *
 * That tie-break is for two DIFFERENT things that happen to sit on top of
 * each other. A task made from a team note is not a different thing: it is
 * the same anchored element, and it gets no marker at all (`visibleMarkers`
 * drops anything carrying `sourceCommentId`). Tapping there opens the note,
 * whose Tasks tab is one tap from the work.
 */

import { DARK_PALETTE } from "./theme";
import type { AnnoKitPalette } from "./theme";

/** Diameter of the drawn dot. Visual only — never grow this for touch. */
export const MARKER_SIZE = 22;
/** Minimum comfortable touch target (Apple HIG / Material both say 44). */
export const MARKER_MIN_TOUCH = 44;

/**
 * Padding to add on each side of the dot to reach the minimum target. Zero
 * when the dot is already big enough (never negative — shrinking the target
 * below the dot would make part of what you can see untappable).
 */
export function markerTouchPadding(size = MARKER_SIZE, minTouch = MARKER_MIN_TOUCH): number {
  return Math.max(0, (minTouch - size) / 2);
}

/** Side of the square touch box around the dot's centre. */
export function markerTouchSize(size = MARKER_SIZE, minTouch = MARKER_MIN_TOUCH): number {
  return size + markerTouchPadding(size, minTouch) * 2;
}

/** What a marker stands for. Same geometry, different meaning and look. */
export type MarkerKind = "annotation" | "comment";

/** The subset of an annotation a marker needs: an id and a placed point. */
export interface MarkerSource {
  id: string;
  x?: number;
  y?: number;
  routeName?: string;
  /** Comment lifecycle (`open` | `resolved` | `converted`); annotations have none. */
  status?: string;
  /**
   * Set when this annotation was made FROM a team note's message. Such an
   * annotation is represented by that note's marker (which gains a blue
   * task pip), never by a mark of its own — see `visibleMarkers`.
   */
  sourceCommentId?: string;
}

/** A marker ready to draw: a resolved point and its 1-based badge number. */
export interface MarkerPlacement {
  id: string;
  x: number;
  y: number;
  /** What the badge shows — the position in the visible list, 1-based. */
  number: number;
  /** Which list it came from. Decides the appearance, never the geometry. */
  kind: MarkerKind;
  /** Comment status, carried through so the appearance can de-emphasize it. */
  status?: string;
}

/**
 * The annotations (or comments) that get a marker on THIS screen: placed
 * ones only (a marker with no coordinates has nowhere to be), filtered to
 * the current route when both sides know their route — an annotation made
 * on another screen must not float over an unrelated one.
 *
 * Order is preserved from the source list (oldest first), so the numbering
 * is stable as the user adds annotations and the last entry is the newest.
 * Numbering is PER KIND: comments do not push the annotation numbers along
 * (their badge is a glyph, not a numeral, and the numbers users read in the
 * queue must keep meaning what they meant).
 *
 * ONE MARKER PER ANCHORED THING. An annotation carrying `sourceCommentId`
 * was made from a message inside a team note, and that note already has a
 * marker on the very same element. A second mark at the same coordinates is
 * clutter — and worse, `combineMarkers` deliberately lets an annotation win
 * an exact overlap, so the note's own marker became untappable and a tap on
 * it opened the task instead (product owner). Such annotations are dropped
 * here, in the model, so numbering AND `pickMarkerAt` both see the same
 * corrected set; the note's marker carries a blue task pip instead
 * (src/markers.tsx, `commentTaskCounts`). Numbering is over what is
 * DISPLAYED — 1..N with no gaps, because a badge that skips a number is a
 * badge asking about a marker that is not there. Nothing else reads these
 * numbers (the queue and the detail panes identify rows by text and id), so
 * no other view can disagree with what a badge says.
 */
export function visibleMarkers(
  annotations: readonly MarkerSource[],
  routeName: string | null,
  kind: MarkerKind = "annotation",
): MarkerPlacement[] {
  const out: MarkerPlacement[] = [];
  for (const a of annotations) {
    if (!a || typeof a.x !== "number" || typeof a.y !== "number") continue;
    if (routeName && a.routeName && a.routeName !== routeName) continue;
    if (typeof a.sourceCommentId === "string" && a.sourceCommentId) continue;
    out.push({ id: a.id, x: a.x, y: a.y, number: out.length + 1, kind, status: a.status });
  }
  return out;
}

/**
 * The one render/pick order for both kinds: comments first, annotations
 * last. `pickMarkerAt` keeps the LAST match of the strongest tier, so on an
 * exact overlap the annotation wins — and because react-native paints in
 * array order, the annotation is also the one drawn on top. Draw order and
 * tap order therefore agree, which is the whole point of doing this in one
 * place instead of two components each guessing.
 */
export function combineMarkers(
  annotationMarkers: readonly MarkerPlacement[],
  commentMarkers: readonly MarkerPlacement[],
): MarkerPlacement[] {
  return [...commentMarkers, ...annotationMarkers];
}

/** How a marker is drawn. Plain tokens — no react-native import here. */
export interface MarkerAppearance {
  kind: MarkerKind;
  /** Annotation dots are round; comment markers are rounded SQUARES. */
  shape: "circle" | "square";
  fill: string;
  border: string;
  /** Ink for the numeral/glyph inside. */
  ink: string;
  /**
   * Settled comments (resolved, or converted into an annotation) stay
   * visible — you must be able to find and reopen them — but at reduced
   * opacity so a screen full of finished discussion does not compete with
   * the live one. 1 = full strength.
   */
  opacity: number;
}

/**
 * The palette this module needs: the two accent fills, their rims, and the
 * ink that goes on them (src/theme.ts).
 */
export type MarkerPalette = Pick<
  AnnoKitPalette,
  "agent" | "agentEdge" | "team" | "teamEdge" | "onAccent"
>;

/** Blue circle = "the agent will act on this". */
function annotationAppearance(p: MarkerPalette): MarkerAppearance {
  return { kind: "annotation", shape: "circle", fill: p.agent, border: p.agentEdge, ink: p.onAccent, opacity: 1 };
}

/** Orange square = "people are talking about this". Deliberately not blue. */
function commentAppearance(p: MarkerPalette): MarkerAppearance {
  return { kind: "comment", shape: "square", fill: p.team, border: p.teamEdge, ink: p.onAccent, opacity: 1 };
}

/** Settled: same mark, faded. */
const SETTLED_OPACITY = 0.45;

/**
 * The look of one marker.
 *
 * Two axes, and only two: KIND picks the colour and the shape (blue
 * circle for an annotation, orange rounded square for a comment — different
 * hue AND different silhouette, so they are told apart at a glance and also
 * without colour), and STATUS fades a comment that is no longer live.
 * Annotations have no status here: an annotation leaves the pending list
 * when it is sent, so a faded one would be a marker for something that is
 * not there.
 */
export function markerAppearance(
  kind: MarkerKind,
  status?: string,
  palette: MarkerPalette = DARK_PALETTE,
): MarkerAppearance {
  if (kind !== "comment") return annotationAppearance(palette);
  const look = commentAppearance(palette);
  const settled = status === "resolved" || status === "converted";
  return settled ? { ...look, opacity: SETTLED_OPACITY } : look;
}

/**
 * Is the agent working on what this mark stands for?
 *
 * A task's own marker when its status is `working`; a note's when one of the
 * tasks made from it is (`workingNotes`), since that task has no marker of
 * its own (src/markers.tsx, ONE MARKER PER ANCHORED THING).
 */
export function markerWorking(
  marker: Pick<MarkerPlacement, "id" | "kind" | "status">,
  workingNotes?: ReadonlySet<string>,
): boolean {
  if (marker.kind === "comment") return !!workingNotes?.has(marker.id);
  return marker.status === "working";
}

/**
 * Markers are only interactive when the overlay is IDLE.
 *
 * While armed the user is targeting the app's own components, and a
 * touchable view sitting over the app would eat the gesture before the
 * capture root ever sees it (src/capture.tsx claims the responder for its
 * own subtree; markers are a sibling of it, not a child). So armed markers
 * go back to `pointerEvents="none"` and become pure decoration.
 */
export function markersInteractive(armed: boolean): boolean {
  return !armed;
}

export interface MarkerPickOptions {
  /** Dot diameter. Defaults to MARKER_SIZE. */
  size?: number;
  /** Minimum touch target. Defaults to MARKER_MIN_TOUCH. */
  minTouch?: number;
}

/**
 * Which annotation a tap at (x, y) opens — see the tier rule at the top of
 * this file. Returns null when the point is outside every marker's touch
 * box, so a caller can fall back rather than open something arbitrary.
 *
 * Window coordinates, matching what the markers are positioned with.
 */
export function pickMarkerAt(
  markers: readonly MarkerPlacement[],
  x: number,
  y: number,
  options: MarkerPickOptions = {},
): MarkerPlacement | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const size = options.size ?? MARKER_SIZE;
  const minTouch = options.minTouch ?? MARKER_MIN_TOUCH;
  const dotRadius = size / 2;
  const touchHalf = markerTouchSize(size, minTouch) / 2;

  let dotHit: MarkerPlacement | null = null;
  let padHit: MarkerPlacement | null = null;
  for (const m of markers) {
    const dx = x - m.x;
    const dy = y - m.y;
    // The dot is round, so test it as a circle: the corners of its bounding
    // box are outside the thing the user can actually see.
    if (dx * dx + dy * dy <= dotRadius * dotRadius) dotHit = m;
    // The touch box is a square — that is the shape react-native lays out.
    else if (Math.abs(dx) <= touchHalf && Math.abs(dy) <= touchHalf) padHit = m;
  }
  // Later in the list = newer = drawn on top, and the loop keeps the last
  // match, so this is the topmost marker of the strongest tier that hit.
  return dotHit ?? padHit;
}

/**
 * The annotation an open marker detail should be showing, or null if it is
 * gone (deleted from the queue while the detail was open, or dropped by a
 * refresh). Callers render nothing for null instead of leaving a pane of
 * stale content that answers to no row on the server.
 */
export function resolveOpenMarker<T extends { id: string }>(
  annotations: readonly T[],
  openId: string | null,
): T | null {
  if (!openId) return null;
  return annotations.find((a) => a && a.id === openId) ?? null;
}
