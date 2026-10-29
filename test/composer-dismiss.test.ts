/**
 * The composer cannot be dismissed while it is sending — checked at the
 * SOURCE, because the suite cannot render the RN tree (see
 * test/accessibility.test.ts).
 *
 * Dismissing mid-send released the screenshot the upload was still reading,
 * and the send's late success then closed whichever composer was open by
 * then. Every dismiss path must go through the guarded `dismiss`, and every
 * await in submit must check the sheet is still mounted before acting.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(__dirname, "..", "src", "composer.tsx"), "utf8");

describe("composer dismissal while sending", () => {
  it("routes the close button and Android back through the guard", () => {
    expect(source).not.toMatch(/onPress=\{onCancel\}/);
    expect(source).not.toMatch(/onRequestClose=\{onCancel\}/);
    expect(source).toMatch(/const dismiss = \(\) => \{\s*if \(!submitting\) onCancel\(\);/);
    expect(source).toContain("onRequestClose={requestClose}");
  });

  it("acts on a send's result only while the sheet is still mounted", () => {
    const submit = source.slice(source.indexOf("const submit = async"), source.indexOf("return (\n    /*"));
    // Every awaited call: the two sends, and the pasted-image upload before them.
    const awaits = submit.match(/await \w+\(/g) ?? [];
    const guards = submit.match(/if \(!mounted\.current\) return;/g) ?? [];
    expect(awaits.length).toBeGreaterThan(0);
    expect(guards).toHaveLength(awaits.length);
  });
});
