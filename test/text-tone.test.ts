/**
 * The text tones (src/text-tone.ts): every step of every ramp is readable
 * on both surfaces of its theme, neutral is exactly the palettes' own
 * ramp, and applying a tone touches the text and nothing else.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEXT_TONE,
  TEXT_TONES,
  TEXT_TONE_SPECS,
  applyTextTone,
  isTextTone,
  textToneSwatch,
} from "../src/text-tone";
import { DARK_PALETTE, LIGHT_PALETTE, paletteFor } from "../src/theme";
import type { ResolvedTheme } from "../src/theme";

/** WCAG relative luminance of an opaque #rrggbb. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const THEMES: ResolvedTheme[] = ["light", "dark"];

describe("every tone is readable", () => {
  for (const tone of TEXT_TONES) {
    for (const theme of THEMES) {
      it(`${tone} in ${theme} clears 4.5:1 on the sheet and raised surfaces, at every step`, () => {
        const p = paletteFor(theme);
        for (const [step, ink] of Object.entries(TEXT_TONE_SPECS[tone][theme])) {
          for (const surface of [p.sheet, p.raised]) {
            expect(contrast(ink, surface), `${step} ${ink} on ${surface}`).toBeGreaterThanOrEqual(4.5);
          }
        }
      });
    }
  }
});

describe("the set", () => {
  it("defaults to neutral, which is the palettes' own ramp", () => {
    expect(DEFAULT_TEXT_TONE).toBe("neutral");
    expect(applyTextTone(LIGHT_PALETTE, "light", "neutral")).toEqual(LIGHT_PALETTE);
    expect(applyTextTone(DARK_PALETTE, "dark", "neutral")).toEqual(DARK_PALETTE);
  });

  it("changes the text and nothing else", () => {
    const toned = applyTextTone(LIGHT_PALETTE, "light", "warm");
    const changed = Object.keys(toned).filter(
      (k) => toned[k as keyof typeof toned] !== LIGHT_PALETTE[k as keyof typeof LIGHT_PALETTE],
    );
    expect(changed.sort()).toEqual(["textBody", "textFaint", "textMuted", "textSecondary", "textStrong"]);
  });

  it("knows its own keys and nothing else", () => {
    for (const tone of TEXT_TONES) expect(isTextTone(tone)).toBe(true);
    expect(isTextTone("purple")).toBe(false);
    expect(isTextTone(null)).toBe(false);
    expect(isTextTone("toString")).toBe(false);
  });
});

describe("the swatches", () => {
  it("are drawn in each tone's muted step, which differs between tones", () => {
    for (const theme of THEMES) {
      const fills = TEXT_TONES.map((tone) => textToneSwatch(tone, theme));
      expect(fills).toEqual(TEXT_TONES.map((tone) => TEXT_TONE_SPECS[tone][theme].textMuted));
      expect(new Set(fills).size).toBe(TEXT_TONES.length);
    }
  });

  it("keeps the published keys, renamed for the eye", () => {
    expect(TEXT_TONE_SPECS.cool.label).toBe("Slate");
    expect(TEXT_TONE_SPECS.warm.label).toBe("Stone");
    expect(TEXT_TONES).toEqual(["neutral", "cool", "warm", "navy", "forest", "plum", "contrast"]);
  });
});
