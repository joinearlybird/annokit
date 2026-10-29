/**
 * The ONE submit path (src/submit.ts) — shared by the composer and the
 * headless helpers, so these assertions guard both callers at once: wire
 * shape, response-id re-keying, anchor registration, the opt-in screenshot
 * upload, and the agentation-compat mapping.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetServerFlavor, setServerFlavor } from "../src/agentation";
import { clearScrollAnchors, hasScrollAnchor } from "../src/anchor-registry";
import { buildCaptureBody, submitAgentCapture, submitCommentCapture } from "../src/submit";
import type { SubmitCaptureContext } from "../src/submit";
import type { AnnoKitTransport } from "../src/transport";
import type { PendingCapture } from "../src/types";
import { installViewShotStub } from "./helpers/stubs";

const CAPTURE: PendingCapture = {
  x: 120,
  y: 340,
  hit: {
    element: "PrimaryButton",
    componentStack: ["App", "Card", "PrimaryButton"],
    source: { file: "app/src/Card.tsx", line: 4 },
    testID: "card-cta",
    frame: { x: 52, y: 179, width: 62, height: 17 },
    // A measurable node, so the anchor registration actually registers.
    elementFiber: { stateNode: { measureInWindow: () => {} } },
  },
  routeName: "/home",
  screenshotUri: null,
};

interface Call {
  path: string;
  body?: unknown;
}

function fakeTransport(response: unknown): { transport: AnnoKitTransport; calls: Call[] } {
  const calls: Call[] = [];
  const transport = {
    postJson: vi.fn(async (path: string, body: unknown) => {
      calls.push({ path, body });
      return response;
    }),
    // Task creation reads the status; a null canned response is a failure.
    postJsonAt: vi.fn(async (path: string, body: unknown) => {
      calls.push({ path, body });
      return response === null ? { status: 0, data: null } : { status: 201, data: response };
    }),
    postForm: vi.fn(async (path: string) => {
      calls.push({ path });
      return {};
    }),
    getJson: vi.fn(async () => null),
  } as unknown as AnnoKitTransport;
  return { transport, calls };
}

function ctxWith(response: unknown): { ctx: SubmitCaptureContext; calls: Call[] } {
  const { transport, calls } = fakeTransport(response);
  return { ctx: { transport, sessionId: "sess-9", capture: CAPTURE }, calls };
}

beforeEach(() => clearScrollAnchors());
afterEach(() => {
  forgetServerFlavor();
  clearScrollAnchors();
});

describe("buildCaptureBody", () => {
  it("builds the protocol body with a fresh id and trimmed comment", () => {
    const body = buildCaptureBody(CAPTURE, "  make it blue  ");
    expect(body.comment).toBe("make it blue");
    expect(body.element).toBe("PrimaryButton");
    expect(typeof body.id).toBe("string");
    expect(body.id.length).toBeGreaterThan(0);
  });

  it("applies the requested Output Detail (minimal drops the stack)", () => {
    const full = buildCaptureBody(CAPTURE, "x", { outputDetail: "full" });
    const minimal = buildCaptureBody(CAPTURE, "x", { outputDetail: "minimal" });
    expect(full.componentStack.length).toBeGreaterThan(0);
    expect(JSON.stringify(minimal).length).toBeLessThan(JSON.stringify(full).length);
  });

  it("carries the chosen agent, at every Output Detail, and nothing when none was chosen", () => {
    expect(buildCaptureBody(CAPTURE, "x").agent).toBeUndefined();
    const run = { agent: "codex", model: "gpt-6", modelLabel: "GPT-6", effort: "high" };
    expect(buildCaptureBody(CAPTURE, "x", { agent: run, outputDetail: "minimal" }).agent).toEqual({
      id: "codex", model: "gpt-6", effort: "high",
    });
    expect(buildCaptureBody(CAPTURE, "x", { agent: { agent: "claude", model: null, effort: null } }).agent).toEqual({ id: "claude" });
  });

  // A POST that times out may still have been stored. The retry must
  // repeat the id, or the agent receives the same task twice.
  it("repeats the client id when the same capture is submitted again", () => {
    const capture: PendingCapture = { ...CAPTURE };
    expect(buildCaptureBody(capture, "a").id).toBe(buildCaptureBody(capture, "b").id);
  });

  it("uses the capture's own id, which survives the screenshot spread", () => {
    const capture: PendingCapture = { ...CAPTURE, id: "cap-1" };
    const withShot = { ...capture, screenshotUri: "file:///shot.png" };
    expect(buildCaptureBody(capture, "a").id).toBe("cap-1");
    expect(buildCaptureBody(withShot, "a").id).toBe("cap-1");
  });

  it("gives different captures different ids", () => {
    expect(buildCaptureBody({ ...CAPTURE }, "a").id).not.toBe(buildCaptureBody({ ...CAPTURE }, "a").id);
  });
});

describe("submitAgentCapture", () => {
  it("POSTs to the session route and keys everything off the RESPONSE id", async () => {
    const { ctx, calls } = ctxWith({ id: "server-assigned" });
    const id = await submitAgentCapture(ctx, "do the thing");
    expect(id).toBe("server-assigned");
    expect(calls[0].path).toBe("/sessions/sess-9/annotations");
    expect(hasScrollAnchor("server-assigned")).toBe(true);
  });

  it("falls back to the client id when the server echoes nothing", async () => {
    const { ctx } = ctxWith({ ok: true });
    const id = await submitAgentCapture(ctx, "x");
    expect(typeof id).toBe("string");
    expect(hasScrollAnchor(id!)).toBe(true);
  });

  it("an empty 2xx is created, under the client id", async () => {
    const { transport } = fakeTransport(null);
    (transport as unknown as { postJsonAt: unknown }).postJsonAt = vi.fn(async () => ({ status: 204, data: null }));
    const capture: PendingCapture = { ...CAPTURE, id: "cap-204" };
    const id = await submitAgentCapture({ transport, sessionId: "sess-9", capture }, "x");
    expect(id).toBe("cap-204");
    expect(hasScrollAnchor("cap-204")).toBe(true);
  });

  it("a failed POST is null — no anchor, no upload", async () => {
    const { ctx, calls } = ctxWith(null);
    await expect(submitAgentCapture(ctx, "x", { attachScreenshot: true })).resolves.toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("uploads the screenshot only when asked AND one exists", async () => {
    const shot = { ...CAPTURE, screenshotUri: "file:///tmp/shot.png" };
    const { transport, calls } = fakeTransport({ id: "a1" });
    const ctx = { transport, sessionId: "s", capture: shot };
    await submitAgentCapture(ctx, "x", { attachScreenshot: true });
    expect(calls.map((c) => c.path)).toEqual(["/sessions/s/annotations", "/annotations/a1/screenshot"]);

    calls.length = 0;
    await submitAgentCapture(ctx, "x"); // switch off
    expect(calls.map((c) => c.path)).toEqual(["/sessions/s/annotations"]);
  });

  it("agentation compat sends THEIR wire shape (trim runs first — full detail keeps the chain)", async () => {
    setServerFlavor("agentation");
    const { ctx, calls } = ctxWith({ id: "mst-1" });
    await submitAgentCapture(ctx, "compat", { references: [], outputDetail: "full" });
    const body = calls[0].body as Record<string, unknown>;
    expect(body.elementPath).toBe("App > Card > PrimaryButton (app/src/Card.tsx:4)");
    expect(body.url).toBe("app://native/home");
    expect(body).not.toHaveProperty("componentStack");
  });
});

describe("submitCommentCapture", () => {
  it("posts a comment and registers its anchor", async () => {
    const { ctx } = ctxWith({ id: "cmt-1", messages: [] });
    const id = await submitCommentCapture(ctx, "note", "Johnny");
    expect(id).toBe("cmt-1");
    expect(hasScrollAnchor("cmt-1")).toBe(true);
  });

  it("a refused comment is null", async () => {
    const { ctx } = ctxWith(null);
    await expect(submitCommentCapture(ctx, "note")).resolves.toBeNull();
  });
});

// ── Screenshot lifecycle ─────────────────────────────────────────────────
//
// The capture is taken before the destination is chosen, so the submit
// paths are where most captures stop being needed. "No abandoned or
// text-only flow leaves a package-created native screenshot behind"
// (docs/audit/high-priority-security-privacy.md).

describe("screenshot release on submit", () => {
  const SHOT = "file:///var/tmp/ReactNative/shot.png";

  /** A fresh src/submit.ts wired to a view-shot stub that records deletes. */
  async function loadSubmit(): Promise<{
    freed: string[];
    submitAgent: typeof submitAgentCapture;
    submitComment: typeof submitCommentCapture;
    restore: () => void;
  }> {
    const freed: string[] = [];
    const restore = installViewShotStub(
      async () => SHOT,
      (uri: string) => freed.push(uri),
    );
    vi.resetModules();
    const mod = await import("../src/submit");
    return {
      freed,
      submitAgent: mod.submitAgentCapture,
      submitComment: mod.submitCommentCapture,
      restore,
    };
  }

  function shotCtx(response: unknown): { ctx: SubmitCaptureContext; calls: Call[] } {
    const { transport, calls } = fakeTransport(response);
    return {
      ctx: { transport, sessionId: "sess-9", capture: { ...CAPTURE, screenshotUri: SHOT } },
      calls,
    };
  }

  it("frees the capture after the upload, not before it", async () => {
    const { freed, submitAgent, restore } = await loadSubmit();
    const { ctx, calls } = shotCtx({ id: "a1" });
    await submitAgent(ctx, "make it blue", { attachScreenshot: true });
    expect(calls.map((c) => c.path)).toContain("/annotations/a1/screenshot");
    expect(freed).toEqual([SHOT]);
    restore();
  });

  it("frees the capture when the screenshot switch was left off", async () => {
    const { freed, submitAgent, restore } = await loadSubmit();
    const { ctx, calls } = shotCtx({ id: "a1" });
    await submitAgent(ctx, "make it blue", { attachScreenshot: false });
    expect(calls.map((c) => c.path)).not.toContain("/annotations/a1/screenshot");
    expect(freed).toEqual([SHOT]);
    restore();
  });

  it("frees the capture behind a text-only team note", async () => {
    const { freed, submitComment, restore } = await loadSubmit();
    const { ctx } = shotCtx({ comment: { id: "c1" } });
    await submitComment(ctx, "this is off-brand");
    expect(freed).toEqual([SHOT]);
    restore();
  });

  it("KEEPS the capture when the submit failed — a retry still needs it", async () => {
    // The sheet stays open with the user's words; the eventual dismissal
    // is what releases the file.
    const { freed, submitAgent, restore } = await loadSubmit();
    const { ctx } = shotCtx(null);
    await expect(submitAgent(ctx, "make it blue", { attachScreenshot: true })).resolves.toBeNull();
    expect(freed).toEqual([]);
    restore();
  });

  it("keeps the capture when a comment submit failed", async () => {
    const { freed, submitComment, restore } = await loadSubmit();
    const { ctx } = shotCtx(null);
    await expect(submitComment(ctx, "nope")).resolves.toBeNull();
    expect(freed).toEqual([]);
    restore();
  });

  it("frees a capture exactly once even when the upload itself failed", async () => {
    const { freed, submitAgent, restore } = await loadSubmit();
    const { ctx } = shotCtx({ id: "a1" });
    await submitAgent(ctx, "x", { attachScreenshot: true });
    await submitAgent(ctx, "x", { attachScreenshot: true });
    expect(freed).toEqual([SHOT]);
    restore();
  });
});

describe("a team note carries its screenshot", () => {
  const SHOT = "file:///var/tmp/ReactNative/note.png";

  async function loadSubmit(): Promise<{
    freed: string[];
    submitComment: typeof submitCommentCapture;
    restore: () => void;
  }> {
    const freed: string[] = [];
    const restore = installViewShotStub(
      async () => SHOT,
      (uri: string) => freed.push(uri),
    );
    vi.resetModules();
    const mod = await import("../src/submit");
    return { freed, submitComment: mod.submitCommentCapture, restore };
  }

  function shotCtx(response: unknown): { ctx: SubmitCaptureContext; calls: Call[] } {
    const { transport, calls } = fakeTransport(response);
    return {
      ctx: { transport, sessionId: "sess-9", capture: { ...CAPTURE, screenshotUri: SHOT } },
      calls,
    };
  }

  it("uploads it to the note's own route", async () => {
    const { submitComment, restore } = await loadSubmit();
    const { ctx, calls } = shotCtx({ comment: { id: "c1" } });
    await submitComment(ctx, "look at this", null, { attachScreenshot: true });
    expect(calls.map((c) => c.path)).toContain("/comments/c1/screenshot");
    restore();
  });

  it("does not upload when no screenshot was asked for", async () => {
    const { submitComment, restore } = await loadSubmit();
    const { ctx, calls } = shotCtx({ comment: { id: "c1" } });
    await submitComment(ctx, "just words", null, { attachScreenshot: false });
    expect(calls.map((c) => c.path)).not.toContain("/comments/c1/screenshot");
    restore();
  });

  it("frees the capture once the note has it", async () => {
    const { freed, submitComment, restore } = await loadSubmit();
    const { ctx } = shotCtx({ comment: { id: "c1" } });
    await submitComment(ctx, "look at this", null, { attachScreenshot: true });
    expect(freed).toEqual([SHOT]);
    restore();
  });

  it("keeps the note when the upload route is missing", async () => {
    // A server that predates the route 404s; the note is already saved and
    // the picture is a follow-up, never a condition of it.
    const { submitComment, restore } = await loadSubmit();
    const { transport, calls } = fakeTransport({ comment: { id: "c1" } });
    (transport as unknown as { postForm: unknown }).postForm = vi.fn(async (path: string) => {
      calls.push({ path });
      return false; // 404, fail-soft
    });
    const ctx = { transport, sessionId: "sess-9", capture: { ...CAPTURE, screenshotUri: SHOT } };
    await expect(submitComment(ctx, "look at this", null, { attachScreenshot: true })).resolves.toBe(
      "c1",
    );
    restore();
  });

  it("encodes a hostile comment id in the upload route", async () => {
    const { submitComment, restore } = await loadSubmit();
    const { ctx, calls } = shotCtx({ comment: { id: "c/1" } });
    await submitComment(ctx, "x", null, { attachScreenshot: true });
    expect(calls.map((c) => c.path)).toContain("/comments/c%2F1/screenshot");
    restore();
  });
});
