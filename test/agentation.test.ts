/**
 * agentation-mcp compat (src/agentation.ts): flavor detection and the two
 * pure wire mappers. Field spellings here mirror what a REAL
 * agentation-mcp@1.2.0 answered during recon
 * (docs/agentation-mcp-wire-recon.md in the platform repo) — these
 * assertions are deliberately literal for the same reason payload.test.ts's
 * are: drift is a protocol break against a server we do not control.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  detectFlavor,
  forgetServerFlavor,
  fromAgentationAnnotation,
  fromAgentationList,
  fromAgentationThreadMessage,
  serverFlavor,
  setServerFlavor,
  toAgentationAnnotation,
} from "../src/agentation";
import { buildAnnotationBody } from "../src/payload";
import type { PendingCapture } from "../src/types";

afterEach(() => forgetServerFlavor());

describe("flavor detection", () => {
  it("a numeric protocolVersion is an AnnoKit Protocol server", () => {
    expect(detectFlavor({ status: "ok", protocolVersion: 1 })).toBe("annokit");
    // Even a version we do NOT speak — whether to enable is the caller's check.
    expect(detectFlavor({ status: "ok", protocolVersion: 99 })).toBe("annokit");
  });

  it("status ok WITHOUT a protocolVersion is agentation-mcp (its live /health body)", () => {
    expect(detectFlavor({ status: "ok" })).toBe("agentation");
  });

  it("anything else is unrecognisable", () => {
    expect(detectFlavor({})).toBeNull();
    expect(detectFlavor({ status: "error" })).toBeNull();
  });

  it('a MALFORMED protocolVersion (string "1") is still our protocol — protocol-aware servers face the version check, never compat', () => {
    expect(detectFlavor({ status: "ok", protocolVersion: "1" })).toBe("annokit");
  });

  it("flavor state defaults to ours and resets to ours", () => {
    expect(serverFlavor()).toBe("annokit");
    setServerFlavor("agentation");
    expect(serverFlavor()).toBe("agentation");
    forgetServerFlavor();
    expect(serverFlavor()).toBe("annokit");
  });
});

const CAPTURE: PendingCapture = {
  x: 120,
  y: 340,
  hit: {
    element: "PrimaryButton",
    componentStack: ["App", "Card", "PrimaryButton"],
    source: { file: "app/src/Card.tsx", line: 4 },
    testID: "card-cta",
    frame: { x: 52, y: 179, width: 62, height: 17 },
    nearbyText: "Get started",
  },
  routeName: "/home",
  screenshotUri: null,
};

describe("outbound: our body → their Annotation", () => {
  it("maps the identity fields onto their spellings", () => {
    const body = buildAnnotationBody(CAPTURE, "make it blue", "our-id");
    const theirs = toAgentationAnnotation(body, 1765700000000);
    expect(theirs).toMatchObject({
      x: 120,
      y: 340,
      comment: "make it blue",
      element: "PrimaryButton",
      // Root-first chain, with the file:line locator folded in — their
      // schema has no `source` slot and elementPath is their locator string.
      elementPath: "App > Card > PrimaryButton (app/src/Card.tsx:4)",
      timestamp: 1765700000000,
      boundingBox: { x: 52, y: 179, width: 62, height: 17 },
      nearbyText: "Get started",
      reactComponents: JSON.stringify(["App", "Card", "PrimaryButton"]),
      url: "app://native/home",
      intent: "change",
    });
  });

  it("never invents fields their schema lacks", () => {
    const body = buildAnnotationBody(CAPTURE, "x", "our-id");
    const theirs = toAgentationAnnotation(body, 1) as unknown as Record<string, unknown>;
    for (const absent of ["id", "kind", "platform", "testID", "scroll", "references", "elements", "source", "routeName"]) {
      expect(theirs).not.toHaveProperty(absent);
    }
  });

  it("summarises area extras into nearbyElements and keeps isMultiSelect", () => {
    const area: PendingCapture = {
      ...CAPTURE,
      extraHits: [
        { element: "Badge", componentStack: ["Badge"], frame: { x: 0, y: 0, width: 5, height: 5 } },
      ],
      areaRect: { x: 10, y: 20, width: 200, height: 100 },
    };
    const theirs = toAgentationAnnotation(buildAnnotationBody(area, "both", "id"), 1);
    expect(theirs.isMultiSelect).toBe(true);
    expect(theirs.boundingBox).toEqual({ x: 10, y: 20, width: 200, height: 100 });
    expect(theirs.nearbyElements).toBe(JSON.stringify(["Badge"]));
  });

  it("routeless captures still satisfy their required url", () => {
    const body = buildAnnotationBody({ ...CAPTURE, routeName: null }, "x", "id");
    expect(toAgentationAnnotation(body, 1).url).toBe("app://native/");
  });
});

describe("inbound: their annotation → our ServerAnnotation", () => {
  // Verbatim shape of a live agentation-mcp answer (nulls and all).
  const THEIRS = {
    id: "mstfc6vj-uyvre2",
    sessionId: "mstfc6ua-5q2735",
    x: 120,
    y: 340,
    comment: "make this blue",
    element: "PrimaryButton",
    elementPath: "App > Card > PrimaryButton",
    timestamp: 1765700000000,
    selectedText: null,
    boundingBox: { x: 52, y: 179, width: 62, height: 17 },
    nearbyText: null,
    computedStyles: null,
    isMultiSelect: false,
    url: "app://native/home",
    status: "pending",
    createdAt: "2026-08-14T20:53:17.647Z",
    thread: [
      { id: "t1", role: "human", content: "actually teal", timestamp: 1765700001000 },
      { id: "t2", role: "agent", content: "done", timestamp: 1765700002000 },
    ],
  };

  it("keeps identity, status and box; recovers our routeName from their url", () => {
    const ours = fromAgentationAnnotation(THEIRS);
    expect(ours).toMatchObject({
      id: "mstfc6vj-uyvre2",
      comment: "make this blue",
      element: "PrimaryButton",
      boundingBox: { x: 52, y: 179, width: 62, height: 17 },
      routeName: "/home",
      status: "pending",
      createdAt: "2026-08-14T20:53:17.647Z",
    });
  });

  it('normalises thread messages: role "human" → "user", ms epoch → ISO', () => {
    const ours = fromAgentationAnnotation(THEIRS);
    expect(ours.thread).toEqual([
      {
        id: "t1",
        role: "user",
        content: "actually teal",
        timestamp: new Date(1765700001000).toISOString(),
      },
      { id: "t2", role: "agent", content: "done", timestamp: new Date(1765700002000).toISOString() },
    ]);
  });

  it("an unrecognised role reads as the human's, and a missing stamp stays absent", () => {
    expect(fromAgentationThreadMessage({ id: "x", role: "robot", content: "hi" })).toEqual({
      id: "x",
      content: "hi",
      role: "user",
      timestamp: undefined,
    });
  });

  it("a url that is not ours stays out of routeName — views must not route by it", () => {
    expect(fromAgentationAnnotation({ ...THEIRS, url: "https://example.com/page" }).routeName).toBeUndefined();
  });

  it("reads both list shapes their routes answer, dropping garbage rows", () => {
    expect(fromAgentationList({ count: 1, annotations: [THEIRS, null, "junk", {}] })).toHaveLength(1);
    expect(fromAgentationList([THEIRS])).toHaveLength(1);
    expect(fromAgentationList("garbage")).toEqual([]);
  });
});
