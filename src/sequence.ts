/**
 * Ordering guards for overlapping reads.
 *
 * THE PROBLEM (docs/audit/performance-correctness.md, "Make request refresh
 * ordering explicit"): a list refresh can be triggered by activation, a
 * route change, a mutation, a poll timer and a server push event — several
 * of which routinely fire at once. `fetch` makes no promise about the order
 * answers come back in, so a slow read issued at T0 can land after a fast
 * one issued at T1 and overwrite newer data with older: a deleted item
 * reappears, a resolved note goes back to open, or a previous screen's
 * comments render on the current one.
 *
 * THE RULE: responses are accepted in issue order, never in arrival order.
 * A read takes a ticket before it starts and presents it when it finishes;
 * anything older than the newest already-accepted answer is dropped.
 *
 * These are deliberately tiny and pure so the ordering logic can be tested
 * without a component, a timer or a network (test/sequence.test.ts).
 */

/** A read's ticket. Opaque on purpose: only `accept` may interpret it. */
export type Ticket = number;

export interface Sequencer {
  /** Take a ticket for a read that is about to start. */
  begin(): Ticket;
  /**
   * May this response be applied? True only when it is newer than the
   * newest response already applied. Accepting advances the watermark, so
   * asking twice with the same ticket answers true then false — a caller
   * must ask exactly once, at the moment it is about to write state.
   */
  accept(ticket: Ticket): boolean;
  /**
   * Abandon every read in flight: nothing issued before this call will be
   * accepted. Used when the configuration changes underneath them — those
   * answers belong to a server that is no longer the active one.
   */
  reset(): void;
}

export function createSequencer(): Sequencer {
  let issued = 0;
  let accepted = 0;
  return {
    begin: () => ++issued,
    accept: (ticket) => {
      if (ticket <= accepted) return false;
      accepted = ticket;
      return true;
    },
    // Jumping the watermark to whatever has been issued so far invalidates
    // every outstanding ticket at once, without having to know them.
    reset: () => {
      accepted = issued;
    },
  };
}

/**
 * The identity of an endpoint-scoped configuration.
 *
 * Any change to it means "a different server, or a different session on it"
 * — a new runtime, not an update to the current one. The token is included
 * because a token change can mean a different principal, and therefore a
 * different view of the same session.
 *
 * Built as a string rather than object identity so it survives the
 * re-resolution of config on every render.
 */
export function configKey(env: {
  endpoint: string;
  sessionId: string;
  token: string | null;
}): string {
  // LENGTH-PREFIXED, not delimited. Any delimiter can be smuggled into a
  // field — a session id may legally contain one (the routes encode it) —
  // and then `a` + `b c` and `a b` + `c` join to the same string, so an
  // endpoint change goes unnoticed. A missed reset is exactly the failure
  // this key exists to prevent, so the encoding is made unambiguous rather
  // than merely unlikely to collide.
  return [env.endpoint, env.sessionId, env.token ?? ""].map((p) => `${p.length}:${p}`).join("");
}
