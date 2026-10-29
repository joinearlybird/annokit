/** Config resolution (src/env.ts): props-first, env fallback, __DEV__ gate. */

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PACKAGE_VERSION, resolveAnnoKitConfig, SUPPORTED_PROTOCOL_VERSION } from "../src/env";

const ENV_KEYS = [
  "EXPO_PUBLIC_ANNOKIT_ENDPOINT",
  "EXPO_PUBLIC_ANNOKIT_SESSION_ID",
  "EXPO_PUBLIC_ANNOKIT_TOKEN",
  "EXPO_PUBLIC_ANNOKIT_AUTHOR_ID",
  "EXPO_PUBLIC_ANNOKIT_AUTHOR_NAME",
] as const;

const g = globalThis as Record<string, unknown>;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  g.__DEV__ = true;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  delete g.__DEV__;
});

describe("resolveAnnoKitConfig — props vs env", () => {
  it("uses props when given, ignoring env", () => {
    process.env.EXPO_PUBLIC_ANNOKIT_ENDPOINT = "https://env.example/agentation";
    process.env.EXPO_PUBLIC_ANNOKIT_SESSION_ID = "env-session";
    process.env.EXPO_PUBLIC_ANNOKIT_TOKEN = "env-token";

    expect(
      resolveAnnoKitConfig({
        endpoint: "https://prop.example/agentation",
        sessionId: "prop-session",
        token: "prop-token",
      }),
    ).toEqual({
      endpoint: "https://prop.example/agentation",
      sessionId: "prop-session",
      token: "prop-token",
      author: null,
      envAuthor: null,
    });
  });

  it("falls back to env when props are absent", () => {
    process.env.EXPO_PUBLIC_ANNOKIT_ENDPOINT = "https://env.example/agentation";
    process.env.EXPO_PUBLIC_ANNOKIT_SESSION_ID = "env-session";
    process.env.EXPO_PUBLIC_ANNOKIT_TOKEN = "env-token";

    expect(resolveAnnoKitConfig()).toEqual({
      endpoint: "https://env.example/agentation",
      sessionId: "env-session",
      token: "env-token",
      author: null,
      envAuthor: null,
    });
  });

  it("mixes props and env per field", () => {
    process.env.EXPO_PUBLIC_ANNOKIT_ENDPOINT = "https://env.example/agentation";
    process.env.EXPO_PUBLIC_ANNOKIT_SESSION_ID = "env-session";

    expect(resolveAnnoKitConfig({ sessionId: "prop-session" })).toEqual({
      endpoint: "https://env.example/agentation",
      sessionId: "prop-session",
      token: null,
      author: null,
      envAuthor: null,
    });
  });

  it("token is null when neither prop nor env supplies one (auth optional)", () => {
    const cfg = resolveAnnoKitConfig({
      endpoint: "https://x.example/agentation",
      sessionId: "s1",
    });
    expect(cfg?.token).toBeNull();
  });
});

describe("resolveAnnoKitConfig — disabled paths", () => {
  it("returns null without an endpoint", () => {
    process.env.EXPO_PUBLIC_ANNOKIT_SESSION_ID = "env-session";
    expect(resolveAnnoKitConfig()).toBeNull();
  });

  it("returns null without a sessionId", () => {
    process.env.EXPO_PUBLIC_ANNOKIT_ENDPOINT = "https://env.example/agentation";
    expect(resolveAnnoKitConfig()).toBeNull();
  });

  it("returns null for empty-string config (empty env var is not config)", () => {
    process.env.EXPO_PUBLIC_ANNOKIT_ENDPOINT = "";
    process.env.EXPO_PUBLIC_ANNOKIT_SESSION_ID = "s1";
    expect(resolveAnnoKitConfig()).toBeNull();
  });

  it("enabled:false forces off even with full config", () => {
    expect(
      resolveAnnoKitConfig({
        endpoint: "https://x.example/agentation",
        sessionId: "s1",
        enabled: false,
      }),
    ).toBeNull();
  });

  it("enabled:true is not required (undefined means on)", () => {
    expect(
      resolveAnnoKitConfig({ endpoint: "https://x.example/agentation", sessionId: "s1" }),
    ).not.toBeNull();
  });

  it("__DEV__ false disables regardless of props (absolute gate)", () => {
    g.__DEV__ = false;
    expect(
      resolveAnnoKitConfig({
        endpoint: "https://x.example/agentation",
        sessionId: "s1",
        enabled: true,
      }),
    ).toBeNull();
  });

  it("__DEV__ undefined disables (production bundles have no such global)", () => {
    delete g.__DEV__;
    expect(
      resolveAnnoKitConfig({ endpoint: "https://x.example/agentation", sessionId: "s1" }),
    ).toBeNull();
  });
});

describe("resolveAnnoKitConfig — endpoint normalization", () => {
  it("strips trailing slashes so path joins never double up", () => {
    const cfg = resolveAnnoKitConfig({
      endpoint: "https://x.example/sessions/abc/agentation///",
      sessionId: "s1",
    });
    expect(cfg?.endpoint).toBe("https://x.example/sessions/abc/agentation");
  });

  it("leaves an already-clean endpoint untouched", () => {
    const cfg = resolveAnnoKitConfig({
      endpoint: "https://x.example/sessions/abc/agentation",
      sessionId: "s1",
    });
    expect(cfg?.endpoint).toBe("https://x.example/sessions/abc/agentation");
  });
});

it("declares protocol version 1 (README: AnnoKit Protocol v1)", () => {
  expect(SUPPORTED_PROTOCOL_VERSION).toBe(1);
});

/**
 * Identity config. The prop and the env variables resolve into SEPARATE
 * fields on purpose: they are different tiers with different trust, and
 * merging them here would quietly promote the env one (src/viewer.ts).
 */
describe("resolveAnnoKitConfig — the author tiers", () => {
  const base = { endpoint: "https://x.example/agentation", sessionId: "s1" };

  it("has neither by default", () => {
    const cfg = resolveAnnoKitConfig(base);
    expect(cfg?.author).toBeNull();
    expect(cfg?.envAuthor).toBeNull();
  });

  it("carries the host prop as `author`", () => {
    const cfg = resolveAnnoKitConfig({ ...base, author: { id: "u1", name: "Johnny" } });
    expect(cfg?.author).toEqual({ id: "u1", name: "Johnny" });
    expect(cfg?.envAuthor).toBeNull();
  });

  it("carries EXPO_PUBLIC_ANNOKIT_AUTHOR_* as `envAuthor`, separately", () => {
    process.env.EXPO_PUBLIC_ANNOKIT_AUTHOR_ID = "env-user";
    process.env.EXPO_PUBLIC_ANNOKIT_AUTHOR_NAME = "Env User";
    const cfg = resolveAnnoKitConfig({ ...base, author: { id: "u1" } });
    expect(cfg?.author).toEqual({ id: "u1" });
    expect(cfg?.envAuthor).toEqual({ id: "env-user", name: "Env User" });
  });

  it("ignores an empty author prop", () => {
    expect(resolveAnnoKitConfig({ ...base, author: {} })?.author).toBeNull();
  });
});

describe("the package's own version", () => {
  it("matches package.json — the diagnostics block must not lie", () => {
    // PACKAGE_VERSION is a literal (src/env.ts explains why importing the
    // manifest from a library is a bundler problem waiting to happen), so
    // the only thing keeping it honest is this test.
    const manifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    expect(PACKAGE_VERSION).toBe(manifest.version);
  });
});


describe("endpoint security", () => {
  it("warns about remote plaintext but still activates — the endpoint is the adopter's call", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const cfg = resolveAnnoKitConfig({ endpoint: "http://lan.example", sessionId: "s" });
      expect(cfg?.endpoint).toBe("http://lan.example");
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain("plaintext HTTP");
      // Loopback is the ordinary stub-server case and says nothing at all.
      warn.mockClear();
      expect(resolveAnnoKitConfig({ endpoint: "http://localhost:4788", sessionId: "s" })).not.toBeNull();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("still disables on an unusable endpoint or session id", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(resolveAnnoKitConfig({ endpoint: "ftp://localhost", sessionId: "s" })).toBeNull();
      expect(resolveAnnoKitConfig({ endpoint: "https://example.com", sessionId: ".." })).toBeNull();
    } finally {
      warn.mockRestore();
    }
  });
  it("keeps explicit loopback development endpoints working", () => {
    expect(resolveAnnoKitConfig({ endpoint: "http://127.0.0.1:4788", sessionId: "s" })?.endpoint)
      .toBe("http://127.0.0.1:4788");
  });
});
