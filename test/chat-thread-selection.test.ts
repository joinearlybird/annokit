/**
 * REGRESSION: THE CHECKBOX HAS TO BE PART OF THE THING YOU CAN PRESS.
 *
 * The bug (product owner, device testing: "the select messages is not
 * working"). Entering selection mode drew a checkbox beside every bubble and
 * made the BUBBLE the press target; the checkbox itself was a plain `View`.
 * So the control that looks exactly like a control did nothing when tapped,
 * and the only way to tick a message was to tap the message — which reads,
 * correctly, as the feature being broken.
 *
 * The fix is structural rather than "add a second onPress": in selection mode
 * the whole ROW (checkbox + bubble) is one `Pressable`, so there is exactly
 * one press target and a dead affordance is not expressible.
 *
 * WHY THIS TEST IS A SOURCE READ. This package has no renderer in its
 * devDependencies and adding one is not on the table, so "is this View
 * pressable" cannot be asserted through a render. It CAN be asserted about
 * the source, which is where the property actually lives: the checkbox must
 * appear inside the selection-mode `Pressable` and nowhere else. That is the
 * exact invariant that broke, so that is what is pinned.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  fileURLToPath(new URL("../src/chat-thread.tsx", import.meta.url)),
  "utf8",
);

/** The selection-mode branch, from its `if` to the closing brace of its return. */
function selectionBranch(source: string): string {
  const start = source.indexOf("if (selecting && onToggle) {");
  expect(start, "the selection-mode branch must still exist").toBeGreaterThan(-1);
  const end = source.indexOf("\n              }", start);
  expect(end, "the selection-mode branch must be closed").toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("selection mode, structurally", () => {
  it("draws the checkbox INSIDE the press target, never beside it", () => {
    const branch = selectionBranch(SOURCE);
    expect(branch).toContain("styles.checkbox");
    expect(branch).toContain("onToggle(message.id)");
    expect(branch).toContain("<Pressable");
  });

  it("has exactly ONE checkbox in the file, and it is that one", () => {
    // A second `styles.checkbox` outside the branch is how the bug comes
    // back: a checkbox drawn as a sibling of whatever is pressable.
    const all = SOURCE.split("styles.checkbox").length - 1;
    const inside = selectionBranch(SOURCE).split("styles.checkbox").length - 1;
    expect(all).toBe(1);
    expect(inside).toBe(1);
  });

  it("keeps the row a checkbox to a screen reader, with its checked state", () => {
    const branch = selectionBranch(SOURCE);
    expect(branch).toContain('accessibilityRole="checkbox"');
    expect(branch).toContain("accessibilityState={{ checked: isPicked }}");
    expect(branch).toContain("messageSelectionLabel(");
  });

  it("still gives every message its positional testID in selection mode", () => {
    // The device automation and the queue's deep links are positional; a
    // selection mode that renumbered them would break both silently.
    expect(selectionBranch(SOURCE)).toContain("testID={`${testIDPrefix}-${index}`}");
  });
});
