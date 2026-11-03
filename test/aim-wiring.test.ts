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

describe("draw mode", () => {
  const sketchLayer = readFileSync(join(__dirname, "..", "src", "sketch-layer.tsx"), "utf8");
  const overlay = readFileSync(join(__dirname, "..", "src", "aim-overlay.tsx"), "utf8");

  it("the gesture pad serves every mode but element", () => {
    expect(index).toMatch(/live && armed && aimMode !== "element" && !capture && !shooting && \(\s*<AnnoKitGesturePad/);
  });

  it("the sketch layer is in the screenshot: never hidden while shooting", () => {
    const line = index.slice(index.lastIndexOf("\n", index.indexOf("<AnnoKitSketchLayer strokes={sketchSel")), index.indexOf("<AnnoKitSketchLayer strokes={sketchSel"));
    expect(line).not.toContain("shooting");
    expect(index).toContain("{(sketchSel || liveStroke) && (");
  });

  it("the live stroke is committed once per frame, not per touch sample", () => {
    expect(index).toContain("strokeFrameRef.current = requestAnimationFrame(");
    expect(index).toMatch(/liveStrokeRef\.current = liveStrokeRef\.current\s*\?\s*extendStroke/);
  });

  it("every way out of a gesture drops the live stroke and the sketch", () => {
    const fn = (name: string) => {
      const start = index.indexOf(`const ${name} = useCallback(`);
      return index.slice(start, index.indexOf("}, [", start));
    };
    expect(fn("cancelAimGesture")).toContain("dropLiveStroke()");
    expect(fn("clearAim")).toContain("dropLiveStroke()");
    expect(fn("clearAim")).toContain("setSketchSel(null)");
  });

  it("the sketch layer reaches react-native-svg only through the shim", () => {
    expect(sketchLayer).not.toContain('require("react-native-svg")');
    expect(sketchLayer).toContain("svgParts()");
    expect(sketchLayer).toMatch(/<Svg[^>]*pointerEvents="none"/);
  });

  it("the Draw segment is offered only when the svg peer can draw it", () => {
    expect(overlay).toContain('drawAvailable && segment("draw"');
    expect(index).toContain("drawAvailable={svgAvailable()}");
  });

  it("a sketch becomes a sketch capture with its strokes", () => {
    expect(index).toContain('shape: "sketch"');
    expect(index).toContain("sketch: sketchSel.sketch,");
  });
});
