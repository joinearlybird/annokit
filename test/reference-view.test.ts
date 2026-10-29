/**
 * How references are shown (src/reference-view.ts).
 *
 * The panes used to print every reference as one line, which for a
 * screenshot meant showing a presigned URL nobody can read — the least
 * useful rendering of the one attachment whose whole value is being looked
 * at. These are the rules that decide which is which.
 */

import { describe, expect, it } from "vitest";
import type { AnnotationReference } from "../src/attachments";
import {
  isOpenableLink,
  openableA11yLabel,
  isViewableScreenshot,
  pictureUrl,
  referenceLine,
  screenshotA11yLabel,
  splitReferences,
} from "../src/reference-view";

const shot = (value: string, label?: string): AnnotationReference => ({
  type: "screenshot",
  value,
  ...(label === undefined ? {} : { label }),
});

describe("isViewableScreenshot", () => {
  it("accepts the presigned URL the protocol grants", () => {
    expect(isViewableScreenshot(shot("https://cdn.example/s/abc?sig=1"))).toBe(true);
    expect(isViewableScreenshot(shot("http://localhost:4788/uploads/a.png"))).toBe(true);
  });

  it("decides on TYPE, not on the URL looking like an image", () => {
    // An asset may well be a PNG, but the protocol says it is a pointer the
    // agent embeds in code — not a thing to display here.
    const asset: AnnotationReference = {
      type: "asset",
      value: "https://cdn.example/api/assets/logo.png",
    };
    expect(isViewableScreenshot(asset)).toBe(false);
  });

  it("refuses values it cannot put in an <Image>", () => {
    // A relative path, or a file:// left over from a client that should not
    // have sent one: the protocol grants an http(s) URL.
    expect(isViewableScreenshot(shot("/uploads/a.png"))).toBe(false);
    expect(isViewableScreenshot(shot("file:///var/tmp/a.png"))).toBe(false);
    expect(isViewableScreenshot(shot(""))).toBe(false);
    expect(isViewableScreenshot(shot("   "))).toBe(false);
  });

  it("is not fooled by a scheme hidden mid-string", () => {
    expect(isViewableScreenshot(shot("javascript:alert(1)//https://x"))).toBe(false);
    expect(isViewableScreenshot(shot(" data:image/png;base64,AAAA"))).toBe(false);
  });

  it("tolerates surrounding whitespace on an otherwise good URL", () => {
    expect(isViewableScreenshot(shot("  https://cdn.example/a.png  "))).toBe(true);
  });
});

describe("referenceLine", () => {
  it("prefers the server's label — it was written for a human", () => {
    expect(referenceLine({ type: "api", value: "GET /api/data/todos", label: "Todos" })).toBe(
      "api: Todos",
    );
  });

  it("falls back to the value when there is no label", () => {
    expect(referenceLine({ type: "url", value: "https://example.com" })).toBe(
      "url: https://example.com",
    );
  });

  it("does not print an empty label", () => {
    expect(referenceLine({ type: "url", value: "https://example.com", label: "   " })).toBe(
      "url: https://example.com",
    );
  });
});

describe("splitReferences", () => {
  it("draws the pictures and lists the rest, server order within each", () => {
    const refs: AnnotationReference[] = [
      { type: "api", value: "GET /api/data/todos" },
      shot("https://cdn.example/1.png"),
      { type: "asset", value: "/api/assets/logo.png" },
      shot("https://cdn.example/2.png"),
    ];
    const { screenshots, lines } = splitReferences(refs);
    expect(screenshots.map((r) => r.value)).toEqual([
      "https://cdn.example/1.png",
      "https://cdn.example/2.png",
    ]);
    expect(lines.map((r) => r.type)).toEqual(["api", "asset"]);
  });

  it("lists a screenshot it cannot display rather than dropping it", () => {
    // Losing it silently would hide that something IS attached.
    const { screenshots, lines } = splitReferences([shot("/uploads/a.png")]);
    expect(screenshots).toEqual([]);
    expect(lines).toHaveLength(1);
  });

  it("survives absent, empty and malformed entries", () => {
    expect(splitReferences(undefined)).toEqual({ screenshots: [], lines: [] });
    expect(splitReferences([])).toEqual({ screenshots: [], lines: [] });
    const junk = [null, undefined, { value: "x" }] as unknown as AnnotationReference[];
    expect(splitReferences(junk)).toEqual({ screenshots: [], lines: [] });
  });
});

describe("screenshotA11yLabel", () => {
  it("uses the server's label when there is one", () => {
    expect(screenshotA11yLabel(shot("https://x/a.png", "Home screen"))).toBe(
      "Screenshot: Home screen. Open it full size",
    );
  });

  it("still says what it is, and that it opens", () => {
    expect(screenshotA11yLabel(shot("https://x/a.png"))).toBe("Screenshot — open it full size");
  });
});

describe("isOpenableLink", () => {
  it("opens a pull request or a diff — the result a worktree run leaves behind", () => {
    expect(isOpenableLink({ type: "url", value: "https://github.com/o/r/pull/7" })).toBe(true);
    expect(isOpenableLink({ type: "url", value: "http://localhost:4788/annotations/d1/diff" })).toBe(true);
  });

  it("leaves screenshots alone — they are drawn, and tapping opens the viewer", () => {
    // Sending one out to a browser would be a downgrade, not a feature.
    expect(isOpenableLink({ type: "screenshot", value: "https://cdn.example/a.png" })).toBe(false);
  });

  it("will not offer to open what a browser cannot reach", () => {
    for (const value of ["annokit/d1", "file:///tmp/x.patch", "", "   ", "javascript:alert(1)"]) {
      expect(isOpenableLink({ type: "branch", value }), value).toBe(false);
    }
  });

  it("says what it is opening, for a screen reader", () => {
    expect(openableA11yLabel({ type: "url", value: "https://x.dev", label: "Diff — 1 file" }))
      .toBe("Open Diff — 1 file in your browser");
    // No label: the type is the only honest name for it.
    expect(openableA11yLabel({ type: "url", value: "https://x.dev" })).toBe("Open url in your browser");
  });
});

describe("images that are assets", () => {
  it("draws an asset with an image preview, as it draws a screenshot", () => {
    const img = { type: "asset", value: "assets/uploads/pasted.png", label: "pasted.png", preview: "http://localhost:4788/assets/raw/uploads/pasted.png" };
    const font = { type: "asset", value: "assets/fonts/Inter.ttf", label: "Inter.ttf" };
    expect(pictureUrl(img)).toBe(img.preview);
    expect(pictureUrl(font)).toBeNull();
    expect(pictureUrl({ ...img, preview: "javascript:alert(1)" })).toBeNull();
    const { screenshots, lines } = splitReferences([font, img]);
    expect(screenshots).toEqual([img]);
    expect(lines).toEqual([font]);
    expect(screenshotA11yLabel(img)).toBe("Image: pasted.png. Open it full size");
  });
});
