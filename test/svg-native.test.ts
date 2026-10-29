/**
 * The native-view probe in src/svg.ts. Android registers the root view as
 * "RNSVGSvgViewAndroid"; asking only for the iOS name made every Android
 * app fall back to text glyphs with react-native-svg installed.
 */

import { describe, expect, it } from "vitest";
import { svgViewManagerRegistered } from "../src/svg";

const registry = (...names: string[]) => ({
  hasViewManagerConfig: (name: string) => names.includes(name),
});

describe("svgViewManagerRegistered", () => {
  it("accepts the iOS root view", () => {
    expect(svgViewManagerRegistered(registry("RNSVGSvgView"))).toBe(true);
  });

  it("accepts the Android root view", () => {
    expect(svgViewManagerRegistered(registry("RNSVGSvgViewAndroid"))).toBe(true);
  });

  it("refuses when the native half is missing (stale dev client)", () => {
    expect(svgViewManagerRegistered(registry("RCTView"))).toBe(false);
  });

  it("falls back to getViewManagerConfig, and treats an unknowable registry as present", () => {
    const legacy = { getViewManagerConfig: (n: string) => (n === "RNSVGSvgViewAndroid" ? {} : undefined) };
    expect(svgViewManagerRegistered(legacy)).toBe(true);
    expect(svgViewManagerRegistered({})).toBe(true);
  });
});
