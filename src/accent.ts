/**
 * THE TWO MARKER COLOURS, as a choice rather than a constant.
 *
 * The overlay draws two kinds of mark and the colour is what tells them
 * apart at a glance: AGENT TASKS in one hue, TEAM NOTES in another
 * (src/destination.ts, src/marker-hit.ts). Which two hues those are is not
 * load-bearing — the DISTINCTION is — so the settings panel offers a small
 * curated set for each kind and this module turns a pair of choices into the
 * dozen palette tokens the components actually draw with.
 *
 * A CURATED SET, NOT A COLOUR WHEEL. Every option here has been given a
 * value for BOTH themes: a hue bright enough to read on near-black is not
 * the same hue that reads on white, and a free colour picker would hand out
 * values that vanish on one of the two (which is the whole reason the theme
 * work exists). Seven options, one row per kind.
 *
 * ONE RULE, AND ONLY ONE. The two kinds may not be the SAME colour — that
 * collapses the visual language entirely — so the taken option is disabled
 * in the other row. Two adjacent blues are the user's business; identical
 * ones are not a preference, they are the feature switched off.
 *
 * Pure: the tints and rims are DERIVED from each hue's four tones rather
 * than hand-authored, so adding an option is four hex values and not
 * fourteen, and the derivation is unit tested.
 */

import type { AnnoKitPalette, ResolvedTheme } from "./theme";

/** The options offered, in the order the swatch row draws them. */
export type AccentKey = "violet" | "blue" | "teal" | "green" | "amber" | "orange" | "rose";

export const ACCENT_KEYS: readonly AccentKey[] = [
  "violet",
  "blue",
  "teal",
  "green",
  "amber",
  "orange",
  "rose",
];

/** Which mark a swatch row is for. The panel labels them in these words. */
export type AccentRole = "agent" | "team";

/** The default pair: blue for the agent's work, orange for the team's talk. */
export const DEFAULT_ACCENTS: Record<AccentRole, AccentKey> = {
  agent: "blue",
  team: "orange",
};

/**
 * One hue, at the four strengths every accent needs.
 *
 * `fill` is the saturated one that carries white ink (marker dots, the
 * armed FAB, the send button). `text` is the same hue as TYPE on a sheet,
 * which is the value that has to move most between themes. `soft` is type
 * on a tint of itself, and `edge` is the rim drawn around a fill so a
 * marker reads against arbitrary app content.
 */
export interface AccentTones {
  fill: string;
  text: string;
  soft: string;
  edge: string;
}

export interface AccentSpec {
  key: AccentKey;
  /** What the swatch's accessibility label calls it. */
  label: string;
  dark: AccentTones;
  light: AccentTones;
}

/**
 * The set. Tailwind scale values throughout — dark takes the 500/400/300/100
 * steps, light takes 600/700/800 and a white rim, which is the same
 * inversion the neutral ramp makes (src/theme.ts).
 */
export const ACCENTS: Record<AccentKey, AccentSpec> = {
  violet: {
    key: "violet",
    label: "Violet",
    dark: { fill: "#7c3aed", text: "#a78bfa", soft: "#c4b5fd", edge: "#ede9fe" },
    light: { fill: "#7c3aed", text: "#6d28d9", soft: "#5b21b6", edge: "#ffffff" },
  },
  blue: {
    key: "blue",
    label: "Blue",
    dark: { fill: "#3c82f7", text: "#66b8ff", soft: "#93c5fd", edge: "#dbeafe" },
    light: { fill: "#2563eb", text: "#1d4ed8", soft: "#1e40af", edge: "#ffffff" },
  },
  teal: {
    key: "teal",
    label: "Teal",
    dark: { fill: "#14b8a6", text: "#2dd4bf", soft: "#5eead4", edge: "#ccfbf1" },
    light: { fill: "#0d9488", text: "#0f766e", soft: "#115e59", edge: "#ffffff" },
  },
  green: {
    key: "green",
    label: "Green",
    dark: { fill: "#22c55e", text: "#4ade80", soft: "#86efac", edge: "#dcfce7" },
    light: { fill: "#16a34a", text: "#15803d", soft: "#166534", edge: "#ffffff" },
  },
  amber: {
    key: "amber",
    label: "Amber",
    dark: { fill: "#f59e0b", text: "#fbbf24", soft: "#fcd34d", edge: "#fef3c7" },
    light: { fill: "#d97706", text: "#b45309", soft: "#92400e", edge: "#ffffff" },
  },
  orange: {
    key: "orange",
    label: "Orange",
    dark: { fill: "#f97316", text: "#fb923c", soft: "#fdba74", edge: "#ffedd5" },
    light: { fill: "#ea580c", text: "#c2410c", soft: "#9a3412", edge: "#ffffff" },
  },
  rose: {
    key: "rose",
    label: "Rose",
    dark: { fill: "#f43f5e", text: "#fb7185", soft: "#fda4af", edge: "#ffe4e6" },
    light: { fill: "#e11d48", text: "#be123c", soft: "#9f1239", edge: "#ffffff" },
  },
};

/** Anything that is not one of the seven — a stale prop, a typo, a null. */
export function isAccentKey(value: unknown): value is AccentKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ACCENTS, value);
}

/**
 * The rule the panel enforces: a swatch already taken by the OTHER kind is
 * disabled, because two identical marks are the visual language switched
 * off. Nothing else is policed — two adjacent blues are a preference.
 */
export function accentSelectable(option: AccentKey, otherRoleAccent: AccentKey): boolean {
  return option !== otherRoleAccent;
}

/** `#rrggbb` → `r,g,b`, for building the tints. Null on anything else. */
export function rgbTriplet(hex: string): string | null {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) return null;
  const int = parseInt(match[1]!, 16);
  return `${(int >> 16) & 255},${(int >> 8) & 255},${int & 255}`;
}

/** A hue at an alpha — the tints and rims are all of this shape. */
export function withAlpha(hex: string, alpha: number): string {
  const rgb = rgbTriplet(hex);
  // An unparseable hue falls back to the opaque colour rather than to
  // nothing: a solid tint is wrong, an invisible one is broken.
  return rgb ? `rgba(${rgb},${alpha})` : hex;
}

/**
 * The alphas, per theme. The same 28% that reads as a whisper on near-black
 * reads as a bruise on white, so light gets roughly half of everything.
 */
const TINTS = {
  dark: { soft: 0.16, mid: 0.22, strong: 0.28, teamSoft: 0.16, teamStrong: 0.32, rule: 0.5 },
  light: { soft: 0.1, mid: 0.14, strong: 0.18, teamSoft: 0.12, teamStrong: 0.2, rule: 0.45 },
} as const;

/** The agent half of the palette, derived from one hue. */
export function agentTokens(
  key: AccentKey,
  theme: ResolvedTheme,
): Pick<
  AnnoKitPalette,
  | "agent"
  | "agentText"
  | "agentSoft"
  | "agentEdge"
  | "agentTintInk"
  | "agentTintSoft"
  | "agentTintMid"
  | "agentTintStrong"
  | "agentBorderSoft"
  | "agentBorderMid"
  | "agentBorderStrong"
> {
  const tone = ACCENTS[key][theme];
  const a = TINTS[theme];
  return {
    agent: tone.fill,
    agentText: tone.text,
    agentSoft: tone.soft,
    agentEdge: tone.edge,
    // Ink on a strong tint of the hue: the pale end in dark, the deep end
    // in light — in both cases the one that is NOT the tint's own strength.
    agentTintInk: theme === "dark" ? tone.edge : tone.soft,
    agentTintSoft: withAlpha(tone.fill, a.soft),
    agentTintMid: withAlpha(tone.fill, a.mid),
    agentTintStrong: withAlpha(tone.fill, a.strong),
    agentBorderSoft: withAlpha(theme === "dark" ? tone.soft : tone.fill, 0.6),
    agentBorderMid: withAlpha(theme === "dark" ? tone.text : tone.fill, 0.45),
    agentBorderStrong: withAlpha(theme === "dark" ? tone.text : tone.fill, 0.55),
  };
}

/** The team half, from the other hue. */
export function teamTokens(
  key: AccentKey,
  theme: ResolvedTheme,
): Pick<AnnoKitPalette, "team" | "teamText" | "teamEdge" | "teamTintSoft" | "teamTintStrong" | "teamRule"> {
  const tone = ACCENTS[key][theme];
  const a = TINTS[theme];
  return {
    team: tone.fill,
    teamText: tone.text,
    teamEdge: tone.edge,
    teamTintSoft: withAlpha(tone.fill, a.teamSoft),
    teamTintStrong: withAlpha(tone.fill, a.teamStrong),
    teamRule: withAlpha(tone.fill, a.rule),
  };
}

/**
 * The palette with both accents applied.
 *
 * Everything else — surfaces, text, lines, danger — is untouched: the
 * choice is which two hues carry the two MEANINGS, not a reskin.
 *
 * THE TEAM'S TYPE IS INK, in both themes. Orange-700 and its neighbours
 * read as brown on white (product owner: "amber"), and the team's colour
 * already says "team note" everywhere it is a shape — the marker, the
 * Comment button's outline, the icons — so the words beside it lose
 * nothing by being the ordinary text colour. `teamText` is the palette's
 * own strongest ink, black in light and near-white in dark, which also
 * means it follows the text tone (src/text-tone.ts) applied before it.
 */
export function applyAccents(
  palette: AnnoKitPalette,
  theme: ResolvedTheme,
  agent: AccentKey,
  team: AccentKey,
): AnnoKitPalette {
  const applied = { ...palette, ...agentTokens(agent, theme), ...teamTokens(team, theme) };
  return { ...applied, teamText: palette.textStrong };
}
