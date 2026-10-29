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
  it("hands onCapture hosts the shutter that does not need the built-in composer", () => {
    const helpers = source.slice(source.indexOf("buildCaptureHelpers(pendingCapture"));
    const wiring = helpers.slice(0, helpers.indexOf("}),"));
    expect(wiring).toContain("captureScreenshot: shootForHost");
  });
});
