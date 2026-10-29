/**
 * agentation-mcp compat — the destination adapter that lets this overlay
 * talk to the npm `agentation` ecosystem's local server (`agentation-mcp
 * server`, HTTP on :4747) instead of an AnnoKit Protocol v1 server, so an
 * existing agentation + Claude Code/Cursor user gets the whole
 * annokit-on-the-phone → `agentation_watch_annotations` → reply/resolve
 * loop with zero changes on their side.
 *
 * VERIFIED LIVE against `agentation-mcp@1.3.2` on 2026-09-23, from the bare
 * React Native example: `/health` answered `{status:"ok",mode:"local"}` with
 * no `protocolVersion` (the flavor detection in 5 below), `POST /sessions`
 * returned a server-assigned id, and every subsequent poll used THAT id
 * rather than the one the app was configured with — delta 2, observed
 * rather than inferred. On 2026-10-29, again against 1.3.2, an annotation
 * created on the iOS Simulator from examples/expo landed in its pending
 * list (what `agentation_get_pending` returns) with element, elementPath
 * carrying file:line, and nearbyText; the composer showed no attach or
 * screenshot controls and disabled Comment. 1.3.2 also has a `sourceFile`
 * field that delta 4 below predates and this adapter leaves null.
 *
 * Wire facts below were probed live against `agentation-mcp@1.2.0`
 * (the recorded responses live on in test/handshake.test.ts). The shape of
 * the adapter follows from five deltas:
 *
 *   1. THEIR SERVER ASSIGNS ANNOTATION IDS (a client-sent id is silently
 *      discarded). The composer therefore re-keys everything — markers,
 *      scroll anchors, the thread route — to the id the POST RETURNS. (Our
 *      own server echoes the client id, so reading it back is harmless
 *      there too: the composer just always trusts the response.)
 *   2. SESSIONS ARE SERVER-ASSIGNED AND NEVER DEDUPED: `POST /sessions`
 *      with the same `url` twice makes two sessions. The handshake creates
 *      ONE per app run and everything else uses the returned id.
 *   3. NO SCREENSHOTS, NO ATTACHMENTS, NO REFERENCES — no upload routes at
 *      all. Compat mode skips the screenshot capture (no switch renders)
 *      and empties the attach sources (no "+ Attach" renders).
 *   4. FIELD SPELLINGS differ (componentStack[] → reactComponents JSON
 *      string, elementPath display chain, no source/file:line slot, thread
 *      role "human" vs our "user", ms-epoch thread timestamps). Pure
 *      mappers here translate both directions.
 *   5. NO PROTOCOL HANDSHAKE: their `/health` answers `{status:"ok",mode}`
 *      with no `protocolVersion`. That absence IS the flavor detection.
 *
 * Everything platform-only degrades the way it already degrades against an
 * older v1 server: comments 404 → the Comment commit disables with its
 * notice; `/me` 404 → the local identity tiers stand.
 */

import type { ServerAnnotation } from "./types";
import type { ThreadMessage } from "./thread";
import type { AnnotationBody } from "./payload";

// ── Flavor ──────────────────────────────────────────────────────────────────

export type ServerFlavor = "annokit" | "agentation";

/**
 * Module state, like the negotiated protocol version (src/handshake.ts):
 * the readers (composer, thread, index) are many components away from the
 * one detection site, and threading a constant through the tree for a fact
 * that cannot change after activation is the worse trade.
 */
let flavor: ServerFlavor = "annokit";

export function serverFlavor(): ServerFlavor {
  return flavor;
}

export function setServerFlavor(next: ServerFlavor): void {
  flavor = next;
}

/** Tests, and anything that swaps servers under us. */
export function forgetServerFlavor(): void {
  flavor = "annokit";
}

/**
 * What kind of server answered /health.
 *
 *   - ANY `protocolVersion` present → an AnnoKit Protocol server. Even a
 *     malformed one (a string "1", a float): a server that knows the field
 *     is protocol-aware and must face the version check, not slip into
 *     compat for a different protocol entirely;
 *   - `status: "ok"` with NO protocolVersion → agentation-mcp (verified:
 *     it answers `{"status":"ok","mode":"local"}`);
 *   - anything else → unrecognisable, and the caller disables as before.
 */
export function detectFlavor(health: {
  status?: unknown;
  protocolVersion?: unknown;
}): ServerFlavor | null {
  if (health.protocolVersion !== undefined) return "annokit";
  if (health.status === "ok") return "agentation";
  return null;
}

// ── Outbound: our capture → their Annotation ────────────────────────────────

/** Their POST body. Field names and encodings from the shipped d.ts. */
export interface AgentationAnnotationBody {
  x: number;
  y: number;
  comment: string;
  element: string;
  elementPath: string;
  timestamp: number;
  boundingBox?: { x: number; y: number; width: number; height: number };
  nearbyText?: string;
  nearbyElements?: string;
  computedStyles?: string;
  accessibility?: string;
  isMultiSelect?: boolean;
  reactComponents?: string;
  url?: string;
  intent?: "fix" | "change" | "question" | "approve";
}

/**
 * Map a composed protocol-v1 body onto agentation's Annotation.
 *
 * Their `timestamp` is required (ms epoch, client-supplied), so it is a
 * parameter rather than a Date.now() here — payload construction stays
 * pure/deterministic for tests, same rule as payload.ts.
 *
 * Lossy on purpose, never silently: `source` (file:line) has no slot, so
 * it rides at the end of `elementPath` where their UI shows a locator
 * string; `elements[]` has no slot, so extras are summarised into
 * `nearbyElements` (a JSON string field they already define) and
 * `isMultiSelect` stays true; `references`/`scroll`/`testID`/`kind`/
 * `platform` are dropped — nothing on their side could read them.
 */
export function toAgentationAnnotation(
  body: AnnotationBody,
  timestamp: number,
): AgentationAnnotationBody {
  const chain = body.componentStack.length > 0 ? body.componentStack : [body.element];
  const locator = body.source ? ` (${body.source.file}:${body.source.line})` : "";
  return {
    x: body.x,
    y: body.y,
    comment: body.comment,
    element: body.element,
    elementPath: chain.join(" > ") + locator,
    timestamp,
    boundingBox: body.boundingBox,
    nearbyText: body.nearbyText,
    computedStyles: body.computedStyles,
    accessibility: body.accessibility,
    isMultiSelect: body.isMultiSelect,
    reactComponents:
      body.componentStack.length > 0 ? JSON.stringify(body.componentStack) : undefined,
    nearbyElements:
      body.elements && body.elements.length > 1
        ? JSON.stringify(body.elements.slice(1).map((e) => e.element))
        : undefined,
    url: body.routeName ? `app://native${body.routeName}` : "app://native/",
    intent: "change",
  };
}

// ── Inbound: their annotation → our ServerAnnotation ────────────────────────

/** Their thread role → ours. Anything unrecognised reads as the human's. */
function toOurRole(role: unknown): ThreadMessage["role"] {
  return role === "agent" ? "agent" : "user";
}

/** Their ms-epoch stamps → the ISO strings the thread UI formats. */
function toIso(timestamp: unknown): string | undefined {
  return typeof timestamp === "number" && Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString()
    : undefined;
}

export function fromAgentationThreadMessage(m: {
  id?: unknown;
  role?: unknown;
  content?: unknown;
  timestamp?: unknown;
}): ThreadMessage {
  return {
    id: typeof m.id === "string" ? m.id : String(m.id ?? ""),
    content: typeof m.content === "string" ? m.content : "",
    role: toOurRole(m.role),
    timestamp: toIso(m.timestamp),
  };
}

/**
 * Their stored annotation, as the queue/detail views read one of ours.
 * Null-heavy on purpose: their GET answers absent optionals as explicit
 * nulls, and our readers treat undefined and null alike.
 */
export function fromAgentationAnnotation(a: Record<string, unknown>): ServerAnnotation {
  const thread = Array.isArray(a.thread)
    ? (a.thread as Record<string, unknown>[]).map(fromAgentationThreadMessage)
    : undefined;
  const url = typeof a.url === "string" ? a.url : undefined;
  return {
    id: String(a.id ?? ""),
    comment: typeof a.comment === "string" ? a.comment : undefined,
    element: typeof a.element === "string" ? a.element : undefined,
    x: typeof a.x === "number" ? a.x : undefined,
    y: typeof a.y === "number" ? a.y : undefined,
    boundingBox: (a.boundingBox ?? undefined) as ServerAnnotation["boundingBox"],
    // Their url carries what our routeName does (the handshake writes
    // `app://native<route>`); anything else stays a plain url string the
    // views simply do not route by.
    routeName: url?.startsWith("app://native") ? url.slice("app://native".length) : undefined,
    status: typeof a.status === "string" ? a.status : undefined,
    createdAt: typeof a.createdAt === "string" ? a.createdAt : undefined,
    timestamp: typeof a.timestamp === "number" ? a.timestamp : undefined,
    thread,
  };
}

/** The pending/list payloads, both shapes their routes answer. */
export function fromAgentationList(data: unknown): ServerAnnotation[] {
  const list = Array.isArray(data)
    ? data
    : Array.isArray((data as { annotations?: unknown[] } | null)?.annotations)
      ? (data as { annotations: unknown[] }).annotations
      : [];
  return list
    .filter((a): a is Record<string, unknown> => typeof a === "object" && a !== null)
    .map(fromAgentationAnnotation)
    .filter((a) => a.id);
}
