/**
 * The React half of the theme: reading the OS scheme, holding the session
 * choice, and building one StyleSheet per theme.
 *
 * The rules live next door in src/theme.ts, which imports nothing and is
 * unit tested. This file is the wiring: `useColorScheme` (the only way to
 * follow the OS), a context so every piece of chrome sees the same answer,
 * and `themedStyles` so components keep declaring their styles once.
 *
 * WHY A FACTORY AND NOT A HOOK PER STYLE. `StyleSheet.create` at module eval
 * time was the pattern here for a reason — it runs once, and no render
 * allocates a style object. A theme means two sheets rather than one, so
 * `themedStyles` keeps a sheet per RESOLVED THEME and builds each the first
 * time it is asked for. A component that never renders in light never pays
 * for light; one that renders a thousand times pays once.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { StyleSheet, useColorScheme } from "react-native";
import { applyAccents } from "./accent";
import { annoKitPreferences, subscribeToPreferences } from "./prefs";
import { applyTextTone } from "./text-tone";
import type { ImageStyle, TextStyle, ViewStyle } from "react-native";
import {
  DARK_PALETTE,
  effectiveThemePreference,
  paletteFor,
  resolveTheme,
  themePreferenceSource,
} from "./theme";
import type {
  AnnoKitPalette,
  ResolvedTheme,
  SystemScheme,
  ThemePreference,
  ThemeSource,
} from "./theme";

export interface AnnoKitThemeValue {
  /** What is being asked for — "system" included. */
  preference: ThemePreference;
  /** What that resolves to right now. Only two values; style against this. */
  theme: ResolvedTheme;
  palette: AnnoKitPalette;
  /** The OS scheme, as reported. Shown beside "System" in the panel. */
  system: SystemScheme;
  /** Which tier supplied the preference (panel > prop > default). */
  source: ThemeSource;
  /**
   * Identity of the palette in force — theme, the two chosen accents and
   * the text tone.
   * `themedStyles` caches a StyleSheet per value of this, so a colour
   * change rebuilds the sheets instead of being ignored.
   */
  paletteKey: string;
  /** Choose, for this session. Null hands control back to the host prop. */
  setPreference: (preference: ThemePreference | null) => void;
}

/**
 * DARK OUT OF CONTEXT, deliberately. A piece of chrome rendered outside the
 * provider (a test, a future standalone use) gets the treatment the overlay
 * has always had rather than an unstyled one — fail-soft, like everything
 * else in this package.
 */
const FALLBACK: AnnoKitThemeValue = {
  preference: "system",
  theme: "dark",
  palette: DARK_PALETTE,
  system: null,
  source: "default",
  paletteKey: "dark",
  setPreference: () => {},
};

const ThemeContext = createContext<AnnoKitThemeValue>(FALLBACK);

/** The theme in force. Every piece of overlay chrome reads this. */
export function useAnnoKitTheme(): AnnoKitThemeValue {
  return useContext(ThemeContext);
}

/**
 * Holds the session's choice and resolves it against the OS.
 *
 * `hostPreference` is the `theme` prop on <AnnoKitProvider>. The choice
 * made in the settings panel overrides it for as long as the app is
 * running, and nothing is persisted — see src/theme.ts on why a dev overlay
 * does not take a storage dependency.
 */
export function AnnoKitThemeProvider({
  hostPreference,
  children,
}: {
  hostPreference?: unknown;
  children: React.ReactNode;
}) {
  const [choice, setChoice] = useState<ThemePreference | null>(null);
  const system = useColorScheme();
  // The two marker colours and the text tone live with the rest of the
  // session preferences (src/prefs.ts) because a host can preset them too;
  // the palette is where they are actually spent.
  const prefs = useSyncExternalStore(
    subscribeToPreferences,
    annoKitPreferences,
    annoKitPreferences,
  );
  const setPreference = useCallback((next: ThemePreference | null) => {
    setChoice(next);
  }, []);
  const value = useMemo<AnnoKitThemeValue>(() => {
    const preference = effectiveThemePreference(hostPreference, choice);
    const theme = resolveTheme(preference, system);
    return {
      preference,
      theme,
      // Tone first: in light the team's type is the tone's own ink
      // (src/accent.ts), so the accents must see the toned ramp.
      palette: applyAccents(
        applyTextTone(paletteFor(theme), theme, prefs.textTone),
        theme,
        prefs.agentAccent,
        prefs.teamAccent,
      ),
      system,
      source: themePreferenceSource(hostPreference, choice),
      paletteKey: `${theme}|${prefs.agentAccent}|${prefs.teamAccent}|${prefs.textTone}`,
      setPreference,
    };
  }, [hostPreference, choice, system, prefs.agentAccent, prefs.teamAccent, prefs.textTone, setPreference]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * The same constraint `StyleSheet.create` uses. It is what keeps a
 * `position: "absolute"` in a factory from widening to `string` and failing
 * the ViewStyle check at every call site.
 */
type NamedStyles<T> = { [P in keyof T]: ViewStyle | TextStyle | ImageStyle };

/**
 * Declare a component's styles against the palette instead of literals.
 *
 *   const useStyles = themedStyles((p) => ({ title: { color: p.textStrong } }));
 *   …
 *   const styles = useStyles();
 *
 * The returned function is a hook (it reads the theme context) and is
 * called unconditionally at the top of a component, so the rules of hooks
 * hold. The sheets are cached per theme on the closure — module state, like
 * the `StyleSheet.create` it replaces.
 */
export function themedStyles<T extends NamedStyles<T> | NamedStyles<Record<string, unknown>>>(
  factory: (palette: AnnoKitPalette) => T & NamedStyles<Record<string, unknown>>,
): () => T {
  const cache = new Map<string, T>();
  return function useThemedStyles(): T {
    const { paletteKey, palette } = useAnnoKitTheme();
    const cached = cache.get(paletteKey);
    if (cached) return cached;
    const created = StyleSheet.create(factory(palette)) as T;
    cache.set(paletteKey, created);
    return created;
  };
}
