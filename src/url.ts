/**
 * The ONE place a protocol request URL is assembled.
 *
 * Everything used to be `${endpoint}${path}`, which is wrong in two ways
 * the audit calls out (docs/audit/high-priority-security-privacy.md,
 * "Centralize safe URL construction"):
 *
 *   1. CAPABILITY ENDPOINTS CARRY A QUERY. Some servers treat the whole
 *      endpoint as the credential (src/env.ts AUTH NOTE), and that secret
 *      can live in a query string: `https://h/cap?k=hunter2`. Concatenating
 *      `/health` onto that produces `https://h/cap?k=hunter2/health` — the
 *      route lands inside the query value and the server sees a request for
 *      `/cap` instead. The route must go on the PATH and the base query has
 *      to survive alongside the route's own.
 *
 *   2. IDS WENT IN RAW. A session or annotation id containing `/`, `?`, `#`
 *      or a space could change which route was called (or smuggle a query
 *      parameter into it). Every dynamic segment is encoded here, once.
 *
 * Hand-rolled rather than `new URL`: this module is pure and must answer
 * identically in a node test and in Hermes, which is the same reason
 * src/log.ts hand-rolls its host parsing.
 */

/**
 * Encode one dynamic path segment (a session id, an annotation id, a
 * comment id — anything that came from the server, the host app or a user).
 *
 * `encodeURIComponent` leaves `!'()*` alone; they are legal in a path
 * segment, so that is fine. What matters is that `/`, `?`, `#` and `%`
 * cannot escape the segment they were given.
 */
export function seg(value: string | number): string {
  const text = String(value);
  // A poison segment keeps route builders fail-soft; joinUrl rejects it before I/O.
  if (!validResourceId(text)) return "\0";
  try { return encodeURIComponent(text); }
  catch { return "\0"; } // An unpaired surrogate must also fail before I/O.
}

/**
 * What `seg` can encode and a route can carry.
 *
 * The last clause is why this is a function and not one more character
 * class: an unpaired surrogate passes every such test and still makes
 * `encodeURIComponent` throw. Callers gate on this BEFORE a route exists
 * (`env.ts` on the session id, `events.ts` on the stream), so what it
 * accepts has to be exactly what `seg` can encode — otherwise a value
 * clears the gate, poisons the segment, and `joinUrl` throws out of a
 * caller with no catch. Asking `encodeURIComponent` is cheaper than
 * spelling surrogate pairing in a RegExp, and cannot disagree with it.
 */
export function validResourceId(value: string): boolean {
  if (value.length === 0 || value === "." || value === "..") return false;
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;
  try {
    encodeURIComponent(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Is this endpoint well-formed enough to send a protocol request to?
 *
 * STRUCTURE, NOT TRANSPORT POLICY. This refuses what cannot be a protocol
 * endpoint at all — a non-HTTP scheme (`file:`, `ftp:`), whitespace or a
 * backslash smuggled into the URL, a malformed authority, an impossible
 * port. It deliberately does NOT refuse plaintext HTTP: the adopter picks
 * the endpoint, the overlay only runs under `__DEV__`, and a LAN address
 * is how a physical device reaches a local stub server. Forcing HTTPS here
 * broke that workflow to protect a host from a choice that is theirs.
 *
 * Plaintext is still worth saying out loud — see `plaintextRemote`, which
 * the config warns on once. Warning is the honest control: the package
 * cannot secure a network it does not own, and pretending otherwise by
 * refusing the request only moves the developer to a worse workaround.
 */
export function safeEndpoint(endpoint: string): boolean {
  if (/[\s\\]/.test(endpoint)) return false;
  const match = /^(https?):\/\/([^/?#]+)(?:[/?#]|$)/i.exec(endpoint);
  if (!match) return false;
  // Userinfo is supported for existing capability URLs.
  const authority = match[2];
  const hostPort = authority.slice(authority.lastIndexOf("@") + 1);
  if (!/^(?:[a-z0-9.-]+|\[[a-f0-9:]+\])(?::[0-9]{1,5})?$/i.test(hostPort)) return false;
  const port = /:([0-9]+)$/.exec(hostPort);
  if (port && Number(port[1]) > 65535) return false;
  return true;
}

/**
 * HTTP to somewhere that is not this machine — a bearer token and any
 * screenshot cross the network in the clear. Not refused (see above), but
 * the one thing the adopter should be told exactly once.
 */
export function plaintextRemote(endpoint: string): boolean {
  const match = /^(https?):\/\/([^/?#]+)(?:[/?#]|$)/i.exec(endpoint);
  if (!match || match[1].toLowerCase() !== "http") return false;
  const authority = match[2];
  const hostPort = authority.slice(authority.lastIndexOf("@") + 1);
  return !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?$/i.test(hostPort);
}

/** Split "path?query#fragment" into its parts. Fragments are dropped. */
function parts(input: string): { path: string; query: string } {
  const noFragment = input.split("#")[0] ?? "";
  const q = noFragment.indexOf("?");
  if (q === -1) return { path: noFragment, query: "" };
  return { path: noFragment.slice(0, q), query: noFragment.slice(q + 1) };
}

/**
 * Join a configured endpoint and a protocol route into a request URL.
 *
 * - The route's path is appended to the endpoint's path, with exactly one
 *   `/` between them.
 * - The endpoint's query is PRESERVED and the route's query is appended to
 *   it, so a capability parameter survives every route.
 * - Fragments are dropped from both: they are never sent to a server, and a
 *   `#` left in the middle of a concatenation would truncate the request.
 *
 * Fail-soft, like the transport it serves: a blank endpoint yields the bare
 * route rather than throwing into the host app.
 */
export function joinUrl(endpoint: string, route: string): string {
  if (/[\u0000-\u0020\u007f\\]/.test(route) ||
      parts(route).path.split("/").some((part) => /^(?:\.|%2e){1,2}$/i.test(part))) {
    throw new Error("Invalid protocol route");
  }
  const base = parts((endpoint ?? "").trim());
  const rel = parts(route ?? "");

  // One slash between the two paths, and none trailing.
  const basePath = base.path.replace(/\/+$/, "");
  const relPath = rel.path === "" ? "" : rel.path.startsWith("/") ? rel.path : `/${rel.path}`;

  const query = [base.query, rel.query].filter(Boolean).join("&");
  return `${basePath}${relPath}${query ? `?${query}` : ""}`;
}

/**
 * Build a query string from name/value pairs, skipping null/undefined.
 * Returns "" (not "?") when nothing survives, so it concatenates safely.
 */
export function query(params: Record<string, string | number | null | undefined>): string {
  const pairs = Object.entries(params)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return pairs.length === 0 ? "" : `?${pairs.join("&")}`;
}

// ── Session-scoped protocol routes ───────────────────────────────────────
//
// The per-resource routes live with their readers (src/comments.ts,
// src/thread.ts, src/pending.ts, src/attachments.ts) — these are the
// session-prefixed ones, which had no home and so were interpolated by hand
// at four call sites, three of them without encoding the id.

/** `GET /sessions/:id` — the session with every annotation in it. */
export function sessionPath(sessionId: string): string {
  return `/sessions/${seg(sessionId)}`;
}

/** `POST /sessions/:id/annotations` — create an annotation. */
export function sessionAnnotationsPath(sessionId: string): string {
  return `/sessions/${seg(sessionId)}/annotations`;
}

/** `GET /sessions/:id/pending` — the agent queue. */
export function sessionPendingPath(sessionId: string): string {
  return `/sessions/${seg(sessionId)}/pending`;
}

/** `GET /sessions/:id/events` — the SSE stream (src/events.ts). */
export function sessionEventsPath(sessionId: string): string {
  return `/sessions/${seg(sessionId)}/events`;
}

/** `POST /annotations/:id/screenshot` — the multipart upload. */
export function annotationScreenshotPath(annotationId: string): string {
  return `/annotations/${seg(annotationId)}/screenshot`;
}

/**
 * The origin of a URL — scheme + authority, lowercased, or null when it
 * cannot be determined (a relative URL, a blank string).
 *
 * Hand-rolled for the same reason as everything else here: identical
 * answers in node and Hermes. Userinfo is NOT part of an origin and is
 * dropped, which is also what keeps it out of the comparison — and out of
 * anything built from the result.
 */
export function originOf(url: string | null | undefined): string | null {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]*)/.exec(trimmed);
  if (!m) return null;
  const scheme = (m[1] ?? "").toLowerCase();
  const authority = m[2] ?? "";
  const host = authority.includes("@") ? authority.slice(authority.lastIndexOf("@") + 1) : authority;
  if (!host) return null;
  return `${scheme}://${host.toLowerCase()}`;
}

/** True when both URLs have a determinable and identical origin. */
export function sameOrigin(a: string | null | undefined, b: string | null | undefined): boolean {
  const oa = originOf(a);
  return oa !== null && oa === originOf(b);
}

/**
 * Did this response come back from where we sent it?
 *
 * True when the origins match, and ALSO true when the final URL is unknown
 * — a runtime that does not populate `res.url`/`responseURL` must make the
 * check abstain rather than fail every request. Used by both the fetch and
 * the XHR paths so their redirect policy cannot drift apart.
 */
export function sameOriginOrUnknown(
  requestUrl: string,
  finalUrl: string | null | undefined,
): boolean {
  if (typeof finalUrl !== "string" || finalUrl === "") return true;
  return sameOrigin(requestUrl, finalUrl);
}
