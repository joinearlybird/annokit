/**
 * Content bounds (src/limits.ts).
 *
 * These are not a security control — a server must enforce its own — but
 * they are the two things a client owns: telling the user before they lose
 * work, and refusing to let a hostile or broken server grow the overlay's
 * memory without limit.
 */

import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_ITEMS_MAX,
  AUTHOR_NAME_MAX,
  clampList,
  clampText,
  FIELD_MAX,
  REFERENCES_MAX,
  TEXT_MAX,
  withinLimit,
} from "../src/limits";

describe("clampText", () => {
  it("leaves anything within the limit untouched, identically", () => {
    const s = "make the button blue";
    expect(clampText(s, TEXT_MAX)).toBe(s);
  });

  it("cuts an over-long string to the limit", () => {
    expect(clampText("x".repeat(5_000), TEXT_MAX)).toHaveLength(TEXT_MAX);
  });

  it("counts by code point, so a surrogate pair is never split", () => {
    // Truncating by code UNIT here would leave a lone surrogate — which
    // becomes a replacement character or a JSON encoding error downstream.
    const emoji = "👍".repeat(10);
    const cut = clampText(emoji, 5);
    expect(Array.from(cut)).toHaveLength(5);
    expect(cut).toBe("👍".repeat(5));
    expect(cut.includes("�")).toBe(false);
  });

  it("handles an empty string and a zero limit", () => {
    expect(clampText("", TEXT_MAX)).toBe("");
    expect(clampText("abc", 0)).toBe("");
  });
});

describe("clampList", () => {
  it("returns the SAME array when nothing is dropped", () => {
    // Identity matters: callers keep their re-render checks.
    const items = [1, 2, 3];
    expect(clampList(items, 10)).toBe(items);
  });

  it("takes the first N when there are too many", () => {
    const items = Array.from({ length: 500 }, (_, i) => i);
    const cut = clampList(items, ATTACHMENT_ITEMS_MAX);
    expect(cut).toHaveLength(ATTACHMENT_ITEMS_MAX);
    expect(cut[0]).toBe(0);
    expect(cut[ATTACHMENT_ITEMS_MAX - 1]).toBe(ATTACHMENT_ITEMS_MAX - 1);
  });

  it("is exact at the boundary", () => {
    const items = Array.from({ length: REFERENCES_MAX }, (_, i) => i);
    expect(clampList(items, REFERENCES_MAX)).toBe(items);
    expect(clampList([...items, 999], REFERENCES_MAX)).toHaveLength(REFERENCES_MAX);
  });

  it("handles an empty list", () => {
    const empty: number[] = [];
    expect(clampList(empty, 10)).toBe(empty);
  });
});

describe("withinLimit", () => {
  it("measures by code point like clampText does", () => {
    expect(withinLimit("👍👍👍", 3)).toBe(true);
    expect(withinLimit("👍👍👍", 2)).toBe(false);
  });

  it("accepts the exact boundary", () => {
    expect(withinLimit("a".repeat(AUTHOR_NAME_MAX), AUTHOR_NAME_MAX)).toBe(true);
    expect(withinLimit("a".repeat(AUTHOR_NAME_MAX + 1), AUTHOR_NAME_MAX)).toBe(false);
  });
});

describe("the limits themselves", () => {
  it("are generous enough not to pinch real use", () => {
    // The point of the cap is that it exists, not that it bites: a change
    // request is a sentence or two.
    expect(TEXT_MAX).toBeGreaterThanOrEqual(1_000);
    expect(FIELD_MAX).toBeGreaterThanOrEqual(500);
    expect(REFERENCES_MAX).toBeGreaterThanOrEqual(10);
  });
});
