/**
 * Read ordering (src/sequence.ts).
 *
 * These tests are written as the interleavings the runtime actually
 * produces — a poll and a push event racing, a route change mid-read, an
 * endpoint swap — because "responses arrive out of order" is not a rare
 * case here: five different triggers can start the same read.
 */

import { describe, expect, it } from "vitest";
import { configKey, createSequencer } from "../src/sequence";

describe("createSequencer", () => {
  it("accepts a lone response", () => {
    const s = createSequencer();
    expect(s.accept(s.begin())).toBe(true);
  });

  it("accepts responses that arrive in order", () => {
    const s = createSequencer();
    const a = s.begin();
    expect(s.accept(a)).toBe(true);
    const b = s.begin();
    expect(s.accept(b)).toBe(true);
  });

  // THE BUG THIS PREVENTS: the older read lands last and overwrites newer
  // data — a deleted item reappears, or a previous screen's list is drawn.
  it("drops an older response that lands after a newer one", () => {
    const s = createSequencer();
    const slow = s.begin(); // poll timer
    const fast = s.begin(); // push event, right after
    expect(s.accept(fast)).toBe(true);
    expect(s.accept(slow)).toBe(false);
  });

  it("drops every straggler, not just the first", () => {
    const s = createSequencer();
    const t1 = s.begin();
    const t2 = s.begin();
    const t3 = s.begin();
    expect(s.accept(t3)).toBe(true);
    expect(s.accept(t2)).toBe(false);
    expect(s.accept(t1)).toBe(false);
  });

  it("refuses to apply the same response twice", () => {
    // A caller must ask exactly once, at the moment it writes state;
    // accepting twice would let a retry re-apply a superseded body.
    const s = createSequencer();
    const t = s.begin();
    expect(s.accept(t)).toBe(true);
    expect(s.accept(t)).toBe(false);
  });

  it("keeps accepting after a straggler is dropped", () => {
    const s = createSequencer();
    const slow = s.begin();
    const fast = s.begin();
    s.accept(fast);
    expect(s.accept(slow)).toBe(false);
    const next = s.begin();
    expect(s.accept(next)).toBe(true);
  });

  describe("reset", () => {
    it("invalidates everything already in flight", () => {
      const s = createSequencer();
      const a = s.begin();
      const b = s.begin();
      s.reset(); // the endpoint changed under both of them
      expect(s.accept(a)).toBe(false);
      expect(s.accept(b)).toBe(false);
    });

    it("lets reads issued after it through", () => {
      const s = createSequencer();
      const old = s.begin();
      s.reset();
      const fresh = s.begin();
      expect(s.accept(fresh)).toBe(true);
      expect(s.accept(old)).toBe(false);
    });

    it("is safe with nothing in flight, and repeatable", () => {
      const s = createSequencer();
      s.reset();
      s.reset();
      expect(s.accept(s.begin())).toBe(true);
    });

    // The exact shape of an endpoint swap: A's read is already out when the
    // config changes, and it answers after B's has been applied.
    it("keeps endpoint A's late answer out of endpoint B's runtime", () => {
      const s = createSequencer();
      const fromA = s.begin();
      s.reset();
      const fromB = s.begin();
      expect(s.accept(fromB)).toBe(true);
      expect(s.accept(fromA)).toBe(false);
    });
  });

  it("keeps two sequencers independent (one per list)", () => {
    const pending = createSequencer();
    const comments = createSequencer();
    const p = pending.begin();
    comments.begin();
    comments.reset();
    // Resetting the comments list must not invalidate the pending read.
    expect(pending.accept(p)).toBe(true);
  });
});

describe("configKey", () => {
  const base = { endpoint: "https://h.dev/cap", sessionId: "s1", token: null };

  it("is stable for an unchanged configuration", () => {
    expect(configKey(base)).toBe(configKey({ ...base }));
  });

  it("changes when the endpoint, the session or the token changes", () => {
    expect(configKey({ ...base, endpoint: "https://other.dev/cap" })).not.toBe(configKey(base));
    expect(configKey({ ...base, sessionId: "s2" })).not.toBe(configKey(base));
    expect(configKey({ ...base, token: "t" })).not.toBe(configKey(base));
  });

  it("tells a null token apart from an empty one only where it matters", () => {
    // Both mean "no bearer"; they must not look like a config change.
    expect(configKey({ ...base, token: "" })).toBe(configKey({ ...base, token: null }));
  });

  // A delimiter that could appear in a component would let two distinct
  // configs collide on one key — and a collision means NO reset, which is
  // the whole failure this key exists to prevent. A session id may legally
  // contain a space, so these are the shapes that break a joined key.
  it("cannot be collided by smuggling the delimiter into a field", () => {
    expect(configKey({ endpoint: "https://h.dev", sessionId: "a b", token: null })).not.toBe(
      configKey({ endpoint: "https://h.dev a", sessionId: "b", token: null }),
    );
    expect(configKey({ endpoint: "https://h.dev/a", sessionId: "b", token: null })).not.toBe(
      configKey({ endpoint: "https://h.dev/a b", sessionId: "", token: null }),
    );
    expect(configKey({ endpoint: "https://h.dev", sessionId: "s:1", token: null })).not.toBe(
      configKey({ endpoint: "https://h.dev", sessionId: "s", token: "1" }),
    );
  });
});
