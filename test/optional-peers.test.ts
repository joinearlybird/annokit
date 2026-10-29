/**
 * Optional peer degradation (src/router.ts, src/screenshot.ts,
 * src/shake.ts): with none of expo-router, react-native-view-shot or
 * expo-sensors resolvable, every module must load and answer "unavailable"
 * instead of throwing.
 */

import { describe, expect, it, vi } from "vitest";
import { navigateToRoute, routerNavigationAvailable, useRoutePathname } from "../src/router";
import { captureScreenUri, screenshotsAvailable } from "../src/screenshot";
import { shakeAvailable, subscribeToShake } from "../src/shake";

describe("expo-router integration", () => {
  it("reports no pathname when expo-router is not installed", () => {
    expect(() => useRoutePathname()).not.toThrow();
    expect(useRoutePathname()).toBeNull();
  });

  it("cannot navigate, and says so instead of pretending", () => {
    // The notes list asks this before offering a jump to another screen; a
    // false yes would swallow the tap and leave the user on the same route.
    expect(routerNavigationAvailable()).toBe(false);
  });

  it("navigating without the package is a no-op, never a crash", () => {
    expect(navigateToRoute("/settings")).toBe(false);
    expect(navigateToRoute(null)).toBe(false);
    expect(navigateToRoute("")).toBe(false);
  });
});

describe("react-native-view-shot integration", () => {
  it("reports screenshots unavailable when the package is not installed", () => {
    expect(screenshotsAvailable()).toBe(false);
  });

  it("captureScreenUri resolves null instead of throwing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(captureScreenUri()).resolves.toBeNull();
    warn.mockRestore();
  });
});

describe("expo-sensors integration", () => {
  it("reports shake unavailable when the package is not installed", () => {
    expect(shakeAvailable()).toBe(false);
  });

  it("subscribing without the package neither throws nor fires", () => {
    const onShake = vi.fn();
    const unsubscribe = subscribeToShake(onShake);
    unsubscribe();
    expect(onShake).not.toHaveBeenCalled();
  });
});

// ── Metro must be able to bundle an app WITHOUT any optional peer ──────────
//
// Metro resolves requires at bundle time, and treats one as optional only
// when the nearest block around it is a try block. One nested a level deeper
// (inside an `if`) made every app without expo-paste-input fail to bundle,
// which no runtime check could catch.

describe("optional peers are optional to Metro", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const { join } = require("node:path") as typeof import("node:path");
  const PEERS = ["expo-paste-input", "expo-router", "expo-sensors", "react-native-svg", "react-native-view-shot", "expo-modules-core"];

  it.each(["paste.ts", "router.ts", "screenshot.ts", "shake.ts", "svg.ts"])("%s requires each peer directly inside a try block", (file) => {
    const lines = readFileSync(join(__dirname, "..", "src", file), "utf8").split("\n");
    lines.forEach((line, i) => {
      const peer = PEERS.find((p) => line.includes(`require("${p}")`));
      if (!peer) return;
      // Walk up to the nearest line that opens a block; it must be a try.
      let j = i - 1;
      let depth = 0;
      for (; j >= 0; j--) {
        const l = lines[j]!;
        depth += (l.match(/\}/g) ?? []).length - (l.match(/\{/g) ?? []).length;
        if (depth < 0) break;
      }
      expect(lines[j]?.trim(), `${file}:${i + 1} requires ${peer}`).toMatch(/^try \{$|\btry \{$/);
    });
  });
});
