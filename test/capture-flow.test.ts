/**
 * The headless seam (src/capture-flow.ts): the handled/open decision and
 * the helper wiring — the two behaviors that would otherwise need a
 * component renderer to regression-test.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { clearScrollAnchors } from "../src/anchor-registry";
import {
  buildCaptureHelpers,
  buildComposerSlotProps,
  resolveCaptureHandling,
} from "../src/capture-flow";
import type { CaptureFlowDeps, CaptureHelpers } from "../src/capture-flow";
import type { AnnoKitTransport } from "../src/transport";
import type { PendingCapture } from "../src/types";

const CAPTURE: PendingCapture = {
  x: 10,
  y: 20,
  hit: {
    element: "FeedRow",
    componentStack: ["App", "FeedRow"],
    testID: "feed-row-2",
    frame: { x: 0, y: 0, width: 100, height: 40 },
    elementFiber: { stateNode: { measureInWindow: () => {} } },
  },
  routeName: "/",
  screenshotUri: null,
};

const NOOP_HELPERS: CaptureHelpers = {
  buildBody: () => ({}) as never,
  submitAgent: async () => null,
  submitComment: async () => null,
  dismiss: () => {},
  releaseScreenshot: () => {},
  captureScreenshot: async () => null,
};

afterEach(() => clearScrollAnchors());

describe("resolveCaptureHandling — the decision", () => {
  it("no hook means the built-in composer, and the hook is never invented", () => {
    expect(resolveCaptureHandling(undefined, CAPTURE, NOOP_HELPERS)).toBe("open-composer");
  });

  it("truthy takes over; every falsy passes through", () => {
    expect(resolveCaptureHandling(() => true, CAPTURE, NOOP_HELPERS)).toBe("handled");
    expect(resolveCaptureHandling(() => false, CAPTURE, NOOP_HELPERS)).toBe("open-composer");
    expect(resolveCaptureHandling(() => undefined, CAPTURE, NOOP_HELPERS)).toBe("open-composer");
  });

  it("hands the hook the capture and the helpers, once", () => {
    const hook = vi.fn(() => true);
    resolveCaptureHandling(hook, CAPTURE, NOOP_HELPERS);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalledWith(CAPTURE, NOOP_HELPERS);
  });

  it("a THROWING hook is fail-soft: warn + built-in composer, never a lost capture", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      resolveCaptureHandling(
        () => {
          throw new Error("host bug");
        },
        CAPTURE,
        NOOP_HELPERS,
      ),
    ).toBe("open-composer");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("onCapture threw"), expect.anything());
    warn.mockRestore();
  });
});

describe("buildCaptureHelpers — the wiring", () => {
  function deps(response: unknown): {
    deps: CaptureFlowDeps;
    calls: { path: string; body?: unknown }[];
    onAgentSubmitted: ReturnType<typeof vi.fn>;
    onCommentSubmitted: ReturnType<typeof vi.fn>;
    dismiss: ReturnType<typeof vi.fn>;
    captureScreenshot: ReturnType<typeof vi.fn>;
  } {
    const calls: { path: string; body?: unknown }[] = [];
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
      postForm: vi.fn(async () => ({})),
      getJson: vi.fn(async () => null),
    } as unknown as AnnoKitTransport;
    const onAgentSubmitted = vi.fn();
    const onCommentSubmitted = vi.fn();
    const dismiss = vi.fn();
    const captureScreenshot = vi.fn(async () => "file:///tmp/on-demand.png");
    return {
      deps: {
        transport,
        sessionId: "sess-h",
        onAgentSubmitted,
        onCommentSubmitted,
        dismiss,
        captureScreenshot,
      },
      captureScreenshot,
      calls,
      onAgentSubmitted,
      onCommentSubmitted,
      dismiss,
    };
  }

  it("submitAgent posts to the EFFECTIVE session and refreshes only on success", async () => {
    const ok = deps({ id: "a1" });
    const helpers = buildCaptureHelpers(CAPTURE, ok.deps);
    await expect(helpers.submitAgent("do it")).resolves.toBe("a1");
    expect(ok.calls[0].path).toBe("/sessions/sess-h/annotations");
    expect(ok.onAgentSubmitted).toHaveBeenCalledTimes(1);
    expect(ok.onCommentSubmitted).not.toHaveBeenCalled();

    const bad = deps(null);
    await expect(buildCaptureHelpers(CAPTURE, bad.deps).submitAgent("do it")).resolves.toBeNull();
    expect(bad.onAgentSubmitted).not.toHaveBeenCalled();
  });

  it("submitComment refreshes the notes side, not the pending side", async () => {
    const ok = deps({ id: "c1", messages: [] });
    const helpers = buildCaptureHelpers(CAPTURE, ok.deps);
    await expect(helpers.submitComment("note", "Host")).resolves.toBe("c1");
    expect(ok.onCommentSubmitted).toHaveBeenCalledTimes(1);
    expect(ok.onAgentSubmitted).not.toHaveBeenCalled();
  });

  // The documented headless flow: take the shot, then submit with it. The
  // helpers used to hold the pre-screenshot capture, so this sent nothing.
  it("a screenshot taken through the helpers rides with the next submit", async () => {
    const d = deps({ id: "a1" });
    const helpers = buildCaptureHelpers({ ...CAPTURE, canScreenshot: true }, d.deps);
    await expect(helpers.captureScreenshot()).resolves.toBe("file:///tmp/on-demand.png");
    await helpers.submitAgent("with a picture", { attachScreenshot: true });
    expect(d.deps.transport.postForm).toHaveBeenCalledWith("/annotations/a1/screenshot", expect.anything());
  });

  it("does not fire the shutter for a capture that can never upload one", async () => {
    const d = deps({ id: "a1" });
    const helpers = buildCaptureHelpers({ ...CAPTURE, canScreenshot: false }, d.deps);
    await expect(helpers.captureScreenshot()).resolves.toBeNull();
    expect(d.captureScreenshot).not.toHaveBeenCalled();
  });

  it("buildBody is the protocol body for THIS capture, no network involved", () => {
    const d = deps({ id: "never" });
    const body = buildCaptureHelpers(CAPTURE, d.deps).buildBody("hello");
    expect(body.comment).toBe("hello");
    expect(body.element).toBe("FeedRow");
    expect(body.testID).toBe("feed-row-2");
    expect(d.calls).toHaveLength(0);
  });

  it("dismiss is the provider's aim-clear, verbatim", () => {
    const d = deps(null);
    buildCaptureHelpers(CAPTURE, d.deps).dismiss();
    expect(d.dismiss).toHaveBeenCalledTimes(1);
  });
});

describe("buildComposerSlotProps — the tier-2 slot contract", () => {
  function slotDeps(response: unknown) {
    const transport = {
      postJson: vi.fn(async () => response),
      postJsonAt: vi.fn(async () =>
        response === null ? { status: 0, data: null } : { status: 201, data: response },
      ),
      postForm: vi.fn(async () => ({})),
      getJson: vi.fn(async () => null),
    } as unknown as AnnoKitTransport;
    const close = vi.fn();
    const onAgentSubmitted = vi.fn();
    const onCommentSubmitted = vi.fn();
    return {
      deps: {
        transport,
        sessionId: "s",
        onAgentSubmitted,
        onCommentSubmitted,
        dismiss: vi.fn(),
    captureScreenshot: vi.fn(async () => null),
        commentsAvailable: true,
        close,
        attachmentSources: [],
      },
      close,
      onAgentSubmitted,
      onCommentSubmitted,
    };
  }

  // One handler, one set of props: `await props.captureScreenshot()` and
  // then `props.submitAgent(...)`. The provider re-renders with the shot,
  // but the handler still holds the props it started with.
  it("a submit through the SAME props after a screenshot still attaches it", async () => {
    const { deps } = slotDeps({ id: "a2" });
    const props = buildComposerSlotProps(
      { ...CAPTURE, canScreenshot: true },
      { ...deps, captureScreenshot: vi.fn(async () => "file:///tmp/slot.png") },
    );
    await props.captureScreenshot();
    await props.submitAgent("with a picture", { attachScreenshot: true });
    expect(deps.transport.postForm).toHaveBeenCalledWith("/annotations/a2/screenshot", expect.anything());
  });

  it("hands the host the comment capability AND the sentence for its absence", () => {
    const { deps } = slotDeps({ id: "x" });
    expect(buildComposerSlotProps(CAPTURE, deps).canComment).toBe(true);
    expect(buildComposerSlotProps(CAPTURE, deps).commentsUnavailableReason).toBeNull();

    const off = buildComposerSlotProps(CAPTURE, { ...deps, commentsAvailable: false });
    expect(off.canComment).toBe(false);
    expect(off.commentsUnavailableReason).toContain("no comment routes");
  });

  it("submits CLOSE THE FLOW on success and leave it standing on failure", async () => {
    const ok = slotDeps({ id: "a1" });
    await expect(buildComposerSlotProps(CAPTURE, ok.deps).submitAgent("do")).resolves.toBe("a1");
    expect(ok.close).toHaveBeenCalledTimes(1);
    expect(ok.onAgentSubmitted).toHaveBeenCalledTimes(1);

    const bad = slotDeps(null);
    await expect(buildComposerSlotProps(CAPTURE, bad.deps).submitAgent("do")).resolves.toBeNull();
    expect(bad.close).not.toHaveBeenCalled();
    expect(bad.onAgentSubmitted).not.toHaveBeenCalled();
  });

  it("a comment submit closes too, refreshing the notes side", async () => {
    const ok = slotDeps({ id: "c1", messages: [] });
    await expect(
      buildComposerSlotProps(CAPTURE, ok.deps).submitComment("note", "Host"),
    ).resolves.toBe("c1");
    expect(ok.close).toHaveBeenCalledTimes(1);
    expect(ok.onCommentSubmitted).toHaveBeenCalledTimes(1);
  });

  it("dismiss is the flow's close (capture state + aim), not a bare aim-clear", () => {
    const { deps, close } = slotDeps(null);
    buildComposerSlotProps(CAPTURE, deps).dismiss();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("passes the attachment sources through untouched", () => {
    const { deps } = slotDeps(null);
    const marker = [{ key: "x", title: "X", emptyText: "none", list: async () => [] }];
    expect(
      buildComposerSlotProps(CAPTURE, { ...deps, attachmentSources: marker }).attachmentSources,
    ).toBe(marker);
  });
});
