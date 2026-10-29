/**
 * The overlay's icon language (src/icons.ts).
 *
 * The rule this file exists to hold: NO COLOUR EMOJI anywhere the overlay
 * draws. A colour emoji ignores the `color` and `fontWeight` of the Text it
 * sits in, so one of them next to the monochrome glyphs reads as a sticker
 * stuck on the chrome (product owner, device testing — the annotate action
 * used to carry a speech-balloon emoji and now shows the same pencil as
 * the collapsed button).
 *
 * The second test is the one that keeps it true: it scans the package
 * source for emoji-presentation characters rather than trusting anyone to
 * remember. A character that HAS an emoji presentation is allowed only when
 * it is followed by U+FE0E, the text variation selector.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ICON_CHECK,
  ICON_CLOSE,
  ICON_COMMENT,
  ICON_COLLAPSE,
  ICON_PENCIL,
  ICON_QUEUE,
  ICON_DELETE,
  OVERLAY_ICONS,
} from "../src/icons";

const SRC = join(__dirname, "..", "src");
const TEXT_VARIATION = "︎";

/**
 * Every pictograph in a string, with the character that follows it.
 *
 * `Extended_Pictographic` is the Unicode property for "this is a picture,
 * not a letter" — it covers both the astral emoji and the older BMP
 * pictographs (U+270F PENCIL and friends) that Apple renders in colour
 * unless asked not to. Plain text symbols (the multiplication sign, the
 * check mark, the chevron) are not pictographs and never match.
 */
function pictographs(text: string): { char: string; next: string }[] {
  const out: { char: string; next: string }[] = [];
  for (const match of text.matchAll(/\p{Extended_Pictographic}/gu)) {
    const index = match.index ?? 0;
    out.push({ char: match[0], next: text.slice(index + match[0].length, index + match[0].length + 1) });
  }
  return out;
}

describe("icon set", () => {
  it("is the glyphs the overlay draws", () => {
    expect(OVERLAY_ICONS).toContain(ICON_PENCIL);
    expect(OVERLAY_ICONS).toContain(ICON_CLOSE);
    expect(OVERLAY_ICONS).toContain(ICON_QUEUE);
    expect(OVERLAY_ICONS).toContain(ICON_COLLAPSE);
    expect(OVERLAY_ICONS).toContain(ICON_CHECK);
    expect(OVERLAY_ICONS).toContain(ICON_COMMENT);
    expect(OVERLAY_ICONS).toContain(ICON_DELETE);
  });

  it("keeps delete out of pictograph territory entirely", () => {
    // The wastebasket (U+1F5D1) was tried and iOS drew it in colour even
    // WITH the text variation selector — so the destructive red never
    // reached it. The erase glyph is a plain symbol and takes the colour.
    expect(ICON_DELETE).toBe("⌦");
    expect(/\p{Extended_Pictographic}/u.test(ICON_DELETE)).toBe(false);
  });

  it("gives comments a mark of their own, unmistakable next to the pencil", () => {
    // The toolbar shows both at once; sharing a glyph would make the two
    // kinds of capture indistinguishable at the moment of choosing.
    expect(ICON_COMMENT).not.toBe(ICON_PENCIL);
    // And it is a text ornament, not one of Unicode's emoji-only balloons.
    expect(/\p{Extended_Pictographic}/u.test(ICON_COMMENT)).toBe(false);
  });

  it("asks for the TEXT presentation of the pencil", () => {
    // U+270F alone renders as a colour emoji pencil on iOS; with U+FE0E it
    // is a monochrome glyph that takes the Text's colour and weight — the
    // same mark on the collapsed button, the toolbar and the confirm bar.
    expect(ICON_PENCIL).toBe("✏︎");
  });

  it("uses no colour-emoji glyph", () => {
    for (const icon of OVERLAY_ICONS) {
      for (const found of pictographs(icon)) {
        expect(found.next).toBe(TEXT_VARIATION);
      }
    }
  });
});

describe("no stray emoji in the package", () => {
  it("keeps every drawn glyph monochrome", () => {
    const offenders: string[] = [];
    for (const file of readdirSync(SRC)) {
      if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue;
      const source = readFileSync(join(SRC, file), "utf8");
      for (const found of pictographs(source)) {
        if (found.next === TEXT_VARIATION) continue;
        offenders.push(`${file}: ${found.char} (U+${found.char.codePointAt(0)?.toString(16)})`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
