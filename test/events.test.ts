/**
 * Server-push event stream (src/events.ts): SSE parsing, the fan-out, and
 * the XHR streaming lifecycle — reconnects, give-up, stop. Framing matches
 * what a live agentation-mcp answered (`: connected` comment, named events
 * with `id:` sequence lines) and what fe-sandbox/the stub emit.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAnnoKitEventListeners,
  createSseParser,
  emitAnnoKitEvent,
  feedSseChunk,
  STREAM_STALE_MS,
  onAnnoKitEvent,
  startAnnoKitEventStream,
  streamLive,
  subscribeToStreamLive,
} from "../src/events";
import type { AnnoKitServerEvent } from "../src/events";

afterEach(() => {
  clearAnnoKitEventListeners();
});

describe("SSE frame parsing", () => {
  it("parses a named event with data, exactly as agentation-mcp frames one", () => {
    const p = createSseParser();
    const events = feedSseChunk(
      p,
      'event: annotation.created\nid: 7\ndata: {"type":"annotation.created"}\n\n',
    );
    expect(events).toEqual([
      { type: "annotation.created", data: '{"type":"annotation.created"}' },
    ]);
  });

  it("holds a partial frame until its blank line arrives", () => {
    const p = createSseParser();
    expect(feedSseChunk(p, "event: thread.message\ndata: {}")).toEqual([]);
    expect(feedSseChunk(p, "\n\n")).toEqual([{ type: "thread.message", data: "{}" }]);
  });

  it("delivers several frames from one chunk, in order", () => {
    const p = createSseParser();
    const events = feedSseChunk(
      p,
      "event: a\ndata: 1\n\nevent: b\ndata: 2\n\n",
    );
    expect(events.map((e) => e.type)).toEqual(["a", "b"]);
  });

  it("skips comments and bare-id keepalives (the ': connected' greeting)", () => {
    const p = createSseParser();
    expect(feedSseChunk(p, ": connected\n\nid: 4\n\n")).toEqual([]);
  });

  it("joins multi-line data and tolerates CRLF framing", () => {
    const p = createSseParser();
    expect(feedSseChunk(p, "data: one\r\ndata: two\r\n\r\n")).toEqual([
      { type: "message", data: "one\ntwo" },
    ]);
  });

  it("a named event without data still delivers (the name is the signal)", () => {
    const p = createSseParser();
    expect(feedSseChunk(p, "event: session.updated\n\n")).toEqual([
      { type: "session.updated" },
    ]);
  });
});

describe("the fan-out", () => {
  it("delivers to every listener and survives one throwing", () => {
    const seen: string[] = [];
    onAnnoKitEvent(() => {
      throw new Error("bad listener");
    });
    onAnnoKitEvent((e) => seen.push(e.type));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    emitAnnoKitEvent({ type: "annotation.updated" });
    expect(seen).toEqual(["annotation.updated"]);
    warn.mockRestore();
  });

  it("unsubscribe is the returned function", () => {
    const seen: string[] = [];
    const off = onAnnoKitEvent((e) => seen.push(e.type));
    off();
    emitAnnoKitEvent({ type: "x" });
    expect(seen).toEqual([]);
  });
});

// ── The XHR lifecycle, against a scripted fake ─────────────────────────────

class FakeXhr {
  static instances: FakeXhr[] = [];
  readyState = 0;
  status = 200;
  responseText = "";
  responseURL = "";
  onreadystatechange: (() => void) | null = null;
  onerror: (() => void) | null = null;
  url = "";
  headers: Record<string, string> = {};
  aborted = false;
  open(_method: string, url: string) {
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send() {
    FakeXhr.instances.push(this);
  }
  abort() {
    this.aborted = true;
  }
  /** Test driver: stream a chunk. */
  chunk(text: string) {
    this.responseText += text;
    this.readyState = 3;
    this.onreadystatechange?.();
  }
  /** Test driver: server closed the stream. */
  end() {
    this.readyState = 4;
    this.onreadystatechange?.();
  }
  /** Test driver: the transport failed. */
  fail() {
    this.onerror?.();
  }
  /**
   * Test driver: a runtime that had ALREADY queued its callbacks before the
   * stream settled, and delivers them afterwards anyway. Clearing the
   * handlers cannot help here — only the settled guard can.
   */
  queuedCallbacks(): { done: () => void; error: () => void } {
    const onreadystatechange = this.onreadystatechange;
    const onerror = this.onerror;
    return {
      done: () => {
        this.readyState = 4;
        onreadystatechange?.();
      },
      error: () => onerror?.(),
    };
  }
}

const ENV = { endpoint: "https://sandbox.example", token: "tok" };

describe("startAnnoKitEventStream", () => {
  beforeEach(() => {
    FakeXhr.instances = [];
    vi.useFakeTimers();
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  /**
   * The stream's connect() builds its URL with no try/catch, and the
   * reconnect timer calls it again — so an id that poisons the segment
   * would throw where nothing can catch it, breaking the fail-soft
   * contract on a timer. The id gate must refuse it before that.
   */
  it("declines an unencodable session id instead of throwing out of connect()", () => {
    let stop: (() => void) | undefined;
    expect(() => { stop = startAnnoKitEventStream(ENV, "sess\uD800"); }).not.toThrow();
    expect(FakeXhr.instances).toHaveLength(0);
    expect(() => stop?.()).not.toThrow();
    // Nothing was scheduled, so draining the timers cannot reach connect().
    expect(() => vi.runOnlyPendingTimers()).not.toThrow();
  });

  it("opens the session events route with the bearer and emits parsed frames", () => {
    const seen: AnnoKitServerEvent[] = [];
    onAnnoKitEvent((e) => seen.push(e));
    const stop = startAnnoKitEventStream(ENV, "sess-1");
    const req = FakeXhr.instances[0];
    expect(req.url).toBe("https://sandbox.example/sessions/sess-1/events");
    expect(req.headers.Accept).toBe("text/event-stream");
    expect(req.headers.Authorization).toBe("Bearer tok");
    req.chunk(": connected\n\nevent: annotation.created\ndata: {}\n\n");
    expect(seen).toEqual([{ type: "annotation.created", data: "{}" }]);
    stop();
    expect(req.aborted).toBe(true);
  });

  it("a stream that worked and then closed reconnects on the base delay", () => {
    const stop = startAnnoKitEventStream(ENV, "s");
    const first = FakeXhr.instances[0];
    first.chunk("event: thread.message\ndata: {}\n\n");
    first.end();
    expect(FakeXhr.instances).toHaveLength(1);
    vi.advanceTimersByTime(2_000);
    expect(FakeXhr.instances).toHaveLength(2);
    stop();
  });

  it("gives up loudly after consecutive dead connections, leaving polling in charge", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stop = startAnnoKitEventStream(ENV, "s");
    // 5 attempts that never deliver a frame; backoff doubles 4s,8s,16s,30s.
    for (let i = 0; i < 5; i++) {
      FakeXhr.instances[FakeXhr.instances.length - 1].end();
      vi.advanceTimersByTime(60_000);
    }
    expect(FakeXhr.instances).toHaveLength(5);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("staying on polling"));
    warn.mockRestore();
    stop();
  });

  it("stop() during a backoff wait cancels the reconnect", () => {
    const stop = startAnnoKitEventStream(ENV, "s");
    FakeXhr.instances[0].end();
    stop();
    vi.advanceTimersByTime(120_000);
    expect(FakeXhr.instances).toHaveLength(1);
  });

  it("a host without XMLHttpRequest is a silent no-op", () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("XMLHttpRequest", undefined);
    const stop = startAnnoKitEventStream(ENV, "s");
    expect(FakeXhr.instances).toHaveLength(0);
    stop();
  });
});

// ── Termination is idempotent ────────────────────────────────────────────
//
// "One connection attempt can produce at most one reconnect, and stopping
// always leaves zero active XHRs and timers."
// (docs/audit/performance-correctness.md)

describe("stream termination", () => {
  beforeEach(() => {
    FakeXhr.instances = [];
    vi.useFakeTimers();
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  /** Wind past every backoff so any scheduled reconnect has to show up. */
  function settle(): void {
    vi.advanceTimersByTime(120_000);
  }

  it("DONE followed by onerror reconnects once, not twice", () => {
    const stop = startAnnoKitEventStream(ENV, "s");
    const queued = FakeXhr.instances[0].queuedCallbacks();
    queued.done();
    queued.error(); // the same dead request, reported twice
    settle();
    expect(FakeXhr.instances).toHaveLength(2);
    stop();
  });

  it("onerror followed by DONE reconnects once, not twice", () => {
    const stop = startAnnoKitEventStream(ENV, "s");
    const queued = FakeXhr.instances[0].queuedCallbacks();
    queued.error();
    queued.done();
    settle();
    expect(FakeXhr.instances).toHaveLength(2);
    stop();
  });

  it("counts one failure per dead connection, so give-up takes the full five", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stop = startAnnoKitEventStream(ENV, "s");
    for (let i = 0; i < 4; i++) {
      const queued = FakeXhr.instances[FakeXhr.instances.length - 1].queuedCallbacks();
      queued.done();
      queued.error(); // double-reported every time
      vi.advanceTimersByTime(60_000);
    }
    // Four dead connections is four failures, not eight: still trying.
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("staying on polling"));
    expect(FakeXhr.instances).toHaveLength(5);
    FakeXhr.instances[4].end();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("staying on polling"));
    settle();
    expect(FakeXhr.instances).toHaveLength(5); // gave up: no sixth attempt
    warn.mockRestore();
    stop();
  });

  it("keeps at most one live XHR across a reconnect", () => {
    const stop = startAnnoKitEventStream(ENV, "s");
    const first = FakeXhr.instances[0];
    first.chunk("event: a\ndata: 1\n\n");
    first.end();
    vi.advanceTimersByTime(2_000);
    expect(FakeXhr.instances).toHaveLength(2);
    // The replaced one is aborted and deaf.
    expect(first.aborted).toBe(true);
    expect(first.onreadystatechange).toBeNull();
    expect(first.onerror).toBeNull();
    stop();
  });

  it("stop() before a terminal callback leaves no reconnect and no timers", () => {
    const stop = startAnnoKitEventStream(ENV, "s");
    const queued = FakeXhr.instances[0].queuedCallbacks();
    stop();
    queued.done();
    queued.error();
    settle();
    expect(FakeXhr.instances).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stop() after a terminal callback cancels the scheduled reconnect", () => {
    const stop = startAnnoKitEventStream(ENV, "s");
    FakeXhr.instances[0].end();
    stop();
    settle();
    expect(FakeXhr.instances).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stop() is safe to call twice", () => {
    const stop = startAnnoKitEventStream(ENV, "s");
    stop();
    expect(() => stop()).not.toThrow();
    settle();
    expect(FakeXhr.instances).toHaveLength(1);
  });

  it("a settled connection cannot emit again", () => {
    const seen: AnnoKitServerEvent[] = [];
    onAnnoKitEvent((e) => seen.push(e));
    const stop = startAnnoKitEventStream(ENV, "s");
    const req = FakeXhr.instances[0];
    const queued = req.queuedCallbacks();
    queued.done();
    // A late chunk on the dead connection must not reach the fan-out.
    req.chunk("event: late\ndata: {}\n\n");
    queued.error();
    expect(seen.filter((e) => e.type === "late")).toEqual([]);
    stop();
  });

  it("recycles the connection when the cumulative response hits its ceiling", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stop = startAnnoKitEventStream(ENV, "s");
    const first = FakeXhr.instances[0];
    // One valid frame, then bulk: responseText is cumulative for the life
    // of the connection, so a long-lived stream grows without this.
    first.chunk("event: a\ndata: 1\n\n");
    first.chunk(`data: ${"x".repeat(5 * 1024 * 1024)}\n\n`);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("response ceiling"));
    expect(first.aborted).toBe(true);
    vi.advanceTimersByTime(2_000);
    expect(FakeXhr.instances).toHaveLength(2);
    warn.mockRestore();
    stop();
  });

  it("logs an open failure without the endpoint or the token", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    class Exploding extends FakeXhr {
      send() {
        throw new TypeError(`open ${ENV.endpoint}/sessions/s/events failed`);
      }
    }
    vi.stubGlobal("XMLHttpRequest", Exploding);
    const stop = startAnnoKitEventStream(
      { endpoint: "https://h.dev/s3cret-cap", token: "s3cret-token" },
      "sess-s3cret",
    );
    const line = String(warn.mock.calls[0]?.[0] ?? "");
    expect(line).toContain("[annokit] GET h.dev /sessions/:id/events");
    expect(line).not.toContain("s3cret-cap");
    expect(line).not.toContain("s3cret-token");
    expect(line).not.toContain("sess-s3cret");
    warn.mockRestore();
    stop();
  });
});

describe("parser bounds", () => {
  it("drops an unterminated frame instead of buffering it forever", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const p = createSseParser();
    // A server (or a buffering proxy) that never sends the blank line.
    expect(feedSseChunk(p, `data: ${"x".repeat(300 * 1024)}`)).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("unterminated frame"));
    // The parser still works afterwards.
    expect(feedSseChunk(p, "event: a\ndata: 1\n\n")).toEqual([{ type: "a", data: "1" }]);
    warn.mockRestore();
  });
});

describe("stream redirect policy", () => {
  beforeEach(() => {
    FakeXhr.instances = [];
    vi.useFakeTimers();
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("refuses a stream that came back from another origin", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const seen: AnnoKitServerEvent[] = [];
    onAnnoKitEvent((e) => seen.push(e));
    const stop = startAnnoKitEventStream(ENV, "s");
    const req = FakeXhr.instances[0];
    req.responseURL = "http://evil.example/events";
    req.chunk("event: annotation.created\ndata: {}\n\n");
    // Nothing from that stream reaches the fan-out.
    expect(seen).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      "[annokit] GET sandbox.example /sessions/:id/events — refused: cross-origin redirect",
    );
    expect(req.aborted).toBe(true);
    warn.mockRestore();
    stop();
  });

  it("allows the stream when the origin matches", () => {
    const seen: AnnoKitServerEvent[] = [];
    onAnnoKitEvent((e) => seen.push(e));
    const stop = startAnnoKitEventStream(ENV, "s");
    const req = FakeXhr.instances[0];
    req.responseURL = "https://sandbox.example/sessions/s/events";
    req.chunk("event: annotation.created\ndata: {}\n\n");
    expect(seen).toEqual([{ type: "annotation.created", data: "{}" }]);
    stop();
  });

  it("abstains when the host omits responseURL", () => {
    const seen: AnnoKitServerEvent[] = [];
    onAnnoKitEvent((e) => seen.push(e));
    const stop = startAnnoKitEventStream(ENV, "s");
    FakeXhr.instances[0].chunk("event: a\ndata: 1\n\n");
    expect(seen).toHaveLength(1);
    stop();
  });
});

// ── Liveness: the polls stand down while the stream delivers ──────────────

describe("streamLive", () => {
  beforeEach(() => {
    FakeXhr.instances = [];
    vi.useFakeTimers();
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("is not live until bytes arrive — an open socket proves nothing", () => {
    const stop = startAnnoKitEventStream(ENV, "s");
    expect(streamLive()).toBe(false);
    stop();
  });

  it("goes live on the greeting comment alone, since keepalives are comments", () => {
    const stop = startAnnoKitEventStream(ENV, "s");
    FakeXhr.instances[0].chunk(": connected\n\n");
    expect(streamLive()).toBe(true);
    stop();
  });

  it("stays live while keepalives keep coming, and goes down after STREAM_STALE_MS of silence", () => {
    const stop = startAnnoKitEventStream(ENV, "s");
    const req = FakeXhr.instances[0];
    req.chunk(": connected\n\n");
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(15_000);
      req.chunk(": ping\n\n");
    }
    expect(streamLive()).toBe(true);
    // A proxy that holds the socket and stops delivering looks exactly
    // like this: the connection never ends, the bytes just stop.
    vi.advanceTimersByTime(STREAM_STALE_MS);
    expect(streamLive()).toBe(false);
    req.chunk(": ping\n\n");
    expect(streamLive()).toBe(true);
    stop();
  });

  it("is not live on a non-200 body, whatever it says", () => {
    const stop = startAnnoKitEventStream(ENV, "s");
    const req = FakeXhr.instances[0];
    req.status = 404;
    req.chunk("not found");
    expect(streamLive()).toBe(false);
    stop();
  });

  it("goes down when the connection ends, and when stopped", () => {
    const stop = startAnnoKitEventStream(ENV, "s");
    // A real frame, so the close is a restart (base delay), not a failure.
    FakeXhr.instances[0].chunk("event: annotation.updated\ndata: {}\n\n");
    FakeXhr.instances[0].end();
    expect(streamLive()).toBe(false);
    vi.advanceTimersByTime(2_000);
    FakeXhr.instances[1].chunk(": connected\n\n");
    expect(streamLive()).toBe(true);
    stop();
    expect(streamLive()).toBe(false);
    // Nothing left behind to flip it back.
    vi.advanceTimersByTime(STREAM_STALE_MS * 2);
    expect(streamLive()).toBe(false);
  });

  it("tells subscribers on each change, not on each byte", () => {
    const changes: boolean[] = [];
    const off = subscribeToStreamLive(() => changes.push(streamLive()));
    const stop = startAnnoKitEventStream(ENV, "s");
    const req = FakeXhr.instances[0];
    req.chunk(": connected\n\n");
    req.chunk(": ping\n\n");
    req.chunk("event: annotation.updated\ndata: {}\n\n");
    stop();
    expect(changes).toEqual([true, false]);
    off();
  });
});
