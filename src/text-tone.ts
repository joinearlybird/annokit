/**
 * THE TEXT COLOUR, as a choice rather than a constant.
 *
 * Every piece of type in the overlay is drawn from one five-step ramp —
 * textStrong, textBody, textSecondary, textMuted, textFaint (src/theme.ts).
 * This module offers alternative ramps for it: the neutral the overlay
 * ships with, two tinted greys (slate and stone), three deep inks (navy,
 * forest and plum), and a high-contrast one for whoever finds the faint
 * steps too faint.
 *
 * INKS, NOT HUES. A text colour is read for paragraphs, so the options are
 * the colours text is printed in — near-black (near-white in dark) with a
 * tint you notice — never the bright marker colours, which would be
 * tiring to read and, at their faint steps, unreadable.
 *
 * A CURATED SET, NOT A COLOUR PICKER, for the reason src/accent.ts gives:
 * a value that reads on near-black vanishes on white, and the other way
 * round. Every option here carries a ramp for BOTH themes, and every step
 * of every ramp clears 4.5:1 on both the sheet and raised surfaces of its
 * theme (test/text-tone.test.ts). An option that cannot is not an option.
 *
 * Only the TEXT ramp changes. Surfaces, lines and the two marker colours
 * are untouched, so a tone is a reading preference, not a reskin.
 */

import { DARK_PALETTE, LIGHT_PALETTE } from "./theme";
import type { AnnoKitPalette, ResolvedTheme } from "./theme";

/** The options offered, in the order the panel lists them. */
/**
 * `cool` and `warm` keep their keys — they are published values of the
 * `textTone` prop — and are shown as Slate and Stone.
 */
export type TextTone = "neutral" | "cool" | "warm" | "navy" | "forest" | "plum" | "contrast";

/** In the order the swatch row draws them: greys, then inks, then contrast. */
export const TEXT_TONES: readonly TextTone[] = ["neutral", "cool", "warm", "navy", "forest", "plum", "contrast"];

export const DEFAULT_TEXT_TONE: TextTone = "neutral";

/** The five palette tokens a tone sets. */
export type TextRamp = Pick<
  AnnoKitPalette,
  "textStrong" | "textBody" | "textSecondary" | "textMuted" | "textFaint"
>;

export interface TextToneSpec {
  key: TextTone;
  /** What the panel and its announcements call it. */
  label: string;
  light: TextRamp;
  dark: TextRamp;
}

function ramp(p: AnnoKitPalette): TextRamp {
  return {
    textStrong: p.textStrong,
    textBody: p.textBody,
    textSecondary: p.textSecondary,
    textMuted: p.textMuted,
    textFaint: p.textFaint,
  };
}

/**
 * The set. Neutral IS the palettes' own ramp, read from them, so the
 * default cannot drift from what src/theme.ts says. Cool and warm are
 * Tailwind's slate and stone, with the faint step pulled one notch toward
 * the ink where the scale's own 500 falls under 4.5:1 on a raised surface.
 */
export const TEXT_TONE_SPECS: Record<TextTone, TextToneSpec> = {
  neutral: {
    key: "neutral",
    label: "Neutral",
    light: ramp(LIGHT_PALETTE),
    dark: ramp(DARK_PALETTE),
  },
  cool: {
    key: "cool",
    label: "Slate",
    light: {
      textStrong: "#0f172a",
      textBody: "#1e293b",
      textSecondary: "#334155",
      textMuted: "#475569",
      textFaint: "#5b6b80",
    },
    dark: {
      textStrong: "#f8fafc",
      textBody: "#e2e8f0",
      textSecondary: "#cbd5e1",
      textMuted: "#94a3b8",
      textFaint: "#8291a6",
    },
  },
  warm: {
    key: "warm",
    label: "Stone",
    light: {
      textStrong: "#1c1917",
      textBody: "#292524",
      textSecondary: "#44403c",
      textMuted: "#57534e",
      textFaint: "#6b645f",
    },
    dark: {
      textStrong: "#fafaf9",
      textBody: "#e7e5e4",
      textSecondary: "#d6d3d1",
      textMuted: "#a8a29e",
      textFaint: "#96908b",
    },
  },
  // Deep inks: the hue is in the faint steps, where it can be seen; the
  // strong ones read as near-black (near-white) with a cast.
  navy: {
    key: "navy",
    label: "Navy",
    light: { textStrong: "#0c1d36", textBody: "#132a4c", textSecondary: "#1d3a66", textMuted: "#2b4d80", textFaint: "#3f5f8f" },
    dark: { textStrong: "#f1f6ff", textBody: "#dce7fb", textSecondary: "#c4d5f2", textMuted: "#a3bce6", textFaint: "#8fa9d6" },
  },
  forest: {
    key: "forest",
    label: "Forest",
    light: { textStrong: "#0d2318", textBody: "#143222", textSecondary: "#1d4531", textMuted: "#2a5940", textFaint: "#3c6a51" },
    dark: { textStrong: "#eef8f2", textBody: "#d6eee0", textSecondary: "#bddfcb", textMuted: "#98c9ac", textFaint: "#86b89b" },
  },
  plum: {
    key: "plum",
    label: "Plum",
    light: { textStrong: "#26102f", textBody: "#33183f", textSecondary: "#472556", textMuted: "#5a366b", textFaint: "#6b4a7b" },
    dark: { textStrong: "#f8f0fb", textBody: "#ecdcf3", textSecondary: "#dcc6e7", textMuted: "#c2a3d4", textFaint: "#b394c6" },
  },
  // The whole ramp moved toward the ink: the faintest step here is darker
  // (lighter, in dark) than neutral's secondary.
  contrast: {
    key: "contrast",
    label: "High contrast",
    light: {
      textStrong: "#000000",
      textBody: "#0a0a0a",
      textSecondary: "#171717",
      textMuted: "#262626",
      textFaint: "#404040",
    },
    dark: {
      textStrong: "#ffffff",
      textBody: "#fafafa",
      textSecondary: "#f5f5f5",
      textMuted: "#e5e5e5",
      textFaint: "#d4d4d4",
    },
  },
};

/**
 * The colour a tone's swatch is drawn in: its MUTED step. The strong steps
 * are near-black in every ink, so a swatch drawn with them would show seven
 * identical marks; the muted step is where the tint can be seen, and it
 * still clears 4.5:1, so the swatch reads as text, which is what it is.
 */
export function textToneSwatch(tone: TextTone, theme: ResolvedTheme): string {
  return TEXT_TONE_SPECS[tone][theme].textMuted;
}

/** Anything that is not one of the seven — a stale prop, a typo, a null. */
export function isTextTone(value: unknown): value is TextTone {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(TEXT_TONE_SPECS, value);
}

/** The palette with a tone's text ramp in place of its own. */
export function applyTextTone(
  palette: AnnoKitPalette,
  theme: ResolvedTheme,
  tone: TextTone,
): AnnoKitPalette {
  return { ...palette, ...TEXT_TONE_SPECS[tone][theme] };
}
