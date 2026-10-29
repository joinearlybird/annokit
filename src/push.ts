/**
 * PUSH — the sheet stops hiding the thing it is about.
 *
 * THE PROBLEM. The composer is a bottom sheet with a CLEAR backdrop
 * (src/composer.tsx), which keeps the aim highlight visible for elements in
 * the top half of the screen and does nothing at all for the ones below it:
 * tap the last row of a feed, confirm, and the sheet opens exactly on top of
 * the element you are now being asked to describe. The label hops above the
 * sheet (`occludedTop`, src/aim.ts) but the ELEMENT cannot hop anywhere. The
 * detail panes (src/detail-shell.tsx) have the same problem one step later,
 * and arguably worse: reopening a task days on, the context that was obvious
 * when you filed it is exactly what you no longer have.
 *
 * THE FIX, AND IT IS NOT A SETTING. When a sheet opens over an element it
 * would cover, the app content (and every layer anchored to it) TRANSLATES
 * UP by just enough that the element clears the covered strip, and the sheet
 * takes a smaller ceiling so the room it made is not immediately eaten
 * again. When the element is already clear — everything in the top half of
 * the screen, which was never broken — NOTHING HAPPENS AT ALL: no
 * translation, and the sheet keeps its usual height.
 *
 * THERE IS NO MODE. There was, briefly: a "Push app up" toggle on the sheet,
 * remembered for the session. It asked the user to solve a problem the app
 * can already see (product owner) — `appPushTranslation` returns 0 for every
 * case in which pushing would be wrong or pointless, so "did the user ask
 * for this?" was a second, worse answer to a question the geometry had
 * already answered. The toggle, the mode, the icon on it and the session
 * memory behind it are all gone; what is left is this file.
 *
 * THIS FILE IS THE GEOMETRY, and it is pure for the usual reason: "how far
 * up, and when do we refuse" is the part that has off-by-one-clamp bugs, and
 * a clamp bug here does not look like a clamp bug — it looks like the app
 * jumping, or like the feature quietly doing nothing. It matters more now
 * that nobody opts in: every refusal below is a case in which the app must
 * sit perfectly still, and there is no toggle to blame if it does not.
 *
 * WHAT MOVES AND WHAT DOES NOT is decided in src/index.tsx, but the reason
 * belongs with the geometry: the aim highlight, its label and the markers are
 * all drawn at WINDOW coordinates taken from `measureInWindow`, so they are
 * only correct as long as the app they were measured against has not moved.
 * They therefore ride INSIDE the translated wrapper, together with the app —
 * one transform, everything anchored stays anchored. Only the sheet itself
 * (a Modal, in its own window) and the FAB stay fixed.
 */

import { AIM_TOP_MARGIN, composerSheetMaxHeight } from "./aim";
import type { AimRect } from "./aim";

/**
 * Breathing room between the highlighted element's bottom edge and the top
 * of the covered strip. Zero would technically "clear" the sheet with the
 * element's last pixel touching its edge, which reads as still-behind-it.
 */
export const PUSH_CLEARANCE = 16;

/**
 * How far up the element may be lifted before we call it broken. Two
 * separate ceilings apply (both in `appPushTranslation`):
 *
 *  - the element's own headroom — never lift it past the top keep-out, i.e.
 *    never drag the thing we are trying to show under the status bar /
 *    dynamic island. Same conservative constant the aim chrome uses
 *    (AIM_TOP_MARGIN), for the same reason: this package takes no dependency
 *    on react-native-safe-area-context.
 *  - a share of the window — a backstop against an absurd translation from
 *    inputs that are individually plausible (a huge window, a frame from a
 *    stale measurement). It is deliberately generous: the honest requirement
 *    for the LAST ROW of a phone screen, with the sheet and the keyboard up,
 *    is around 70% of the window, and refusing that would fail exactly the
 *    case the feature exists for while looking like a bug ("push does
 *    nothing down here"). At three quarters, a quarter of the app is always
 *    still on screen, and the element-headroom clamp above is what actually
 *    keeps the result sane in every real case.
 */
export const PUSH_TOP_INSET = AIM_TOP_MARGIN;
export const PUSH_MAX_RATIO = 0.75;

/**
 * The composer's ceiling WHILE IT IS PUSHING, as a share of the window —
 * smaller than its usual ceiling (COMPOSER_SHEET_MAX_RATIO, 0.4) on purpose.
 * Pushing the app up to escape the sheet and then letting the sheet grow to
 * eat the space would be running to stand still: a pushing sheet scrolls
 * internally sooner so that more of the app survives. A sheet that is not
 * pushing has made no room and gives none up.
 */
export const PUSH_SHEET_MAX_RATIO = 0.3;

export interface PushScreen {
  width: number;
  height: number;
}

export interface PushGeometry {
  /**
   * The highlighted element, in window coordinates as measured BEFORE any
   * push (which is the only state anything ever measures in — capture is
   * disarmed while the sheet is open, and the translation is snapped back to
   * zero the moment it closes).
   */
  frame?: AimRect | null;
  /**
   * The y below which the bottom of the screen is covered by our own chrome:
   * the sheet, plus the keyboard under it. Null/unknown means we do not know
   * what is covered, and an unknown occlusion must never move the app.
   */
  coveredTop?: number | null;
  screen: PushScreen;
  /** Top keep-out. Defaults to PUSH_TOP_INSET. */
  topInset?: number;
  /** Gap left under the element. Defaults to PUSH_CLEARANCE. */
  clearance?: number;
  /** Hard ceiling as a share of the window. Defaults to PUSH_MAX_RATIO. */
  maxRatio?: number;
}

/**
 * How far UP (a positive number of points; 0 means "do not move") the app
 * content must translate for the highlighted element to clear the covered
 * strip.
 *
 * THE RULES, in order:
 *  1. FAIL SOFT TO OVERLAY. No frame, a zero-area frame, a frame or a
 *     covered-top that is not a finite number, nothing covered at all — any
 *     of these returns 0. "We are not sure" must never translate blindly:
 *     the worst outcome of doing nothing is today's behaviour, and the worst
 *     outcome of guessing is the app jumping away from its own highlight.
 *  2. ONLY AS FAR AS NEEDED. The requirement is the element's BOTTOM edge
 *     plus a margin sitting above the covered strip, so an element that is
 *     already clear of it returns 0 — including every element in the top
 *     half of the screen, which is the case that was never broken.
 *  3. NEVER PAST THE TOP. The lift is capped by the element's own headroom
 *     (frame.y - topInset), so the element can end up AT the safe-area line
 *     and never above it. An element already under the top keep-out has no
 *     headroom and is not moved.
 *  4. NEVER MORE THAN A SHARE OF THE WINDOW (maxRatio).
 *
 * When 3 or 4 bind, the element does NOT fully clear the sheet: we translate
 * as far as is sane and accept partial visibility, which is strictly better
 * than both the alternatives (not moving, or tearing the layout apart to
 * honour a requirement the screen has no room for).
 */
export function appPushTranslation(geometry: PushGeometry): number {
  const { frame, coveredTop, screen } = geometry;
  if (!frame || !screen) return 0;
  if (!finite(frame.x) || !finite(frame.y) || !finite(frame.width) || !finite(frame.height)) {
    return 0;
  }
  if (!(frame.width > 0) || !(frame.height > 0)) return 0;
  if (!finite(screen.height) || !(screen.height > 0)) return 0;
  if (coveredTop == null || !finite(coveredTop)) return 0;
  // Nothing is covered (no sheet measured yet, or a sheet with no height):
  // there is nothing to clear.
  if (coveredTop <= 0 || coveredTop >= screen.height) return 0;

  const clearance = numberOr(geometry.clearance, PUSH_CLEARANCE);
  const topInset = numberOr(geometry.topInset, PUSH_TOP_INSET);
  const maxRatio = numberOr(geometry.maxRatio, PUSH_MAX_RATIO);

  // 2 — what clearing the strip would cost.
  const needed = frame.y + frame.height + clearance - coveredTop;
  if (!(needed > 0)) return 0;

  // 3 and 4 — what we are willing to pay.
  const headroom = frame.y - topInset;
  if (!(headroom > 0)) return 0;
  const ceiling = Math.max(0, screen.height * maxRatio);

  return Math.round(Math.min(needed, headroom, ceiling));
}

/**
 * The aim chrome's bounds, RE-EXPRESSED for a pushed layout.
 *
 * The label and the confirm bar are placed in untranslated window
 * coordinates and then carried up by the same transform as everything else,
 * so a chip placed at y appears at y - push. Both of the limits that keep a
 * chip readable therefore move with it: a chip must now be placed BELOW
 * `topMargin + push` to appear below the status bar, and ABOVE
 * `coveredTop + push` to appear above the sheet.
 *
 * Getting this wrong is silent and specific: without it the element's own
 * name label ends up under the dynamic island exactly in the case push mode
 * was built for (an element lifted to the top of the screen).
 */
export function pushedAimBounds(
  push: number,
  coveredTop: number | undefined,
  topMargin: number = AIM_TOP_MARGIN,
): { topMargin: number; occludedTop: number | undefined } {
  const shift = finite(push) && push > 0 ? push : 0;
  return {
    topMargin: topMargin + shift,
    occludedTop: coveredTop == null || !finite(coveredTop) ? undefined : coveredTop + shift,
  };
}

/**
 * The composer's ceiling, given whether it is currently pushing the app.
 * `pushing` is not a preference — it is "the translation came out non-zero"
 * (src/index.tsx), so the sheet gives up height exactly when that height is
 * what is buying the room.
 */
export function sheetMaxHeight(windowHeight: number, pushing: boolean): number {
  if (!pushing) return composerSheetMaxHeight(windowHeight);
  if (!finite(windowHeight) || !(windowHeight > 0)) return 0;
  return Math.max(0, Math.floor(windowHeight * PUSH_SHEET_MAX_RATIO));
}

/**
 * THE INPUT'S FLOOR, which is what decides whether the row under it is
 * half-drawn.
 *
 * The compact ceiling (30% of the window) leaves the composer's scroll body
 * about 100pt. A three-line input starts at 72pt and the attach row wants
 * another 44, so the row landed a few pixels tall with the rest cut off
 * mid-switch — which reads as a rendering bug rather than as "there is more
 * below" (device-observed, product owner). A ScrollView was doing exactly
 * what it was told; there was simply nowhere to put the row.
 *
 * So while the app is pushed the field starts at ONE line and grows with
 * what is typed, exactly as it did before — the difference is only where it
 * starts, and it buys the row underneath enough room to be drawn whole.
 * Nothing is hidden: the body still scrolls, and the field still tops out
 * at its own maxHeight.
 */
export const COMPOSER_INPUT_MIN_HEIGHT = 72;
export const COMPOSER_INPUT_MIN_HEIGHT_COMPACT = 44;

export function composerInputMinHeight(pushing: boolean): number {
  return pushing ? COMPOSER_INPUT_MIN_HEIGHT_COMPACT : COMPOSER_INPUT_MIN_HEIGHT;
}

// ── The detail panes ─────────────────────────────────────────────────────────

/**
 * THE SAME PROBLEM, ONE STEP LATER — and arguably the worse half of it.
 *
 * The composer covers the element you are describing; a DETAIL PANE (an
 * agent task, a team note — src/detail-shell.tsx) covers the element you are
 * REREADING, days after you filed it, when the context that was obvious at
 * capture time is exactly what you no longer have. So the panes push too, on
 * the same terms and with the same clamps.
 *
 * WHAT IS DIFFERENT, and it is the whole of the difference: the composer has
 * a LIVE aim frame, re-measured this second against the app as it is right
 * now. A detail pane has only the frame the server STORED at capture time
 * (`boundingBox`, window coordinates, protocol v1). Nobody re-measures it,
 * and nothing here pretends to:
 *
 *  - RE-MEASURING WAS CONSIDERED AND REJECTED. The inspector hit-tests a
 *    root ref that only exists during an aim gesture (src/inspector.ts,
 *    src/capture.tsx); resurrecting an element by testID would mean a
 *    second traversal API, on a tree the pane is currently covering, for a
 *    frame that would still be a guess about which of several matching
 *    nodes was meant. That is a lot of machinery to make a dev-tool sheet
 *    slide differently.
 *  - SO WE PUSH THE STORED FRAME, and are honest about what that means: the
 *    thing guaranteed to be brought into view is the OVERLAY'S OWN RECORD
 *    of the element — its marker, which is drawn from the same stored
 *    coordinates and rides the same transform (src/markers.tsx is inside
 *    the pushed layer). If the screen has scrolled or re-laid-out since,
 *    the marker and the element have already parted company, visibly, and
 *    the push moves the marker to where the reader can see it rather than
 *    inventing a position for an element it cannot find.
 *  - AND WE REFUSE, SILENTLY AND COMPLETELY, when even that much is not
 *    true (below). With no toggle there is nothing to disable and nothing to
 *    explain: a pane that cannot place its element simply opens over an app
 *    that does not move, which is what every such pane did until now.
 */

/** The stored half of an annotation or a note — all this geometry needs. */
export interface DetailPushSubject {
  routeName?: string | null;
  boundingBox?: { x: number; y: number; width: number; height: number } | null;
}

/**
 * How far a stored frame may exceed the current window before we call it a
 * frame from a different layout — a rotation, a foldable, an iPad's split
 * view, a capture from another device on the same session. Generous (a
 * frame slightly overhanging the window is ordinary), but a frame twice the
 * screen's width is not a frame for this screen.
 */
const STALE_FRAME_TOLERANCE = 1.5;

/**
 * The frame a detail pane may push against, or NULL for "do not move".
 *
 * ROUTE FIRST, and by exactly the rule the markers use (`visibleMarkers`,
 * src/marker-hit.ts): a conflict between two KNOWN route names hides the
 * marker, and it must equally refuse the push — the element is not on this
 * screen, so lifting this screen reveals nothing and only makes the app
 * lurch. An item or a host that does not know its route is not a conflict,
 * and is treated as "here", again exactly as the markers do; the frame
 * checks below are what stop that from becoming nonsense.
 *
 * THEN THE FRAME, which must be finite, have area, and plausibly belong to
 * the window we are looking at. A frame that starts below the bottom edge
 * or right of the right edge is not stale, it is from another layout, and
 * pushing by "however far it takes to lift something off-screen into view"
 * is precisely the absurd translation the clamps in `appPushTranslation`
 * exist to survive rather than to produce.
 */
export function detailPushFrame(
  subject: DetailPushSubject | null | undefined,
  routeName: string | null | undefined,
  screen: PushScreen,
): AimRect | null {
  if (!subject) return null;
  if (routeName && subject.routeName && subject.routeName !== routeName) return null;
  const box = subject.boundingBox;
  if (!box) return null;
  if (!finite(box.x) || !finite(box.y) || !finite(box.width) || !finite(box.height)) return null;
  if (!(box.width > 0) || !(box.height > 0)) return null;
  if (!finite(screen?.width) || !finite(screen?.height)) return null;
  const belongsHere =
    box.x < screen.width &&
    box.y < screen.height &&
    box.x + box.width > 0 &&
    box.y + box.height > 0 &&
    box.width <= screen.width * STALE_FRAME_TOLERANCE &&
    box.height <= screen.height * STALE_FRAME_TOLERANCE;
  if (!belongsHere) return null;
  return { ...box };
}

/**
 * The detail pane's own ceiling, pushing or not.
 *
 * Not pushing keeps the 80% the pane has always had — it is a reading
 * surface with a thread in it. Pushing gives up rather more than the
 * composer does in absolute terms and rather less in principle: the point of
 * moving the app is to look at it, and 80% of the window would leave nothing
 * to look at. 45% still holds a header, several messages and the reply box
 * before it scrolls, which is the least a conversation can be read in.
 */
export const DETAIL_SHEET_MAX_RATIO = 0.8;
export const DETAIL_PUSH_SHEET_MAX_RATIO = 0.45;

export function detailSheetMaxHeight(windowHeight: number, pushing: boolean): number {
  if (!finite(windowHeight) || !(windowHeight > 0)) return 0;
  const ratio = pushing ? DETAIL_PUSH_SHEET_MAX_RATIO : DETAIL_SHEET_MAX_RATIO;
  return Math.max(0, Math.floor(windowHeight * ratio));
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function numberOr(value: number | undefined, fallback: number): number {
  return finite(value) ? value : fallback;
}
