/**
 * THE ONE REFRESH CADENCE.
 *
 * Two surfaces in this overlay wait for someone else to say something: a
 * team note's conversation (a human replying) and an agent task's thread (the
 * agent replying). Both refetch on the EVENTS that matter and back those up
 * with a lazy timer, and both stop that timer the moment the endpoint proves
 * it cannot answer — a dev overlay sharing a phone with a Metro bundler has
 * no business running a tight timer, and a server without the route would
 * otherwise collect a failure every interval forever.
 *
 * That is one rule, so it is one module. It was written twice, cadence and
 * all, when the thread pane grew its poll (agent replies were invisible until
 * you closed and reopened the pane); two independently-tuned timers doing the
 * same job is exactly how a "why does this feel slower than that" bug is
 * born.
 *
 * 30 seconds, because these are conversations at human speed: it is well
 * inside "I read the reply, thought about it, and looked back".
 *
 * THE REALTIME CHANNEL REPLACES THE TIMER, and only the timer. While the
 * event stream is live (src/events.ts) every change is announced and the
 * timer would only re-ask what nothing has said changed, so it stands
 * down; the event-driven refetches around it are correctness and stay.
 */

/** Backstop interval for both conversation surfaces. */
export const OVERLAY_POLL_INTERVAL_MS = 30_000;

/** What a polling surface knows about itself. */
export interface PollState {
  /** The overlay is active (and, for a pane, on screen). */
  enabled: boolean;
  /** The endpoint has not yet proven absent. */
  available: boolean;
  /** The event stream is delivering (src/events.ts `streamLive`). */
  streamLive?: boolean;
}

/**
 * Should the backstop timer run at all?
 *
 * All three are load-bearing: `enabled` keeps a closed pane and a
 * disabled overlay off the network entirely, `available` is what stops a
 * server with no such route from being asked forever, and `streamLive`
 * hands the job to the stream while it is doing it.
 */
export function shouldPoll(state: PollState): boolean {
  return state.enabled && state.available && state.streamLive !== true;
}
