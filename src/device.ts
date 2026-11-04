/**
 * The device a capture was made on — platform, OS version, window size,
 * pixel ratio, font scale, appearance, orientation — as one small object
 * that rides on an agent task at Standard detail and up.
 *
 * WHY. "The button is cut off" means something different on a 320-point
 * phone at font scale 1.3 than on a tablet at 1.0, and a dark-mode colour
 * complaint is unanswerable without knowing the scheme. A screenshot does
 * not say any of this either: it is pixels, and the agent has to know the
 * window's point size to read coordinates off it.
 *
 * WHAT IT IS NOT. Not a fingerprint: no identifiers, no locale, no network,
 * no exact model on iOS (React Native core does not expose one, and this
 * package takes no peer for it). On Android the brand and model come from
 * `Platform.constants`, the same values any app reads. Minimal detail drops
 * the whole object (src/payload.ts, `applyOutputDetail`).
 *
 * React Native is reached through a guarded require, as src/screenshot.ts
 * does for Platform: node tests and SSR hosts have no RN, and `readDevice`
 * takes its sources as a parameter so the shape is tested without one.
 */

export interface DeviceInfo {
  platform: "ios" | "android" | "web";
  /** iOS `osVersion`, Android `Release`; absent on web. */
  osVersion?: string;
  /** Android `Brand Model` (e.g. "Google Pixel 8"). Absent on iOS: RN core exposes none. */
  model?: string;
  idiom?: "phone" | "tablet" | "tv" | "desktop";
  /** `Dimensions.get("window")`, points, rounded to a tenth. */
  window: { width: number; height: number };
  pixelRatio: number;
  fontScale: number;
  colorScheme: "light" | "dark" | null;
  orientation: "portrait" | "landscape";
  /** Android emulators only: RN core gives iOS no simulator signal. Absent otherwise. */
  simulator?: boolean;
}

/** The React Native pieces `readDevice` reads; each one optional so a partial stub still works. */
export interface DeviceSources {
  Platform?: {
    OS?: string;
    Version?: string | number;
    isPad?: boolean;
    isTV?: boolean;
    constants?: Record<string, unknown>;
  };
  Dimensions?: { get?: (dim: "window" | "screen") => { width: number; height: number } | undefined };
  PixelRatio?: { get?: () => number; getFontScale?: () => number };
  Appearance?: { getColorScheme?: () => string | null | undefined };
}

function tenth(n: number): number {
  return Math.round(n * 10) / 10;
}

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : undefined;
}

/** The sources from `react-native`, or undefined when the module is not there (node, SSR). */
function reactNativeSources(): DeviceSources | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("react-native") as DeviceSources;
  } catch {
    return undefined;
  }
}

/**
 * Read the device, or undefined when React Native is not available or the
 * platform is not one this package names. Never throws: a device line is
 * context, and a capture without one is still a capture.
 */
export function readDevice(sources: DeviceSources | undefined = reactNativeSources()): DeviceInfo | undefined {
  try {
    const Platform = sources?.Platform;
    const os = Platform?.OS;
    if (os !== "ios" && os !== "android" && os !== "web") return undefined;
    const constants = (Platform?.constants ?? {}) as Record<string, unknown>;

    const win = sources?.Dimensions?.get?.("window");
    const width = finite(win?.width) ? tenth(win.width) : 0;
    const height = finite(win?.height) ? tenth(win.height) : 0;

    const ratio = sources?.PixelRatio?.get?.();
    const fontScale = sources?.PixelRatio?.getFontScale?.();
    const scheme = sources?.Appearance?.getColorScheme?.();

    const info: DeviceInfo = {
      platform: os,
      window: { width, height },
      pixelRatio: finite(ratio) && ratio > 0 ? tenth(ratio) : 1,
      fontScale: finite(fontScale) && fontScale > 0 ? Math.round(fontScale * 100) / 100 : 1,
      colorScheme: scheme === "dark" ? "dark" : scheme === "light" ? "light" : null,
      orientation: width > height ? "landscape" : "portrait",
    };

    if (os === "ios") {
      info.osVersion = str(constants.osVersion) ?? str(Platform?.Version);
      const idiom = str(constants.interfaceIdiom);
      info.idiom = idiom === "pad" || Platform?.isPad ? "tablet" : idiom === "tv" || Platform?.isTV ? "tv" : idiom === "mac" ? "desktop" : "phone";
    } else if (os === "android") {
      info.osVersion = str(constants.Release) ?? str(Platform?.Version);
      const brand = str(constants.Brand);
      const model = str(constants.Model);
      if (model) info.model = brand && !model.toLowerCase().startsWith(brand.toLowerCase()) ? `${brand} ${model}` : model;
      else if (brand) info.model = brand;
      const uiMode = str(constants.uiMode);
      info.idiom = uiMode === "tv" || Platform?.isTV ? "tv" : Math.min(width, height) >= 600 ? "tablet" : "phone";
      const fingerprint = str(constants.Fingerprint) ?? "";
      const emulator = (brand?.toLowerCase() === "google" && (model ?? "").toLowerCase().startsWith("sdk_"))
        || /generic|emulator|sdk_gphone/i.test(fingerprint);
      if (emulator) info.simulator = true;
    } else {
      info.idiom = "desktop";
    }
    return info;
  } catch {
    return undefined;
  }
}

/** `1` → "1.0", `1.15` → "1.15": at least one decimal, never a float's tail. */
function scaleText(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? rounded.toFixed(1) : String(rounded);
}

/**
 * One line a person (or an agent prompt) reads:
 * `iPhone · iOS 26.0 · 402×874 pt @3x · dark · font scale 1.0`. The stub
 * server's `deviceLine` prints the same shape from the wire object.
 */
export function describeDevice(d: DeviceInfo): string {
  const name = d.model ?? (d.platform === "ios" ? (d.idiom === "tablet" ? "iPad" : "iPhone") : d.platform === "android" ? "Android device" : "Browser");
  const osName = d.platform === "ios" ? (d.idiom === "tablet" ? "iPadOS" : "iOS") : d.platform === "android" ? "Android" : null;
  const parts = [name];
  if (osName && d.osVersion) parts.push(`${osName} ${d.osVersion}`);
  else if (osName) parts.push(osName);
  parts.push(`${d.window.width}×${d.window.height} pt @${d.pixelRatio}x`);
  if (d.orientation === "landscape") parts.push("landscape");
  if (d.colorScheme) parts.push(d.colorScheme);
  parts.push(`font scale ${scaleText(d.fontScale)}`);
  if (d.simulator) parts.push("simulator");
  return parts.join(" · ");
}
