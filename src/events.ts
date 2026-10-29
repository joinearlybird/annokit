/**
 * Server-push event stream (plan item 5b): `GET /sessions/:sid/events` as
 * SSE, so agent replies and status changes arrive when they happen instead
 * of on the next 30-second poll.
 *
 * PUSH REPLACES THE CADENCE, NOT THE READS. An event never carries state
 * into the UI — it only triggers the SAME refresh paths the poll timers
 * drive (refreshPending, the open pane's re-read), so every anti-clobber
 * rule those reads enforce (src/thread.ts applyPolledThread, the comment
 * poll rules) keeps holding. The poll timers stay armed underneath as the
 * backstop: a dropped or never-connecting stream costs latency, never
 * correctness.
 *
 * BOTH FLAVORS SPEAK IT. agentation-mcp ships this exact route (verified
 * live — named events with monotonic `id:` sequence numbers, a
 * `: connected` comment on open); our servers (fe-sandbox, the harness
 * stub) implement the same path and framing. Event NAMES are advisory —
 * any event on a session means "something you may care about changed", and
 * the refreshes are cheap idempotent reads — so unknown types are
 * deliberately still delivered to listeners.
 *
 * TRANSPORT: React Native has no EventSource and its fetch cannot stream a
 * body, but its XMLHttpRequest DOES deliver progressive `responseText`
 * (readyState LOADING fires repeatedly) — the same mechanism react-native-
 * sse rides. On react-native-web the same XHR path works, so there is one
 * implementation, structurally typed like src/transport.ts's XhrLike.
 *
 * FAIL-SOFT: connect errors reconnect with doubling backoff (capped), and
 * after MAX_CONSECUTIVE_FAILURES the stream gives up for the session —
 * loudly once, not per attempt — leaving the polls in charge, exactly as
 * before 5b existed.
 *
 * WHILE THE STREAM IS LIVE, THE POLLS STAND DOWN. A backstop timer catches
 * what a missing stream would have announced; with the stream delivering,
 * it only re-asks for what nothing has said changed — on a local stub, or
 * a session one person is using, that was every request it made. So the
 * stream publishes whether it is LIVE (`streamLive`), and the timers run
 * only while it is not. Live means BYTES ARRIVING, not a socket open: a
 * proxy that buffers the stream holds the connection and delivers nothing,
 * and that must not silence the polls. The protocol asks for a comment
 * line every ~15s, so a stream quiet for STREAM_STALE_MS is taken as down
 * — a server that sends no keepalives simply keeps its polls.
 */

import type { AnnoKitConfig } from "./env";
import { errorCategory, requestLabel, warnRequestFailed } from "./log";
import { joinUrl, safeEndpoint, validResourceId, sameOriginOrUnknown, sessionEventsPath } from "./url";

/** One parsed SSE frame. `data` is the raw string — consumers re-read, never parse state out of events. */
export interface AnnoKitServerEvent {
  type: string;
  data?: string;
}

export type AnnoKitEventListener = (event: AnnoKitServerEvent) => void;

// ── The in-process fan-out ──────────────────────────────────────────────────
//
// One stream per session, many readers (the root refreshes the lists, an
// open pane re-reads itself). A tiny module-level emitter keeps the panes
// from needing the stream threaded through props.

const listeners = new Set<AnnoKitEventListener>();

export function onAnnoKitEvent(listener: AnnoKitEventListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitAnnoKitEvent(event: AnnoKitServerEvent): void {
  for (const l of [...listeners]) {
    try {
      l(event);
    } catch (e) {
      console.warn("[annokit] event listener threw:", e);
    }
  }
}

/** Tests. */
export function clearAnnoKitEventListeners(): void {
  listeners.clear();
  liveListeners.clear();
}

// ── SSE frame parsing (pure, tested) ────────────────────────────────────────

/**
 * Incremental parser state: SSE frames are blocks separated by a blank
 * line; a block's `event:` names it (default "message") and its `data:`
 * lines join with newlines. `id:` and comment (`:`) lines are skipped —
 * resume via Last-Event-ID is deliberately NOT implemented, because events
 * only trigger re-reads: a missed event is at worst one backstop-poll of
 * latency, and replay would deliver stale triggers.
 */
export interface SseParserState {
  buffer: string;
}

export function createSseParser(): SseParserState {
  return { buffer: "" };
}

/** Feed a chunk; get every COMPLETE frame (partial tail stays buffered). */
export function feedSseChunk(state: SseParserState, chunk: string): AnnoKitServerEvent[] {
  state.buffer += chunk;
  // An unterminated frame this large is not a frame — it is a server (or a
  // proxy) that will never send the blank line. Drop what is buffered
  // rather than growing it; the next complete frame parses normally.
  if (state.buffer.length > MAX_FRAME_BYTES) {
    console.warn(
      `[annokit] event stream: dropped an unterminated frame over ${MAX_FRAME_BYTES} bytes`,
    );
    state.buffer = "";
    return [];
  }
  const events: AnnoKitServerEvent[] = [];
  // Normalise CRLF once so the frame split is one rule.
  let normalized = state.buffer.replace(/\r\n/g, "\n");
  const frames = normalized.split("\n\n");
  state.buffer = frames.pop() ?? "";
  for (const frame of frames) {
    let type = "message";
    const data: string[] = [];
    for (const line of frame.split("\n")) {
      if (!line || line.startsWith(":")) continue;
      if (line.startsWith("event:")) type = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    // A frame with neither name nor data (pure id/comment block) is keepalive.
    if (type === "message" && data.length === 0) continue;
    events.push({ type, ...(data.length > 0 ? { data: data.join("\n") } : {}) });
  }
  return events;
}

// ── The stream itself ───────────────────────────────────────────────────────

/** Structural XHR slice (see src/transport.ts for why it is not the DOM type). */
interface StreamingXhr {
  readyState: number;
  status: number;
  responseText: string;
  /** The URL the response actually came from; "" when the host omits it. */
  responseURL?: string;
  onreadystatechange: (() => void) | null;
  onerror: (() => void) | null;
  open(method: string, url: string): void;
  setRequestHeader(name: string, value: string): void;
  send(): void;
  abort(): void;
}

// ── Liveness ────────────────────────────────────────────────────────────────

/** Three missed keepalives (the protocol asks for one every ~15s). */
export const STREAM_STALE_MS = 45_000;

let live = false;
const liveListeners = new Set<() => void>();

/** Is the event stream delivering right now? The polls run while it is not. */
export function streamLive(): boolean {
  return live;
}

/** `useSyncExternalStore`'s subscribe half for `streamLive`. */
export function subscribeToStreamLive(listener: () => void): () => void {
  liveListeners.add(listener);
  return () => {
    liveListeners.delete(listener);
  };
}

function setLive(next: boolean): void {
  if (next === live) return;
  live = next;
  for (const l of [...liveListeners]) l();
}

const XHR_LOADING = 3;
const XHR_DONE = 4;

const INITIAL_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 30_000;
/** After this many failures in a row the polls own it again. */
const MAX_CONSECUTIVE_FAILURES = 5;

/**
 * BOUNDS ON SERVER-CONTROLLED GROWTH (docs/audit — "Bound user and
 * server-controlled content").
 *
 * `responseText` on a streaming XHR is CUMULATIVE: it holds every byte the
 * server has ever sent on this connection, and a push stream is meant to
 * stay open for the whole session. Left alone it is an unbounded buffer
 * fed by the other end. At the ceiling the connection is recycled — abort,
 * reconnect, and the new XHR starts from an empty string — which costs one
 * reconnect and no events, since events only trigger re-reads.
 *
 * The parser buffer is the other half: a server that never sends a blank
 * line produces one frame that never completes, so an unterminated frame
 * past this size is dropped rather than accumulated.
 */
const MAX_STREAM_TEXT = 4 * 1024 * 1024;
const MAX_FRAME_BYTES = 256 * 1024;

function resolveXhr(): (new () => StreamingXhr) | null {
  const ctor = (globalThis as { XMLHttpRequest?: new () => StreamingXhr }).XMLHttpRequest;
  return typeof ctor === "function" ? ctor : null;
}

/**
 * Open the session's event stream and emit every frame through
 * `emitAnnoKitEvent`. Returns a stop function; safe to call in any state.
 * A host without XHR (node tests, SSR) is a no-op stop immediately.
 */
export function startAnnoKitEventStream(
  env: Pick<AnnoKitConfig, "endpoint" | "token">,
  sessionId: string,
): () => void {
  if (!safeEndpoint(env.endpoint) || !validResourceId(sessionId)) return () => {};
  const Xhr = resolveXhr();
  if (!Xhr) return () => {};

  /**
   * Built ONCE, here with the other refusals — not inside `connect`.
   *
   * The endpoint and session are captured and cannot change, so the URL is
   * the same on the first attempt and the fortieth. More importantly
   * `connect` is also the reconnect timer's callback: a route that cannot
   * be built would throw out of a `setTimeout` where nothing can catch it,
   * breaking the promise that this function never throws into the app. A
   * route that can never be built must therefore stop the stream before it
   * starts, the same answer a bad endpoint or a missing XHR already gets.
   */
  let streamUrl: string;
  let streamLabel: string;
  try {
    const route = sessionEventsPath(sessionId);
    streamUrl = joinUrl(env.endpoint, route);
    streamLabel = requestLabel("GET", env.endpoint, route);
  } catch {
    return () => {};
  }

  let stopped = false;
  let xhr: StreamingXhr | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  let backoff = INITIAL_BACKOFF_MS;
  /** Fires when the stream has gone STREAM_STALE_MS without a byte. */
  let staleTimer: ReturnType<typeof setTimeout> | null = null;

  const clearStale = () => {
    if (staleTimer !== null) {
      clearTimeout(staleTimer);
      staleTimer = null;
    }
  };

  /** Bytes arrived: live, until the next STREAM_STALE_MS of silence. */
  const heard = () => {
    clearStale();
    staleTimer = setTimeout(() => {
      staleTimer = null;
      setLive(false);
    }, STREAM_STALE_MS);
    setLive(true);
  };

  /** Not delivering, for whatever reason: the polls take over. */
  const deaf = () => {
    clearStale();
    setLive(false);
  };

  /** Cancel the pending reconnect, if any. At most one exists at a time. */
  const clearRetry = () => {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

  /** Drop the current XHR, deaf and aborted, so it cannot call back. */
  const discard = (req: StreamingXhr | null) => {
    if (!req) return;
    req.onreadystatechange = null;
    req.onerror = null;
    try {
      req.abort();
    } catch {
      /* an aborted abort is nothing */
    }
  };

  const connect = () => {
    if (stopped) return;
    // Defensive: nothing should reach here with a live connection, but a
    // second one would mean two streams emitting into the same fan-out.
    discard(xhr);
    clearRetry();

    const parser = createSseParser();
    let seen = 0;
    let gotFrames = false;
    /**
     * THIS CONNECTION HAS FINISHED — at most once.
     *
     * `readystatechange` at DONE and `onerror` both fire on some runtimes
     * for a single failed request, and without this guard one dead XHR
     * counted two failures and scheduled two reconnects — which then each
     * scheduled two more. The give-up threshold arrived at half the
     * attempts it describes, and the "one stream" invariant was only ever
     * true by luck.
     */
    let settled = false;
    const req = new Xhr();
    xhr = req;

    const drain = () => {
      // Same redirect policy as the transport: a stream that came back from
      // another origin is not this session's stream, and the bearer rode
      // the request that reached it. Checked here because this is the first
      // point at which the answer exists.
      if (!sameOriginOrUnknown(streamUrl, req.responseURL)) {
        warnRequestFailed(streamLabel, "refused: cross-origin redirect");
        finish(null);
        return;
      }
      // Progressive text: everything past what we have already parsed.
      const text = req.responseText;
      if (text.length <= seen) return;
      const chunk = text.slice(seen);
      seen = text.length;
      // ANY bytes on a 200, comments included: the keepalive is a comment.
      if (req.status === 200) heard();
      for (const event of feedSseChunk(parser, chunk)) {
        gotFrames = true;
        // Any frame — even a named keepalive — proves the pipe works.
        failures = 0;
        backoff = INITIAL_BACKOFF_MS;
        emitAnnoKitEvent(event);
      }
      // Cumulative buffer ceiling: recycle the connection rather than let
      // the server grow one string for the life of the session.
      if (text.length > MAX_STREAM_TEXT) {
        console.warn("[annokit] event stream: response ceiling reached, reconnecting");
        recycle();
      }
    };

    /** Finish this connection and schedule the next, exactly once. */
    const finish = (reconnectIn: number | null) => {
      if (settled) return;
      settled = true;
      discard(req);
      if (xhr === req) {
        xhr = null;
        deaf();
      }
      if (reconnectIn === null || stopped) return;
      clearRetry();
      retryTimer = setTimeout(connect, reconnectIn);
    };

    /** A healthy stream that grew too large: restart it immediately-ish. */
    const recycle = () => finish(INITIAL_BACKOFF_MS);

    const ended = () => {
      if (stopped || settled) return;
      drain();
      // A stream that delivered frames and then closed is a server restart
      // or an idle timeout — reconnect on the base delay. One that never
      // delivered (404, refused, proxy-buffered) counts toward giving up.
      if (!gotFrames) {
        failures += 1;
        if (failures >= MAX_CONSECUTIVE_FAILURES) {
          console.warn("[annokit] event stream unavailable — staying on polling");
          finish(null);
          return;
        }
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      }
      finish(gotFrames ? INITIAL_BACKOFF_MS : backoff);
    };

    req.onreadystatechange = () => {
      if (settled) return;
      if (req.readyState === XHR_LOADING) drain();
      else if (req.readyState === XHR_DONE) ended();
    };
    req.onerror = ended;
    try {
      req.open("GET", streamUrl);
      req.setRequestHeader("Accept", "text/event-stream");
      if (env.token) req.setRequestHeader("Authorization", `Bearer ${env.token}`);
      req.send();
    } catch (e) {
      // Redacted: the endpoint may itself be the credential (src/log.ts).
      warnRequestFailed(streamLabel, errorCategory(e));
      ended();
    }
  };

  connect();

  return () => {
    stopped = true;
    clearRetry();
    discard(xhr);
    xhr = null;
    deaf();
  };
}
