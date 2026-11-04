/**
 * Provider wiring, checked at the source because the suite cannot render
 * the RN tree (see test/accessibility.test.ts).
 *
 * The transport is rebuilt only when its CONFIGURATION changes.
 * Each new transport disposes the old one, which aborts every request in
 * flight and re-runs the handshake. Keying the memo on the `timeouts`
 * OBJECT made an inline `timeouts={{ read: 20000 }}` do that on every host
 * re-render.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(__dirname, "..", "src", "index.tsx"), "utf8");

describe("transport memo", () => {
  it("is keyed on the timeout values, not the object identity", () => {
    const memo = source.match(/const transport = useMemo\(([\s\S]*?)\);\n/);
    expect(memo, "transport useMemo not found").not.toBeNull();
    const deps = memo![1].slice(memo![1].lastIndexOf("["));
    expect(deps).toMatch(/^\[env, readMs, mutateMs, uploadMs\]/);
    expect(deps).not.toContain("timeouts");
  });
});

describe("headless screenshots", () => {
  // The built-in composer's shutter discards any shot taken while no
  // composer flow is open — which, for a headless host, is always.
  it("hands onCapture hosts the shutter that does not need the built-in composer, with THIS capture to mark", () => {
    const helpers = source.slice(source.indexOf("buildCaptureHelpers(pendingCapture"));
    const wiring = helpers.slice(0, helpers.indexOf("}),"));
    expect(wiring).toContain("captureScreenshot: () => shootForHost(pendingCapture)");
  });
});

describe("what a screenshot shows", () => {
  const line = (needle: string) => {
    const at = source.indexOf(needle);
    expect(at, `${needle} not found`).toBeGreaterThan(-1);
    return source.slice(source.lastIndexOf("\n", at), source.indexOf("\n", at + needle.length));
  };

  it("hides the package's own chrome while the shutter is open", () => {
    expect(line("<AnnoKitFab")).toBeTruthy();
    expect(source).toContain("hidden={shooting}");
    expect(line("<AnnoKitAreaBox rect=")).toContain("!shooting");
    expect(line("{selection?.target &&")).toContain("!shooting");
    expect(line("<AnnoKitPinDot")).toContain("!shooting");
    expect(line("<AnnoKitAgentBanner")).toBeTruthy();
    expect(source).toMatch(/agentWork\.count > 0 && !armed && !capture && !shooting/);
  });

  it("puts the app back where it was for the shot, without animating", () => {
    expect(source).toMatch(/const pushBy = sheetOpen && !shooting/);
    expect(source).toMatch(/if \(shooting\) \{\s*\n\s*\/\/[^\n]*\n(\s*\/\/[^\n]*\n)*\s*pushAnim\.setValue\(0\);/);
  });

  it("draws the composed task's mark into the shot, numbered as the markers are", () => {
    const pushLayer = source.slice(source.indexOf('testID="annokit-push-layer"'), source.indexOf("</Animated.View>", source.indexOf('testID="annokit-push-layer"')));
    expect(pushLayer).toContain("<AnnoKitBurnIn capture={burnIn} number={nextMarkerNumber(pending, routeName, markerPositionTrusted)} />");
    // The layer mounts on the same commit the chrome hides in.
    expect(source).toMatch(/setBurnIn\(target\);\s*\n\s*setShooting\(true\);/);
  });

  it("asks for one pixel per point", () => {
    expect(source).toContain("captureScreenUri({ window: { width: windowWidth, height: windowHeight }, pixelRatio: PixelRatio.get() })");
  });
});
