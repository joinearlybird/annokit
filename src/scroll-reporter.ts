/**
 * App-reported scrolls — the compat-friendly fast path for marker anchoring.
 *
 * The overlay cannot hear scrolls on its own (RN's onScroll does not
 * bubble, and the overlay does not own the app's ScrollViews), so anchored
 * markers fall back to a 150ms measurement poll with a settle delay
 * (src/anchor-registry.ts). Any host app can do better by telling us when
 * it scrolls — one line inside any scrollable:
 *
 *   <ScrollView onScroll={reportAnnoKitScroll} scrollEventThrottle={32}>
 *
 * This works in ANY React Native app (no template dependency; the
 * app-builder template's own primitives call it out of the box). While
 * events arrive the marker layer hides anchored marks immediately and
 * re-measures the moment they stop, so marks reappear right as the scroll
 * settles instead of a poll-interval later. Apps that never call it lose
 * nothing but the responsiveness.
 *
 * No payloads: the event carries no offsets on purpose. Offsets would need
 * per-container identity to be usable, and the registry re-measures
 * elements anyway — "something scrolled just now" is the entire contract.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

/** Tell the overlay a scroll just happened. Safe to call from any onScroll. */
export function reportAnnoKitScroll(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* a broken subscriber must not break the app's scroll handler */
    }
  }
}

/** Marker-layer side: be told when the app reports a scroll. */
export function subscribeAnnoKitScroll(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** How long after the last reported event a scroll counts as ongoing. */
export const SCROLL_REPORT_SETTLE_MS = 90;
