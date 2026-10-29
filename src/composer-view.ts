/**
 * What the composer SHOWS, as pure functions — the sentences and the one-line
 * summaries the sheet draws, with none of the drawing.
 *
 * WHY THIS EXISTS. The sheet grew a container per feature round: a bordered
 * identity card, an attachment tray, a boxed drop-notice, and two full-width
 * destination buttons each carrying its own explainer. Every box was
 * defensible alone; together they read as a wall (product owner, device
 * testing: "a bit too boxy and confusing"). Flattening them means the sheet
 * now shows ONE identity line and ONE helper line where there used to be
 * four blocks — and the rule for what those single lines say is exactly the
 * kind of precedence that silently loses a warning if it is only ever
 * expressed in JSX. So it lives here, and it is tested.
 *
 * The destination copy itself is still src/destination.ts; the submit rules
 * (canSubmitTo, submitBlockedReason) live there too.
 */

/** Just enough of a PendingCapture to name it. */
export interface IdentityCapture {
  hit?: {
    element?: string;
    testID?: string;
    source?: { file: string; line: number } | null;
  } | null;
  routeName?: string | null;
}

/** The last path segment: "app/src/components/Card.tsx" → "Card.tsx". */
export function fileBasename(file: string): string {
  const cut = file.replace(/\\/g, "/").split("/");
  return cut[cut.length - 1] || file;
}

/**
 * The captured element on ONE line: "PrimaryButton · Card.tsx:3".
 *
 * This is CONTEXT, not the headline — the user already knows what they
 * tapped, and the sentence they are about to write is the point of the
 * sheet. So the name and where it came from collapse into a single muted
 * line instead of a two-line bordered card, and the path is shortened to its
 * basename: a full "app/src/components/Card.tsx" wrapped or ellipsised on a
 * phone and told the reader nothing the filename did not.
 *
 * Falls back the way the capture does: source line, then testID, then route,
 * then nothing at all (in which case the line is just the element name).
 */
export function captureIdentityLine(capture: IdentityCapture): string {
  const hit = capture.hit ?? null;
  const name = hit?.element?.trim() || "Screen";
  const where = hit?.source
    ? `${fileBasename(hit.source.file)}:${hit.source.line}`
    : hit?.testID
      ? `#${hit.testID}`
      : capture.routeName?.trim() || "";
  return where ? `${name} · ${where}` : name;
}

/**
 * AVAILABLE IS NOT ATTACHED.
 *
 * The screenshot is taken EAGERLY, at confirm time, before the destination is
 * known — an agent task that arrives without its screenshot cannot be given
 * one afterwards, so the shot has to exist before the choice is made
 * (src/index.tsx, openComposer). That made `capture.screenshotUri` non-null
 * essentially always, and the sheet used to seed its toggle from exactly that
 * value — so "a screenshot EXISTS" and "the user WANTS it sent" were one
 * boolean.
 *
 * That conflation is a bug with two faces. The visible one: `hasScreenshot`
 * was permanently true, so `attachmentControlsVisible` never hid anything and
 * the Team half kept offering a switch it could not honour, under a permanent
 * orange "a team note drops the screenshot" notice about a screenshot nobody
 * had asked for (product owner, device testing). The quieter one: every agent
 * task uploaded a screenshot whether or not the author wanted it.
 *
 * So the eager capture stays and the CHOICE starts off. Attaching is a tap.
 * Default-on for the agent's half was considered — screenshots are genuinely
 * useful context — and rejected: it would put the visibility signal back on a
 * default rather than on intent, which is the bug, and it makes the Team half
 * depend on which half you looked at first. Off everywhere, opt-in, one rule.
 */
export const SCREENSHOT_ATTACHED_BY_DEFAULT = false;

/** Just enough of a PendingCapture to reason about its screenshot. */
export interface ScreenshotCapture {
  screenshotUri?: string | null;
  canScreenshot?: boolean;
}

/**
 * Whether the SWITCH IS DRAWN: a screenshot is possible here.
 *
 * Separate from whether one exists, and the separation is the whole point
 * of opt-in capture. The shot is taken when the switch goes on, so keying
 * the switch off "a shot exists" would mean it never appeared: nothing to
 * flip, so nothing taken, so nothing to flip.
 *
 * `canScreenshot` is the provider's answer (peer resolved, host has not
 * turned screenshots off, server has the route). Older callers that only
 * carry a URI still work — if a shot is already in hand, a screenshot is
 * self-evidently possible.
 */
export function screenshotOffered(capture: ScreenshotCapture): boolean {
  return capture.canScreenshot === true || capture.screenshotUri != null;
}

/**
 * Whether a screenshot HAS BEEN TAKEN — the preview and the upload are
 * derived from this, never from the switch alone.
 */
export function screenshotAvailable(capture: ScreenshotCapture): boolean {
  return capture.screenshotUri != null;
}

/**
 * Whether a screenshot actually rides along: the user asked for it AND there
 * is one. This is the ATTACHED half — the only thing `hasScreenshot`, the
 * drop notice, and the controls' visibility may ever be derived from.
 */
export function screenshotAttached(wanted: boolean, capture: ScreenshotCapture): boolean {
  return wanted && screenshotAvailable(capture);
}

/**
 * How long the composer shows "Taking the screenshot…" before it hides
 * itself to be captured.
 *
 * Feedback for a capture has an awkward constraint: anything drawn WHILE
 * the shot is taken ends up in the shot. So the only moment a spinner can
 * exist is before the sheet steps out, and this is the size of that moment
 * — long enough to register as "something is happening", short enough that
 * the tap and the thumbnail still feel like one gesture.
 */
export const CAPTURE_BUSY_BEAT_MS = 180;
