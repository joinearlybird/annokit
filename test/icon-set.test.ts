/**
 * The icon set (src/icon-set.ts, src/svg.ts).
 *
 * The rule worth a test: EVERY semantic icon has BOTH a Lucide drawing and a
 * text glyph. The drawing is what you see when the optional `react-native-svg`
 * peer resolved; the glyph is what you see when it did not, which is a
 * perfectly ordinary state for a package that hard-depends on nothing. An
 * icon added to only one of the two tables would look fine in whichever
 * environment its author happened to run, and be missing in the other.
 *
 * `react-native-svg` is not resolvable in this node test process, which is
 * also the degraded case: `svgAvailable()` must say so rather than throw at
 * import time.
 */

import { describe, expect, it } from "vitest";
import {
  ICON_GLYPHS,
  ICON_NAMES,
  ICON_PATHS,
  LUCIDE_NAMES,
  LUCIDE_STROKE_WIDTH,
  LUCIDE_VIEWBOX,
  glyphFontSize,
} from "../src/icon-set";
import { OVERLAY_ICONS } from "../src/icons";
import { svgAvailable, svgParts } from "../src/svg";

describe("every icon has both drawings", () => {
  it.each(ICON_NAMES)("%s has a Lucide path, a glyph and a Lucide name", (name) => {
    expect(ICON_PATHS[name].length).toBeGreaterThan(0);
    for (const d of ICON_PATHS[name]) expect(d.trim().length).toBeGreaterThan(0);
    expect(ICON_GLYPHS[name].length).toBeGreaterThan(0);
    expect(LUCIDE_NAMES[name]).toBeTruthy();
  });

  it("has no table entry the others do not have", () => {
    const names = [...ICON_NAMES].sort();
    expect(Object.keys(ICON_PATHS).sort()).toEqual(names);
    expect(Object.keys(LUCIDE_NAMES).sort()).toEqual(names);
  });

  it("falls back to glyphs the emoji guard already covers", () => {
    // The fallbacks are the package's own icon language, not a second set:
    // whatever the guard test enforces about colour emoji applies to them.
    for (const name of ICON_NAMES) {
      expect(OVERLAY_ICONS).toContain(ICON_GLYPHS[name]);
    }
  });

  it("keeps Lucide's stroke conventions, which the paths are drawn for", () => {
    expect(LUCIDE_VIEWBOX).toBe("0 0 24 24");
    expect(LUCIDE_STROKE_WIDTH).toBe(2);
  });

  it("sizes the glyph from the box the drawing would have filled", () => {
    expect(glyphFontSize(16)).toBe(15);
    expect(glyphFontSize(20)).toBe(18);
  });
});

describe("react-native-svg integration", () => {
  it("reports unavailable when the package is not installed, without throwing", () => {
    expect(svgAvailable()).toBe(false);
    expect(svgParts()).toBeNull();
  });
});
