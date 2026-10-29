/**
 * Screenshot capture + multipart part construction (src/screenshot.ts).
 *
 * The interesting split is per target: native hands the transport RN's
 * `{uri, name, type}` descriptor (XHR streams the temp file off disk), while
 * on react-native-web the same object appended to the browser's native
 * FormData stringifies to "[object Object]" — ~150 bytes of garbage instead
 * of an image — so the web branch must produce a real Blob/File.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildScreenshotPart, captureScreenUri, screenshotsAvailable, setScreenshotsEnabled } from "../src/screenshot";
import { installReactNativeStub, installViewShotStub } from "./helpers/stubs";

interface HostFormData {
  append(name: string, value: unknown): void;
  get(name: string): unknown;
}

const DATA_URL = "data:image/png;base64,iVBORw0KGgo=";
const FILE_URI = "file:///var/tmp/ReactNative/shot.png";

let restoreRn: (() => void) | null = null;
let warn: ReturnType<typeof vi.spyOn>;

/** Pretend to be running under react-native-web (or a native target). */
function onPlatform(platformOS: string) {
  restoreRn?.();
  restoreRn = installReactNativeStub({ platformOS });
}

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  restoreRn?.();
  restoreRn = null;
  vi.unstubAllGlobals();
  warn.mockRestore();
});

describe("native part (unchanged)", () => {
  it("hands back RN's {uri, name, type} descriptor for a file:// capture", async () => {
    onPlatform("ios");
    await expect(buildScreenshotPart(FILE_URI)).resolves.toEqual({
      uri: FILE_URI,
      name: "screenshot.png",
      type: "image/png",
    });
  });

  it("never fetches the file:// URI (fetch would resolve it against Metro)", async () => {
    // The trap this guards: on native a `fetch("file://…")` silently resolves
    // against the dev server and uploads Expo's HTML index as the "image".
    onPlatform("android");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await buildScreenshotPart(FILE_URI);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the native part when react-native is not resolvable at all", async () => {
    // node tests / SSR: no RN module, so no Platform — must not throw.
    const part = await buildScreenshotPart(FILE_URI);
    expect(part).toEqual({ uri: FILE_URI, name: "screenshot.png", type: "image/png" });
  });
});

describe("web part (Blob conversion)", () => {
  it("converts a data: capture into a real Blob/File, not the RN object", async () => {
    onPlatform("web");
    const blob = new Blob(["png-bytes"]);
    const fetchMock = vi.fn().mockResolvedValue({ blob: async () => blob });
    vi.stubGlobal("fetch", fetchMock);

    const part = await buildScreenshotPart(DATA_URL);
    expect(part).toBeInstanceOf(Blob);
    expect(part).not.toHaveProperty("uri");
    expect(fetchMock).toHaveBeenCalledWith(DATA_URL);
  });

  it("names the part screenshot.png with an image/png type", async () => {
    onPlatform("web");
    vi.stubGlobal("fetch", async () => ({ blob: async () => new Blob(["png-bytes"]) }));
    const part = (await buildScreenshotPart(DATA_URL)) as File;
    expect(part.type).toBe("image/png");
    expect(part.name).toBe("screenshot.png");
  });

  it("falls back to the plain Blob when the host has no File constructor", async () => {
    onPlatform("web");
    const blob = new Blob(["png-bytes"]);
    vi.stubGlobal("fetch", async () => ({ blob: async () => blob }));
    vi.stubGlobal("File", undefined);
    await expect(buildScreenshotPart(DATA_URL)).resolves.toBe(blob);
  });

  it("converts a blob: capture URL too", async () => {
    onPlatform("web");
    const blob = new Blob(["png-bytes"]);
    vi.stubGlobal("fetch", async () => ({ blob: async () => blob }));
    const part = await buildScreenshotPart("blob:http://localhost:8081/a-b-c");
    expect(part).toBeInstanceOf(Blob);
  });

  it("the converted part survives a real FormData append (the actual bug)", async () => {
    // Regression guard: appending {uri,name,type} to the browser's FormData
    // yields the string "[object Object]"; a Blob part stays a Blob.
    onPlatform("web");
    vi.stubGlobal("fetch", async () => ({
      blob: async () => new Blob(["png-bytes"]),
    }));
    // (the host's FormData is typed loosely here: @types/node's FormData
    // declares neither `get` nor a non-Blob `append` value.)
    const good = new FormData() as unknown as HostFormData;
    good.append("file", await buildScreenshotPart(DATA_URL));
    expect(good.get("file")).toBeInstanceOf(Blob);

    const bad = new FormData() as unknown as HostFormData;
    bad.append("file", { uri: DATA_URL, name: "screenshot.png" });
    expect(bad.get("file")).toBe("[object Object]");
  });

  it("refuses a file:// URI on web instead of fetching it, and warns", async () => {
    onPlatform("web");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(buildScreenshotPart(FILE_URI)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[annokit]"));
  });

  it("resolves null (never throws) when the fetch of the capture fails", async () => {
    onPlatform("web");
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(buildScreenshotPart(DATA_URL)).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it("resolves null when the response cannot be read as a blob", async () => {
    onPlatform("web");
    vi.stubGlobal("fetch", async () => ({
      blob: async () => {
        throw new Error("no body");
      },
    }));
    await expect(buildScreenshotPart(DATA_URL)).resolves.toBeNull();
  });
});

describe("capture options per target", () => {
  /** Re-import screenshot.ts against a stubbed view-shot (resolved at load). */
  async function withViewShot(captureScreen: unknown) {
    const restore = installViewShotStub(captureScreen);
    vi.resetModules();
    const mod = await import("../src/screenshot");
    return { mod, restore };
  }

  it("asks for a data-uri on web (view-shot's tmpfile default is unimplemented there)", async () => {
    onPlatform("web");
    const captureScreen = vi.fn().mockResolvedValue(DATA_URL);
    const { mod, restore } = await withViewShot(captureScreen);
    try {
      expect(mod.screenshotsAvailable()).toBe(true);
      await expect(mod.captureScreenUri()).resolves.toBe(DATA_URL);
      expect(captureScreen).toHaveBeenCalledWith({
        format: "png",
        quality: 0.9,
        result: "data-uri",
      });
    } finally {
      restore();
      vi.resetModules();
    }
  });

  it("keeps the native capture options byte-identical (no result option)", async () => {
    onPlatform("ios");
    const captureScreen = vi.fn().mockResolvedValue(FILE_URI);
    const { mod, restore } = await withViewShot(captureScreen);
    try {
      await expect(mod.captureScreenUri()).resolves.toBe(FILE_URI);
      expect(captureScreen).toHaveBeenCalledWith({ format: "png", quality: 0.9 });
    } finally {
      restore();
      vi.resetModules();
    }
  });

  it("resolves null (never throws) when the capture itself fails", async () => {
    onPlatform("web");
    const { mod, restore } = await withViewShot(async () => {
      throw new Error("html2canvas exploded");
    });
    try {
      await expect(mod.captureScreenUri()).resolves.toBeNull();
      expect(warn).toHaveBeenCalled();
    } finally {
      restore();
      vi.resetModules();
    }
  });

  it("degrades to null when react-native-view-shot is not installed", async () => {
    onPlatform("web");
    await expect(captureScreenUri()).resolves.toBeNull();
  });
});

// ── Release ──────────────────────────────────────────────────────────────
//
// A native capture is a temp FILE holding whatever was on screen. It is
// taken before the destination is chosen, so most captures are never
// uploaded — "no abandoned or text-only flow leaves a package-created
// native screenshot behind" (docs/audit/high-priority-security-privacy.md).

describe("releaseScreenshot", () => {
  /**
   * Install the peer and load a FRESH src/screenshot.ts against it —
   * the module resolves react-native-view-shot once, at load (see
   * test/helpers/stubs.ts).
   */
  async function withViewShot(
    release?: (uri: string) => void,
  ): Promise<{ freed: string[]; release: (uri: string | null | undefined) => void; restore: () => void }> {
    const freed: string[] = [];
    const restore = installViewShotStub(
      async () => FILE_URI,
      release ?? ((uri: string) => freed.push(uri)),
    );
    vi.resetModules();
    const mod = await import("../src/screenshot");
    return { freed, release: mod.releaseScreenshot, restore };
  }

  it("frees a native temp file", async () => {
    const { freed, release, restore } = await withViewShot();
    release(FILE_URI);
    expect(freed).toEqual([FILE_URI]);
    restore();
  });

  it("frees each capture exactly once, however many exits reach it", async () => {
    // A submit releases, and the flow closing behind it releases again.
    const { freed, release, restore } = await withViewShot();
    release(FILE_URI);
    release(FILE_URI);
    release(FILE_URI);
    expect(freed).toEqual([FILE_URI]);
    restore();
  });

  it("still frees a different capture after one has been released", async () => {
    const { freed, release, restore } = await withViewShot();
    release(FILE_URI);
    release("file:///var/tmp/ReactNative/other.png");
    expect(freed).toHaveLength(2);
    restore();
  });

  it("does nothing for a web capture — there is no file to free", async () => {
    const { freed, release, restore } = await withViewShot();
    release(DATA_URL);
    release("blob:http://localhost/abc");
    expect(freed).toEqual([]);
    restore();
  });

  it("is a no-op for an absent capture", async () => {
    const { freed, release, restore } = await withViewShot();
    release(null);
    release(undefined);
    release("");
    expect(freed).toEqual([]);
    restore();
  });

  it("never throws when the peer is missing", async () => {
    // Node tests and SSR hosts: cleanup must degrade, not crash.
    vi.resetModules();
    const mod = await import("../src/screenshot");
    expect(() => mod.releaseScreenshot(FILE_URI)).not.toThrow();
  });

  it("never throws when the peer's release throws, and says so without the path", async () => {
    const { release, restore } = await withViewShot(() => {
      throw new Error(`ENOENT ${FILE_URI}`);
    });
    expect(() => release(FILE_URI)).not.toThrow();
    const logged = (warn.mock.calls as unknown[][]).map((c) => c.join(" ")).join("\n");
    expect(logged).toContain("screenshot cleanup failed");
    expect(logged).not.toContain(FILE_URI);
    restore();
  });

  it("does not grow without bound", async () => {
    // The dedupe memory must not become the leak it prevents.
    const { freed, release, restore } = await withViewShot();
    for (let i = 0; i < 500; i++) release(`file:///var/tmp/shot-${i}.png`);
    expect(freed).toHaveLength(500);
    // The oldest is forgotten, so re-releasing it reaches the peer again —
    // harmless (the file is already gone) and bounded, which is the trade.
    release("file:///var/tmp/shot-0.png");
    expect(freed).toHaveLength(501);
    restore();
  });
});

// ── Host opt-out ─────────────────────────────────────────────────────────
//
// Off must mean NEVER TAKEN, not taken-then-not-uploaded: a host that turns
// screenshots off is saying this screen must not be written to disk.

describe("setScreenshotsEnabled", () => {
  afterEach(() => setScreenshotsEnabled(true));

  it("reports unavailable when the host turns them off", async () => {
    const restore = installViewShotStub(async () => FILE_URI);
    vi.resetModules();
    const mod = await import("../src/screenshot");
    expect(mod.screenshotsAvailable()).toBe(true);
    mod.setScreenshotsEnabled(false);
    expect(mod.screenshotsAvailable()).toBe(false);
    mod.setScreenshotsEnabled(true);
    expect(mod.screenshotsAvailable()).toBe(true);
    restore();
  });

  it("stays unavailable when the peer is missing, however the flag is set", () => {
    setScreenshotsEnabled(true);
    expect(screenshotsAvailable()).toBe(false);
  });
});

// ── "Off" means gone ─────────────────────────────────────────────────────
//
// Turning the switch off (or dismissing the chip) deletes the capture
// rather than keeping it in case the user changes their mind. Keeping it
// would make "off" mean "taken but withheld", which is the thing opt-in
// capture exists to avoid.

describe("removing a screenshot", () => {
  it("frees the file, and a later capture is a genuinely new one", async () => {
    const freed: string[] = [];
    const restore = installViewShotStub(
      async () => FILE_URI,
      (uri: string) => freed.push(uri),
    );
    vi.resetModules();
    const mod = await import("../src/screenshot");

    mod.releaseScreenshot(FILE_URI);
    expect(freed).toEqual([FILE_URI]);

    // A second, different capture is not confused with the released one.
    const second = "file:///var/tmp/ReactNative/second.png";
    mod.releaseScreenshot(second);
    expect(freed).toEqual([FILE_URI, second]);
    restore();
  });
});
