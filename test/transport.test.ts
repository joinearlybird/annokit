import { createServer, type Server, type RequestListener } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnnoKitTransport, MAX_RESPONSE_BYTES, makeId, postAccepted } from "../src/transport";
import type { AnnoKitConfig } from "../src/env";
import { deleteAnnotationPath } from "../src/pending";

function config(endpoint = "https://sandbox.example", token: string | null = "synthetic-token"): AnnoKitConfig {
  return { endpoint, token, sessionId: "s", author: null, envAuthor: null };
}
const servers: Server[] = [];
async function listen(handler: RequestListener): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.closeAllConnections(); server.close(() => resolve());
  })));
});

describe("redirect prevention (real HTTP)", () => {
  it.each([301, 302, 303, 307, 308])("never contacts a cross-origin redirect destination (%s)", async status => {
    let received = 0;
    const sink = await listen((_req, res) => { received++; res.end("{}"); });
    const source = await listen((_req, res) => { res.writeHead(status, { Location: sink }); res.end(); });
    const t = new AnnoKitTransport(config(source));
    expect(await t.postJson("/annotations", { comment: "private synthetic text" })).toBeNull();
    const form = new FormData(); form.append("file", new Blob(["private synthetic image"]));
    expect(await t.postForm("/screenshot", form)).toBe(false);
    expect(received).toBe(0);
  });
  it("also refuses same-origin redirects", async () => {
    let received = 0;
    const source = await listen((req, res) => {
      if (req.url === "/sink") { received++; res.end("{}"); }
      else { res.writeHead(307, { Location: "/sink" }); res.end(); }
    });
    expect(await new AnnoKitTransport(config(source)).postJson("/start", {})).toBeNull();
    expect(received).toBe(0);
  });
});

describe("body lifecycle (real HTTP)", () => {
  it("times out after headers arrive while JSON is incomplete", async () => {
    const source = await listen((_req, res) => { res.writeHead(200); res.write('{"ok":'); });
    const t = new AnnoKitTransport(config(source), { read: 50 });
    const started = Date.now();
    expect(await t.getJson("/slow")).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
  });
  it("dispose cancels a body already being consumed", async () => {
    let headers!: () => void;
    const sent = new Promise<void>(resolve => { headers = resolve; });
    const source = await listen((_req, res) => { res.writeHead(200); res.write('{"ok":'); headers(); });
    const t = new AnnoKitTransport(config(source));
    const pending = t.getJson("/slow");
    await sent;
    await new Promise(resolve => setTimeout(resolve, 20));
    t.dispose();
    expect(await pending).toBeNull();
  });
  it("caps chunked responses without Content-Length", async () => {
    const source = await listen((_req, res) => {
      res.writeHead(200); res.write('"'); res.end("x".repeat(MAX_RESPONSE_BYTES + 1) + '"');
    });
    expect(await new AnnoKitTransport(config(source)).getJson("/large")).toBeNull();
  });
  it("uploads real multipart bytes with a filename", async () => {
    let body = "";
    const source = await listen((req, res) => {
      req.on("data", chunk => { body += chunk; }); req.on("end", () => { res.writeHead(204); res.end(); });
    });
    const form = new FormData(); (form as unknown as { append(name: string, blob: Blob, filename: string): void }).append("file", new Blob(["synthetic-png"]), "screenshot.png");
    expect(await new AnnoKitTransport(config(source)).postForm("/shot", form)).toBe(true);
    expect(body).toContain('filename="screenshot.png"'); expect(body).toContain("synthetic-png");
  });
  it("reports an empty 2xx body as success with no data, not a parse failure", async () => {
    const source = await listen((_req, res) => { res.writeHead(201); res.end(); });
    expect(await new AnnoKitTransport(config(source)).postJsonAt("/sessions/s/annotations", {}))
      .toEqual({ status: 201, data: null });
  });
});

describe("fail-soft protocol contract", () => {
  it("uses the bearer, JSON content type, query capability and encoded path", async () => {
    const fetcher = vi.fn(async () => new Response('{"id":"a"}'));
    vi.stubGlobal("fetch", fetcher);
    const t = new AnnoKitTransport(config("https://sandbox.example/cap?k=secret"));
    expect(await t.postJson("/sessions/a%2Fb/annotations", { comment: "hi" })).toEqual({ id: "a" });
    expect(fetcher).toHaveBeenCalledWith("https://sandbox.example/cap/sessions/a%2Fb/annotations?k=secret", expect.objectContaining({
      // same-origin, not omit: a protocol server behind a cookie-authenticated
      // proxy must still be reachable, while nothing is sent across origins.
      redirect: "error", credentials: "same-origin", method: "POST", body: '{"comment":"hi"}',
      headers: { Authorization: "Bearer synthetic-token", "Content-Type": "application/json" },
    }));
  });
  it("does not dispatch unsafe endpoint schemes or dot-segment IDs", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    // Plaintext is NOT here: a remote http endpoint is the adopter's choice
    // and dispatches normally (src/env.ts warns once). Only endpoints that
    // cannot be a protocol URL at all are refused.
    for (const endpoint of ["file:///tmp/x", "https://localhost\\@evil.example"]) {
      const t = new AnnoKitTransport(config(endpoint));
      expect(await t.getJson("/health")).toBeNull(); expect(await t.postForm("/shot", new FormData())).toBe(false);
    }
    for (const id of ["", ".", "..", "\0", "\ud800"]) {
      expect(await new AnnoKitTransport(config()).del(deleteAnnotationPath(id))).toBe(false);
    }
    expect(fetcher).not.toHaveBeenCalled();

    // The other half of the policy: a remote plaintext endpoint is warned
    // about at config time, never refused here.
    fetcher.mockResolvedValue(new Response("{}", { status: 200 }));
    expect(await new AnnoKitTransport(config("http://lan.example:4788")).getJson("/health")).toEqual({});
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toBe("http://lan.example:4788/health");
  });
  it("retains HTTP status and handles malformed JSON, 204, and network errors", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("no", { status: 404 }))
      .mockResolvedValueOnce(new Response("not json")).mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockRejectedValueOnce(new Error("secret transport detail"));
    vi.stubGlobal("fetch", fetcher);
    const t = new AnnoKitTransport(config());
    expect(await t.getJsonAt("/missing")).toEqual({ status: 404, data: null });
    expect(await t.getJson("/bad")).toBeNull(); expect(await t.del("/a")).toBe(true);
    expect(await t.patchJson("/a", {})).toBeNull();
  });
  it("does not dispatch after dispose", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const t = new AnnoKitTransport(config()); t.dispose(); t.dispose();
    expect(await t.getJson("/x")).toBeNull(); expect(await t.postJson("/x", {})).toBeNull();
    expect(await t.patchJson("/x", {})).toBeNull(); expect(await t.del("/x")).toBe(false);
    expect(await t.postForm("/x", new FormData())).toBe(false);
    expect(await t.getJsonAt("/x")).toEqual({ status: 0, data: null });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("settles even if a fetch implementation ignores abort", async () => {
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    const t = new AnnoKitTransport(config(), { read: 10 });
    expect(await t.getJson("/x")).toBeNull();
  });
  it("uses the upload deadline and ignores invalid deadline overrides", async () => {
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    const t = new AnnoKitTransport(config(), { upload: 10, read: NaN });
    expect(await t.postForm("/x", new FormData())).toBe(false);
    const pending = t.getJson("/x"); t.dispose(); expect(await pending).toBeNull();
  });
  it("never logs endpoint credentials, bodies, or raw errors", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("SECRET-error")));
    await new AnnoKitTransport(config("https://u:SECRET-password@sandbox.example/SECRET-cap?k=SECRET-query", "SECRET-token"))
      .postJson("/sessions/SECRET-id", { text: "SECRET-body" });
    expect(warn).toHaveBeenCalled(); expect(JSON.stringify(warn.mock.calls)).not.toContain("SECRET");
  });
});

describe("makeId", () => {
  it("uses crypto.randomUUID when available", () => {
    const spy = vi.fn(() => "11111111-2222-4333-8444-555555555555");
    vi.stubGlobal("crypto", { randomUUID: spy });
    expect(makeId()).toBe("11111111-2222-4333-8444-555555555555");
    expect(spy).toHaveBeenCalled();
  });

  it("falls back to a v4-shaped id when crypto is unavailable (Hermes)", () => {
    vi.stubGlobal("crypto", undefined);
    const id = makeId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(makeId()).not.toBe(id);
  });

  it("falls back when crypto.randomUUID throws", () => {
    vi.stubGlobal("crypto", {
      randomUUID: () => {
        throw new Error("insecure context");
      },
    });
    expect(makeId()).toMatch(/^[0-9a-f]{8}-/);
  });
});

describe("makeId", () => {
  const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it("prefers crypto.randomUUID when the runtime has it", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "11111111-2222-4333-8444-555555555555" });
    expect(makeId()).toBe("11111111-2222-4333-8444-555555555555");
  });

  it("falls to getRandomValues, and formats a valid v4", () => {
    // The tier that matters in practice: many RN apps have
    // react-native-get-random-values installed for other libraries.
    let asked = 0;
    vi.stubGlobal("crypto", {
      getRandomValues: (a: Uint8Array) => {
        asked += 1;
        for (let i = 0; i < a.length; i++) a[i] = i * 7 + 3;
        return a;
      },
    });
    const id = makeId();
    expect(asked).toBe(1);
    expect(id).toMatch(V4);
  });

  it("falls to Math.random on a bare runtime, still a valid v4", () => {
    vi.stubGlobal("crypto", undefined);
    expect(makeId()).toMatch(V4);
  });

  it("survives a throwing crypto at either tier", () => {
    vi.stubGlobal("crypto", {
      randomUUID: () => {
        throw new Error("unavailable");
      },
      getRandomValues: () => {
        throw new Error("also unavailable");
      },
    });
    expect(makeId()).toMatch(V4);
  });

  it("sets the version and variant bits whatever the byte source said", () => {
    // All-zero bytes would be an invalid UUID without the RFC 4122 fixups.
    vi.stubGlobal("crypto", { getRandomValues: (a: Uint8Array) => a.fill(0) });
    const id = makeId();
    expect(id).toMatch(V4);
    expect(id[14]).toBe("4");
    expect(["8", "9", "a", "b"]).toContain(id[19]);
  });

  it("does not repeat itself", () => {
    vi.stubGlobal("crypto", undefined);
    const ids = new Set(Array.from({ length: 2000 }, () => makeId()));
    expect(ids.size).toBe(2000);
  });
});

describe("standard React Native compatibility without Expo", () => {
  it("reads a non-streaming RN response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, status: 200, url: "", headers: { get: () => null },
      text: async () => '{"ok":true}',
    })));
    expect(await new AnnoKitTransport(config()).getJson("/health")).toEqual({ ok: true });
  });
  it("bounds UTF-8 bytes before parsing buffered native JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, status: 200, url: "", headers: { get: () => null },
      text: async () => '"' + "é".repeat(MAX_RESPONSE_BYTES / 2) + '"',
    })));
    expect(await new AnnoKitTransport(config()).getJson("/large")).toBeNull();
  });
  it("keeps timeout and disposal active for buffered response consumption", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, status: 200, url: "", headers: { get: () => null },
      text: () => new Promise(() => {}),
    })));
    expect(await new AnnoKitTransport(config(), { read: 10 }).getJson("/slow")).toBeNull();
    const t = new AnnoKitTransport(config());
    const pending = t.getJson("/slow");
    await Promise.resolve();
    t.dispose();
    expect(await pending).toBeNull();
  });

  class Xhr {
    static instances: Xhr[] = [];
    timeout = 0;
    status = 204;
    responseURL = "";
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    ontimeout: (() => void) | null = null;
    onabort: (() => void) | null = null;
    headers: Record<string, string> = {};
    body: unknown;
    aborted = false;
    constructor() { Xhr.instances.push(this); }
    open(_method: string, _url: string) {}
    setRequestHeader(name: string, value: string) { this.headers[name] = value; }
    send(body: unknown) { this.body = body; }
    abort() { this.aborted = true; this.onabort?.(); }
  }
  it("passes RN file descriptors unchanged to XHR without a Content-Type override", async () => {
    vi.stubGlobal("XMLHttpRequest", Xhr);
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const form = { parts: [["file", { uri: "file:///tmp/capture.png", name: "screenshot.png", type: "image/png" }]] } as unknown as FormData;
    const pending = new AnnoKitTransport(config()).postForm("/shot", form);
    const xhr = Xhr.instances.at(-1)!;
    expect(xhr.body).toBe(form);
    expect(xhr.headers).toEqual({ Authorization: "Bearer synthetic-token" });
    xhr.onload?.(); expect(await pending).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("cancels native uploads on disposal and enforces an independent deadline", async () => {
    vi.stubGlobal("XMLHttpRequest", Xhr);
    const t = new AnnoKitTransport(config());
    const pending = t.postForm("/shot", new FormData());
    const xhr = Xhr.instances.at(-1)!;
    t.dispose(); expect(await pending).toBe(false); expect(xhr.aborted).toBe(true);
    expect(await new AnnoKitTransport(config(), { upload: 10 }).postForm("/shot", new FormData())).toBe(false);
    expect(Xhr.instances.at(-1)!.aborted).toBe(true);
  });
  it("rejects cross-origin upload responses without claiming to prevent the redirect", async () => {
    vi.stubGlobal("XMLHttpRequest", Xhr);
    const pending = new AnnoKitTransport(config()).postForm("/shot", new FormData());
    const xhr = Xhr.instances.at(-1)!;
    xhr.responseURL = "https://other.example/shot";
    xhr.onload?.(); expect(await pending).toBe(false);
  });
  it("blocks unusable upload endpoints and routes before creating XHR", async () => {
    const xhr = vi.fn(); vi.stubGlobal("XMLHttpRequest", xhr);
    expect(await new AnnoKitTransport(config("ftp://remote.example")).postForm("/shot", new FormData())).toBe(false);
    expect(await new AnnoKitTransport(config()).postForm("/annotations/../shot", new FormData())).toBe(false);
    expect(xhr).not.toHaveBeenCalled();
  });
});

describe("postAccepted (real HTTP)", () => {
  it("counts an empty 204 as accepted, which postJson alone could not tell from a failure", async () => {
    const url = await listen((_req, res) => { res.writeHead(204); res.end(); });
    const t = new AnnoKitTransport(config(url));
    expect(await t.postJson("/annotations/send", { annotationIds: [] })).toBeNull();
    await expect(postAccepted(t, "/annotations/send", { annotationIds: [] })).resolves.toEqual({ ok: true, data: null });
  });

  it("is not accepted on an error status, body or not", async () => {
    const url = await listen((_req, res) => { res.writeHead(500, { "Content-Type": "application/json" }); res.end("{}"); });
    const t = new AnnoKitTransport(config(url));
    await expect(postAccepted(t, "/annotations/send", {})).resolves.toMatchObject({ ok: false });
  });

  it("hands back the body when there is one", async () => {
    const url = await listen((_req, res) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"sent":2}'); });
    const t = new AnnoKitTransport(config(url));
    await expect(postAccepted(t, "/annotations/send", {})).resolves.toEqual({ ok: true, data: { sent: 2 } });
  });
});
