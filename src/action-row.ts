/**
 * ACTION BUTTONS — one size, everywhere, side by side.
 *
 * TWO DECISIONS LIVE HERE, and they are both about a sheet that is now
 * sometimes short (push mode, src/push.ts).
 *
 * INLINE, NOT STACKED. The composer's commit and its Cancel were on separate
 * rows because the destination buttons they grew out of each carried an
 * explaining sentence that could not survive being halved. The copy trims
 * removed those sentences — the segment names the destination, the button
 * spells out the verb — so the constraint that forced stacking is gone, and
 * a row per button is a row a compact sheet does not have. There is no
 * "stack it again if the words are tight" mode: one layout is worth more
 * than a branch nobody sees (product owner). At an extreme accessibility
 * text size the label shrinks and ellipsizes, which is the accepted edge.
 *
 * ONE SIZE IN BOTH MODES. The compact metrics apply in overlay mode too,
 * rather than switching with the mode: a control that changes size when you
 * move the sheet reads as a different control, and the tall sheet does not
 * look empty without the extra padding — it gives the space back to the
 * thing being written.
 *
 * THE HEIGHT FLOOR IS THE TOUCH TARGET, NOT THE PADDING. The buttons drop a
 * point of type and a few of vertical padding — that is what stops them
 * dominating — but never drop below a comfortable target, so the visual
 * weight shrinks and the tappable area does not.
 */

/** Gap between two inline actions. */
export const ACTION_GAP = 10;

/** Comfortable minimum touch target, and therefore the button's min height. */
export const ACTION_MIN_HEIGHT = 44;

/** Compact metrics: lighter than the old sizing, same target. */
export const ACTION_PADDING_V = 9;
export const ACTION_PADDING_H = 14;
export const ACTION_FONT_SIZE = 14;
