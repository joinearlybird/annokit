/**
 * The overlay's icons as DATA: one semantic name, two ways to draw it.
 *
 * WHY TWO. Drawn icons read better than text ornaments — a real trash can
 * says "delete" where U+2326 says "some symbol" — but Lucide on React Native
 * needs `react-native-svg`, and this package has no hard dependencies at all
 * (that is what makes it droppable into any app). So `react-native-svg` is an
 * OPTIONAL peer, exactly like react-native-view-shot and expo-sensors: when
 * it resolves the overlay draws Lucide, and when it does not every icon falls
 * back to the monochrome TEXT GLYPH it has always used (src/icons.ts). The
 * component that chooses is src/icon.tsx; nothing else in the package knows
 * which of the two it got.
 *
 * THE PATH DATA IS INLINED, and lucide-react-native is NOT a dependency: we
 * need ten icons, and a runtime dependency for ten path strings would be
 * exactly the kind of weight this package refuses to add to a host app.
 *
 *   Icon paths from Lucide — https://lucide.dev — ISC licence, (c) Lucide
 *   Contributors (itself a fork of Feather, MIT, (c) Cole Bemis). The stroke
 *   conventions come with them and must be kept: 24×24 viewBox, stroke
 *   width 2, round caps and joins, `currentColor`, no fill.
 *
 * Pure data, so the one rule that cannot be eyeballed — every name has BOTH
 * a drawing and a glyph, forever — is a table-driven test.
 */

import {
  ICON_AGENT,
  ICON_AREA,
  ICON_CHECK,
  ICON_CLOSE,
  ICON_COLLAPSE,
  ICON_COMMENT,
  ICON_DELETE,
  ICON_PENCIL,
  ICON_EXPAND,
  ICON_INFO,
  ICON_MINIMIZE,
  ICON_REFRESH,
  ICON_CAMERA,
  ICON_PLUS,
  ICON_QUEUE,
  ICON_SEND,
  ICON_SETTINGS,
} from "./icons";

/** What the overlay asks for. Semantic, never "the pencil glyph". */
export type IconName =
  | "annotate"
  | "close"
  | "delete"
  | "check"
  | "chevron"
  | "queue"
  | "comment"
  | "agent"
  | "send"
  | "settings"
  | "plus"
  | "camera"
  | "area"
  | "info"
  | "expand"
  | "minimize"
  | "refresh"
  | "gear";

/** Lucide's drawing conventions, applied to every icon we render. */
export const LUCIDE_VIEWBOX = "0 0 24 24";
export const LUCIDE_STROKE_WIDTH = 2;
export const LUCIDE_LINECAP = "round" as const;
export const LUCIDE_LINEJOIN = "round" as const;

/** Which Lucide icon each name is, for anyone comparing with lucide.dev. */
export const LUCIDE_NAMES: Record<IconName, string> = {
  annotate: "pencil",
  close: "x",
  delete: "trash-2",
  check: "check",
  chevron: "chevron-down",
  queue: "list",
  comment: "message-square",
  agent: "sparkle",
  send: "arrow-up",
  settings: "sliders-horizontal",
  plus: "plus",
  camera: "camera",
  area: "square-dashed",
  info: "info",
  expand: "maximize-2",
  minimize: "minimize-2",
  refresh: "rotate-cw",
  gear: "settings",
};

/** The `d` attributes, in Lucide's own order. */
export const ICON_PATHS: Record<IconName, readonly string[]> = {
  annotate: [
    "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",
    "m15 5 4 4",
  ],
  close: ["M18 6 6 18", "m6 6 12 12"],
  delete: [
    "M3 6h18",
    "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",
    "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
    "M10 11v6",
    "M14 11v6",
  ],
  check: ["M20 6 9 17l-5-5"],
  chevron: ["m6 9 6 6 6-6"],
  queue: ["M3 5h.01", "M3 12h.01", "M3 19h.01", "M8 5h13", "M8 12h13", "M8 19h13"],
  comment: ["M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"],
  settings: [
    "M10 5H3",
    "M12 19H3",
    "M14 3v4",
    "M16 17v4",
    "M21 12h-9",
    "M21 19h-5",
    "M21 5h-7",
    "M8 10v4",
    "M8 12H3",
  ],
  agent: [
    "M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z",
  ],
  send: ["m5 12 7-7 7 7", "M12 19V5"],
  plus: ["M5 12h14", "M12 5v14"],
  camera: [
    "M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z",
    "M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  ],
  area: [
    "M5 3a2 2 0 0 0-2 2",
    "M19 3a2 2 0 0 1 2 2",
    "M21 19a2 2 0 0 1-2 2",
    "M5 21a2 2 0 0 1-2-2",
    "M9 3h1",
    "M9 21h1",
    "M14 3h1",
    "M14 21h1",
    "M3 9v1",
    "M21 9v1",
    "M3 14v1",
    "M21 14v1",
  ],
  info: [
    // Lucide draws the ring as a <circle>; our renderer speaks paths, so
    // it is the same circle as two arcs.
    "M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20",
    "M12 16v-4",
    "M12 8h.01",
  ],
  expand: ["M15 3h6v6", "m21 3-7 7", "m3 21 7-7", "M9 21H3v-6"],
  minimize: ["M4 14h6v6", "m10 14-7 7", "m21 3-7 7", "M20 10h-6V4"],
  refresh: ["M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8", "M21 3v5h-5"],
  // A way INTO settings from elsewhere (the agent pill's menu), where the
  // toolbar's sliders would read as "adjust this" rather than "go there".
  gear: [
    "M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915",
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  ],
};

/**
 * The fallback, which is the package's original icon language unchanged —
 * monochrome text characters that take the colour and weight of the Text
 * they sit in (src/icons.ts explains the variation-selector rule, and the
 * emoji guard still applies to every one of them).
 */
export const ICON_GLYPHS: Record<IconName, string> = {
  annotate: ICON_PENCIL,
  close: ICON_CLOSE,
  delete: ICON_DELETE,
  check: ICON_CHECK,
  chevron: ICON_COLLAPSE,
  queue: ICON_QUEUE,
  comment: ICON_COMMENT,
  agent: ICON_AGENT,
  send: ICON_SEND,
  settings: ICON_SETTINGS,
  plus: ICON_PLUS,
  camera: ICON_CAMERA,
  area: ICON_AREA,
  info: ICON_INFO,
  expand: ICON_EXPAND,
  minimize: ICON_MINIMIZE,
  refresh: ICON_REFRESH,
  gear: ICON_SETTINGS,
};

/** Every name the overlay can ask for — what the guard test iterates. */
export const ICON_NAMES = Object.keys(ICON_GLYPHS) as IconName[];

/**
 * A glyph is a character in a line of text; a drawing is a box. The fallback
 * therefore needs a slightly larger font size than the SVG's box to look
 * like the same weight of mark, which is a rendering detail rather than
 * anything a caller should think about.
 */
export function glyphFontSize(size: number): number {
  return Math.round(size * 0.92);
}
