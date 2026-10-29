/**
 * react-native-view-shot integration. The package is a required peer (the
 * template and harness apps both depend on it); the guarded require is kept
 * so hosts without it — node tests, SSR — degrade to "off" instead of
 * crashing at import time.
 *
 * The screen is captured at TAP time (before the composer modal opens) so
 * the screenshot shows the app, not our overlay chrome.
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
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Platform } = require("react-native") as { Platform?: { OS?: string } };
    return Platform?.OS === "web";
  } catch {
    return false;
  }
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
export async function captureScreenUri(): Promise<string | null> {
  if (!captureScreenImpl) return null;
  try {
    return await captureScreenImpl(
      isWeb()
        ? { format: "png", quality: 0.9, result: "data-uri" }
        : { format: "png", quality: 0.9 },
    );
  } catch (e) {
    console.warn("[annokit] screenshot capture failed:", e);
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
 * password field mid-type, someone else's data. The capture is taken
 * eagerly — before the destination is chosen, because the composer would
 * otherwise cover the thing being captured — so most captures are never
 * uploaded at all: the user cancels, writes a text-only team note, or
 * leaves the screenshot switch off. Nothing used to delete those, and a
 * long session accumulated them.
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
