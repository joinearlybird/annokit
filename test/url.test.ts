/** URL construction (src/url.ts): route joining, encoding, capability queries. */

import { describe, expect, it } from "vitest";
import {
  annotationScreenshotPath,
  joinUrl,
  originOf,
  query,
  seg,
  sessionAnnotationsPath,
  sessionEventsPath,
  sameOrigin,
  sessionPendingPath,
} from "../src/url";

describe("joinUrl", () => {
  it("appends a route to a plain endpoint", () => {
    expect(joinUrl("https://h.dev/agentation", "/health")).toBe("https://h.dev/agentation/health");
  });

  it("collapses a trailing slash on the endpoint", () => {
    expect(joinUrl("https://h.dev/agentation/", "/health")).toBe("https://h.dev/agentation/health");
    expect(joinUrl("https://h.dev///", "/health")).toBe("https://h.dev/health");
  });

  it("tolerates a route without a leading slash", () => {
    expect(joinUrl("https://h.dev/base", "health")).toBe("https://h.dev/base/health");
  });

  // THE BUG THIS MODULE EXISTS FOR: concatenation put the route inside the
  // capability query value, so the server saw a request for /cap.
  it("keeps a capability query on the endpoint and puts the route on the path", () => {
    expect(joinUrl("https://h.dev/cap?k=hunter2", "/health")).toBe(
      "https://h.dev/cap/health?k=hunter2",
    );
  });

  it("merges the endpoint query with the route's own", () => {
    expect(joinUrl("https://h.dev/cap?k=hunter2", "/comments?routeName=%2Ffeed")).toBe(
      "https://h.dev/cap/comments?k=hunter2&routeName=%2Ffeed",
    );
  });

  it("drops fragments from both sides — they are never sent", () => {
    expect(joinUrl("https://h.dev/cap#frag", "/health")).toBe("https://h.dev/cap/health");
    expect(joinUrl("https://h.dev/cap", "/health#frag")).toBe("https://h.dev/cap/health");
    expect(joinUrl("https://h.dev/cap?k=1#frag", "/health")).toBe("https://h.dev/cap/health?k=1");
  });

  it("preserves userinfo and IPv6 authorities untouched", () => {
    expect(joinUrl("https://user:pass@h.dev/cap", "/health")).toBe(
      "https://user:pass@h.dev/cap/health",
    );
    expect(joinUrl("http://[::1]:4788", "/health")).toBe("http://[::1]:4788/health");
  });

  it("fails soft on a blank endpoint rather than throwing into the app", () => {
    expect(joinUrl("", "/health")).toBe("/health");
    expect(joinUrl("   ", "/health")).toBe("/health");
  });

  it("does not invent a slash for an empty route", () => {
    expect(joinUrl("https://h.dev/cap", "")).toBe("https://h.dev/cap");
  });
});

describe("seg", () => {
  it("keeps a hostile id inside its own path segment", () => {
    expect(seg("a/b")).toBe("a%2Fb");
    expect(seg("a?b")).toBe("a%3Fb");
    expect(seg("a#b")).toBe("a%23b");
    expect(seg("a b")).toBe("a%20b");
    expect(seg("100%")).toBe("100%25");
  });

  it("encodes unicode and numbers", () => {
    expect(seg("café")).toBe("caf%C3%A9");
    expect(seg(7)).toBe("7");
  });
});

describe("session routes", () => {
  it("encode the session id", () => {
    expect(sessionAnnotationsPath("s/1")).toBe("/sessions/s%2F1/annotations");
    expect(sessionPendingPath("s?x=1")).toBe("/sessions/s%3Fx%3D1/pending");
    expect(sessionEventsPath("s 1")).toBe("/sessions/s%201/events");
  });

  // A caller must not be able to reach a different route through an id:
  // "x/../../admin" has to stay one segment.
  it("cannot be steered to another route by a traversal id", () => {
    expect(sessionAnnotationsPath("x/../../admin")).toBe(
      "/sessions/x%2F..%2F..%2Fadmin/annotations",
    );
  });

  it("encodes the annotation id in the screenshot route", () => {
    expect(annotationScreenshotPath("a/1")).toBe("/annotations/a%2F1/screenshot");
  });
});

describe("query", () => {
  it("builds and encodes pairs, skipping absent values", () => {
    expect(query({ routeName: "/feed", cursor: null, limit: 20, after: undefined })).toBe(
      "?routeName=%2Ffeed&limit=20",
    );
  });

  it("returns an empty string — not a bare ? — when nothing survives", () => {
    expect(query({ a: null })).toBe("");
    expect(query({})).toBe("");
  });
});

describe("originOf / sameOrigin", () => {
  it("is scheme + host + port, lowercased", () => {
    expect(originOf("https://H.Dev/cap?x=1#f")).toBe("https://h.dev");
    expect(originOf("HTTP://localhost:4788/x")).toBe("http://localhost:4788");
  });

  it("excludes userinfo", () => {
    expect(originOf("https://user:pw@h.dev/cap")).toBe("https://h.dev");
  });

  it("is null when there is no origin to speak of", () => {
    expect(originOf("/health")).toBeNull();
    expect(originOf("")).toBeNull();
    expect(originOf(null)).toBeNull();
    expect(originOf("https://")).toBeNull();
  });

  it("treats a scheme change as a different origin (no silent downgrade)", () => {
    expect(sameOrigin("https://h.dev/a", "http://h.dev/a")).toBe(false);
  });

  it("treats a port change as a different origin", () => {
    expect(sameOrigin("http://h.dev:1/a", "http://h.dev:2/a")).toBe(false);
  });

  it("is true for the same origin with different paths and queries", () => {
    expect(sameOrigin("https://h.dev/cap?k=1", "https://h.dev/cap/health")).toBe(true);
  });

  it("is false when either side has no determinable origin", () => {
    expect(sameOrigin("/health", "/health")).toBe(false);
    expect(sameOrigin("https://h.dev", null)).toBe(false);
  });
});

describe("endpoint and ID policy", () => {
  it("accepts any well-formed http(s) endpoint and rejects malformed ones", async () => {
    const { safeEndpoint, validResourceId, seg } = await import("../src/url");
    // Plaintext is the adopter's call (a LAN stub is a real workflow), so
    // these pass structure and are warned about, not refused.
    for (const endpoint of ["https://example.com/cap?k=x", "http://localhost:4788", "http://127.0.0.1:3000", "http://[::1]:3000", "http://192.168.1.20:4788", "http://lan.example", "http://evil@localhost"]) {
      expect(safeEndpoint(endpoint), endpoint).toBe(true);
    }
    // These cannot be a protocol endpoint at all, whatever the scheme.
    for (const endpoint of ["file:///tmp/x", "ftp://localhost", "http://[::1]:99999", "https://", "https://a\nb", "http://localhost\\evil"]) {
      expect(safeEndpoint(endpoint), endpoint).toBe(false);
    }
    for (const id of ["", ".", "..", "a\0b"]) expect(validResourceId(id)).toBe(false);
    // An unpaired surrogate clears every character class and still cannot be
    // encoded. The gate has to agree with `seg`, or a value passes here,
    // poisons the segment, and joinUrl throws out of a caller with no catch
    // (src/events.ts connect(), which also runs from the reconnect timer).
    for (const id of ["s\uD800", "\uDFFF", "a\uD83D", "\uDC00b"]) {
      expect(validResourceId(id), JSON.stringify(id)).toBe(false);
    }
    // Paired surrogates are ordinary text and must still be usable as ids.
    for (const id of ["\uD83D\uDE00", "caf\u00e9-1"]) {
      expect(validResourceId(id), JSON.stringify(id)).toBe(true);
      expect(seg(id)).not.toBe("\0");
    }
    for (const route of ["/annotations/..", "/annotations/%2e%2e", "/annotations/.%2e", "/annotations/\0"]) {
      expect(() => joinUrl("https://example.com", route)).toThrow();
    }
  });
});
