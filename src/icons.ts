/**
 * The overlay's icon language, in one place.
 *
 * NO COLOUR EMOJI. Every glyph here is a monochrome TEXT character: it
 * inherits the colour and weight of the Text it sits in, so the same mark
 * reads correctly on the dark chrome, at 20pt on the collapsed button and
 * at 14pt in the toolbar. A colour emoji does none of that — it ignores
 * `color`, carries its own palette, and sat next to the drawn glyphs like a
 * sticker (product owner, device testing: the annotate action's speech-balloon
 * emoji is now the same pencil the button has always used).
 *
 * The mechanism is the VARIATION SELECTOR: U+FE0E after a character that
 * has both presentations asks for the text one. Keep it on any glyph added
 * here — test/icons.test.ts fails the build without it, so the rule cannot
 * quietly rot back to emoji.
 *
 * These are constants rather than a component because they ARE text: a
 * component would only wrap what a Text node already renders identically
 * everywhere it is used.
 */

/** Annotate: the overlay's primary mark, on the button, toolbar and confirm bar. */
export const ICON_PENCIL = "✏︎";
/**
 * Comment: human-to-human discussion, NOT an instruction for the agent.
 * A quotation mark rather than a speech balloon on purpose — every balloon
 * glyph in Unicode (U+1F4AC, U+1F5E8) is emoji-presentation on iOS, and this
 * one is a plain text ornament that takes the Text's colour like the rest.
 */
export const ICON_COMMENT = "❝";
/** Dismiss / cancel / delete. */
export const ICON_CLOSE = "×";
/** The pending queue. */
export const ICON_QUEUE = "☰︎";
/** Collapse the toolbar back to the button. */
export const ICON_COLLAPSE = "⌄";
/** Selected, in the queue's and attach panel's checkboxes. */
export const ICON_CHECK = "✓";
/**
 * DELETE, in the detail pane's header.
 *
 * NOT a wastebasket. U+1F5D1 was tried first and iOS renders it in colour
 * even with U+FE0E after it — a metal mesh bin, ignoring the destructive red
 * that is the only thing marking the control as dangerous now that the word
 * "Delete" is gone (device testing). The erase key's own glyph is a plain
 * text symbol: it takes the colour and weight of the Text it sits in, like
 * every other mark on this chrome, and it is not a pictograph at all so the
 * guard below can never be argued with.
 */
export const ICON_DELETE = "⌦";
/**
 * The AGENT, on its avatar in a thread. A four-pointed star rather than a
 * robot: every robot/sparkle glyph in Unicode is emoji-presentation, and a
 * conversation needs to say "this speaker is not a teammate" in the same
 * monochrome ink as everything else on the chrome.
 */
export const ICON_AGENT = "✦";

/**
 * SEND, on the circular reply buttons in both detail panes. A plain upward
 * arrow (U+2191) — text-presentation everywhere, so it takes the accent
 * colour of the circle it sits in like every other mark here.
 */
export const ICON_SEND = "↑";

/** ADD ANOTHER, on the aim confirm bar (multi-select banking). */
export const ICON_PLUS = "+";

/**
 * CAMERA, the control that takes the screenshot.
 *
 * A FISHEYE (U+25C9), read as a lens. This was U+25A3 "▣" with a comment
 * claiming it read as a camera at 13pt; on a device it reads as a square,
 * and — worse — as very nearly the same square as `ICON_AREA` below, so
 * the two controls this package draws as boxes were indistinguishable in
 * the fallback. Nothing in monochrome text looks like a camera; a lens is
 * at least a different shape from a region, which is the distinction the
 * glyph has to carry.
 *
 * Text-presentation everywhere, like every other mark here — no emoji
 * camera, which would arrive as a colour sticker beside monochrome chrome.
 */
export const ICON_CAMERA = "\u25c9";

/**
 * AREA MODE, on the armed-mode chip. A plain box: the region, not a thing.
 * Deliberately the only box in the set now — see `ICON_CAMERA`.
 */
export const ICON_AREA = "▢";

/**
 * INFO, beside the screenshot toggle. Circled information source (U+24D8) —
 * text-presentation everywhere, no emoji risk.
 */
export const ICON_INFO = "\u24d8";

/** EXPAND, on the detail pane header: grow the sheet to the full screen. */
export const ICON_EXPAND = "\u2922";

/** MINIMIZE, the expand's other half: back to the sheet's own height. */
export const ICON_MINIMIZE = "\u2921";

/** REFRESH: ask again. U+21BB, a plain arrow with no emoji presentation. */
export const ICON_REFRESH = "\u21bb";

/**
 * SETTINGS, on the toolbar. The gear, with the variation selector — U+2699
 * is emoji-presentation on iOS without it and would arrive as a blue-and-
 * white sticker beside the monochrome marks.
 */
export const ICON_SETTINGS = "\u2699\ufe0e";

/** Every glyph the overlay draws — the guard test iterates this. */
export const OVERLAY_ICONS = [
  ICON_PENCIL,
  ICON_COMMENT,
  ICON_CLOSE,
  ICON_QUEUE,
  ICON_COLLAPSE,
  ICON_CHECK,
  ICON_DELETE,
  ICON_AGENT,
  ICON_SEND,
  ICON_SETTINGS,
  ICON_CAMERA,
  ICON_PLUS,
  ICON_AREA,
  ICON_INFO,
  ICON_EXPAND,
  ICON_MINIMIZE,
  ICON_REFRESH,
] as const;
