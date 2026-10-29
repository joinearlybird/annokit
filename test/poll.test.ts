/**
 * The one refresh cadence (src/poll.ts), and the guarantee that the two
 * surfaces built on it — the team-note conversation and the agent-task
 * thread — really are built on the SAME one. A second, independently-tuned
 * timer doing the same job is how "why is this slower than that" bugs start.
 */

import { describe, expect, it } from "vitest";
import { OVERLAY_POLL_INTERVAL_MS, shouldPoll } from "../src/poll";
import { COMMENTS_POLL_INTERVAL_MS, shouldPollComments } from "../src/comments";
import { THREAD_POLL_INTERVAL_MS, shouldPollThread } from "../src/thread";

describe("OVERLAY_POLL_INTERVAL_MS", () => {
  it("is lazy — a dev overlay must not run a tight timer on a phone", () => {
    expect(OVERLAY_POLL_INTERVAL_MS).toBeGreaterThanOrEqual(15_000);
  });

  it("is the cadence BOTH conversation surfaces use", () => {
    expect(COMMENTS_POLL_INTERVAL_MS).toBe(OVERLAY_POLL_INTERVAL_MS);
    expect(THREAD_POLL_INTERVAL_MS).toBe(OVERLAY_POLL_INTERVAL_MS);
  });
});

describe("shouldPoll", () => {
  it("runs only while active AND answerable", () => {
    expect(shouldPoll({ enabled: true, available: true })).toBe(true);
    expect(shouldPoll({ enabled: false, available: true })).toBe(false);
    expect(shouldPoll({ enabled: true, available: false })).toBe(false);
    expect(shouldPoll({ enabled: false, available: false })).toBe(false);
  });

  it("stands down while the event stream is live, and only then", () => {
    expect(shouldPoll({ enabled: true, available: true, streamLive: true })).toBe(false);
    expect(shouldPoll({ enabled: true, available: true, streamLive: false })).toBe(true);
    expect(shouldPollComments({ enabled: true, available: true, streamLive: true })).toBe(false);
    expect(shouldPollThread({ enabled: true, available: true, streamLive: true })).toBe(false);
  });

  it("is the rule both surfaces apply", () => {
    for (const enabled of [true, false]) {
      for (const available of [true, false]) {
        const state = { enabled, available };
        expect(shouldPollComments(state)).toBe(shouldPoll(state));
        expect(shouldPollThread(state)).toBe(shouldPoll(state));
      }
    }
  });
});
