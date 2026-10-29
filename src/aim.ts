/**
 * Aim highlighting — the touch analogue of the web overlay's hover
 * highlight, and the reason armed mode is no longer a blind tap.
 *
 * On the web the pointer hovers before it clicks, so the overlay can
 * outline the element under the cursor and name it. A finger has no hover:
 * the first the user knows about their target is after they have committed
 * to it. So arming no longer captures on contact — it SELECTS:
 *
 *   finger down  → hit-test, outline the element, name it
 *   drag         → re-hit-test (throttled) so the user can survey
 *   release      → the outline STAYS (a persistent selection), and a
 *                  confirm button appears; the composer does not open yet
 *   tap again    → the selection moves to the new element (change your mind)
 *   confirm      → the composer opens as a bottom sheet, with the selection
 *                  still visible above it
 *
 * This module is the session-independent half: geometry, label text, and
 * the survey tracker (throttle + staleness + clearing). It imports nothing
 * from react-native so it is unit-testable in the node environment, and the
 * rendering half (src/aim-overlay.tsx) stays a dumb view of its output.
 */

export interface AimRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AimSize {
  width: number;
  height: number;
}

/**
 * One re-hit-test per ~60ms (≈ one 60fps frame). Fast enough that the
 * outline reads as "attached to the finger", slow enough that a drag does
 * not queue one native round-trip per touch event.
 */
export const AIM_THROTTLE_MS = 60;
/** Gap between the highlighted frame and the chrome anchored to it. */
export const AIM_CHIP_GAP = 6;
/** Keep anchored chrome this far inside the side and bottom screen edges. */
export const AIM_EDGE_MARGIN = 8;
/**
 * A bigger allowance at the TOP. Device-observed: a label placed 8px down
 * is technically on-screen and completely unreadable, sitting under the
 * status bar / dynamic island. This package will not take a dependency on
 * react-native-safe-area-context to learn the real inset, so it uses a
 * conservative constant — the cost of over-estimating is a label that flips
 * below its element, which is fine; the cost of under-estimating is a label
 * nobody can read.
 */
export const AIM_TOP_MARGIN = 52;

export interface AimPlacement {
  left: number;
  top: number;
  /** True when the chip ended up under the frame instead of over it. */
  below: boolean;
}

export interface AimPlacementOptions {
  /** Preferred side of the frame. Default "above". */
  prefer?: "above" | "below";
  gap?: number;
  margin?: number;
  /** Top allowance (status bar / notch). Defaults to AIM_TOP_MARGIN. */
  topMargin?: number;
  /**
   * Y coordinate below which the screen is covered by something opaque
   * (the composer bottom sheet). Chrome is kept above it so the selection
   * stays readable while the user types.
   */
  occludedTop?: number;
}

/**
 * Place a small chip (the name label, the confirm button) against a
 * highlighted frame.
 *
 * The rules, in order:
 *  P1. Take the PREFERRED side; the label prefers above (the finger is
 *      inside the frame, and anything drawn over it is hidden by the hand)
 *      and the confirm button prefers below, so the two never collide.
 *  P2. FLIP to the other side when the preferred one would clip off-screen
 *      (a frame in a header has no room above; one at the bottom none
 *      below). A chip clipped off-screen names nothing.
 *  P3. CENTRE horizontally on the frame, then CLAMP into the screen so a
 *      chip on a wide or edge-hugging element stays fully readable.
 *  P4. Vertical clamp last. An element too tall for a chip to sit outside
 *      it (a full-screen container) is the one case where the chip lands
 *      ON the frame — there is nowhere else, and no chip at all would be
 *      worse.
 */
export function placeAimChip(
  frame: AimRect,
  chip: AimSize,
  screen: AimSize,
  options: AimPlacementOptions = {},
): AimPlacement {
  const gap = options.gap ?? AIM_CHIP_GAP;
  const margin = options.margin ?? AIM_EDGE_MARGIN;
  const topMargin = options.topMargin ?? Math.max(margin, AIM_TOP_MARGIN);
  const bottomLimit =
    options.occludedTop != null ? Math.min(screen.height, options.occludedTop) : screen.height;

  // P1/P2 — preferred side, flipped when it does not fit.
  const aboveTop = frame.y - gap - chip.height;
  const belowTop = frame.y + frame.height + gap;
  const fitsAbove = aboveTop >= topMargin;
  const fitsBelow = belowTop + chip.height <= bottomLimit - margin;
  const prefer = options.prefer ?? "above";
  let below: boolean;
  if (prefer === "above") below = !fitsAbove && fitsBelow;
  else below = fitsBelow || !fitsAbove;

  // P3 — centre, then clamp horizontally (a chip wider than the screen
  // pins to the left margin rather than centring its overflow).
  const centred = frame.x + frame.width / 2 - chip.width / 2;
  const maxLeft = screen.width - margin - chip.width;
  const left = maxLeft < margin ? margin : clamp(centred, margin, maxLeft);

  // P4 — clamp vertically inside the usable (non-occluded) screen.
  const maxTop = bottomLimit - margin - chip.height;
  const rawTop = below ? belowTop : aboveTop;
  const top = maxTop < topMargin ? Math.max(0, maxTop) : clamp(rawTop, topMargin, maxTop);

  return { left, top, below };
}

/** The element's name label: above the frame by default. */
export function placeAimLabel(
  frame: AimRect,
  chip: AimSize,
  screen: AimSize,
  options: Omit<AimPlacementOptions, "prefer"> = {},
): AimPlacement {
  return placeAimChip(frame, chip, screen, { ...options, prefer: "above" });
}

/** The confirm button: below the frame by default, opposite the label. */
export function placeAimConfirm(
  frame: AimRect,
  chip: AimSize,
  screen: AimSize,
  options: Omit<AimPlacementOptions, "prefer"> = {},
): AimPlacement {
  return placeAimChip(frame, chip, screen, { ...options, prefer: "below" });
}

/**
 * Place BOTH chips against the same frame without letting them overlap.
 *
 * Opposite defaults usually keep them apart, but not always: an element
 * against the top edge pushes the label DOWN into the confirm button's slot
 * (device-observed — the button sat on top of the element's name). So the
 * label is placed first and the button is then placed against a frame
 * EXPANDED to include the label's footprint, which makes it stack under (or
 * over) the label using the same flip-and-clamp rules as everything else.
 *
 * The label's WIDTH never affects the button, and its height is fixed (one
 * line), so a caller that only knows one of the two sizes exactly still
 * gets the right answer for its own chip.
 */
export function placeAimChrome(
  frame: AimRect,
  label: AimSize,
  confirm: AimSize,
  screen: AimSize,
  options: Omit<AimPlacementOptions, "prefer"> = {},
): { label: AimPlacement; confirm: AimPlacement } {
  const gap = options.gap ?? AIM_CHIP_GAP;
  const labelPlace = placeAimLabel(frame, label, screen, options);
  const footprint = label.height + gap;
  const expanded: AimRect = labelPlace.below
    ? { ...frame, height: frame.height + footprint }
    : { ...frame, y: frame.y - footprint, height: frame.height + footprint };
  const confirmPlace = placeAimConfirm(expanded, confirm, screen, options);

  // Last resort. For a frame mostly OFF-screen both chips clamp to the same
  // edge and land on each other; the anchor is meaningless there, so the
  // button simply stacks against the label.
  if (overlapping(labelPlace, label, confirmPlace, confirm)) {
    const margin = options.margin ?? AIM_EDGE_MARGIN;
    const bottomLimit =
      options.occludedTop != null ? Math.min(screen.height, options.occludedTop) : screen.height;
    const under = labelPlace.top + label.height + gap;
    const fitsUnder = under + confirm.height <= bottomLimit - margin;
    return {
      label: labelPlace,
      confirm: {
        left: confirmPlace.left,
        top: fitsUnder ? under : Math.max(0, labelPlace.top - gap - confirm.height),
        below: fitsUnder,
      },
    };
  }
  return { label: labelPlace, confirm: confirmPlace };
}

function overlapping(a: AimPlacement, aSize: AimSize, b: AimPlacement, bSize: AimSize): boolean {
  return (
    a.top < b.top + bSize.height &&
    b.top < a.top + aSize.height &&
    a.left < b.left + bSize.width &&
    b.left < a.left + aSize.width
  );
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Ceiling on the composer sheet, as a share of the window. */
export const COMPOSER_SHEET_MAX_RATIO = 0.4;

/**
 * The composer sheet is sized by its CONTENT, not by a fixed fraction —
 * every point it does not use is another point of the app (and of the
 * highlighted element) the user can still see. This is only the ceiling,
 * past which the sheet stops growing and scrolls internally instead.
 */
export function composerSheetMaxHeight(windowHeight: number): number {
  // Floor, not round: the cap is a ceiling and must never be exceeded.
  return Math.max(0, Math.floor(windowHeight * COMPOSER_SHEET_MAX_RATIO));
}

/**
 * The y below which the sheet covers the screen, given the height it
 * actually laid out at. Fed to the aim overlay as `occludedTop` so the
 * element's name label hops above the sheet instead of hiding behind it.
 * A sheet whose height is not measured yet occludes nothing.
 */
export function composerOccludedTop(windowHeight: number, sheetHeight: number | null): number | undefined {
  if (sheetHeight == null || !(sheetHeight > 0)) return undefined;
  return Math.max(0, windowHeight - sheetHeight);
}

// ── Throttle ─────────────────────────────────────────────────────────────────

export interface Throttle<T> {
  /** Offer a value; emitted now or on the trailing edge of the window. */
  call: (value: T) => void;
  /** Emit any pending value immediately. */
  flush: () => void;
  /** Drop any pending value (the gesture ended; it is stale). */
  cancel: () => void;
}

/**
 * Leading + trailing throttle. Emits at most once per `intervalMs`, and the
 * LAST value offered is always delivered — dropping the final position of a
 * drag would leave the highlight lagging behind the finger at the moment it
 * matters most.
 */
export function createThrottle<T>(fn: (value: T) => void, intervalMs: number): Throttle<T> {
  let lastEmit = -Infinity;
  let pending: { value: T } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const emit = (value: T) => {
    lastEmit = Date.now();
    pending = null;
    fn(value);
  };

  const onTimer = () => {
    timer = null;
    if (pending) emit(pending.value);
  };

  return {
    call(value: T) {
      const wait = intervalMs - (Date.now() - lastEmit);
      if (wait <= 0) {
        clearTimer();
        emit(value);
        return;
      }
      pending = { value };
      if (!timer) timer = setTimeout(onTimer, wait);
    },
    flush() {
      clearTimer();
      if (pending) emit(pending.value);
    },
    cancel() {
      clearTimer();
      pending = null;
    },
  };
}

// ── Target derivation ────────────────────────────────────────────────────────

/** The inspector fields the aim overlay needs (a subset of InspectorHit). */
export interface AimHit {
  element: string;
  frame: AimRect;
  testID?: string;
  source?: { file: string; line: number };
}

/** What the overlay draws: a frame to outline and a name to show. */
export interface AimTarget {
  frame: AimRect;
  label: string;
}

/**
 * Short label for a hit: the resolved component name, plus the source
 * BASENAME:line when the inspector already had it (a floating label has no
 * room for `app/src/components/Card.tsx`, and the composer shows the full
 * path anyway). Never triggers work of its own — if the survey hit-test
 * skipped symbolication, the name stands alone.
 */
export function formatAimLabel(hit: AimHit): string {
  const name = hit.element || hit.testID || "UnknownView";
  if (!hit.source?.file) return name;
  const base = hit.source.file.split("/").pop() || hit.source.file;
  return `${name} · ${base}:${hit.source.line}`;
}

/**
 * A hit becomes a highlight only if it has a frame with real area — a
 * zero-sized frame would draw a degenerate outline pointing at nothing,
 * which is worse than showing no highlight at all.
 */
export function aimTargetFromHit(hit: AimHit | null | undefined): AimTarget | null {
  if (!hit || !hit.frame) return null;
  const { width, height } = hit.frame;
  if (!(width > 0) || !(height > 0)) return null;
  return { frame: hit.frame, label: formatAimLabel(hit) };
}

// ── Survey tracker ───────────────────────────────────────────────────────────

/**
 * A resolved selection: where the user touched, what was there, what to draw.
 *
 * `hit` and `target` are BOTH nullable, and the difference matters:
 *
 *   hit null, target null    nothing was identified — a position-only mark
 *   hit set,  target null    identified, but with no frame worth outlining
 *   hit set,  target set     the ordinary case
 *
 * A selection with no target is still a selection. The user tapped
 * deliberately, and the coordinate is worth keeping even when nothing can
 * be named: see `createAimTracker` for why this is not the same as "no
 * selection at all".
 */
export interface AimSelection<H extends AimHit = AimHit> {
  x: number;
  y: number;
  hit: H | null;
  /** What to outline, or null when there is no frame worth drawing. */
  target: AimTarget | null;
  /** True once the gesture ended and this is the committed selection. */
  final: boolean;
}

/**
 * The frame to anchor chrome to — the confirm button, the name label.
 *
 * Drawing and anchoring are different questions. `aimTargetFromHit` refuses
 * a zero-area frame because a degenerate OUTLINE points at nothing, but the
 * confirm button still has to appear somewhere, and the tap point is the
 * honest place. `placeAimChip` centres on a frame, so a zero-size one at
 * (x, y) places chrome exactly over where the finger went down.
 */
export function aimAnchorTarget<H extends AimHit = AimHit>(
  selection: AimSelection<H>,
): AimTarget {
  if (selection.target) return selection.target;
  return {
    frame: { x: selection.x, y: selection.y, width: 0, height: 0 },
    label: selection.hit ? formatAimLabel(selection.hit) : "this spot",
  };
}

export interface AimTracker {
  /** Finger down / moved to (x, y) — survey it (throttled). */
  aim: (x: number, y: number) => void;
  /** Finger lifted at (x, y) — resolve it fully and keep it selected. */
  select: (x: number, y: number) => void;
  /** Drop the selection and forget any in-flight work. */
  clear: () => void;
}

export interface AimTrackerOptions<H extends AimHit = AimHit> {
  /**
   * Hit-test a point. `final` is false for the throttled survey (callers
   * should skip expensive extras like Metro symbolication there) and true
   * for the committed selection. Must never throw; null means "nothing".
   */
  inspect: (x: number, y: number, final: boolean) => Promise<H | null>;
  /** Called with the selection to draw, or null to hide the highlight. */
  onSelection: (selection: AimSelection<H> | null) => void;
  throttleMs?: number;
}

/**
 * Drives the survey: throttles positions, resolves them asynchronously, and
 * keeps the drawn highlight honest.
 *
 * Two kinds of staleness are handled, because a hit-test is a native
 * round-trip that can land out of order or after the gesture:
 *  - a response for an older position is dropped (the finger moved on);
 *  - a response that arrives after `clear()` is dropped entirely, so a
 *    highlight can never flash back over a screen that has moved on.
 * A null hit HIDES the highlight rather than freezing the last one — a
 * stale outline under the finger is a lie about what release will select.
 *
 * A null hit on RELEASE is different, and used to be the bug that made
 * armed mode useless wherever the inspector is unavailable. Surveying with
 * nothing under the finger means "nothing to outline"; releasing with
 * nothing under the finger means "the user committed to this point". The
 * first hides the highlight, the second commits a position-only selection —
 * otherwise the confirm button never appears, the composer is unreachable,
 * and the tap (which the capture root has already swallowed) does nothing
 * at all. That is exactly what react-native-web sees, because
 * `getInspectorDataForViewAtPoint` is a React Native renderer API, and what
 * any build without the dev inspector would see.
 */
export function createAimTracker<H extends AimHit = AimHit>({
  inspect,
  onSelection,
  throttleMs = AIM_THROTTLE_MS,
}: AimTrackerOptions<H>): AimTracker {
  let seq = 0;
  let generation = 0;

  const run = (point: { x: number; y: number; final: boolean }) => {
    const mySeq = ++seq;
    const myGeneration = generation;
    void (async () => {
      let hit: H | null = null;
      try {
        hit = await inspect(point.x, point.y, point.final);
      } catch {
        hit = null; // fail-soft: an inspector blowup hides the highlight
      }
      if (mySeq !== seq || myGeneration !== generation) return;
      const target = aimTargetFromHit(hit);
      if (target || point.final) {
        onSelection({ x: point.x, y: point.y, hit, target, final: point.final });
      } else {
        onSelection(null);
      }
    })();
  };

  const throttle = createThrottle(run, throttleMs);

  return {
    aim(x: number, y: number) {
      throttle.call({ x, y, final: false });
    },
    select(x: number, y: number) {
      // The committed point must never wait behind a throttle window, and
      // any queued survey position is now stale.
      throttle.cancel();
      run({ x, y, final: true });
    },
    clear() {
      throttle.cancel();
      generation++;
      seq++;
      onSelection(null);
    },
  };
}
