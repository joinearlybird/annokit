/**
 * PASTING AN IMAGE INTO THE COMPOSER — through `expo-paste-input`, an
 * optional peer.
 *
 * React Native's TextInput takes text and nothing else, so a pasted image
 * went nowhere. `expo-paste-input` wraps the input natively: text pastes as
 * it always did, and an image (or a GIF) comes out as a local file the
 * composer can upload. On the simulator that is the Mac's clipboard — copy
 * a mockup on the Mac, paste it into the task.
 *
 * OPTIONAL, LIKE THE OTHER NATIVE PEERS (svg, view-shot, sensors): it needs
 * `expo` and a native rebuild, and this package also runs in bare React
 * Native apps that have neither. Without it the composer is text-only, as
 * before. Both example apps install it.
 *
 * THE NATIVE SIDE IS CHECKED, not just the JavaScript. Its view is looked
 * up lazily, so an app that installed the package but never rebuilt would
 * crash the moment the composer drew it; `globalThis.expo.modules` says
 * whether the native module is actually in this build.
 */
import type { ComponentType, ReactNode } from "react";

/** What a paste was, as expo-paste-input reports it. */
export type PastePayload =
  | { type: "text"; value: string }
  | { type: "images"; uris: string[] }
  | { type: "unsupported" };

type PasteWrapperProps = {
  onPaste?: (payload: PastePayload) => void;
  children?: ReactNode;
  style?: unknown;
};

/** At most this many pasted images ride on one task (the reference cap is 20). */
export const PASTED_MAX = 6;

function nativePresent(): boolean {
  try {
    const modules = (globalThis as { expo?: { modules?: Record<string, unknown> } }).expo?.modules;
    if (modules && modules.ExpoPasteInput) return true;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const core = require("expo-modules-core") as { requireOptionalNativeModule?: (name: string) => unknown };
    return !!core.requireOptionalNativeModule?.("ExpoPasteInput");
  } catch {
    return false;
  }
}

/**
 * THE REQUIRE SITS DIRECTLY IN THE TRY BLOCK, and must stay there. Metro
 * resolves requires when it bundles, and lets one be missing only when the
 * nearest block around it IS a try block — one level deeper (inside an
 * `if`) and an app without the package failed to bundle at all. Loading
 * the JavaScript is harmless without the native side: its view is looked
 * up lazily, and nothing draws it unless nativePresent() says it is built.
 */
type PasteModule = {
  TextInputWrapper?: ComponentType<PasteWrapperProps>;
  TextInputWrapperView?: ComponentType<PasteWrapperProps>;
};
let mod: PasteModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  mod = require("expo-paste-input") as PasteModule;
} catch {
  mod = null;
}
const wrapper: ComponentType<PasteWrapperProps> | null =
  mod && nativePresent() ? mod.TextInputWrapper ?? mod.TextInputWrapperView ?? null : null;

/** The wrapper to put around the composer's input, or null: text only. */
export function pasteWrapper(): ComponentType<PasteWrapperProps> | null {
  return wrapper;
}

export function pasteAvailable(): boolean {
  return wrapper !== null;
}

/** One image waiting in the composer to be uploaded when it is sent. */
export interface PastedImage {
  uri: string;
  /** The file name it is uploaded under; the server makes it safe and unique. */
  name: string;
  type: string;
}

const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

/**
 * The images in a paste, named for upload — "pasted-20261028-1412.png",
 * numbered past the first. Only local files: a paste never hands over a
 * remote URL, and one that did would not be a file to upload.
 */
export function pastedImages(payload: PastePayload, now: Date = new Date(), already = 0): PastedImage[] {
  if (payload.type !== "images" || !Array.isArray(payload.uris)) return [];
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return payload.uris
    .filter((uri) => typeof uri === "string" && /^(file|content|ph|assets-library):/i.test(uri))
    .slice(0, Math.max(0, PASTED_MAX - already))
    .map((uri, i) => {
      const ext = (/\.([a-z0-9]+)(?:\?|$)/i.exec(uri)?.[1] ?? "png").toLowerCase();
      const known = TYPES[ext] ? ext : "png";
      const n = already + i;
      return { uri, name: `pasted-${stamp}${n ? `-${n + 1}` : ""}.${known === "jpeg" ? "jpg" : known}`, type: TYPES[known]! };
    });
}
