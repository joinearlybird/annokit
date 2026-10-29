/**
 * The marker-colour options (src/accent.ts): that every hue is defined for
 * both themes, that the derived tints actually derive, and that the one
 * rule — the two kinds may not be the same colour — is enforced.
 */

import { describe, expect, it } from "vitest";
import {
  ACCENTS,
  ACCENT_KEYS,
  DEFAULT_ACCENTS,
  accentSelectable,
  agentTokens,
  applyAccents,
  isAccentKey,
  rgbTriplet,
  teamTokens,
  withAlpha,
} from "../src/accent";
import { DARK_PALETTE, LIGHT_PALETTE } from "../src/theme";
import type { ResolvedTheme } from "../src/theme";

const THEMES: ResolvedTheme[] = ["dark", "light"];

describe("the curated set", () => {
  it("offers seven hues, each defined for both themes", () => {
    expect(ACCENT_KEYS).toHaveLength(7);
    for (const key of ACCENT_KEYS) {
      const spec = ACCENTS[key];
      expect(spec.key).toBe(key);
      expect(spec.label.length).toBeGreaterThan(0);
      for (const theme of THEMES) {
        for (const tone of ["fill", "text", "soft", "edge"] as const) {
          expect(spec[theme][tone], `${key}.${theme}.${tone}`).toMatch(/^#[0-9a-f]{6}$/i);
        }
      }
    }
  });

  it("gives every hue a DIFFERENT type tone per theme", () => {
    // The point of a curated set: a hue bright enough on near-black is not
    // the hue that reads on white, so nothing may reuse one value for both.
    for (const key of ACCENT_KEYS) {
      expect(ACCENTS[key].dark.text, key).not.toBe(ACCENTS[key].light.text);
    }
  });

  it("recognises its own keys and nothing else", () => {
    expect(isAccentKey("blue")).toBe(true);
    for (const junk of ["Blue", "", "cyan", null, 3, undefined, {}]) {
      expect(isAccentKey(junk)).toBe(false);
    }
  });

  it("defaults to blue for the agent and orange for the team", () => {
    expect(DEFAULT_ACCENTS).toEqual({ agent: "blue", team: "orange" });
    expect(DEFAULT_ACCENTS.agent).not.toBe(DEFAULT_ACCENTS.team);
  });
});

describe("the only rule", () => {
  it("refuses the colour the other kind is already using", () => {
    // Two identical marks is not a preference — it is the visual language
    // switched off.
    expect(accentSelectable("teal", "orange")).toBe(true);
    expect(accentSelectable("orange", "orange")).toBe(false);
  });

  it("polices nothing else — two near neighbours are the user's call", () => {
    expect(accentSelectable("violet", "blue")).toBe(true);
    expect(accentSelectable("amber", "orange")).toBe(true);
  });
});

describe("deriving the tokens", () => {
  it("turns a hex into an rgb triplet, and refuses anything else", () => {
    expect(rgbTriplet("#3c82f7")).toBe("60,130,247");
    expect(rgbTriplet("#FFFFFF")).toBe("255,255,255");
    expect(rgbTriplet("rgba(0,0,0,1)")).toBeNull();
    expect(rgbTriplet("#fff")).toBeNull();
  });

  it("builds a tint at an alpha", () => {
    expect(withAlpha("#3c82f7", 0.16)).toBe("rgba(60,130,247,0.16)");
  });

  it("falls back to the opaque colour rather than to nothing", () => {
    // A solid tint is wrong; an invisible one is broken.
    expect(withAlpha("nonsense", 0.2)).toBe("nonsense");
  });

  it("fills every agent and team token, for both themes", () => {
    for (const theme of THEMES) {
      for (const key of ACCENT_KEYS) {
        for (const value of Object.values(agentTokens(key, theme))) {
          expect(typeof value).toBe("string");
          expect(value.length).toBeGreaterThan(0);
        }
        for (const value of Object.values(teamTokens(key, theme))) {
          expect(value.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("reproduces the shipped palette from its own defaults", () => {
    // The base palettes ARE blue-and-orange, so applying the defaults must
    // be a no-op in everything that matters — otherwise the derivation and
    // the literals have quietly drifted apart.
    for (const [theme, base] of [
      ["dark", DARK_PALETTE],
      ["light", LIGHT_PALETTE],
    ] as const) {
      const applied = applyAccents(base, theme, "blue", "orange");
      expect(applied.agent).toBe(base.agent);
      expect(applied.agentText).toBe(base.agentText);
      expect(applied.team).toBe(base.team);
      expect(applied.teamText).toBe(base.teamText);
    }
  });
});

describe("the team's type", () => {
  it("is the palette's strongest ink in light, whatever the team's hue", () => {
    for (const team of ["orange", "amber", "rose"] as const) {
      expect(applyAccents(LIGHT_PALETTE, "light", "blue", team).teamText).toBe(LIGHT_PALETTE.textStrong);
    }
  });

  it("follows a text tone applied before it", () => {
    const toned = { ...LIGHT_PALETTE, textStrong: "#000000" };
    expect(applyAccents(toned, "light", "blue", "orange").teamText).toBe("#000000");
  });

  it("is the strongest ink in dark too", () => {
    expect(applyAccents(DARK_PALETTE, "dark", "blue", "orange").teamText).toBe(DARK_PALETTE.textStrong);
  });
});

describe("applying a pair", () => {
  it("changes both halves and leaves the surfaces alone", () => {
    const applied = applyAccents(DARK_PALETTE, "dark", "teal", "rose");
    expect(applied.agent).toBe(ACCENTS.teal.dark.fill);
    expect(applied.team).toBe(ACCENTS.rose.dark.fill);
    // A colour choice is not a reskin.
    expect(applied.sheet).toBe(DARK_PALETTE.sheet);
    expect(applied.textStrong).toBe(DARK_PALETTE.textStrong);
    expect(applied.danger).toBe(DARK_PALETTE.danger);
  });

  it("keeps the two marks apart in every allowed combination", () => {
    for (const theme of THEMES) {
      for (const agent of ACCENT_KEYS) {
        for (const team of ACCENT_KEYS) {
          if (!accentSelectable(team, agent)) continue;
          const p = applyAccents(theme === "dark" ? DARK_PALETTE : LIGHT_PALETTE, theme, agent, team);
          expect(p.agent, `${agent}/${team} @${theme}`).not.toBe(p.team);
        }
      }
    }
  });
});
