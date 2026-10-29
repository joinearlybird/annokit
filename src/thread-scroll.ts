/**
 * WHERE A MESSAGE LIST SHOULD BE LOOKING.
 *
 * Both detail panes open onto a conversation, and a conversation's newest
 * message is the one you came for — but both panes used to open at message
 * one and stay there, so a thread of any length opened onto history and hid
 * its own present (product owner, device testing). Worse, posting a reply
 * appended it below the fold: you typed, it "worked", and nothing moved.
 *
 * So: land at the bottom, and follow your own messages down. The one case
 * where following is hostile is a reader who has deliberately scrolled UP
 * into the history when someone else's message lands — yanking them back is
 * the behaviour every chat app gets shouted at for. Hence a REASON, not a
 * boolean: the pane says why it wants to scroll, and this decides.
 *
 * Pure, because "did we just steal the user's scroll position" is invisible
 * in a screenshot and obvious in a test.
 */

/** Why a pane is considering a scroll-to-bottom. */
export type ScrollReason =
  /** The pane just opened, or its first authoritative read landed. */
  | "open"
  /** The user posted; this is their own message arriving. */
  | "own"
  /** A refresh brought in messages the user did not write. */
  | "incoming";

/** The scroll metrics RN hands `onScroll`, narrowed to what we read. */
export interface ScrollMetrics {
  layoutMeasurement: { height: number };
  contentOffset: { y: number };
  contentSize: { height: number };
}

/**
 * Is the view parked at (or within a thumb's reach of) the end?
 *
 * The slack matters: a list is almost never at exactly its maximum offset
 * after a momentum scroll, and a few stray pixels must not read as "the user
 * is reading history".
 */
export function isNearBottom(m: ScrollMetrics, slack = 48): boolean {
  const distance = m.contentSize.height - m.contentOffset.y - m.layoutMeasurement.height;
  return distance <= slack;
}

/**
 * Should the pane jump to the newest message?
 *
 * Opening and your own replies always win — those are moments the user just
 * caused and expects to see the result of. Someone else's message only wins
 * when the user was already at the bottom, i.e. already reading the present.
 */
export function shouldAutoScroll(reason: ScrollReason, atBottom: boolean): boolean {
  if (reason === "open" || reason === "own") return true;
  return atBottom;
}

/**
 * Animate the jump?
 *
 * Opening should not animate — the pane is already sliding up, and a second
 * motion inside it reads as a glitch. Everything after is a change the user
 * should SEE happen.
 */
export function autoScrollAnimated(reason: ScrollReason): boolean {
  return reason !== "open";
}

/**
 * The list's VIEWPORT changed size: stay on the newest message?
 *
 * The opening jump runs when the content first measures, and the sheet has
 * not settled its own height yet: a content-sized sheet first lays the list
 * out tall enough to hold everything, so there is nothing to scroll, and
 * only then shrinks to its cap. The content size does not change, so
 * nothing jumps again, and the pane sat on its oldest message (device
 * testing, a four-message team note). A viewport change re-anchors a list
 * that is still parked at the bottom, which is also what keeps the newest
 * message in view when the keyboard takes room. A reader who scrolled up
 * is left where they are, the same rule as for incoming messages.
 */
export function shouldFollowResize(atBottom: boolean): boolean {
  return atBottom;
}
