/**
 * Diagnostic logging with redaction.
 *
 * WHY THIS EXISTS: the endpoint may be a capability URL — an unguessable
 * path or query parameter that IS the credential (src/env.ts AUTH NOTE).
 * src/settings-view.ts already refuses to render more than the host for
 * that reason; the transport used to `console.warn` the complete request
 * URL on every failure, which put the same secret into Metro output, device
 * logs, CI output, crash reporters and any log a developer pastes into an
 * issue. See docs/audit/high-priority-security-privacy.md, "Redact
 * capability URLs from transport logs".
 *
 * WHAT A LOG LINE MAY CONTAIN: the method, the HOST (with port — the part
 * that matters when telling a local stub from a sandbox), a STABLE ROUTE
 * LABEL with ids replaced by placeholders, and a status or error category.
 * Nothing else. No userinfo, no path, no query, no fragment, no bearer, no
 * request body, no response body, no raw error object — a runtime may hang
 * the whole request (URL included) off an Error it throws.
 */

/**
 * The host of an endpoint — WITH its port, and NOTHING ELSE.
 *
 * Hand-rolled rather than `new URL`: this module is pure and has to answer
 * the same way in a node test and in Hermes.
 *
 * (This function lives here rather than in src/settings-view.ts, where it
 * started, because redaction is now needed by the transport too. It is
 * re-exported there so the settings panel's public surface is unchanged.)
 */
export function endpointHost(endpoint: string | null | undefined): string | null {
  if (typeof endpoint !== "string") return null;
  const trimmed = endpoint.trim();
  if (!trimmed) return null;
  const afterScheme = trimmed.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "");
  const authority = afterScheme.split(/[/?#]/)[0] ?? "";
  // user:pass@host — the credential half is exactly what must not be shown.
  const host = authority.includes("@") ? authority.slice(authority.lastIndexOf("@") + 1) : authority;
  return host || null;
}

/**
 * Every path segment the AnnoKit Protocol defines. ANYTHING ELSE IS AN ID
 * and is replaced with a placeholder.
 *
 * Allowlist rather than an id-shaped-looking heuristic on purpose: a
 * capability segment or a human-readable session name ("acme-staging")
 * would sail straight through a "does it look like a uuid" test, and the
 * cost of being wrong is a secret in a log line. A route word that is
 * missing here degrades to `:id`, which is safe; a secret that leaks
 * because it looked like a route word is not.
 */
const ROUTE_WORDS = new Set([
  "annotations",
  "assets",
  "comments",
  "events",
  "health",
  "me",
  "messages",
  "pending",
  "screenshot",
  "send",
  "sessions",
  "thread",
]);

/**
 * A route path reduced to something safe and stable to log:
 * `/sessions/abc-secret/annotations` → `/sessions/:id/annotations`.
 *
 * The query is dropped entirely (a capability parameter can live there) and
 * only its presence is noted, because "the route had a query" is sometimes
 * the clue that explains a 404 while its contents never are.
 */
export function routeLabel(route: string): string {
  const [pathPart = "", ...rest] = (route ?? "").split("?");
  const path = pathPart.split("#")[0] ?? "";
  const labelled = path
    .split("/")
    .map((s) => (s === "" || ROUTE_WORDS.has(s) ? s : ":id"))
    .join("/");
  return rest.length > 0 ? `${labelled}?…` : labelled;
}

/**
 * The safe identity of a request: `POST sandbox.example /sessions/:id/annotations`.
 * Host is `?` when the endpoint could not be parsed — a dash is friendlier
 * than a half-parsed URL, and a half-parsed URL is how secrets escape.
 */
export function requestLabel(method: string, endpoint: string, route: string): string {
  return `${method} ${endpointHost(endpoint) ?? "?"} ${routeLabel(route)}`;
}

/**
 * A failed request, described without its URL.
 *
 * `detail` must already be a category ("network error", "timeout after
 * 15000ms", a status number) — never a caught error. Callers hold the error
 * object; this function will not print it.
 *
 * REPEATS ARE AGGREGATED. A failure that recurs usually recurs forever: a
 * poll against a server that is down warns every 30 seconds for as long as
 * the app is open, and the overlay is a guest in someone else's console.
 * The same failure is therefore printed at occurrences 1, 2, 4, 8, 16 …
 * with a count, so it stays visible (and its persistence stays legible)
 * without becoming the log. A different failure resets the streak, because
 * the interesting event is the CHANGE.
 */
let lastWarnKey: string | null = null;
let lastWarnCount = 0;

export function warnRequestFailed(label: string, detail: string): void {
  const key = `${label} — ${detail}`;
  if (key !== lastWarnKey) {
    lastWarnKey = key;
    lastWarnCount = 1;
    console.warn(`[annokit] ${key}`);
    return;
  }
  lastWarnCount += 1;
  // Powers of two: 2, 4, 8, 16 … — dense enough to show a problem taking
  // hold, sparse enough that an hour of failures is a handful of lines.
  if ((lastWarnCount & (lastWarnCount - 1)) === 0) {
    console.warn(`[annokit] ${key} (x${lastWarnCount})`);
  }
}

/** Tests, and the reset a new configuration deserves. */
export function forgetWarnStreak(): void {
  lastWarnKey = null;
  lastWarnCount = 0;
}

/**
 * The safe category for a value thrown by `fetch`/XHR.
 *
 * Deliberately lossy: an error's `message` can carry the request URL (both
 * Hermes' and node's fetch put it there), so only the CLASS of failure
 * survives. `AbortError` is separated from a network failure because the
 * two mean opposite things to a caller — one is us, one is the network.
 */
export function errorCategory(e: unknown): string {
  const name = (e as { name?: unknown } | null)?.name;
  if (name === "AbortError") return "aborted";
  if (name === "TimeoutError") return "timeout";
  if (typeof name === "string" && name) return `network error (${name})`;
  return "network error";
}

// ── Verbosity ────────────────────────────────────────────────────────────
//
// WHY THIS EXISTS: the overlay's per-anchor diagnostics were unconditional
// `console.log`s, and several of them describe a STEADY STATE rather than
// an event. A device run of the harness accumulated 895 copies of one line
// — a mark whose stored testID matches a differently-sized element, which
// the wrong-element guard correctly refuses to anchor, re-reported on every
// list refresh for as long as the screen is open. The condition is right;
// reporting it forever is not, and it buries the failures that matter in
// the host app's own console.
//
// So: failures stay on `console.warn` and are always shown. Diagnostics are
// opt-in, and the ones describing a lasting condition are said ONCE.
// (docs/audit/high-priority-security-privacy.md, "Use a deliberate logging
// policy and verbosity control".)

declare const process: { env: Record<string, string | undefined> };

function debugFromEnv(): boolean {
  try {
    // Metro inlines EXPO_PUBLIC_* only for literal member accesses.
    const raw = process.env.EXPO_PUBLIC_ANNOKIT_DEBUG;
    return raw === "1" || raw === "true";
  } catch {
    return false;
  }
}

let debugEnabled = debugFromEnv();

/**
 * Turn the overlay's diagnostic logging on or off for this run. Also
 * settable per-environment with `EXPO_PUBLIC_ANNOKIT_DEBUG=1`, and exposed
 * as the provider's `debug` prop.
 */
export function setAnnoKitDebug(on: boolean): void {
  debugEnabled = on;
  if (!on) said.clear();
}

export function annoKitDebugEnabled(): boolean {
  return debugEnabled;
}

/** A diagnostic worth printing every time it happens — when asked for. */
export function debugLog(message: string): void {
  if (debugEnabled) console.log(`[annokit] ${message}`);
}

/**
 * A diagnostic describing a CONDITION rather than an event: printed the
 * first time each distinct `key` occurs and never again. Bounded, so the
 * dedupe memory cannot become the leak it prevents; a key evicted from a
 * long-running session may print a second time, which is the trade.
 */
const said = new Set<string>();
const SAID_MEMORY = 128;

export function debugLogOnce(key: string, message: string): void {
  if (!debugEnabled || said.has(key)) return;
  if (said.size >= SAID_MEMORY) {
    const oldest = said.values().next().value;
    if (oldest !== undefined) said.delete(oldest);
  }
  said.add(key);
  console.log(`[annokit] ${message}`);
}

/** Tests. */
export function forgetSaidDiagnostics(): void {
  said.clear();
}
