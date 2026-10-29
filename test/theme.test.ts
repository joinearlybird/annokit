/**
 * The theme rules (src/theme.ts): what "System" follows, who wins between
 * the host prop and the panel, and that both palettes actually say
 * something different for every role they claim to.
 */

import { describe, expect, it } from "vitest";
import {
  DARK_PALETTE,
  LIGHT_PALETTE,
  THEME_PREFERENCES,
  effectiveThemePreference,
  isThemePreference,
  paletteFor,
  resolveTheme,
  themeOptionAccessibilityLabel,
  themePreferenceLabel,
  themePreferenceSource,
} from "../src/theme";
import type { AnnoKitPalette, ThemePreference } from "../src/theme";

describe("resolving a preference", () => {
  it("answers itself when the user named a theme", () => {
    // The OS is irrelevant once someone has said what they want — that is
    // the whole difference between "Light" and "System".
    expect(resolveTheme("light", "dark")).toBe("light");
    expect(resolveTheme("dark", "light")).toBe("dark");
    expect(resolveTheme("light", null)).toBe("light");
  });

  it("follows the OS on System", () => {
    expect(resolveTheme("system", "light")).toBe("light");
    expect(resolveTheme("system", "dark")).toBe("dark");
  });

  it("falls back to dark when the OS will not say", () => {
    // RN 0.86 answers "unspecified", older ones null, and there is a frame
    // on some Android builds where it is undefined. All three mean the same
    // thing, and the overlay's designed-against-anything treatment is dark.
    expect(resolveTheme("system", "unspecified")).toBe("dark");
    expect(resolveTheme("system", null)).toBe("dark");
    expect(resolveTheme("system", undefined)).toBe("dark");
  });

  it("changes answer when the phone does, with no other input", () => {
    // The System-follows-the-OS promise, stated as the transition it makes:
    // one preference, two answers, because the device changed under it.
    const preference: ThemePreference = "system";
    expect(resolveTheme(preference, "light")).toBe("light");
    expect(resolveTheme(preference, "dark")).toBe("dark");
  });
});

describe("precedence: the host proposes, the user disposes", () => {
  it("uses the host prop when nothing has been chosen in the panel", () => {
    expect(effectiveThemePreference("light", null)).toBe("light");
    expect(themePreferenceSource("light", null)).toBe("prop");
  });

  it("lets the panel override the host prop", () => {
    // The prop is the host's belief about its app; the user is looking at
    // the actual screen.
    expect(effectiveThemePreference("light", "dark")).toBe("dark");
    expect(themePreferenceSource("light", "dark")).toBe("panel");
  });

  it("hands control back to the host when the panel choice is cleared", () => {
    expect(effectiveThemePreference("dark", null)).toBe("dark");
    expect(themePreferenceSource("dark", null)).toBe("prop");
  });

  it("falls back to system with neither", () => {
    expect(effectiveThemePreference(undefined, null)).toBe("system");
    expect(themePreferenceSource(undefined, null)).toBe("default");
  });

  it("ignores a host prop that is not a preference at all", () => {
    // A dev overlay does not crash the app over a typo in a prop.
    for (const junk of ["Dark", "", 1, null, {}, undefined]) {
      expect(effectiveThemePreference(junk, null)).toBe("system");
      expect(themePreferenceSource(junk, null)).toBe("default");
    }
    expect(isThemePreference("system")).toBe(true);
    expect(isThemePreference("Dark")).toBe(false);
  });
});

describe("the option list the panel renders", () => {
  it("offers exactly System, Light and Dark, in that order", () => {
    expect([...THEME_PREFERENCES]).toEqual(["system", "light", "dark"]);
    expect(THEME_PREFERENCES.map(themePreferenceLabel)).toEqual(["System", "Light", "Dark"]);
  });

  it("says the selected state in words, not only in accessibilityState", () => {
    expect(themeOptionAccessibilityLabel("light", true, "dark")).toBe("Light theme, selected");
    expect(themeOptionAccessibilityLabel("light", false, "dark")).toBe("Light theme");
  });

  it("tells a screen reader what System currently resolves to", () => {
    // Audio has no way to see that the screen is dark because the phone is.
    expect(themeOptionAccessibilityLabel("system", true, "dark")).toBe(
      "System theme (currently dark), selected",
    );
    expect(themeOptionAccessibilityLabel("system", false, "light")).toBe(
      "System theme (currently light)",
    );
  });
});

describe("the two palettes", () => {
  const roles = Object.keys(DARK_PALETTE) as (keyof AnnoKitPalette)[];

  it("hands back the right one for a resolved theme", () => {
    expect(paletteFor("dark")).toBe(DARK_PALETTE);
    expect(paletteFor("light")).toBe(LIGHT_PALETTE);
  });

  it("defines every role in both", () => {
    for (const role of roles) {
      expect(typeof LIGHT_PALETTE[role], `light is missing ${role}`).toBe("string");
      expect(LIGHT_PALETTE[role].length, `light ${role} is empty`).toBeGreaterThan(0);
    }
    expect(Object.keys(LIGHT_PALETTE).sort()).toEqual(roles.slice().sort());
  });

  it("actually differs where it must — a flipped theme is not one palette", () => {
    // Only the values that are the same colour BY DESIGN may match: white
    // ink on a saturated fill, and the shadow, are the same in both.
    const shared: (keyof AnnoKitPalette)[] = ["onAccent", "shadow"];
    for (const role of roles) {
      if (shared.includes(role)) {
        expect(LIGHT_PALETTE[role]).toBe(DARK_PALETTE[role]);
      } else {
        expect(LIGHT_PALETTE[role], `${role} was not retuned for light`).not.toBe(
          DARK_PALETTE[role],
        );
      }
    }
  });

  it("keeps the agent and the team visibly different in BOTH themes", () => {
    // The distinction is the meaning (src/destination.ts): blue = the agent
    // will act, orange = people are talking. A theme that collapsed the two
    // would have thrown away what the colour is for.
    for (const palette of [DARK_PALETTE, LIGHT_PALETTE]) {
      expect(palette.agent).not.toBe(palette.team);
      expect(palette.agentText).not.toBe(palette.teamText);
    }
  });
});

/** WCAG relative luminance of an opaque #rrggbb. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("light text is readable", () => {
  const TEXT = ["textStrong", "textBody", "textSecondary", "textMuted", "textFaint", "agentText", "teamText"] as const;

  it.each(TEXT)("%s clears 4.5:1 on the sheet and on raised surfaces", (role) => {
    // The faintest step was neutral-400, 2.5:1 on white: the settings
    // panel's summaries could not be read on a light app.
    for (const surface of [LIGHT_PALETTE.sheet, LIGHT_PALETTE.raised]) {
      expect(contrast(LIGHT_PALETTE[role], surface)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
