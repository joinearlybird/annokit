/**
 * Annotation payload (src/payload.ts) — the exact POST body documented in
 * README.md "AnnoKit Protocol v1 › Annotations". This is what the
 * fe-sandbox DO validates, so any drift here is a real protocol break.
 */

import { describe, expect, it } from "vitest";
import type { InspectorHit } from "../src/inspector";
import { applyOutputDetail, buildAnnotationBody } from "../src/payload";
import type { PendingCapture } from "../src/types";

const HIT: InspectorHit = {
  element: "PrimaryButton",
  componentStack: ["HomeScreen", "Card", "PrimaryButton"],
  frame: { x: 52, y: 179.7, width: 62, height: 17 },
  testID: "card-cta",
  nearbyText: "Get started",
  source: { file: "app/src/Card.tsx", line: 4 },
};

const CAPTURE: PendingCapture = {
  x: 120,
  y: 340,
  hit: HIT,
  routeName: "/home",
  screenshotUri: "file:///tmp/shot.png",
};

/** What the wire actually carries (undefined fields vanish in JSON). */
function wire(body: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
}

describe("buildAnnotationBody — documented v1 body", () => {
  it("matches the README example field-for-field", () => {
    const body = buildAnnotationBody(CAPTURE, "Make this button green", "3f1c-uuid");
    expect(wire(body)).toEqual({
      id: "3f1c-uuid",
      comment: "Make this button green",
      kind: "feedback",
      platform: "native",
      element: "PrimaryButton",
      componentStack: ["HomeScreen", "Card", "PrimaryButton"],
      source: { file: "app/src/Card.tsx", line: 4 },
      testID: "card-cta",
      routeName: "/home",
      x: 120,
      y: 340,
      boundingBox: { x: 52, y: 179.7, width: 62, height: 17 },
      nearbyText: "Get started",
      scroll: { offsetY: 0 },
    });
  });

  it("pins the constant discriminators (kind/platform)", () => {
    const body = buildAnnotationBody(CAPTURE, "x", "id-1");
    expect(body.kind).toBe("feedback");
    expect(body.platform).toBe("native");
  });

  it("uses the client-generated id verbatim (screenshot upload races on it)", () => {
    expect(buildAnnotationBody(CAPTURE, "x", "abc-123").id).toBe("abc-123");
  });

  it("componentStack is root→leaf, ending at the annotated element", () => {
    const body = buildAnnotationBody(CAPTURE, "x", "id-1");
    expect(body.componentStack[body.componentStack.length - 1]).toBe(body.element);
  });

  it("boundingBox is the touched view frame, x/y is the tap point", () => {
    const body = buildAnnotationBody(CAPTURE, "x", "id-1");
    expect(body.boundingBox).toEqual({ x: 52, y: 179.7, width: 62, height: 17 });
    expect({ x: body.x, y: body.y }).toEqual({ x: 120, y: 340 });
  });
});

describe("buildAnnotationBody — scroll offset", () => {
  it("carries the owning container's measured offset and tag", () => {
    const body = buildAnnotationBody(
      { ...CAPTURE, hit: { ...HIT, scroll: { scrollViewTag: 42, offsetY: 480 } } },
      "note",
      "id-s1",
    );
    expect(body.scroll).toEqual({ scrollViewTag: 42, offsetY: 480 });
  });

  it("passes offsetX through when the container scrolls horizontally", () => {
    const body = buildAnnotationBody(
      { ...CAPTURE, hit: { ...HIT, scroll: { scrollViewTag: 7, offsetY: 0, offsetX: 240 } } },
      "note",
      "id-s2",
    );
    expect(body.scroll).toEqual({ scrollViewTag: 7, offsetY: 0, offsetX: 240 });
  });

  it("degrades to offsetY 0 when no offset was resolvable (no container, or unreadable)", () => {
    expect(buildAnnotationBody(CAPTURE, "note", "id-s3").scroll).toEqual({ offsetY: 0 });
    expect(
      buildAnnotationBody({ ...CAPTURE, hit: null }, "note", "id-s4").scroll,
    ).toEqual({ offsetY: 0 });
  });

  it("always sends a scroll object (offsetY is required by the protocol)", () => {
    const sent = wire(buildAnnotationBody({ ...CAPTURE, hit: null }, "note", "id-s5"));
    expect(sent.scroll).toEqual({ offsetY: 0 });
  });
});

describe("buildAnnotationBody — references (attach panel)", () => {
  const ASSET_REF = {
    type: "asset" as const,
    value: "/api/assets/brand/logo.png",
    label: "logo.png",
  };
  const API_REF = {
    type: "api" as const,
    value: "POST /api/data/todos",
    label: "Todos — Add new entries",
  };

  it("carries the picked references verbatim alongside the documented fields", () => {
    const sent = wire(buildAnnotationBody(CAPTURE, "use this", "id-r1", [ASSET_REF, API_REF]));
    expect(sent.references).toEqual([ASSET_REF, API_REF]);
    // The rest of the contract is untouched by attaching.
    expect(sent.kind).toBe("feedback");
    expect(sent.platform).toBe("native");
    expect(sent.element).toBe("PrimaryButton");
  });

  it("OMITS references entirely when nothing was attached", () => {
    // Not `[]`: a server that PATCHes references wholesale would read an
    // empty array as "the user cleared them".
    expect("references" in wire(buildAnnotationBody(CAPTURE, "x", "id-r2"))).toBe(false);
    expect("references" in wire(buildAnnotationBody(CAPTURE, "x", "id-r3", []))).toBe(false);
  });

  it("never sends a screenshot reference (the server appends that on upload)", () => {
    const body = buildAnnotationBody(CAPTURE, "x", "id-r4", [ASSET_REF]);
    expect(body.references?.some((r) => r.type === "screenshot")).toBe(false);
  });

  it("attaches to a degraded capture too (hit-test found nothing)", () => {
    const sent = wire(
      buildAnnotationBody(
        { x: 1, y: 2, hit: null, routeName: null, screenshotUri: null },
        "just this API",
        "id-r5",
        [API_REF],
      ),
    );
    expect(sent).toEqual({
      id: "id-r5",
      comment: "just this API",
      kind: "feedback",
      platform: "native",
      element: "Screen",
      componentStack: [],
      x: 1,
      y: 2,
      boundingBox: { x: 1, y: 2, width: 0, height: 0 },
      scroll: { offsetY: 0 },
      references: [API_REF],
    });
  });
});

describe("buildAnnotationBody — degraded captures", () => {
  it('falls back to element "Screen" + a zero-size box at the tap point when the hit-test found nothing', () => {
    const body = buildAnnotationBody(
      { x: 10, y: 20, hit: null, routeName: "/settings", screenshotUri: null },
      "position-only note",
      "id-2",
    );
    expect(wire(body)).toEqual({
      id: "id-2",
      comment: "position-only note",
      kind: "feedback",
      platform: "native",
      element: "Screen",
      componentStack: [],
      routeName: "/settings",
      x: 10,
      y: 20,
      boundingBox: { x: 10, y: 20, width: 0, height: 0 },
      scroll: { offsetY: 0 },
    });
  });

  it("omits optional identity fields rather than sending nulls", () => {
    const bareHit: InspectorHit = {
      element: "Card",
      componentStack: ["Card"],
      frame: { x: 0, y: 0, width: 10, height: 10 },
    };
    const body = buildAnnotationBody(
      { x: 1, y: 2, hit: bareHit, routeName: null, screenshotUri: null },
      "note",
      "id-3",
    );
    const sent = wire(body);
    expect(Object.keys(sent).sort()).toEqual(
      ["boundingBox", "comment", "componentStack", "element", "id", "kind", "platform", "scroll", "x", "y"].sort(),
    );
    expect("testID" in sent).toBe(false);
    expect("source" in sent).toBe(false);
    expect("routeName" in sent).toBe(false);
    expect("nearbyText" in sent).toBe(false);
  });

  it("never invents a routeName when expo-router is absent", () => {
    const body = buildAnnotationBody({ ...CAPTURE, routeName: null }, "note", "id-4");
    expect(body.routeName).toBeUndefined();
  });

  it("carries the comment through exactly as given (caller trims)", () => {
    expect(buildAnnotationBody(CAPTURE, "keep  inner   spacing", "id-5").comment).toBe(
      "keep  inner   spacing",
    );
  });
});

describe("buildAnnotationBody — styles + accessibility (capture enrichment)", () => {
  it("serializes both as compact JSON under the web overlay's wire names", () => {
    const capture: PendingCapture = {
      ...CAPTURE,
      hit: {
        ...HIT,
        styles: { backgroundColor: "#888", opacity: 0.4 },
        accessibility: { label: "Get started", role: "button", state: { disabled: true } },
      },
    };
    const body = wire(buildAnnotationBody(capture, "why is this gray?", "a9"));
    // Strings, not objects: `StoredAnnotation.computedStyles` and
    // `.accessibility` have been string fields since the web overlay's
    // schema — reusing them is what makes this a zero-server-change field.
    expect(body.computedStyles).toBe('{"backgroundColor":"#888","opacity":0.4}');
    expect(body.accessibility).toBe(
      '{"label":"Get started","role":"button","state":{"disabled":true}}',
    );
  });

  it("omits both when the hit carries none — absent, never empty strings", () => {
    const body = wire(buildAnnotationBody(CAPTURE, "hi", "a10"));
    expect("computedStyles" in body).toBe(false);
    expect("accessibility" in body).toBe(false);
  });

  it("omits empty objects too", () => {
    const capture: PendingCapture = {
      ...CAPTURE,
      hit: { ...HIT, styles: {}, accessibility: {} as never },
    };
    const body = wire(buildAnnotationBody(capture, "hi", "a11"));
    expect("computedStyles" in body).toBe(false);
    expect("accessibility" in body).toBe(false);
  });
});

describe("buildAnnotationBody — multi-select (elements[])", () => {
  const EXTRA: InspectorHit = {
    element: "SecondaryButton",
    componentStack: ["HomeScreen", "Card", "SecondaryButton"],
    frame: { x: 52, y: 220, width: 62, height: 17 },
    testID: "card-alt",
    nearbyText: "Learn more",
    source: { file: "app/src/Card.tsx", line: 9 },
  };

  it("sends isMultiSelect + every element, primary first", () => {
    const body = wire(
      buildAnnotationBody({ ...CAPTURE, extraHits: [EXTRA] }, "make these match", "m1"),
    );
    expect(body.isMultiSelect).toBe(true);
    expect(body.elements).toEqual([
      {
        element: "PrimaryButton",
        componentStack: ["HomeScreen", "Card", "PrimaryButton"],
        source: { file: "app/src/Card.tsx", line: 4 },
        testID: "card-cta",
        boundingBox: { x: 52, y: 179.7, width: 62, height: 17 },
        nearbyText: "Get started",
      },
      {
        element: "SecondaryButton",
        componentStack: ["HomeScreen", "Card", "SecondaryButton"],
        source: { file: "app/src/Card.tsx", line: 9 },
        testID: "card-alt",
        boundingBox: { x: 52, y: 220, width: 62, height: 17 },
        nearbyText: "Learn more",
      },
    ]);
    // The top-level identity is still the primary — markers and the queue
    // row read one element, multi or not.
    expect(body.element).toBe("PrimaryButton");
  });

  it("omits both fields for the everyday single-element capture", () => {
    const body = wire(buildAnnotationBody(CAPTURE, "hi", "m2"));
    expect("isMultiSelect" in body).toBe(false);
    expect("elements" in body).toBe(false);
    const empty = wire(buildAnnotationBody({ ...CAPTURE, extraHits: [] }, "hi", "m3"));
    expect("isMultiSelect" in empty).toBe(false);
  });

  it("drops extras when the primary hit is missing — never promotes them", () => {
    const body = wire(buildAnnotationBody({ ...CAPTURE, hit: null, extraHits: [EXTRA] }, "hi", "m4"));
    expect("isMultiSelect" in body).toBe(false);
    expect("elements" in body).toBe(false);
  });

  it("output detail trims per element too — same judgment, every element", () => {
    const full = buildAnnotationBody({ ...CAPTURE, extraHits: [EXTRA] }, "hi", "m5");
    const standard = applyOutputDetail(full, "standard");
    for (const e of standard.elements ?? []) {
      expect(e.componentStack).toEqual([]);
      // Kept, like the body's: every element keeps its own words.
      expect(e.nearbyText).toBeTruthy();
      expect(e.source).toBeDefined();
      expect(e.testID).toBeDefined();
      expect(e.element).toBeTruthy();
      expect(e.boundingBox).toBeDefined();
    }
    const minimal = applyOutputDetail(full, "minimal");
    for (const e of minimal.elements ?? []) {
      // The privacy floor holds per element too. If only the primary were
      // stripped, a multi-select would ship the extras' on-screen text at a
      // level whose whole promise is that none leaves the device.
      expect(e.nearbyText).toBeUndefined();
      expect(e.source).toBeUndefined();
      expect(e.testID).toBeUndefined();
      expect(e.element).toBeTruthy();
      expect(e.boundingBox).toBeDefined();
    }
    expect(minimal.isMultiSelect).toBe(true);
  });
});

describe("buildAnnotationBody — area capture", () => {
  const RECT = { x: 40, y: 300, width: 240, height: 160 };

  it("the drawn rectangle IS the boundingBox, whatever was sampled inside", () => {
    const body = wire(
      buildAnnotationBody(
        { ...CAPTURE, x: 160, y: 380, areaRect: RECT },
        "tighten this section",
        "ar1",
      ),
    );
    expect(body.boundingBox).toEqual(RECT);
    // The sampled primary element still names the annotation.
    expect(body.element).toBe("PrimaryButton");
  });

  it("an area over empty space is honest: element 'Area', box kept", () => {
    const body = wire(
      buildAnnotationBody(
        { ...CAPTURE, hit: null, areaRect: RECT, x: 160, y: 380 },
        "something is missing here",
        "ar2",
      ),
    );
    expect(body.element).toBe("Area");
    expect(body.boundingBox).toEqual(RECT);
    // No hit ⇒ protocol-required stack goes empty, scroll falls back.
    expect(body.componentStack).toEqual([]);
    expect(body.scroll).toEqual({ offsetY: 0 });
  });

  it("a tap that found nothing still says 'Screen', not 'Area'", () => {
    const body = wire(buildAnnotationBody({ ...CAPTURE, hit: null }, "hi", "ar3"));
    expect(body.element).toBe("Screen");
  });

  it("sampled extras ride as elements[], multi-style", () => {
    const extra: InspectorHit = {
      element: "Badge",
      componentStack: ["HomeScreen", "Badge"],
      frame: { x: 60, y: 320, width: 40, height: 16 },
    };
    const body = wire(
      buildAnnotationBody(
        { ...CAPTURE, areaRect: RECT, extraHits: [extra] },
        "align these",
        "ar4",
      ),
    );
    expect(body.isMultiSelect).toBe(true);
    expect((body.elements as unknown[]).length).toBe(2);
    expect(body.boundingBox).toEqual(RECT);
  });
});

describe("output detail — how much of it actually goes", () => {
  const capture = {
    x: 10,
    y: 20,
    routeName: "/feed",
    screenshotUri: null,
    hit: {
      element: "FeedRow",
      componentStack: ["Screen", "FeedList", "FeedRow"],
      source: { file: "app/feed.tsx", line: 12 },
      testID: "feed-row-1",
      nearbyText: "Row 1 — annotate me",
      frame: { x: 0, y: 0, width: 100, height: 40 },
      scroll: { offsetY: 120 },
      styles: { backgroundColor: "#888" },
      accessibility: { label: "Row 1" },
    },
  } as unknown as Parameters<typeof buildAnnotationBody>[0];

  const full = () => buildAnnotationBody(capture, "make it blue", "a1");

  it("sends everything at Full", () => {
    const body = applyOutputDetail(full(), "full");
    expect(body.componentStack).toEqual(["Screen", "FeedList", "FeedRow"]);
    expect(body.nearbyText).toBe("Row 1 — annotate me");
    expect(body.source).toEqual({ file: "app/feed.tsx", line: 12 });
    expect(body.testID).toBe("feed-row-1");
    expect(body.computedStyles).toBe('{"backgroundColor":"#888"}');
    expect(body.accessibility).toBe('{"label":"Row 1"}');
  });

  it("keeps nearby text but drops the stack, styles and accessibility at Standard", () => {
    // What a developer needs to find the line stays — and that includes the
    // rendered text. `source` names where a component is DEFINED; the words
    // on it come from where it is USED, so the text is what says WHICH one
    // was meant and is a search key that lands on the call site. The
    // appearance fields still go: styles are the most app-revealing thing we
    // capture. This is the default.
    const body = applyOutputDetail(full(), "standard");
    expect(body.componentStack).toEqual([]);
    expect(body.nearbyText).toBe("Row 1 — annotate me");
    expect(body.computedStyles).toBeUndefined();
    expect(body.accessibility).toBeUndefined();
    expect(body.source).toEqual({ file: "app/feed.tsx", line: 12 });
    expect(body.testID).toBe("feed-row-1");
  });

  it("drops the source and the testID too at Minimal", () => {
    const body = applyOutputDetail(full(), "minimal");
    expect(body.componentStack).toEqual([]);
    expect(body.nearbyText).toBeUndefined();
    expect(body.computedStyles).toBeUndefined();
    expect(body.accessibility).toBeUndefined();
    expect(body.source).toBeUndefined();
    expect(body.testID).toBeUndefined();
  });

  it("never drops what makes the task findable", () => {
    // An annotation nobody can locate is not a lighter annotation.
    for (const detail of ["minimal", "standard", "full"] as const) {
      const body = applyOutputDetail(full(), detail);
      expect(body.id).toBe("a1");
      expect(body.comment).toBe("make it blue");
      expect(body.kind).toBe("feedback");
      expect(body.platform).toBe("native");
      expect(body.routeName).toBe("/feed");
      expect(body.x).toBe(10);
      expect(body.y).toBe(20);
      expect(body.boundingBox).toEqual({ x: 0, y: 0, width: 100, height: 40 });
      expect(body.scroll).toEqual({ offsetY: 120 });
      // The label every marker, row and header reads.
      expect(body.element).toBe("FeedRow");
    }
  });

  it("leaves the attachments alone at every level", () => {
    const refs = [{ type: "asset", path: "a.png" }] as never;
    for (const detail of ["minimal", "standard", "full"] as const) {
      const body = applyOutputDetail(
        buildAnnotationBody(capture, "hi", "a2", refs),
        detail,
      );
      expect(body.references).toEqual(refs);
    }
  });
});
