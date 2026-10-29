/**
 * Accessibility semantics, checked at the SOURCE.
 *
 * The suite cannot render the React Native tree (see README), so the
 * rendered accessibility tree cannot be asserted here — that needs React
 * Native Testing Library, and it is still owed
 * (docs/audit/performance-correctness.md). What CAN be enforced without a
 * renderer is the invariant that produces most of that tree: every
 * interactive control declares a role, every control whose appearance
 * carries state declares that state, and anything deliberately hidden from
 * assistive technology says so explicitly rather than by omission.
 *
 * This is a lint in test's clothing, and it exists because the gap it
 * closes was found by counting: 61 `Pressable`s carried 31 roles between
 * them, and whole surfaces — the floating button, the aim confirm bar, the
 * attach panel — had none at all.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "src");

const sourceFiles = readdirSync(SRC)
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => ({ name: f, text: readFileSync(join(SRC, f), "utf8") }));

/**
 * The attribute text of every opening `<Tag`, brace-aware so a `>` inside
 * a `{...}` expression does not end the tag early.
 */
function openingTags(src: string, tag: string): { line: number; attrs: string }[] {
  const out: { line: number; attrs: string }[] = [];
  const needle = `<${tag}`;
  let from = 0;
  for (;;) {
    const start = src.indexOf(needle, from);
    if (start === -1) break;
    let i = start + needle.length;
    let depth = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === "{") depth += 1;
      else if (c === "}") depth -= 1;
      else if (c === ">" && depth === 0) break;
      i += 1;
    }
    out.push({
      line: src.slice(0, start).split("\n").length,
      attrs: src.slice(start + needle.length, i),
    });
    from = i;
  }
  return out;
}

/** Hidden from assistive tech ON PURPOSE — a decision, not an omission. */
function isHidden(attrs: string): boolean {
  return attrs.includes("accessibilityElementsHidden");
}

describe("every interactive control declares a role", () => {
  it("no Pressable is left without a role or an explicit hide", () => {
    const missing: string[] = [];
    for (const { name, text } of sourceFiles) {
      for (const { line, attrs } of openingTags(text, "Pressable")) {
        if (!attrs.includes("accessibilityRole") && !isHidden(attrs)) {
          missing.push(`${name}:${line}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("every Pressable is either labelled or hidden", () => {
    // An unlabelled control is announced as "button" and nothing else.
    const unlabelled: string[] = [];
    for (const { name, text } of sourceFiles) {
      for (const { line, attrs } of openingTags(text, "Pressable")) {
        if (isHidden(attrs)) continue;
        // A row whose only child is text may rely on that text; require a
        // label anywhere the control is an icon or carries state.
        const iconOnly = attrs.includes("hitSlop") || attrs.includes("accessibilityState");
        if (iconOnly && !attrs.includes("accessibilityLabel")) unlabelled.push(`${name}:${line}`);
      }
    }
    expect(unlabelled).toEqual([]);
  });
});

describe("controls whose look carries state also declare it", () => {
  /**
   * A control that can be disabled must say so: the visual signal is a
   * dimmed style, which is invisible to a screen reader, and pressing a
   * dimmed-but-unannounced control is the "nothing happened" bug.
   */
  it("a disabled Pressable declares accessibilityState.disabled", () => {
    const missing: string[] = [];
    for (const { name, text } of sourceFiles) {
      for (const { line, attrs } of openingTags(text, "Pressable")) {
        if (!attrs.includes("disabled=")) continue;
        if (isHidden(attrs)) continue;
        if (!attrs.includes("accessibilityState")) missing.push(`${name}:${line}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("the checker itself", () => {
  // A parser that silently matched nothing would make every test above
  // vacuously true, which is the failure mode of source-level lints.
  it("finds the controls it is supposed to be checking", () => {
    const total = sourceFiles.reduce((n, f) => n + openingTags(f.text, "Pressable").length, 0);
    expect(total).toBeGreaterThan(50);
  });

  it("is brace-aware, so a `>` inside an expression does not end the tag", () => {
    const src = `<Pressable onPress={() => (a > b ? x : y)} accessibilityRole="button" />`;
    const [tag] = openingTags(src, "Pressable");
    expect(tag.attrs).toContain("accessibilityRole");
  });
});
