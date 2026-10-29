/**
 * Metro symbolication (src/inspector.ts, spike finding 4): React 19 removed
 * `_debugSource`, so file:line comes from POSTing owner-stack frames to the
 * dev server's /symbolicate. Exercised through `inspectAtPoint` with the
 * recorded owner stacks + a stubbed Metro.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSymbolicationCache, inspectAtPoint } from "../src/inspector";
import {
  BUNDLE_URL,
  IMAGE_PAYLOAD,
  METRO_ORIGIN,
  PRIMARY_BUTTON_PAYLOAD,
  symbolicateResponse,
} from "./fixtures/spike-payloads";
import { installInspectorPayload, installReactNativeStub } from "./helpers/stubs";

const cleanups: Array<() => void> = [];
let fetchMock: ReturnType<typeof vi.fn>;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Symbolication is memoized per owner stack so the aim survey can label
  // an element without a Metro round-trip; each test starts from empty.
  clearSymbolicationCache();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  cleanups.push(installReactNativeStub({ scriptURL: `${BUNDLE_URL}` }));
});

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
  vi.unstubAllGlobals();
  warn.mockRestore();
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("symbolication happy path", () => {
  it("resolves the nearest user component to its repo-relative definition site", async () => {
    fetchMock.mockResolvedValue(
      json(
        symbolicateResponse([
          { file: "/Users/dev/proj/app/src/components/Card.tsx", lineNumber: 4, methodName: "PrimaryButton" },
        ]),
      ),
    );
    cleanups.push(installInspectorPayload(PRIMARY_BUTTON_PAYLOAD));
    const result = await inspectAtPoint({}, 100, 200);
    expect(result?.source).toEqual({ file: "app/src/components/Card.tsx", line: 4 });
  });

  it("POSTs to {metroOrigin}/symbolicate, origin derived from the bundle scriptURL", async () => {
    fetchMock.mockResolvedValue(json(symbolicateResponse([])));
    cleanups.push(installInspectorPayload(PRIMARY_BUTTON_PAYLOAD));
    await inspectAtPoint({}, 100, 200);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${METRO_ORIGIN}/symbolicate`);
    expect(init.method).toBe("POST");
  });

  it("sends the user-component frames from the owner stack (max 5)", async () => {
    fetchMock.mockResolvedValue(json(symbolicateResponse([])));
    cleanups.push(installInspectorPayload(PRIMARY_BUTTON_PAYLOAD));
    await inspectAtPoint({}, 100, 200);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.stack.length).toBeGreaterThan(0);
    expect(body.stack.length).toBeLessThanOrEqual(5);
    // Only frames whose method name survived component filtering.
    expect(body.stack.map((f: { methodName: string }) => f.methodName)).toEqual([
      "PrimaryButton",
      "Card",
    ]);
    // Frame shape Metro expects: file + line + column.
    expect(body.stack[0]).toMatchObject({
      file: BUNDLE_URL,
      lineNumber: 93078,
      column: 3,
    });
  });

  it("skips node_modules frames and returns the first app frame", async () => {
    fetchMock.mockResolvedValue(
      json(
        symbolicateResponse([
          { file: "/proj/node_modules/react-native/Libraries/Text/Text.js", lineNumber: 47 },
          { file: "/proj/app/src/Card.tsx", lineNumber: 4 },
        ]),
      ),
    );
    cleanups.push(installInspectorPayload(PRIMARY_BUTTON_PAYLOAD));
    const result = await inspectAtPoint({}, 100, 200);
    expect(result?.source).toEqual({ file: "app/src/Card.tsx", line: 4 });
  });

  it("relativizes packages/* and bare src/* paths too", async () => {
    fetchMock.mockResolvedValue(
      json(symbolicateResponse([{ file: "/Users/dev/proj/packages/src/ui/Button.tsx", lineNumber: 12 }])),
    );
    cleanups.push(installInspectorPayload(IMAGE_PAYLOAD));
    const first = await inspectAtPoint({}, 1, 2);
    expect(first?.source).toEqual({ file: "packages/src/ui/Button.tsx", line: 12 });

    fetchMock.mockResolvedValue(
      json(symbolicateResponse([{ file: "/Users/dev/proj/src/ListBits.tsx", lineNumber: 4 }])),
    );
    // Same payload, so the same owner stack — the memo would (correctly)
    // answer from the first half; this half is about the path shape.
    clearSymbolicationCache();
    const second = await inspectAtPoint({}, 1, 2);
    expect(second?.source).toEqual({ file: "src/ListBits.tsx", line: 4 });
  });

  /**
   * Regression: this returned the raw absolute path when no known layout
   * matched, so an ordinary Expo Router app (app/ and components/ at the
   * root, no src/) sent the developer's home directory to the server inside
   * source.file — and the detail chip rendered it ellipsised. Found by
   * annotating a component in examples/expo.
   */
  it("never returns an absolute path, whatever the project layout", async () => {
    const cases: Array<[string, string]> = [
      // The shape that leaked: components/ beside app/, no src/ anywhere.
      ["/Users/johnny/Workspace/eb/examples/expo/components/PrimaryButton.tsx",
       "components/PrimaryButton.tsx"],
      // A file at the project root keeps its directory for context, and
      // still says nothing about the machine.
      ["/Users/dev/my-rn-app/App.tsx", "my-rn-app/App.tsx"],
      // Symbolication can hand back a bundle URL rather than a path.
      ["http://localhost:8081/components/Header.tsx", "components/Header.tsx"],
      // Already short and relative — left alone.
      ["components/Card.tsx", "components/Card.tsx"],
      ["App.tsx", "App.tsx"],
    ];

    for (const [given, expected] of cases) {
      fetchMock.mockResolvedValue(json(symbolicateResponse([{ file: given, lineNumber: 7 }])));
      clearSymbolicationCache();
      cleanups.push(installInspectorPayload(IMAGE_PAYLOAD));
      const result = await inspectAtPoint({}, 1, 2);
      expect(result?.source, given).toEqual({ file: expected, line: 7 });
      expect(result?.source?.file.startsWith("/"), given).toBe(false);
    }
  });

  it("skips dependency frames entirely rather than naming a library file", async () => {
    fetchMock.mockResolvedValue(json(symbolicateResponse([
      { file: "/Users/dev/proj/node_modules/react-native-paper/lib/Button.js", lineNumber: 3 },
      { file: "/Users/dev/my-rn-app/components/Checkout.tsx", lineNumber: 9 },
    ])));
    clearSymbolicationCache();
    cleanups.push(installInspectorPayload(IMAGE_PAYLOAD));
    const result = await inspectAtPoint({}, 1, 2);
    // The first frame under node_modules is passed over: an annotation points
    // at the code you would edit, not at a library's internals.
    expect(result?.source).toEqual({ file: "components/Checkout.tsx", line: 9 });
  });

  it("defaults a missing lineNumber to 0 rather than dropping the file", async () => {
    fetchMock.mockResolvedValue(
      json(symbolicateResponse([{ file: "/proj/app/src/Card.tsx", lineNumber: null }])),
    );
    cleanups.push(installInspectorPayload(PRIMARY_BUTTON_PAYLOAD));
    const result = await inspectAtPoint({}, 1, 2);
    expect(result?.source).toEqual({ file: "app/src/Card.tsx", line: 0 });
  });
});

describe("symbolication graceful degradation", () => {
  async function expectNoSource() {
    cleanups.push(installInspectorPayload(PRIMARY_BUTTON_PAYLOAD));
    const result = await inspectAtPoint({}, 100, 200);
    expect(result).not.toBeNull();
    // Identity fields still ship without symbolication.
    expect(result?.element).toBe("PrimaryButton");
    expect(result?.source).toBeUndefined();
    return result;
  }

  it("returns no source when every frame is in node_modules", async () => {
    fetchMock.mockResolvedValue(
      json(
        symbolicateResponse([
          { file: "/proj/node_modules/react-native/Libraries/Text/Text.js", lineNumber: 47 },
          { file: "/proj/node_modules/react-native/Libraries/Pressability/Pressability.js", lineNumber: 10 },
        ]),
      ),
    );
    await expectNoSource();
  });

  it("returns no source when Metro answers with an empty stack", async () => {
    fetchMock.mockResolvedValue(json(symbolicateResponse([])));
    await expectNoSource();
  });

  it("returns no source when frames have null files", async () => {
    fetchMock.mockResolvedValue(json(symbolicateResponse([{ file: null, lineNumber: null }])));
    await expectNoSource();
  });

  it("returns no source on a non-2xx /symbolicate", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    await expectNoSource();
  });

  it("returns no source when /symbolicate is unreachable", async () => {
    fetchMock.mockRejectedValue(new TypeError("Network request failed"));
    await expectNoSource();
  });

  it("returns no source when /symbolicate answers non-JSON", async () => {
    fetchMock.mockResolvedValue(new Response("<html>", { status: 200 }));
    await expectNoSource();
  });

  it("does not call Metro at all when there is no bundle scriptURL", async () => {
    while (cleanups.length) cleanups.pop()?.();
    cleanups.push(installReactNativeStub({ scriptURL: null }));
    await expectNoSource();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not call Metro on web (Platform.OS === 'web')", async () => {
    while (cleanups.length) cleanups.pop()?.();
    cleanups.push(installReactNativeStub({ scriptURL: BUNDLE_URL, platformOS: "web" }));
    await expectNoSource();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not call Metro when the owner stack has no locatable frames", async () => {
    cleanups.push(
      installInspectorPayload({
        hierarchy: [{ name: "PrimaryButton" }],
        // Host-only owner stack: React 19 gives host frames no location.
        componentStack: "\n    at RCTText (<anonymous>)\n    at RCTView (<anonymous>)\n",
        props: null,
      }),
    );
    const result = await inspectAtPoint({}, 1, 2);
    expect(result?.source).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aborts a hanging /symbolicate after the 2s timeout without blocking capture", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      );
      cleanups.push(installInspectorPayload(PRIMARY_BUTTON_PAYLOAD));
      const promise = inspectAtPoint({}, 1, 2);
      await vi.advanceTimersByTimeAsync(2000);
      const result = await promise;
      expect(result?.source).toBeUndefined();
      expect(result?.element).toBe("PrimaryButton");
    } finally {
      vi.useRealTimers();
    }
  });
});
