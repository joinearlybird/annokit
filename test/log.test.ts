/**
 * Redaction (src/log.ts).
 *
 * The point of these tests is adversarial: a capability endpoint is a
 * credential, so every assertion below is really "the secret is not in the
 * string". See docs/audit/high-priority-security-privacy.md.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  annoKitDebugEnabled,
  debugLog,
  debugLogOnce,
  endpointHost,
  errorCategory,
  forgetSaidDiagnostics,
  forgetWarnStreak,
  requestLabel,
  routeLabel,
  setAnnoKitDebug,
  warnRequestFailed,
} from "../src/log";

const SECRET = "s3cret-capability";

describe("endpointHost", () => {
  it("keeps the host and port and nothing else", () => {
    expect(endpointHost("https://sandbox.example.dev/sessions/abc/agentation")).toBe(
      "sandbox.example.dev",
    );
    expect(endpointHost("http://localhost:4788/agentation")).toBe("localhost:4788");
  });

  it("drops path, query, fragment and userinfo", () => {
    expect(endpointHost(`https://h.dev/${SECRET}?token=hunter2#x`)).toBe("h.dev");
    expect(endpointHost("https://user:pass@h.dev/path")).toBe("h.dev");
  });

  it("is null for anything unparseable", () => {
    expect(endpointHost(null)).toBeNull();
    expect(endpointHost(undefined)).toBeNull();
    expect(endpointHost("")).toBeNull();
    expect(endpointHost("   ")).toBeNull();
  });
});

describe("routeLabel", () => {
  it("replaces every non-protocol segment with a placeholder", () => {
    expect(routeLabel(`/sessions/${SECRET}/annotations`)).toBe("/sessions/:id/annotations");
    expect(routeLabel("/annotations/8fd2/screenshot")).toBe("/annotations/:id/screenshot");
    expect(routeLabel("/comments/abc/messages")).toBe("/comments/:id/messages");
  });

  it("keeps static protocol routes readable", () => {
    expect(routeLabel("/health")).toBe("/health");
    expect(routeLabel("/me")).toBe("/me");
    expect(routeLabel("/sessions")).toBe("/sessions");
    expect(routeLabel("/annotations/send")).toBe("/annotations/send");
    expect(routeLabel("/assets")).toBe("/assets");
  });

  it("notes that a query existed without printing it", () => {
    expect(routeLabel("/comments?routeName=%2Ffeed")).toBe("/comments?…");
    expect(routeLabel(`/comments?token=${SECRET}`)).not.toContain(SECRET);
  });

  it("drops a fragment", () => {
    expect(routeLabel("/health#frag")).toBe("/health");
  });
});

describe("requestLabel", () => {
  it("is method, host and an id-free route", () => {
    expect(
      requestLabel("POST", "https://h.dev/cap?k=hunter2", `/sessions/${SECRET}/annotations`),
    ).toBe("POST h.dev /sessions/:id/annotations");
  });

  it("never contains the capability path, the query or userinfo", () => {
    const label = requestLabel(
      "GET",
      `https://user:pass@h.dev/${SECRET}?token=hunter2`,
      `/sessions/${SECRET}/pending`,
    );
    expect(label).not.toContain(SECRET);
    expect(label).not.toContain("hunter2");
    expect(label).not.toContain("pass");
  });

  it("degrades to ? rather than half a URL", () => {
    expect(requestLabel("GET", "", "/health")).toBe("GET ? /health");
  });
});

describe("errorCategory", () => {
  it("separates our own aborts from the network's failures", () => {
    expect(errorCategory({ name: "AbortError" })).toBe("aborted");
    expect(errorCategory({ name: "TimeoutError" })).toBe("timeout");
    expect(errorCategory({ name: "TypeError" })).toBe("network error (TypeError)");
    expect(errorCategory(null)).toBe("network error");
    expect(errorCategory("boom")).toBe("network error");
  });

  // Both node's and Hermes' fetch put the request URL in the message.
  it("never returns the error's message", () => {
    const e = new Error(`request to https://h.dev/${SECRET} failed`);
    expect(errorCategory(e)).not.toContain(SECRET);
  });
});

describe("warnRequestFailed", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it("prints one tagged line and nothing else", () => {
    warnRequestFailed("GET h.dev /health", "HTTP 503");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]).toEqual(["[annokit] GET h.dev /health — HTTP 503"]);
  });
});

// ── Verbosity ────────────────────────────────────────────────────────────
//
// A device run accumulated 895 copies of ONE line — a steady-state
// condition re-reported on every list refresh. Failures must stay loud;
// diagnostics must be opt-in, and the ones describing a lasting condition
// must be said once.

describe("diagnostic verbosity", () => {
  let log: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    log = vi.spyOn(console, "log").mockImplementation(() => {});
    forgetSaidDiagnostics();
    setAnnoKitDebug(false);
  });
  afterEach(() => {
    setAnnoKitDebug(false);
    forgetSaidDiagnostics();
    log.mockRestore();
  });

  it("is off by default, so a host app's console stays clean", () => {
    expect(annoKitDebugEnabled()).toBe(false);
    debugLog("anchor a1: registered");
    debugLogOnce("size:a1", "a1 matched a differently-sized element");
    expect(log).not.toHaveBeenCalled();
  });

  it("prints tagged diagnostics once switched on", () => {
    setAnnoKitDebug(true);
    debugLog("re-anchor poll: watching 3 marker(s)");
    expect(log).toHaveBeenCalledWith("[annokit] re-anchor poll: watching 3 marker(s)");
  });

  it("says a lasting condition ONCE, however often it recurs", () => {
    // The exact shape of the flood: the same mark, re-checked on every
    // refresh, failing the wrong-element guard every time.
    setAnnoKitDebug(true);
    for (let i = 0; i < 200; i++) {
      debugLogOnce("size:a1", 'a1: testID "feed-row-2" matched a differently-sized element');
    }
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("still reports a DIFFERENT condition", () => {
    setAnnoKitDebug(true);
    debugLogOnce("size:a1", "a1 skipped");
    debugLogOnce("size:a2", "a2 skipped");
    expect(log).toHaveBeenCalledTimes(2);
  });

  it("does not let the dedupe memory grow without bound", () => {
    setAnnoKitDebug(true);
    for (let i = 0; i < 500; i++) debugLogOnce(`size:${i}`, `mark ${i}`);
    expect(log).toHaveBeenCalledTimes(500);
  });

  it("turning debug off clears what has been said", () => {
    setAnnoKitDebug(true);
    debugLogOnce("size:a1", "a1 skipped");
    setAnnoKitDebug(false);
    setAnnoKitDebug(true);
    debugLogOnce("size:a1", "a1 skipped");
    expect(log).toHaveBeenCalledTimes(2);
  });

  it("never suppresses a failure — those are warnings, not diagnostics", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setAnnoKitDebug(false);
    warnRequestFailed("GET h.dev /health", "HTTP 500");
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe("repeated-failure aggregation", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    forgetWarnStreak();
  });
  afterEach(() => {
    forgetWarnStreak();
    warn.mockRestore();
  });

  it("prints a recurring failure at 1, 2, 4, 8, 16 — not 30 times", () => {
    // A poll against a server that is down warns every 30s forever, and the
    // overlay is a guest in someone else's console.
    for (let i = 0; i < 30; i++) warnRequestFailed("GET h.dev /health", "network error");
    expect(warn).toHaveBeenCalledTimes(5); // 1, 2, 4, 8, 16
    expect(warn).toHaveBeenLastCalledWith("[annokit] GET h.dev /health — network error (x16)");
  });

  it("says how persistent it is, so the count is not lost", () => {
    for (let i = 0; i < 4; i++) warnRequestFailed("GET h.dev /health", "network error");
    expect((warn.mock.calls as unknown[][]).map((c) => String(c[0]))).toEqual([
      "[annokit] GET h.dev /health — network error",
      "[annokit] GET h.dev /health — network error (x2)",
      "[annokit] GET h.dev /health — network error (x4)",
    ]);
  });

  it("a DIFFERENT failure always prints — the change is the news", () => {
    warnRequestFailed("GET h.dev /health", "network error");
    warnRequestFailed("GET h.dev /health", "network error");
    warnRequestFailed("GET h.dev /health", "HTTP 500");
    warnRequestFailed("GET h.dev /health", "network error");
    expect(warn).toHaveBeenCalledTimes(4);
  });

  it("distinguishes routes, not just details", () => {
    warnRequestFailed("GET h.dev /health", "HTTP 500");
    warnRequestFailed("GET h.dev /comments", "HTTP 500");
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
