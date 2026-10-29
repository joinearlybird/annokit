/** Protocol requests share redirect, endpoint, cancellation and body limits. */
import type { AnnoKitConfig } from "./env";
import { errorCategory, requestLabel, warnRequestFailed } from "./log";
import { joinUrl, safeEndpoint, sameOriginOrUnknown } from "./url";

interface UploadXhr {
  timeout: number;
  status: number;
  responseURL?: string;
  responseText?: string;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  ontimeout: (() => void) | null;
  onabort: (() => void) | null;
  open(method: string, url: string): void;
  setRequestHeader(name: string, value: string): void;
  send(body: unknown): void;
  abort?(): void;
}

export interface AnnoKitTimeouts {
  read?: number;
  mutate?: number;
  upload?: number;
}
export const DEFAULT_TIMEOUTS: Required<AnnoKitTimeouts> = {
  read: 10_000, mutate: 15_000, upload: 30_000,
};
/** Decompressed JSON bytes, bounded before parsing. */
export const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

/** Count UTF-8 bytes without requiring TextEncoder on older Hermes runtimes. */
function utf8Bytes(text: string): number {
  let bytes = 0;
  for (const character of text) {
    const point = character.codePointAt(0)!;
    bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
    if (bytes > MAX_RESPONSE_BYTES) break;
  }
  return bytes;
}

async function readJson(res: Response, signal: AbortSignal): Promise<unknown> {
  const length = Number(res.headers.get("content-length"));
  if (length > MAX_RESPONSE_BYTES) throw new Error("Response exceeds limit");
  // RN's standard fetch buffers the response and has no ReadableStream.
  // Keep the deadline active, then bound the text before JSON parsing.
  // This bounds parsing, not the native networking layer's initial buffer.
  if (!res.body || typeof res.body.getReader !== "function") {
    const text = await res.text();
    if (signal.aborted) throw new Error("Aborted");
    if (utf8Bytes(text) > MAX_RESPONSE_BYTES) throw new Error("Response exceeds limit");
    return text ? JSON.parse(text) : null;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new Error("Aborted");
      const { done, value } = await reader.read();
      if (signal.aborted) throw new Error("Aborted");
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new Error("Response exceeds limit");
      text += decoder.decode(value, { stream: true });
    }
    // Empty means "no body", the same as the buffered branch above — a
    // 201 or 204 with nothing in it is a success, not a parse error.
    text += decoder.decode();
    return text ? JSON.parse(text) : null;
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
  }
}

export class AnnoKitTransport {
  private readonly timeouts: Required<AnnoKitTimeouts>;
  private readonly inflight = new Set<AbortController>();
  private disposed = false;

  constructor(private readonly env: AnnoKitConfig, timeouts?: AnnoKitTimeouts) {
    this.timeouts = { ...DEFAULT_TIMEOUTS };
    for (const key of ["read", "mutate", "upload"] as const) {
      const value = timeouts?.[key];
      if (typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 2_147_483_647) {
        this.timeouts[key] = value;
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const controller of this.inflight) controller.abort();
    this.inflight.clear();
  }
  get isDisposed(): boolean { return this.disposed; }

  private async request(
    path: string, method: string, body?: unknown, form = false, readFormReply = false,
  ): Promise<{ status: number; data: unknown } | null> {
    if (this.disposed) return null;
    const label = requestLabel(method, this.env.endpoint, path);
    if (!safeEndpoint(this.env.endpoint)) {
      warnRequestFailed(label, "refused: unusable endpoint");
      return null;
    }
    const controller = new AbortController();
    const ms = form ? this.timeouts.upload : method === "GET" ? this.timeouts.read : this.timeouts.mutate;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, ms);
    this.inflight.add(controller);
    let res: Response | undefined;
    let onAbort: () => void = () => {};
    // Race as well as abort: a broken adapter must not leave the caller busy.
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error("Aborted"));
      controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      const url = joinUrl(this.env.endpoint, path);
      const headers: Record<string, string> = {};
      if (this.env.token) headers.Authorization = `Bearer ${this.env.token}`;
      if (body !== undefined && !form) headers["Content-Type"] = "application/json";
      const work = async () => {
        res = await fetch(url, {
          // Best effort: native XHR-backed fetch may ignore redirect mode.
          redirect: "error",
          /**
           * SAME-ORIGIN, NOT OMIT.
           *
           * This was `omit`, on the reasoning that the package authenticates
           * with a bearer token and should never rely on ambient authority.
           * That is right across origins and wrong for the endpoint itself:
           * a protocol server behind a cookie-authenticated proxy — a
           * Namespace devbox, a corporate SSO gateway, any preview
           * environment — then refuses every request the overlay makes,
           * while the page around it loads fine because a document
           * navigation sends cookies normally. Observed exactly once it was
           * deployed behind one:
           *
           *   [annokit] GET …devbox.so /health — network error (TypeError)
           *   [annokit] health check failed — overlay disabled
           *
           * The TypeError is `redirect: "error"` meeting the gateway's auth
           * redirect, so the message names neither cookies nor auth.
           *
           * `same-origin` is the browser's own default: cookies go to the
           * endpoint's origin and nowhere else, so nothing is sent across
           * origins and the bearer token remains the only thing carrying
           * authority off it.
           */
          credentials: "same-origin",
          method, headers, signal: controller.signal,
          body: body === undefined ? undefined : form ? body as FormData : JSON.stringify(body),
        });
        if (controller.signal.aborted) {
          void res.body?.cancel().catch(() => {});
          return null;
        }
        if (!sameOriginOrUnknown(url, res.url)) {
          warnRequestFailed(label, "refused: cross-origin redirect");
          return null;
        }
        if (res.redirected || (res.status >= 300 && res.status < 400)) {
          warnRequestFailed(label, "refused: redirect");
          return null;
        }
        if (!res.ok) warnRequestFailed(label, `HTTP ${res.status}`);
        return {
          status: res.status,
          data: res.ok && (!form || readFormReply) && method !== "DELETE" ? await readJson(res, controller.signal) : null,
        };
      };
      return await Promise.race([work(), aborted]);
    } catch (e) {
      warnRequestFailed(label, timedOut ? `timeout after ${ms}ms` :
        controller.signal.aborted ? "aborted" : e instanceof SyntaxError ? "invalid JSON in response" : errorCategory(e));
      return null;
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener("abort", onAbort);
      this.inflight.delete(controller);
      controller.abort();
      if (res?.body && !res.body.locked) void res.body.cancel().catch(() => {});
    }
  }

  async getJson<T = unknown>(path: string): Promise<T | null> {
    return (await this.request(path, "GET"))?.data as T ?? null;
  }
  async getJsonAt<T = unknown>(path: string): Promise<{ status: number; data: T | null }> {
    const result = await this.request(path, "GET");
    return { status: result?.status ?? 0, data: result?.data as T ?? null };
  }
  async postJson<T = unknown>(path: string, body: unknown): Promise<T | null> {
    return (await this.request(path, "POST", body))?.data as T ?? null;
  }
  /** postJson with the status, for callers that must tell an empty 2xx from a failure. */
  async postJsonAt<T = unknown>(path: string, body: unknown): Promise<{ status: number; data: T | null }> {
    const result = await this.request(path, "POST", body);
    return { status: result?.status ?? 0, data: result?.data as T ?? null };
  }
  async patchJson<T = unknown>(path: string, body: unknown): Promise<T | null> {
    return (await this.request(path, "PATCH", body))?.data as T ?? null;
  }
  async del(path: string): Promise<boolean> {
    const res = await this.request(path, "DELETE");
    return !!res && res.status >= 200 && res.status < 300;
  }
  async postForm(path: string, form: FormData): Promise<boolean> {
    const { status } = await this.postFormAt(path, form);
    return status >= 200 && status < 300;
  }

  /**
   * postForm with the status and the JSON the server answered — an asset
   * upload (POST /assets) answers with the asset, whose paths are what the
   * reference carries. A body that is not JSON reads as null.
   */
  async postFormAt<T = unknown>(path: string, form: FormData): Promise<{ status: number; data: T | null }> {
    const Xhr = (globalThis as { XMLHttpRequest?: new () => UploadXhr }).XMLHttpRequest;
    if (!Xhr) {
      const res = await this.request(path, "POST", form, true, true);
      return { status: res?.status ?? 0, data: (res?.data as T) ?? null };
    }
    if (this.disposed) return { status: 0, data: null };
    const label = requestLabel("POST", this.env.endpoint, path);
    if (!safeEndpoint(this.env.endpoint)) {
      warnRequestFailed(label, "refused: unusable endpoint");
      return { status: 0, data: null };
    }
    return new Promise<{ status: number; data: T | null }>((resolve) => {
      const controller = new AbortController();
      this.inflight.add(controller);
      let xhr: UploadXhr | undefined;
      let settled = false;
      const finish = (ok: boolean, reason: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.inflight.delete(controller);
        controller.signal.removeEventListener("abort", abort);
        const status = xhr?.status ?? 0;
        const text = ok ? xhr?.responseText ?? "" : "";
        if (xhr) xhr.onload = xhr.onerror = xhr.ontimeout = xhr.onabort = null;
        if (!ok) warnRequestFailed(label, reason);
        let data: T | null = null;
        // Bounded like every other read (MAX_RESPONSE_BYTES): a reply to an
        // upload is a small JSON object, or nothing.
        if (text && utf8Bytes(text) <= MAX_RESPONSE_BYTES) {
          try { data = JSON.parse(text) as T; } catch { data = null; }
        }
        resolve({ status: ok ? status : (status >= 300 ? status : 0), data });
      };
      const cancel = (reason: string) => {
        finish(false, reason);
        try { xhr?.abort?.(); } catch { /* already settled */ }
      };
      const abort = () => cancel("aborted");
      const timer = setTimeout(() => cancel(`timeout after ${this.timeouts.upload}ms`), this.timeouts.upload);
      controller.signal.addEventListener("abort", abort, { once: true });
      try {
        const url = joinUrl(this.env.endpoint, path);
        xhr = new Xhr();
        xhr.open("POST", url);
        xhr.timeout = this.timeouts.upload;
        if (this.env.token) xhr.setRequestHeader("Authorization", `Bearer ${this.env.token}`);
        xhr.onload = () => {
          // Post-response check only: XHR cannot prevent redirect body replay.
          if (!sameOriginOrUnknown(url, xhr!.responseURL)) {
            finish(false, "refused: cross-origin redirect");
            return;
          }
          finish(xhr!.status >= 200 && xhr!.status < 300, `HTTP ${xhr!.status}`);
        };
        xhr.onerror = () => finish(false, "network error");
        xhr.ontimeout = () => cancel(`timeout after ${this.timeouts.upload}ms`);
        xhr.onabort = () => finish(false, "aborted");
        xhr.send(form);
      } catch (e) { finish(false, errorCategory(e)); }
    });
  }
}

/**
 * A v4 UUID for a client-generated annotation id.
 *
 * THREE TIERS, best first — Hermes guarantees none of them:
 *   1. `crypto.randomUUID()`
 *   2. `crypto.getRandomValues()` (present wherever a host has installed
 *      react-native-get-random-values, which many RN apps already have for
 *      other libraries) formatted into a v4 by hand
 *   3. `Math.random()` — Hermes' is a non-cryptographic xorshift128+, so
 *      these ids are UNGUESSABLE-ISH, not unguessable.
 *
 * NOT AN AUTHORIZATION TOKEN, at any tier. The id names an annotation the
 * client is about to create; a server must authorize the request that
 * carries it and must never treat possession of an id as proof of anything
 * (docs/protocol.md, "Client obligations"). Tier 3 exists so the overlay keeps
 * working on a bare Hermes runtime, and the ids remain collision-safe for
 * a session's worth of annotations either way.
 */
export function makeId(): string {
  const g = globalThis as {
    crypto?: {
      randomUUID?: () => string;
      getRandomValues?: <T extends Uint8Array>(array: T) => T;
    };
  };
  if (typeof g.crypto?.randomUUID === "function") {
    try {
      return g.crypto.randomUUID();
    } catch {
      /* fall through to the next tier */
    }
  }
  const bytes = randomBytes(g.crypto?.getRandomValues);
  // RFC 4122 §4.4: version 4 in the high nibble of byte 6, variant 10x in
  // the top bits of byte 8.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex: string[] = [];
  for (let i = 0; i < 16; i++) hex.push((bytes[i] ?? 0).toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

/** 16 random bytes, from the strongest source this runtime offers. */
function randomBytes(
  getRandomValues: (<T extends Uint8Array>(array: T) => T) | undefined,
): Uint8Array {
  const bytes = new Uint8Array(16);
  if (typeof getRandomValues === "function") {
    try {
      getRandomValues(bytes);
      return bytes;
    } catch {
      /* fall through to Math.random */
    }
  }
  for (let i = 0; i < 16; i++) bytes[i] = (Math.random() * 256) | 0;
  return bytes;
}

/** The POST surface `postAccepted` needs; `postJsonAt` is optional so small fakes still fit. */
export interface AcceptingTransport {
  postJson(path: string, body: unknown): Promise<unknown>;
  postJsonAt?(path: string, body: unknown): Promise<{ status: number; data: unknown }>;
}

/**
 * A POST whose success is decided by the STATUS, not by having a body.
 *
 * The protocol makes response bodies optional on the routes that only
 * report "done" (docs/protocol.md, "Responses"), and a server answering
 * 204 used to read as a failure here: Send stayed enabled, a reply was
 * taken back off the screen, and a task made from a note was reported as
 * not made even though it existed. `data` is whatever came back, or null.
 *
 * A transport without `postJsonAt` (a test fake) falls back to the old
 * rule, where a body is the only evidence of success.
 */
export async function postAccepted(
  transport: AcceptingTransport,
  path: string,
  body: unknown,
): Promise<{ ok: boolean; data: unknown }> {
  if (transport.postJsonAt) {
    const { status, data } = await transport.postJsonAt(path, body);
    return { ok: status >= 200 && status < 300, data };
  }
  const data = await transport.postJson(path, body);
  return { ok: data !== null && data !== undefined, data: data ?? null };
}
