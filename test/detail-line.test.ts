/**
 * The detail header's second line (src/detail-line.ts).
 *
 * The header the product owner sent back was three stacked lines that said
 * the element name twice and the route as a bare "/". What replaced it is
 * two lines — the kind + the element, then THIS: where it lives, once. The
 * cases that matter are the missing ones, because a server is free to have
 * kept neither field and the old header still drew its separator.
 */

import { describe, expect, it } from "vitest";
import {
  detailContextLabel,
  detailContextLine,
  routeDisplay,
  sourceRef,
} from "../src/detail-line";

describe("a route, as a person reads it", () => {
  it("calls the root Home — a lone slash reads as a stray separator", () => {
    expect(routeDisplay("/")).toBe("Home");
  });

  it("leaves every other pathname alone, because it already looks like one", () => {
    expect(routeDisplay("/settings")).toBe("/settings");
    expect(routeDisplay("/users/7")).toBe("/users/7");
  });

  it("is empty for a capture with no route, so callers can drop the line", () => {
    expect(routeDisplay(null)).toBe("");
    expect(routeDisplay(undefined)).toBe("");
    expect(routeDisplay("   ")).toBe("");
  });
});

describe("the source reference", () => {
  it("is the file and the line, which is what a developer navigates by", () => {
    expect(sourceRef({ file: "app/src/components/FeedRow.tsx", line: 9 })).toBe(
      "app/src/components/FeedRow.tsx:9",
    );
  });

  it("survives a server that kept the file but not a usable line", () => {
    expect(sourceRef({ file: "app/src/FeedRow.tsx", line: NaN })).toBe("app/src/FeedRow.tsx");
  });

  it("is empty when there is no file at all", () => {
    expect(sourceRef(null)).toBe("");
    expect(sourceRef(undefined)).toBe("");
    expect(sourceRef({ file: "  ", line: 3 })).toBe("");
  });
});

describe("the context line", () => {
  const source = { file: "app/src/components/FeedRow.tsx", line: 9 };

  it("is the source then the screen, and never the element name again", () => {
    expect(detailContextLine({ source, routeName: "/" })).toBe(
      "app/src/components/FeedRow.tsx:9 · Home",
    );
    // The element is on the line above; repeating it was the duplication
    // the owner flagged.
    expect(detailContextLine({ source, routeName: "/" })).not.toContain("FeedRow ·");
  });

  it("degrades to whichever half exists", () => {
    expect(detailContextLine({ source })).toBe("app/src/components/FeedRow.tsx:9");
    expect(detailContextLine({ routeName: "/settings" })).toBe("/settings");
  });

  it("is EMPTY when there is neither — no lonely separator", () => {
    expect(detailContextLine({})).toBe("");
    expect(detailContextLine({ source: null, routeName: "" })).toBe("");
    expect(detailContextLine({})).not.toContain("·");
  });

  it("reads as a phrase aloud, not as punctuation", () => {
    expect(detailContextLabel({ source, routeName: "/" })).toBe(
      "from app/src/components/FeedRow.tsx:9, on Home",
    );
    expect(detailContextLabel({ routeName: "/settings" })).toBe("on /settings");
    expect(detailContextLabel({})).toBe("");
  });
});
