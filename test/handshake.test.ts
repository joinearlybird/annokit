/**
 * Protocol handshake (src/handshake.ts + README "Versioning"):
 * GET /health must gate activation on protocolVersion, fail loud, never throw.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetServerFlavor, serverFlavor } from "../src/agentation";
import type { AnnoKitConfig } from "../src/env";
import { checkProtocol, fetchViewer, handshakeRetryDelay, probeProtocol, registerSession } from "../src/handshake";
import { AnnoKitTransport } from "../src/transport";
import { annoKitPreferences, forgetPreferences } from "../src/prefs";

const ENDPOINT = "https://sandbox.example/sessions/abc/agentation";
const CONFIG: AnnoKitConfig = {
  endpoint: ENDPOINT,
  sessionId: "sess-1",
  token: null,
  author: null,
  envAuthor: null,
};

let fetchMock: ReturnType<typeof vi.fn>;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  warn.mockRestore();
  forgetServerFlavor();
  forgetPreferences();
});

function health(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function transport(): AnnoKitTransport {
  return new AnnoKitTransport(CONFIG);
}

describe("checkProtocol", () => {
  it("enables on the documented response {status:'ok',protocolVersion:1}", async () => {
    fetchMock.mockResolvedValue(health({ status: "ok", protocolVersion: 1 }));
    await expect(checkProtocol(transport())).resolves.toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe(`${ENDPOINT}/health`);
    expect(warn).not.toHaveBeenCalled();
  });

  it("takes queuesTasks from /health as the default for blocking Send", async () => {
    fetchMock.mockResolvedValue(health({ status: "ok", protocolVersion: 1, queuesTasks: true }));
    await expect(checkProtocol(transport())).resolves.toBe(true);
    expect(annoKitPreferences().blockSendWhileWorking).toBe(false);
    fetchMock.mockResolvedValue(health({ status: "ok", protocolVersion: 1 }));
    await checkProtocol(transport());
    expect(annoKitPreferences().blockSendWhileWorking).toBe(true);
  });

  it("disables loudly on a newer protocol version", async () => {
    fetchMock.mockResolvedValue(health({ status: "ok", protocolVersion: 2 }));
    await expect(checkProtocol(transport())).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("protocol mismatch"));
    expect(warn.mock.calls[0][0]).toContain("server=2");
    expect(warn.mock.calls[0][0]).toContain("supported=1");
  });

  it("ENABLES in compat when protocolVersion is missing but status is ok — that is agentation-mcp's /health", async () => {
    // Verified live: agentation-mcp@1.2.0 answers {"status":"ok","mode":"local"}.
    fetchMock.mockResolvedValue(health({ status: "ok", mode: "local" }));
    await expect(checkProtocol(transport())).resolves.toBe(true);
    expect(serverFlavor()).toBe("agentation");
    expect(warn).not.toHaveBeenCalled();
  });

  it("stays in our protocol's flavor when protocolVersion is present", async () => {
    fetchMock.mockResolvedValue(health({ status: "ok", protocolVersion: 1 }));
    await checkProtocol(transport());
    expect(serverFlavor()).toBe("annokit");
  });

  it("disables (not compat) when the body has neither protocolVersion nor status ok", async () => {
    fetchMock.mockResolvedValue(health({ hello: "world" }));
    await expect(checkProtocol(transport())).resolves.toBe(false);
    expect(serverFlavor()).toBe("annokit");
  });

  it('disables when protocolVersion is the string "1" (strict equality)', async () => {
    fetchMock.mockResolvedValue(health({ status: "ok", protocolVersion: "1" }));
    await expect(checkProtocol(transport())).resolves.toBe(false);
  });

  it("tells an unreachable server from a wrong version, since only one of them can change", async () => {
    fetchMock.mockRejectedValue(new TypeError("Network request failed"));
    await expect(probeProtocol(transport())).resolves.toBe("unreachable");
    fetchMock.mockResolvedValue(health({ status: "ok", protocolVersion: 2 }));
    await expect(probeProtocol(transport())).resolves.toBe("mismatch");
    fetchMock.mockResolvedValue(health({ status: "ok", protocolVersion: 1 }));
    await expect(probeProtocol(transport())).resolves.toBe("ok");
  });

  it("asks an unreachable server again quickly at first, then every half minute", () => {
    expect([0, 1, 2, 3, 50].map(handshakeRetryDelay)).toEqual([2_000, 5_000, 15_000, 30_000, 30_000]);
  });

  it("disables (health check failed) when the server is unreachable", async () => {
    fetchMock.mockRejectedValue(new TypeError("Network request failed"));
    await expect(checkProtocol(transport())).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("health check failed"));
  });

  it("disables on a non-2xx /health", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 503 }));
    await expect(checkProtocol(transport())).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("health check failed"));
  });

  it("disables on a non-JSON /health body", async () => {
    fetchMock.mockResolvedValue(new Response("<html>proxy error</html>", { status: 200 }));
    await expect(checkProtocol(transport())).resolves.toBe(false);
  });

  it("never throws — a hanging-then-rejecting fetch still resolves false", async () => {
    fetchMock.mockImplementation(
      () => new Promise((_res, rej) => setTimeout(() => rej(new Error("timeout")), 0)),
    );
    await expect(checkProtocol(transport())).resolves.toBe(false);
  });

  it("degrades to disabled (not enabled) on a null-ish body — documented fail-soft", async () => {
    fetchMock.mockResolvedValue(health(null));
    await expect(checkProtocol(transport())).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("health check failed"));
  });
});

describe("registerSession", () => {
  it("POSTs the configured session id (idempotent register/reuse)", async () => {
    fetchMock.mockResolvedValue(health({ id: "sess-1" }, 201));
    await registerSession(transport(), "sess-1", "/home");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${ENDPOINT}/sessions`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      id: "sess-1",
      url: "/home",
      title: "native",
    });
  });

  it("defaults url to / when no router pathname is available", async () => {
    fetchMock.mockResolvedValue(health({ id: "sess-1" }, 201));
    await registerSession(transport(), "sess-1", null);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body)).url).toBe("/");
  });

  it("swallows registration failures and still answers the configured id (the server knows it by other means)", async () => {
    fetchMock.mockRejectedValue(new Error("nope"));
    await expect(registerSession(transport(), "sess-1", "/home")).resolves.toBe("sess-1");
  });

  it("agentation compat: sends only their url shape and returns THEIR assigned id", async () => {
    fetchMock.mockResolvedValue(health({ id: "mst-xyz", url: "app://native/home", status: "active" }, 201));
    await expect(registerSession(transport(), "sess-1", "/home", "agentation")).resolves.toBe(
      "mst-xyz",
    );
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    // No client id — their server assigns and never dedupes (recon doc).
    expect(JSON.parse(String(init.body))).toEqual({ url: "app://native/home" });
  });

  it("agentation compat: a failed create is null — the caller must not post into a session that does not exist", async () => {
    fetchMock.mockRejectedValue(new Error("nope"));
    await expect(registerSession(transport(), "sess-1", "/home", "agentation")).resolves.toBeNull();
  });
});

/**
 * GET /me — who the server says is holding THIS device, per request. It is
 * optional in the protocol, so every way of not having one has to land on
 * the same answer: null, quietly, and the next identity tier speaks.
 */
describe("fetchViewer", () => {
  it("reads the viewer off the documented shape", async () => {
    fetchMock.mockResolvedValue(
      health({ id: "u1", name: "Johnny", avatarUrl: "https://x/y.png" }),
    );
    await expect(fetchViewer(transport())).resolves.toEqual({
      id: "u1",
      name: "Johnny",
      avatarUrl: "https://x/y.png",
    });
    expect(fetchMock.mock.calls[0][0]).toBe(`${ENDPOINT}/me`);
  });

  it("accepts the enveloped form too", async () => {
    fetchMock.mockResolvedValue(health({ viewer: { id: "u1" } }));
    await expect(fetchViewer(transport())).resolves.toEqual({ id: "u1" });
  });

  it("is null — never a throw — when the route is not there (older server)", async () => {
    fetchMock.mockResolvedValue(health({ error: "Not found" }, 404));
    await expect(fetchViewer(transport())).resolves.toBe(null);
  });

  it("is null for {id: null}: nobody is authenticated, which is not an error", async () => {
    fetchMock.mockResolvedValue(health({ id: null }));
    await expect(fetchViewer(transport())).resolves.toBe(null);
  });

  it("is null when the server is unreachable, and says nothing loud about it", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    await expect(fetchViewer(transport())).resolves.toBe(null);
  });

  it("ignores blank fields rather than storing an empty name", async () => {
    fetchMock.mockResolvedValue(health({ id: "u1", name: "   " }));
    await expect(fetchViewer(transport())).resolves.toEqual({ id: "u1" });
  });
});
