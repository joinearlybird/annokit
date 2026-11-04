/**
 * How the provider wires the aim gesture (src/index.tsx), checked at the
 * source like test/tree-stability.test.ts: the suite cannot render the RN
 * tree, and these are the seams a refactor would silently drop.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const index = readFileSync(join(__dirname, "..", "src", "index.tsx"), "utf8");
const captureRoot = readFileSync(join(__dirname, "..", "src", "capture.tsx"), "utf8");

describe("hold to pin", () => {
  it("the capture root reports the finger going DOWN, before the first survey", () => {
    const down = captureRoot.indexOf("onAimStart?.(pageX, pageY, rootRef.current);");
    const survey = captureRoot.indexOf("onAim(pageX, pageY, rootRef.current);", down);
    expect(down).toBeGreaterThan(-1);
    expect(survey).toBeGreaterThan(down);
  });

  it("the provider hands the capture root its hold detector", () => {
    expect(index).toContain("onAimStart={onAimStart}");
    expect(index).toMatch(/createHoldDetector\(\{ onHold: \(x, y\) => tracker\.pin\(x, y\) \}\)/);
  });

  it("every way out of a gesture cancels the hold", () => {
    const fn = (name: string) => {
      const start = index.indexOf(`const ${name} = useCallback(`);
      expect(start, `${name} not found`).toBeGreaterThan(-1);
      return index.slice(start, index.indexOf("}, [", start));
    };
    expect(fn("cancelAimGesture")).toContain("hold.cancel()");
    expect(fn("clearAim")).toContain("hold.cancel()");
    // A fired hold owns the release: selecting as well would open two captures.
    expect(fn("onSelect")).toContain("hold.up()) return;");
  });

  it("a pinned selection becomes a point capture and draws the pin", () => {
    expect(index).toContain('shape: "point"');
    expect(index).toContain("<AnnoKitPinDot x={selection.x} y={selection.y} />");
  });
});
