/**
 * react-native-view-shot integration. The package is an OPTIONAL peer: the
 * require is guarded so hosts without it — node tests, SSR, an app that
 * never installed it — degrade to "screenshots off" instead of crashing at
 * import time.
 *
 * The screen is captured ON REQUEST: when the composer's camera switch goes
 * on, or a headless host calls `captureScreenshot()`. While the shutter is
 * open the overlay hides its own chrome and draws the task's badge into the
 * frame (src/burn-in.tsx), so the shot shows the app and the mark, not our
 * sheet. On native the shot is 1x — one pixel per point — so coordinates
 * in the task read straight off the image (`captureOptionsFor`).
 *
 * What `captureScreen` hands back differs per target, which is why the
 * multipart part is built here rather than at the call site:
 *   - native — a `file://` temp-file path. RN's FormData/XHR layer streams
 *     that file off disk when given a `{uri, name, type}` part.
 *   - web    — react-native-view-shot's web implementation renders the DOM
 *     with html2canvas and returns `canvas.toDataURL()`, i.e. a `data:`
 *     URL. The browser's native FormData has no `{uri, name, type}` part:
 *     it stringifies the object to "[object Object]" and uploads ~150
 *     bytes of garbage, so the web branch must produce a real Blob/File.
 */

type CaptureScreen = (options?: Record<string, unknown>) => Promise<string>;
type ReleaseCapture = (uri: string) => void;

/** The multipart "file" part: an RN file descriptor (native) or a Blob (web). */
export type ScreenshotPart = Blob | { uri: string; name: string; type: string };

const SCREENSHOT_NAME = "screenshot.png";
const SCREENSHOT_TYPE = "image/png";

let captureScreenImpl: CaptureScreen | null = null;
let releaseCaptureImpl: ReleaseCapture | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const viewShot = require("react-native-view-shot") as {
    captureScreen?: CaptureScreen;
    releaseCapture?: ReleaseCapture;
  };
  if (typeof viewShot.captureScreen === "function") captureScreenImpl = viewShot.captureScreen;
  if (typeof viewShot.releaseCapture === "function") releaseCaptureImpl = viewShot.releaseCapture;
} catch {
  captureScreenImpl = null;
  releaseCaptureImpl = null;
}

/**
 * True on react-native-web. `react-native` exports `Platform` on web too,
 * but the module must not be a hard dependency of this file (node tests and
 * SSR hosts have no RN), so it is reached through a guarded runtime require
 * — the same shape inspector.ts uses for NativeModules.
 */
function isWeb(): boolean {
  return platformOS() === "web";
}

/**
 * HOST OPT-OUT. Screenshots are the most sensitive thing this package
 * touches — a full-screen grab holds whatever was on screen, not just the
 * element (docs/security-and-privacy.md, "What a screenshot contains") — and until now the only
 * way to stop them being taken was to uninstall the peer dependency, which
 * a host cannot do when something else in the app needs it.
 *
 * Off means the capture is never TAKEN, not merely never uploaded: the
 * switch stays out of the composer, headless consumers get a null
 * `screenshotUri`, and no temp file is created to have to clean up.
 */
let screenshotsEnabled = true;

export function setScreenshotsEnabled(on: boolean): void {
  screenshotsEnabled = on;
}

export function screenshotsAvailable(): boolean {
  return screenshotsEnabled && captureScreenImpl !== null;
}

/**
 * Capture the full screen, or null on any failure. Native yields a
 * `file://` temp-file URI; web yields a `data:` URL (asked for explicitly
 * so the capture does not fall through view-shot's `result: "tmpfile"`
 * default, which is unimplemented on web and warns on every capture).
 */
export async function captureScreenUri(target?: CaptureTarget): Promise<string | null> {
  if (!captureScreenImpl) return null;
  try {
    return await captureScreenImpl(captureOptionsFor(platformOS(), target ?? readTarget()));
  } catch (e) {
    console.warn("[annokit] screenshot capture failed:", e);
    return null;
  }
}

/** The window's point size and the device's pixel ratio: what a 1x capture needs. */
export interface CaptureTarget {
  window: { width: number; height: number };
  pixelRatio: number;
}

/**
 * The options handed to view-shot's `captureScreen`, so the image comes
 * back at ONE PIXEL PER POINT where the platform lets it. A 3x phone's raw
 * capture is nine times the pixels of the window it shows, and every
 * coordinate in the task is in points; an agent reading the box off the
 * image should not have to multiply.
 *
 * The two native platforms read `width`/`height` differently, and the
 * difference is an implementation detail worth spelling out:
 *
 *   iOS      the size is in POINTS, rendered at the DEVICE scale
 *            (`UIGraphicsImageRendererFormat.scale = 0`, RNViewShot.mm).
 *            Asking for the window's point size gives the same pixel count
 *            as asking for nothing; 1x needs width = points / pixelRatio.
 *   Android  the size is in PIXELS (`Bitmap.createScaledBitmap`), so the
 *            window's point size IS 1x.
 *   web      html2canvas captures `document.body`, which can be taller than
 *            the viewport; a resize would distort it. No size keys, and the
 *            `data-uri` result view-shot's tmpfile default cannot give there.
 *
 * Anything that is not a sane target (no window, a pixel ratio under 1,
 * NaN) sends no size keys: a capture at native scale is still a capture,
 * and the server works the real scale out from the image's own header.
 */
export function captureOptionsFor(os: string | null, target?: CaptureTarget | null): Record<string, unknown> {
  const base: Record<string, unknown> = { format: "png", quality: 0.9 };
  if (os === "web") return { ...base, result: "data-uri" };
  const w = target?.window.width;
  const h = target?.window.height;
  const ratio = target?.pixelRatio;
  const sane = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
  if (!sane(w) || !sane(h) || !sane(ratio) || ratio < 1) return base;
  if (os === "android") return { ...base, width: Math.round(w), height: Math.round(h) };
  if (os === "ios") return { ...base, width: w / ratio, height: h / ratio };
  return base;
}

/** `Platform.OS`, through the same guarded require, or null without RN. */
function platformOS(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Platform } = require("react-native") as { Platform?: { OS?: string } };
    return Platform?.OS ?? null;
  } catch {
    return null;
  }
}

/** The window and pixel ratio from RN, for callers that did not pass them; null without RN. */
function readTarget(): CaptureTarget | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const rn = require("react-native") as {
      Dimensions?: { get?: (d: "window") => { width: number; height: number } };
      PixelRatio?: { get?: () => number };
    };
    const window = rn.Dimensions?.get?.("window");
    const pixelRatio = rn.PixelRatio?.get?.();
    return window && typeof pixelRatio === "number" ? { window, pixelRatio } : null;
  } catch {
    return null;
  }
}

/**
 * Build the multipart `file` part for a captured screenshot, or null when
 * the capture cannot be turned into one (never throws — a missing
 * screenshot must not cost the annotation).
 *
 * Native keeps the `{uri, name, type}` descriptor untouched: RN's XHR
 * streams the temp file off disk (see transport.postForm).
 *
 * Web reads the capture into a real Blob. Only `data:` and `blob:` URLs are
 * fetched — a `file://` path is REFUSED rather than fetched, because on
 * native the browser-ish `fetch` resolves it against the dev server and
 * silently uploads Expo's HTML index instead of the image.
 */
export async function buildScreenshotPart(uri: string): Promise<ScreenshotPart | null> {
  if (!isWeb()) return { uri, name: SCREENSHOT_NAME, type: SCREENSHOT_TYPE };
  if (!/^(data:|blob:)/i.test(uri)) {
    // The SCHEME is the diagnostic ("it was a file:// path, not a data:
    // URL"); the rest is a path into the user's device and is withheld.
    const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*:)/.exec(uri)?.[1] ?? "(no scheme)";
    console.warn(`[annokit] screenshot upload skipped: unsupported web capture URI (${scheme})`);
    return null;
  }
  try {
    const blob = await (await fetch(uri)).blob();
    // A File keeps the filename in the multipart part; not every runtime
    // has the constructor (older RN-web hosts), so the Blob is the floor.
    const FileCtor = (globalThis as { File?: new (...args: never[]) => Blob }).File;
    if (typeof FileCtor === "function") {
      try {
        return new (FileCtor as unknown as new (
          parts: Blob[],
          name: string,
          options?: { type?: string },
        ) => Blob)([blob], SCREENSHOT_NAME, { type: SCREENSHOT_TYPE });
      } catch {
        /* fall through to the plain Blob */
      }
    }
    return blob;
  } catch (e) {
    console.warn("[annokit] screenshot blob conversion failed:", e);
    return null;
  }
}

/**
 * ── SCREENSHOT LIFECYCLE ──────────────────────────────────────────────────
 *
 * A native capture is a FILE in the OS temp directory, and the screen it
 * holds is whatever was on it: notifications, another app's content, a
 * password field mid-type, someone else's data. The capture is taken on
 * request, after the sheet is open — the camera switch, or a headless
 * host's `captureScreenshot()` — and a capture can still go unused: the
 * user cancels, switches the camera back off, or retakes. Nothing used to
 * delete those, and a long session accumulated them.
 *
 * OWNERSHIP: the package releases the capture at every exit — dismissal,
 * either kind of submit (after the upload, when there is one), and
 * provider teardown. A host driving the headless API owns the URI only
 * while it holds it, and gets `releaseScreenshot` among its helpers to say
 * so explicitly; using `submitAgent`/`submitComment` releases it for them.
 *
 * See docs/audit/high-priority-security-privacy.md.
 */

/**
 * URIs already handed to `releaseCapture`.
 *
 * Release is reached from several exits and they legitimately overlap — a
 * submit releases, and the flow closing behind it releases again — so this
 * is what makes "cleanup runs once" true rather than merely intended.
 * Bounded, because it must not become the leak it was added to prevent;
 * the oldest entry is dropped, and a re-release that old is harmless
 * anyway (view-shot ignores a path that is already gone).
 */
const released = new Set<string>();
const RELEASED_MEMORY = 64;

/**
 * Delete a native capture's temp file. Safe to call with null, with a web
 * `data:` URL (nothing on disk to free), twice, or without the peer
 * installed — a cleanup path that can throw is worse than the leak.
 */
export function releaseScreenshot(uri: string | null | undefined): void {
  if (typeof uri !== "string" || !uri) return;
  // A data:/blob: capture is memory the GC owns; there is no file.
  if (/^(data:|blob:)/i.test(uri)) return;
  if (released.has(uri)) return;
  if (released.size >= RELEASED_MEMORY) {
    const oldest = released.values().next().value;
    if (oldest !== undefined) released.delete(oldest);
  }
  released.add(uri);
  if (!releaseCaptureImpl) return;
  try {
    releaseCaptureImpl(uri);
  } catch (e) {
    // Redacted: the URI is a path into the user's device.
    console.warn("[annokit] screenshot cleanup failed:", (e as { name?: string })?.name ?? "error");
  }
}
