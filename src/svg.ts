/**
 * Optional react-native-svg integration, loaded lazily and never required.
 *
 * Same contract as src/screenshot.ts (react-native-view-shot) and src/shake.ts
 * (expo-sensors): the package declares it as an OPTIONAL peer, resolves it
 * once at module load inside a try/catch, and every caller asks first. With
 * it, the overlay draws Lucide icons; without it, the icons fall back to the
 * text glyphs and nothing else changes — no crash, no warning spam, no
 * feature that silently half-works.
 */

import type { ComponentType } from "react";

interface SvgProps {
  width?: number | string;
  height?: number | string;
  viewBox?: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  strokeLinecap?: "round" | "butt" | "square";
  strokeLinejoin?: "round" | "miter" | "bevel";
  children?: unknown;
}

interface PathProps {
  d: string;
  fill?: string;
  stroke?: string;
}

export interface SvgParts {
  Svg: ComponentType<SvgProps>;
  Path: ComponentType<PathProps>;
}

/**
 * JS RESOLVING IS NOT ENOUGH. react-native-svg ships native views, and a
 * dev client (or Expo Go) built before the dependency was added will happily
 * import the JS half and then render every icon as a red "unimplemented
 * component" box — which is how this was found (device testing). So the
 * probe also asks the running app whether the native view manager is
 * actually registered, and treats "no" exactly like "not installed".
 *
 * Unknowable answers count as available: on react-native-web there is no
 * view manager registry and the JS implementation is the whole thing.
 */
// The root view registers under a PLATFORM-SPECIFIC name: Android's view
// manager is "RNSVGSvgViewAndroid" (old and new architecture alike). Asking
// for the iOS name alone sent every Android app to the text glyphs.
const SVG_ROOT_VIEW_NAMES = ["RNSVGSvgView", "RNSVGSvgViewAndroid"] as const;

/** Exported for tests: is any react-native-svg root view registered? */
export function svgViewManagerRegistered(ui: {
  hasViewManagerConfig?: (name: string) => boolean;
  getViewManagerConfig?: (name: string) => unknown;
}): boolean {
  if (typeof ui.hasViewManagerConfig === "function") {
    return SVG_ROOT_VIEW_NAMES.some((name) => !!ui.hasViewManagerConfig!(name));
  }
  if (typeof ui.getViewManagerConfig === "function") {
    return SVG_ROOT_VIEW_NAMES.some((name) => !!ui.getViewManagerConfig!(name));
  }
  return true;
}

function nativeViewsPresent(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const rn = require("react-native") as {
      UIManager?: {
        hasViewManagerConfig?: (name: string) => boolean;
        getViewManagerConfig?: (name: string) => unknown;
      };
    };
    const ui = rn?.UIManager;
    if (!ui) return true;
    return svgViewManagerRegistered(ui);
  } catch {
    return true;
  }
}

let parts: SvgParts | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require("react-native-svg") as {
    default?: ComponentType<SvgProps>;
    Svg?: ComponentType<SvgProps>;
    Path?: ComponentType<PathProps>;
  };
  // The package's default export IS Svg; older/newer builds also name it.
  const Svg = mod?.Svg ?? mod?.default;
  const Path = mod?.Path;
  if (typeof Svg === "function" && typeof Path === "function" && nativeViewsPresent()) {
    parts = { Svg, Path } as SvgParts;
  }
} catch {
  parts = null;
}

/** True when Lucide icons can be drawn. */
export function svgAvailable(): boolean {
  return parts !== null;
}

/** The two components the icon renderer needs, or null. */
export function svgParts(): SvgParts | null {
  return parts;
}
