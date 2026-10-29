/**
 * The host app's tree must not change shape when the overlay changes state.
 *
 * Checked at the SOURCE, like test/accessibility.test.ts, because the suite
 * cannot render the React Native tree. The invariant: once the runtime is
 * mounted, every state (handshake pending, live, hidden until restart,
 * endpoint switching) renders `children` under the SAME element types.
 * Returning bare `children` on one path and the wrapped tree on another
 * makes React remount the entire host app at each transition — which is
 * what happened on every dev cold start until the runtime was fixed.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(__dirname, "..", "src", "index.tsx"), "utf8");

function body(name: string): string {
  const start = source.indexOf(`function ${name}(`);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  const next = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

describe("tree stability", () => {
  it("AnnoKitRuntime never renders bare children on a side path", () => {
    const runtime = body("AnnoKitRuntime");
    expect(runtime).not.toMatch(/return\s*<>\s*\{children\}\s*<\/>/);
    // One render: the wrapped tree, with only the chrome depending on state.
    expect(runtime.match(/^  return \(/gm)).toHaveLength(1);
  });

  it("the capture root and push layer stay mounted while the overlay is not live", () => {
    const runtime = body("AnnoKitRuntime");
    expect(runtime).toContain("armed={armed && live}");
    expect(runtime).toMatch(/translateY: live \? pushAnim : 0/);
  });
});
