/**
 * THE OVERLAY'S ONE PALETTE, and the rules that pick which half of it is in
 * force.
 *
 * WHY THIS EXISTS AT ALL. The web overlay never had to answer this: its
 * parent builder page pushes an appearance in over postMessage
 * (`theme.set`), so the iframe simply wears what the page wearing it wears.
 * A React Native app has no parent frame — nothing is going to tell this
 * overlay what the surrounding product looks like — so it has to decide for
 * itself. Before this module it did not decide: every colour was a dark
 * literal inlined at the point of use, so on a light app the chrome was a
 * slab of near-black over a white screen and the only "adaptation" was that
 * dark surfaces happen to read on most backgrounds.
 *
 * PURE ON PURPOSE. No react-native import: the resolution rules (what
 * "system" follows, which of the host prop and the in-panel choice wins) are
 * the parts that are easy to get subtly wrong, so they are unit tested
 * rather than eyeballed on a simulator. The React side — reading the OS
 * scheme, holding the session choice, building StyleSheets — is
 * src/theme-context.tsx.
 *
 * SESSION MEMORY ONLY. The chosen preference lives in React state for as
 * long as the app is running. No async-storage dependency for a dev overlay
 * (the same posture as the prompted display name, src/viewer.ts): a reload
 * returns to whatever the host asked for, or to the system scheme.
 */

/** What a human can ask for. "system" is a rule, the other two are answers. */
export type ThemePreference = "system" | "light" | "dark";

/** What the components actually get. There is no third state to style. */
export type ResolvedTheme = "light" | "dark";

/**
 * The OS colour scheme, as react-native's `useColorScheme` reports it.
 *
 * Three shapes across versions, all meaning the same third thing: RN 0.86
 * answers the literal `"unspecified"`, older ones `null`, and there is a
 * frame on some Android builds where it is `undefined`. Only "light" and
 * "dark" are an answer; everything else is "the OS did not say".
 */
export type SystemScheme = "light" | "dark" | "unspecified" | null | undefined;

/** Where the preference in force came from — shown in the settings panel. */
export type ThemeSource = "panel" | "prop" | "default";

export const THEME_PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark"];

/** The label a preference wears in the settings panel. */
export function themePreferenceLabel(preference: ThemePreference): string {
  return preference === "system" ? "System" : preference === "light" ? "Light" : "Dark";
}

/**
 * Is this a preference at all? Anything else — a typo in a host prop, a
 * value from an older release — is not worth a crash in a dev overlay, and
 * the caller falls back to "system".
 */
export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

/**
 * SYSTEM FOLLOWS THE OS, and an OS that will not say follows dark.
 *
 * `useColorScheme` answers null on platforms/simulators that have no opinion
 * (and for one frame on some Android versions). Dark is the right fallback
 * for this overlay specifically: its chrome floats over someone else's app,
 * and the dark treatment is the one that was designed against arbitrary
 * content.
 */
export function resolveTheme(preference: ThemePreference, system: SystemScheme): ResolvedTheme {
  if (preference === "light") return "light";
  if (preference === "dark") return "dark";
  return system === "light" ? "light" : "dark";
}

/**
 * PRECEDENCE, the same shape as the `author` prop (src/viewer.ts): the host
 * states a default, the person holding the device overrides it.
 *
 *   1. the choice made in the settings panel, for this session;
 *   2. the `theme` prop on <AnnoKitProvider>, the host app's default;
 *   3. "system".
 *
 * The panel choice wins deliberately — the prop is the host saying what it
 * *believes* suits its app, and the user is looking at the actual screen.
 * Because it is session memory, a reload hands control back to the host.
 */
export function effectiveThemePreference(
  hostPreference: unknown,
  panelChoice: ThemePreference | null | undefined,
): ThemePreference {
  if (isThemePreference(panelChoice)) return panelChoice;
  if (isThemePreference(hostPreference)) return hostPreference;
  return "system";
}

/** Which of the three tiers above supplied the preference in force. */
export function themePreferenceSource(
  hostPreference: unknown,
  panelChoice: ThemePreference | null | undefined,
): ThemeSource {
  if (isThemePreference(panelChoice)) return "panel";
  if (isThemePreference(hostPreference)) return "prop";
  return "default";
}

/**
 * One a11y label per theme option, carrying the SELECTED STATE in words.
 *
 * `accessibilityState={{selected}}` is the structured answer and is set too,
 * but VoiceOver's announcement of a selected state inside a custom row is
 * inconsistent enough that the label says it as well. It also says what
 * "System" resolves to right now, which is the only way to know from audio
 * that the screen is dark because the phone is.
 */
export function themeOptionAccessibilityLabel(
  preference: ThemePreference,
  selected: boolean,
  system: SystemScheme,
): string {
  const name = themePreferenceLabel(preference);
  const detail =
    preference === "system"
      ? ` (currently ${resolveTheme("system", system)})`
      : "";
  return `${name} theme${detail}${selected ? ", selected" : ""}`;
}

/**
 * EVERY COLOUR THE OVERLAY DRAWS, by role.
 *
 * The names say what a value is FOR, never what it looks like: `textFaint`
 * is lighter than its surface in dark and darker in light, and a component
 * that asked for "grey 400" could not have been flipped at all.
 *
 * WHERE THE VALUES COME FROM. The look is the one the product owner
 * picked: near-black surfaces (#1a1a1a/#1c1c1c), a neutral grey ramp, an
 * ORANGE and a BLUE accent, red for destructive. Those are stock Tailwind
 * scale values (orange-500, blue-500, red-500, neutral-*), so every
 * intermediate step this overlay needs is taken from the same scales rather
 * than eyeballed between them.
 *
 * THE TWO ACCENTS ARE NOT DECORATION. Blue says "the agent will act on
 * this" and orange says "people are talking about this" (src/destination.ts,
 * src/marker-hit.ts) — a marker, a chip, a bubble and a segment all pick
 * their colour from that one distinction, and they are also different
 * SHAPES so the difference survives a colour-blind reader and a screenshot.
 * Both are retuned per theme: a colour bright enough to read on near-black
 * is not the same colour that reads on white.
 */
export interface AnnoKitPalette {
  // ── Surfaces ───────────────────────────────────────────────────────────
  /** Bottom sheets and panels — the overlay's main surface. */
  sheet: string;
  /** Inputs and other surfaces raised off the sheet. */
  raised: string;
  /** Cards inside a sheet (a task card in a thread). */
  card: string;
  /** Pill-shaped chips (attachment references). */
  chip: string;
  /** The wash under a pressed row. */
  pressed: string;
  /** Behind a modal sheet. */
  backdrop: string;
  /**
   * Behind full-screen MEDIA, where `backdrop` is deliberately too light.
   * A sheet's backdrop keeps the app legible underneath on purpose; an
   * image being examined needs the opposite — everything else out of the
   * way, in both themes, so what you are checking is the picture.
   */
  scrim: string;
  /** Floating chrome over the app: the FAB, the toolbar, the aim label. */
  chrome: string;
  /** Ink on that floating chrome. */
  chromeInk: string;
  /** Secondary ink on it (a label under an icon, a dismiss glyph). */
  chromeInkSoft: string;
  /** Its edge — floating chrome needs a rim against arbitrary content. */
  chromeBorder: string;

  // ── Lines ──────────────────────────────────────────────────────────────
  border: string;
  borderStrong: string;
  inputBorder: string;
  hairline: string;
  /** Unchecked checkboxes, disabled control outlines. */
  control: string;
  /** The sheet's drag handle. */
  grabber: string;
  shadow: string;

  // ── Text, strongest to faintest (one neutral ramp, read in reverse) ───
  textStrong: string;
  textBody: string;
  textSecondary: string;
  textMuted: string;
  textFaint: string;

  // ── The agent's half: blue ─────────────────────────────────────────────
  /** Fills: the armed FAB, marker dots, the send button. */
  agent: string;
  /** Blue as TEXT on a sheet — a link, a "Done", a badge numeral. */
  agentText: string;
  /** Blue text on a blue tint (the softer of the two). */
  agentSoft: string;
  /** The rim around a blue fill, and ink on it. */
  agentEdge: string;
  /** Ink on a strong blue tint (the "unseen replies" pill). */
  agentTintInk: string;
  agentTintSoft: string;
  agentTintMid: string;
  agentTintStrong: string;
  agentBorderSoft: string;
  agentBorderMid: string;
  agentBorderStrong: string;

  // ── The team's half: orange ────────────────────────────────────────────
  team: string;
  /** Orange as TEXT on a sheet (a note's status word). */
  teamText: string;
  /** The rim around an orange fill. */
  teamEdge: string;
  teamTintSoft: string;
  teamTintStrong: string;
  /** The quoted-context rule down the left of a task made from a note. */
  teamRule: string;

  // ── Ink on a saturated fill, and trouble ───────────────────────────────
  /** White on blue/orange in both themes — a fill is a fill. */
  onAccent: string;
  danger: string;
  /** The connected dot: an agent is there to take the task. */
  online: string;
  dangerSoft: string;

  // ── Aim chrome (drawn over the app, not over a sheet) ──────────────────
  /** The outline around the element being aimed at. */
  aimOutline: string;
}

/**
 * DARK — near-black surfaces, the neutral ramp read from its light end.
 */
export const DARK_PALETTE: AnnoKitPalette = {
  sheet: "#1a1a1a",
  // The deeper surface, used the other way up: inputs sit slightly ABOVE
  // the sheet here, so this is neutral-800 rather than #1c1c1c.
  raised: "#262626",
  card: "rgba(255,255,255,0.045)",
  chip: "rgba(255,255,255,0.07)",
  pressed: "rgba(255,255,255,0.06)",
  backdrop: "rgba(0,0,0,0.35)",
  scrim: "rgba(0,0,0,0.82)",
  chrome: "rgba(26,26,26,0.92)",
  chromeInk: "#fafafa",
  chromeInkSoft: "#cdcdcd",
  chromeBorder: "rgba(255,255,255,0.25)",

  border: "rgba(255,255,255,0.12)",
  borderStrong: "rgba(255,255,255,0.25)",
  inputBorder: "rgba(255,255,255,0.15)",
  hairline: "rgba(255,255,255,0.10)",
  control: "#525252",
  grabber: "rgba(255,255,255,0.25)",
  shadow: "#000",

  textStrong: "#fafafa",
  textBody: "#e5e5e5",
  textSecondary: "#d4d4d4",
  textMuted: "#a3a3a3",
  // Not neutral-500 (#737373), which is 3.7:1 here and 3.2:1 on raised.
  textFaint: "#8f8f8f",

  // blue-500-ish fill, and lighter blues above it for text on near-black.
  agent: "#3c82f7",
  agentText: "#66b8ff",
  agentSoft: "#93c5fd",
  agentEdge: "#dbeafe",
  agentTintInk: "#dbeafe",
  agentTintSoft: "rgba(60,130,247,0.16)",
  agentTintMid: "rgba(60,130,247,0.22)",
  agentTintStrong: "rgba(60,130,247,0.28)",
  agentBorderSoft: "rgba(147,197,253,0.6)",
  agentBorderMid: "rgba(102,184,255,0.45)",
  agentBorderStrong: "rgba(102,184,255,0.55)",

  // orange-500 fill, orange-400/-100 above it.
  team: "#f97316",
  // Ink, like light's (src/accent.ts): the orange stays on the shapes.
  teamText: "#fafafa",
  teamEdge: "#ffedd5",
  teamTintSoft: "rgba(249,115,22,0.16)",
  teamTintStrong: "rgba(249,115,22,0.32)",
  teamRule: "rgba(249,115,22,0.5)",

  onAccent: "#fff",
  // red-500 / red-300.
  danger: "#ef4444",
  online: "#4ade80",
  dangerSoft: "#fca5a5",

  aimOutline: "rgba(255,255,255,0.9)",
};

/**
 * LIGHT — not the dark values inverted.
 *
 * The neutrals run neutral-900 → #6b6b6b on white and #f5f5f5, with
 * #dddddd/#cdcdcd for the lines. NOT the dark ramp read from the other end,
 * which is what they were: its faintest step, neutral-400, is 2.5:1 on
 * white, and every summary and version line in the settings panel was
 * unreadable. Every text step clears 4.5:1 on both surfaces
 * (test/theme.test.ts).
 *
 * THE ACCENTS TURN ROUND. On near-black the legible blue is a LIGHT one
 * (#66b8ff) and the legible orange is orange-400; on white both of those
 * are a smudge, so the agent's text tint goes the other way — blue-700,
 * DARKER than its fill rather than lighter. The team's text does not take
 * a tint at all: orange-700 read as brown, so it is ink (src/accent.ts). The FILLS
 * themselves (marker dots, the armed FAB, the send button) stay saturated in
 * both, because they carry white ink and are read as shapes; light's are one
 * step down the scale so white ink still clears 4.5:1 on them.
 *
 * Tints get less alpha on white: the same 28% blue that reads as a whisper
 * on near-black reads as a bruise on white.
 */
export const LIGHT_PALETTE: AnnoKitPalette = {
  sheet: "#ffffff",
  raised: "#f5f5f5",
  card: "rgba(0,0,0,0.03)",
  chip: "rgba(0,0,0,0.05)",
  pressed: "rgba(0,0,0,0.05)",
  backdrop: "rgba(0,0,0,0.18)",
  scrim: "rgba(0,0,0,0.74)",
  chrome: "rgba(250,250,250,0.94)",
  chromeInk: "#171717",
  chromeInkSoft: "#484848",
  chromeBorder: "rgba(0,0,0,0.16)",

  border: "#dddddd",
  borderStrong: "#cdcdcd",
  inputBorder: "#dddddd",
  hairline: "rgba(0,0,0,0.08)",
  control: "#cdcdcd",
  grabber: "rgba(0,0,0,0.2)",
  shadow: "#000",

  textStrong: "#171717",
  textBody: "#262626",
  textSecondary: "#484848",
  textMuted: "#525252",
  textFaint: "#6b6b6b",

  agent: "#2563eb",
  agentText: "#1d4ed8",
  agentSoft: "#1e40af",
  agentEdge: "#ffffff",
  agentTintInk: "#1e3a8a",
  agentTintSoft: "rgba(60,130,247,0.10)",
  agentTintMid: "rgba(60,130,247,0.14)",
  agentTintStrong: "rgba(60,130,247,0.18)",
  agentBorderSoft: "rgba(37,99,235,0.45)",
  agentBorderMid: "rgba(37,99,235,0.35)",
  agentBorderStrong: "rgba(37,99,235,0.5)",

  team: "#ea580c",
  // Ink, not orange-700, which read as brown on white (src/accent.ts).
  teamText: "#171717",
  teamEdge: "#ffffff",
  teamTintSoft: "rgba(234,88,12,0.12)",
  teamTintStrong: "rgba(234,88,12,0.2)",
  teamRule: "rgba(234,88,12,0.45)",

  onAccent: "#fff",
  // red-600 / red-500 — one step darker than dark's, for white behind it.
  danger: "#dc2626",
  online: "#16a34a",
  dangerSoft: "#ef4444",

  aimOutline: "rgba(23,23,23,0.85)",
};

/** The palette for a resolved theme. Never null — there are only two. */
export function paletteFor(theme: ResolvedTheme): AnnoKitPalette {
  return theme === "light" ? LIGHT_PALETTE : DARK_PALETTE;
}
