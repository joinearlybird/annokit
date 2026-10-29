/**
 * The stub server (server/stub-server.mjs, the `annokit` bin), driven by the
 * CLIENT's own code over real HTTP.
 *
 * The stub is what every example talks to, so a drift between its shapes
 * and the client's is invisible until someone tries the examples: it once
 * stored replies as `text` where the protocol says `content`, and the
 * overlay — which drops a message without a string `content` — showed every
 * thread and every team note as empty. Nothing failed; there was simply
 * nothing there. These tests read the stub through the same functions the
 * overlay uses, so a shape the client cannot read fails here instead.
 */

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AnnoKitTransport } from "../src/transport";
import { checkProtocol, registerSession } from "../src/handshake";
import { annoKitPreferences } from "../src/prefs";
import { fetchAnnotation, fetchThread, postThreadReply, type ThreadMessage } from "../src/thread";
import {
  createComment,
  deleteComment,
  fetchComment,
  fetchComments,
  postCommentMessage,
  setCommentStatus,
} from "../src/comments";
import { isViewableScreenshot } from "../src/reference-view";
import type { PendingCapture } from "../src/types";

const STUB = fileURLToPath(new URL("../server/stub-server.mjs", import.meta.url));
const SESSION = "stub-test-session";
/** A stand-in app: the server's directory decides which assets/ it lists. */
const APP_FIXTURE = fileURLToPath(new URL("./fixtures/app", import.meta.url));
const LOGO = join(APP_FIXTURE, "assets", "brand", "logo.png");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

let stub: ChildProcess;
let endpoint: string;
let transport: AnnoKitTransport;

async function freePort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address() as { port: number };
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

beforeAll(async () => {
  const port = await freePort();
  // A copy, because the asset store is writable and the fixture is tracked.
  const app = mkdtempSync(join(tmpdir(), "annokit-stub-app-"));
  cpSync(APP_FIXTURE, app, { recursive: true });
  stub = spawn(process.execPath, [STUB, "--port", String(port)], {
    env: { ...process.env, AGENT: "0", AGENT_CMD: "", AGENT_DIR: app },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    stub.stdout!.on("data", (chunk: Buffer) => { if (chunk.toString().includes("stub —")) resolve(); });
    stub.once("exit", (code) => reject(new Error(`stub exited with ${code}`)));
  });
  endpoint = `http://127.0.0.1:${port}`;
  transport = new AnnoKitTransport({ endpoint, token: null, sessionId: SESSION, author: null, envAuthor: null });
});

afterAll(() => { stub?.kill(); });

/** What the composer would capture on a FeedRow. */
function capture(): PendingCapture {
  return {
    x: 150, y: 310, routeName: "/home",
    hit: {
      element: "FeedRow", componentStack: ["HomeScreen", "FeedRow"],
      source: { file: "app/FeedRow.tsx", line: 9 }, testID: "feed-row-1",
      frame: { x: 17, y: 306, width: 367, height: 68 },
    },
  } as unknown as PendingCapture;
}

async function createAnnotation(id: string, comment = "Make this green"): Promise<void> {
  const res = await transport.postJsonAt(`/sessions/${SESSION}/annotations`, {
    id, comment, kind: "feedback", platform: "native", element: "FeedRow",
    componentStack: [], x: 1, y: 2, boundingBox: { x: 0, y: 0, width: 1, height: 1 }, scroll: { offsetY: 0 },
  });
  expect(res.status).toBe(201);
}

/**
 * A one-file multipart upload, written out by hand: React Native's typings
 * replace the DOM's FormData and Blob with ones a Node test cannot build.
 */
async function upload(path: string, bytes: Buffer): Promise<Response> {
  const boundary = "annokit-test-boundary";
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="screenshot.png"\r\n` +
      `Content-Type: image/png\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return fetch(`${endpoint}${path}`, {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body: new Uint8Array(body),
  });
}

describe("handshake", () => {
  it("runs no agent when AGENT=0, and says so in /agent", async () => {
    const state = (await (await fetch(`${endpoint}/agent`)).json()) as { enabled: boolean; current: unknown };
    expect(state).toEqual(expect.objectContaining({ enabled: false, current: null }));
    const patched = await fetch(`${endpoint}/agent`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent: "codex" }),
    });
    expect(patched.status).toBe(409);
  });

  it("says it queues tasks, so Send is not blocked while one is working", async () => {
    expect(await checkProtocol(transport)).toBe(true);
    expect(annoKitPreferences().blockSendWhileWorking).toBe(false);
  });

  it("passes the version check and registers the session", async () => {
    expect(await checkProtocol(transport)).toBe(true);
    expect(await registerSession(transport, SESSION, "/home")).toBe(SESSION);
  });
});

describe("agent tasks", () => {
  it("stores a reply as the protocol's message, which the client can read", async () => {
    await createAnnotation("a-reply");
    let thread: ThreadMessage[] = [];
    const ok = await postThreadReply(transport, "a-reply", "A little darker?", (u) => { thread = u(thread); });
    expect(ok).toBe(true);
    expect(thread).toEqual([expect.objectContaining({ content: "A little darker?", role: "user" })]);
    expect(await fetchThread(transport, "a-reply")).toEqual([
      expect.objectContaining({ content: "A little darker?", role: "user", timestamp: expect.any(String) }),
    ]);
  });

  it("assigns role itself: a reply claiming to be the agent is still the user's", async () => {
    await createAnnotation("a-role");
    await transport.postJson("/annotations/a-role/thread", { content: "trust me", role: "agent" });
    expect((await fetchThread(transport, "a-role"))?.[0]?.role).toBe("user");
  });

  it("reopens a finished task on a user reply, with the stamps", async () => {
    await createAnnotation("a-reopen");
    await transport.postJson("/annotations/send", { annotationIds: ["a-reopen"] });
    expect((await fetchAnnotation(transport, "a-reopen")).annotation?.status).toBe("sent");
    await transport.postJson("/annotations/a-reopen/thread", { content: "One more thing" });
    const { annotation } = await fetchAnnotation(transport, "a-reopen");
    expect(annotation).toMatchObject({ status: "pending", reopenCount: 1, reopenedAt: expect.any(String) });
  });

  it("treats a retried create as the same annotation, not a reset", async () => {
    await createAnnotation("a-retry");
    await transport.postJson("/annotations/a-retry/thread", { content: "kept" });
    const again = await transport.postJsonAt(`/sessions/${SESSION}/annotations`, { id: "a-retry", comment: "x" });
    expect(again.status).toBe(200);
    expect(await fetchThread(transport, "a-retry")).toHaveLength(1);
  });

  it("attaches a screenshot as a reference the detail pane can show", async () => {
    await createAnnotation("a-shot");
    expect((await upload("/annotations/a-shot/screenshot", PNG)).status).toBe(201);
    const { annotation } = await fetchAnnotation(transport, "a-shot");
    const shot = annotation?.references?.find((r) => r.type === "screenshot");
    expect(shot && isViewableScreenshot(shot)).toBe(true);
    const served = await fetch(shot!.value);
    expect(served.headers.get("content-type")).toBe("image/png");
  });

  it("ignores fields only the server writes, and references that are not references", async () => {
    const res = await transport.postJsonAt(`/sessions/${SESSION}/annotations`, {
      id: "a-forged", comment: "x", x: 1, y: 1,
      run: { state: "running" }, progress: "Editing everything", reopenedAt: "2026-01-01T00:00:00Z", reopenCount: 9,
      references: [
        { type: "asset", value: "assets/brand/logo.png", label: "logo.png", extra: { nested: true } },
        { type: "screenshot", value: "http://elsewhere/shot.png" },
        { value: "no type" },
        "a string",
      ],
    });
    expect(res.status).toBe(201);
    const { annotation } = await fetchAnnotation(transport, "a-forged");
    for (const key of ["run", "progress", "reopenedAt", "reopenCount"]) expect(annotation).not.toHaveProperty(key);
    expect(annotation?.references).toEqual([{ type: "asset", value: "assets/brand/logo.png", label: "logo.png" }]);
  });

  it("deletes a task's screenshots with it", async () => {
    await createAnnotation("a-gone");
    await upload("/annotations/a-gone/screenshot", PNG);
    const shot = (await fetchAnnotation(transport, "a-gone")).annotation!.references!.find((r) => r.type === "screenshot")!;
    expect((await fetch(shot.value)).status).toBe(200);
    expect(await transport.del("/annotations/a-gone")).toBe(true);
    expect((await fetch(shot.value)).status).toBe(404);
  });

  it("refuses an upload that is not an image, whatever it claims", async () => {
    await createAnnotation("a-fake");
    expect((await upload("/annotations/a-fake/screenshot", Buffer.from("<html>"))).status).toBe(415);
  });

  it("answers DELETE with a 2xx", async () => {
    await createAnnotation("a-delete");
    expect(await transport.del("/annotations/a-delete")).toBe(true);
    expect((await fetchAnnotation(transport, "a-delete")).gone).toBe(true);
  });
});

describe("team notes", () => {
  it("round-trips a note and its replies through the client's readers", async () => {
    const created = await createComment(transport, capture(), "Is this the right label?", "Ada");
    expect(created).toMatchObject({
      status: "open",
      author: { name: "Ada" },
      messages: [expect.objectContaining({ content: "Is this the right label?", author: expect.objectContaining({ name: "Ada" }) })],
    });
    const id = created!.id;

    const replied = await postCommentMessage(transport, id, "Start here, maybe", "Dana");
    expect(replied?.messages.map((m) => [m.author?.name, m.content])).toEqual([
      ["Ada", "Is this the right label?"],
      ["Dana", "Start here, maybe"],
    ]);

    expect((await fetchComments(transport, "/home"))?.map((c) => c.id)).toContain(id);
    expect((await fetchComments(transport, "/elsewhere"))?.map((c) => c.id)).not.toContain(id);
    expect((await setCommentStatus(transport, id, "resolved"))?.status).toBe("resolved");
    expect((await fetchComment(transport, id))?.status).toBe("resolved");
    expect(await deleteComment(transport, id)).toBe(true);
    expect(await fetchComment(transport, id)).toBeNull();
  });

  it("attaches a screenshot to a note in the same shape", async () => {
    const created = await createComment(transport, capture(), "Look at this");
    expect((await upload(`/comments/${created!.id}/screenshot`, PNG)).status).toBe(201);
    const shot = (await fetchComment(transport, created!.id))?.references?.find((r) => r.type === "screenshot");
    expect(shot && isViewableScreenshot(shot)).toBe(true);
  });

  it("refuses a status the protocol does not have", async () => {
    const created = await createComment(transport, capture(), "Status check");
    const res = await fetch(`${endpoint}/comments/${created!.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "deleted" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("agent runs", () => {
  /**
   * A second stub with a fake agent: it waits a moment, then answers with
   * whether its prompt carried the thread. The wait is the window in which
   * a user reply lands DURING the run.
   */
  let agentStub: ChildProcess;
  let agentTransport: AnnoKitTransport;

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), "annokit-stub-agent-"));
    const script = join(dir, "agent.mjs");
    writeFileSync(script, [
      "const prompt = process.argv.slice(2).join(' ');",
      "await new Promise((r) => setTimeout(r, 400));",
      "console.log(prompt.includes('SINCE THEN') ? 'saw the thread' : 'saw only the request');",
    ].join("\n"));
    const port = await freePort();
    agentStub = spawn(process.execPath, [STUB, "--port", String(port)], {
      env: { ...process.env, AGENT: "1", AGENT_CMD: `${process.execPath} ${script} {prompt}`, AGENT_DIR: dir },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise<void>((resolve, reject) => {
      agentStub.stdout!.on("data", (chunk: Buffer) => { if (chunk.toString().includes("stub —")) resolve(); });
      agentStub.once("exit", (code) => reject(new Error(`stub exited with ${code}`)));
    });
    agentTransport = new AnnoKitTransport({
      endpoint: `http://127.0.0.1:${port}`, token: null, sessionId: SESSION, author: null, envAuthor: null,
    });
  });

  afterAll(() => { agentStub?.kill(); });

  async function settled(id: string) {
    for (let i = 0; i < 100; i++) {
      const { annotation } = await fetchAnnotation(agentTransport, id);
      if (annotation && annotation.status !== "working" && (annotation.thread ?? []).some((m) => m.content.startsWith("saw"))) {
        return annotation;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("the run never finished");
  }

  it("keeps a reply sent mid-run, and reopens the task the run did not see it in", async () => {
    await agentTransport.postJson(`/sessions/${SESSION}/annotations`, { id: "run-1", comment: "Make it green" });
    await agentTransport.postJson("/annotations/send", { annotationIds: ["run-1"] });
    expect((await fetchAnnotation(agentTransport, "run-1")).annotation?.status).toBe("working");
    await agentTransport.postJson("/annotations/run-1/thread", { content: "Darker, please" });

    const done = await settled("run-1");
    expect(done.thread?.map((m) => [m.role, m.content])).toEqual([
      ["user", "Darker, please"],
      ["agent", "saw only the request"],
    ]);
    expect(done).toMatchObject({ status: "pending", reopenCount: 1 });
  });

  it("gives a reopened task's thread to the agent", async () => {
    await agentTransport.postJson("/annotations/send", { annotationIds: ["run-1"] });
    await new Promise((r) => setTimeout(r, 100));
    const done = await settled("run-1");
    expect(done.status).toBe("sent");
    expect(done.thread?.at(-1)?.content).toBe("saw the thread");
  });
});

describe("the undo line after an agent edits in place", () => {
  /**
   * The examples start the server in a SUBDIRECTORY of the repository, and
   * git names changed files from the root — so an undo line built from those
   * names has to say where to run. A file the agent created has nothing to
   * restore to, so it is listed for removal instead.
   */
  it("restores edited files and removes created ones, run from anywhere", async () => {
    const repo = mkdtempSync(join(tmpdir(), "annokit-undo-"));
    const app = join(repo, "apps", "demo");
    mkdirSync(app, { recursive: true });
    writeFileSync(join(app, "label.txt"), "Annotate me\n");
    const g = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
    g("init", "-q");
    g("-c", "user.email=t@t", "-c", "user.name=t", "add", ".");
    g("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
    const script = join(repo, "agent.mjs");
    writeFileSync(script, [
      "import { writeFileSync } from 'node:fs';",
      "writeFileSync('label.txt', 'Ship it\\n');",
      "writeFileSync('extra.txt', 'new\\n');",
      "console.log('done');",
    ].join("\n"));
    // The agent script itself is outside the app, so only the agent's edits show.
    g("-c", "user.email=t@t", "-c", "user.name=t", "add", "agent.mjs");
    g("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "agent");

    const port = await freePort();
    const server = spawn(process.execPath, [STUB, "--port", String(port)], {
      cwd: app,
      env: { ...process.env, AGENT: "1", AGENT_CMD: `${process.execPath} ${script} {prompt}`, AGENT_DIR: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    server.stdout!.on("data", (c: Buffer) => { log += c.toString(); });
    try {
      for (let i = 0; i < 100 && !log.includes("stub —"); i++) await new Promise((r) => setTimeout(r, 50));
      const t = new AnnoKitTransport({
        endpoint: `http://127.0.0.1:${port}`, token: null, sessionId: SESSION, author: null, envAuthor: null,
      });
      await t.postJson(`/sessions/${SESSION}/annotations`, { id: "undo-1", comment: "Ship it" });
      await t.postJson("/annotations/send", { annotationIds: ["undo-1"] });
      for (let i = 0; i < 100 && !log.includes("undo:"); i++) await new Promise((r) => setTimeout(r, 50));
      await new Promise((r) => setTimeout(r, 100));

      const undo = [...log.matchAll(/undo: {3}(.+)/g)].map((m) => m[1].replace(/ {3}# new files$/, ""));
      expect(undo).toHaveLength(2);
      for (const line of undo) execFileSync("sh", ["-c", line], { cwd: tmpdir() });
      expect(readFileSync(join(app, "label.txt"), "utf8")).toBe("Annotate me\n");
      expect(g("status", "--porcelain")).toBe("");
    } finally {
      server.kill();
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("bad input", () => {
  it("answers malformed JSON with 400 everywhere, never as an empty body", async () => {
    await createAnnotation("a-garbled");
    const res = await fetch(`${endpoint}/annotations/send`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{not json",
    });
    expect(res.status).toBe(400);
    expect((await fetchAnnotation(transport, "a-garbled")).annotation?.status).toBe("pending");
  });

  it("answers an oversized body with 413 and keeps running", async () => {
    const res = await fetch(`${endpoint}/comments`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "x".repeat(2 * 1024 * 1024) }),
    });
    expect(res.status).toBe(413);
    expect(await checkProtocol(transport)).toBe(true);
  });
});

// ── progress, from a real agent run ──────────────────────────────────────
//
// A fake `claude` on PATH that streams what Claude Code streams — two tool
// calls, then the result — slowly enough to be seen mid-run. The stub must
// turn the calls into `progress` while the task is `working`, and clear it
// when the run ends.

describe("progress while the agent works", () => {
  let agentStub: ChildProcess;
  let base: string;
  const bin = mkdtempSync(join(tmpdir(), "annokit-fake-agent-"));

  beforeAll(async () => {
    mkdirSync(join(bin, "assets"), { recursive: true });
    writeFileSync(
      join(bin, "claude"),
      [
        "#!/bin/sh",
        '[ "$1" = "--version" ] && { echo 1.0; exit 0; }',
        `[ "$1" = "auth" ] && { echo '{"loggedIn": true}'; exit 0; }`,
        // Model discovery: counted, so the cache can be seen working.
        `[ "$2" = "--input-format" ] && { echo x >> "${join(bin, "discoveries.txt")}"; exit 0; }`,
        `printf '%s' "$2" > "${join(bin, "prompt.txt")}"`,
        `shift 2; echo "$@" > "${join(bin, "args.txt")}"`,
        // A session that cannot be continued, on demand.
        `case "$*" in *--resume*) [ -f "${join(bin, "fail-resume")}" ] && { echo "No conversation found" >&2; exit 1; };; esac`,
        `echo '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/x/app/Button.tsx"}}]}}'`,
        "sleep 1",
        // printf, not echo: sh's echo would turn the JSON's \n into a line break.
        `printf '%s\\n' '{"type":"result","result":"Made it blue.\\nTitle: Blue button"}'`,
      ].join("\n"),
      { mode: 0o755 },
    );
    const port = await freePort();
    agentStub = spawn(process.execPath, [STUB, "--port", String(port), "--agent=claude"], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, AGENT_DIR: bin, AGENT_CMD: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise<void>((resolve, reject) => {
      agentStub.stdout!.on("data", (chunk: Buffer) => { if (chunk.toString().includes("stub —")) resolve(); });
      agentStub.once("exit", (code) => reject(new Error(`stub exited with ${code}`)));
    });
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(() => { agentStub?.kill(); });

  const post = (path: string, body: unknown) =>
    fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const read = async () => (await (await fetch(`${base}/annotations/p1`)).json()) as { status: string; progress?: string };

  it("reports the agent, and switches model over PATCH /agent", async () => {
    const state = (await (await fetch(`${base}/agent`)).json()) as {
      enabled: boolean; current: { id: string; model: string | null } | null;
      agents: { id: string; installed: boolean; connected?: boolean }[];
    };
    expect(state.enabled).toBe(true);
    expect(state.current?.id).toBe("claude");
    // Asked of `claude auth status`, which the fake answers signed in.
    expect(state.agents.find((a) => a.id === "claude")?.connected).toBe(true);
    // It runs each task on the agent the task carries, and says so.
    expect((state as { perTask?: boolean }).perTask).toBe(true);
    expect(state.agents.map((a) => a.id)).toEqual(["claude", "codex", "cursor", "opencode", "gemini", "grok"]);
    const patch = (body: unknown) =>
      fetch(`${base}/agent`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const switched = (await (await patch({ model: "sonnet" })).json()) as { current: { model: string } };
    expect(switched.current.model).toBe("sonnet");
    expect((await patch({ model: "; rm -rf /" })).status).toBe(400);
    expect((await patch({ agent: "nope" })).status).toBe(400);
    await patch({ model: null });
  });

  it("asks the CLI for models once a minute, and again on refresh", async () => {
    const count = () => {
      try { return readFileSync(join(bin, "discoveries.txt"), "utf8").trim().split("\n").length; } catch { return 0; }
    };
    const models = (q = "") => fetch(`${base}/agent/models?agent=claude${q}`).then((r) => r.json());
    await models();
    await models();
    expect(count()).toBe(1);
    await models("&refresh=1");
    expect(count()).toBe(2);
  });

  it("says what the agent is doing, then clears it when the run ends", async () => {
    await post("/sessions", { id: "ps", url: "/" });
    await post("/sessions/ps/annotations", {
      id: "p1", comment: "Make it blue", element: "Button", x: 1, y: 1,
      references: [{ type: "asset", value: "assets/brand/logo.png", label: "logo.png", open: "assets/brand/logo.png" }],
    });
    await post("/annotations/send", { annotationIds: ["p1"] });

    let seen: { status: string; progress?: string } | null = null;
    for (let i = 0; i < 40 && !seen; i++) {
      const a = await read();
      if (a.progress) seen = a;
      else await new Promise((r) => setTimeout(r, 50));
    }
    expect(seen).toEqual(expect.objectContaining({ status: "working", progress: "Editing Button.tsx" }));

    let done = await read();
    for (let i = 0; i < 60 && done.status === "working"; i++) {
      await new Promise((r) => setTimeout(r, 100));
      done = await read();
    }
    expect(done.status).toBe("sent");
    expect(done.progress).toBeUndefined();
    // The picked asset reached the agent, with where to open it.
    expect(readFileSync(join(bin, "prompt.txt"), "utf8")).toContain(
      'asset logo.png: use "assets/brand/logo.png" in code; open assets/brand/logo.png to see it',
    );
    // And where the app's assets live, attached or not.
    expect(readFileSync(join(bin, "prompt.txt"), "utf8")).toContain("The app's own assets (images, fonts, media) are in assets/");
    // No choice on the task: the agent's own model and effort.
    expect(readFileSync(join(bin, "args.txt"), "utf8")).not.toMatch(/--model|--effort/);
  }, 15_000);

  it("runs a task on the model and effort it asked for", async () => {
    await post("/sessions/ps/annotations", {
      id: "p2", comment: "Make it red", element: "Button", x: 1, y: 1,
      agent: { id: "claude", model: "opus", effort: "high" },
    });
    await post("/annotations/send", { annotationIds: ["p2"] });
    let a = (await (await fetch(`${base}/annotations/p2`)).json()) as { status: string };
    for (let i = 0; i < 60 && a.status !== "sent"; i++) {
      await new Promise((r) => setTimeout(r, 100));
      a = (await (await fetch(`${base}/annotations/p2`)).json()) as { status: string };
    }
    expect(a.status).toBe("sent");
    const args = readFileSync(join(bin, "args.txt"), "utf8");
    expect(args).toContain("--model opus");
    expect(args).toContain("--effort high");
  }, 15_000);

  it("continues the agent's own session on a follow-up, and starts fresh when it cannot", async () => {
    type Task = { status: string; runs?: { outcome: string; resumed?: boolean; error?: string }[] };
    const task = async () => (await (await fetch(`${base}/annotations/p6`)).json()) as Task;
    const runOnce = async (count: number) => {
      await post("/annotations/send", { annotationIds: ["p6"] });
      let t = await task();
      for (let i = 0; i < 80 && ((t.runs?.length ?? 0) < count || t.status === "working"); i++) {
        await new Promise((r) => setTimeout(r, 100));
        t = await task();
      }
      return t;
    };
    await post("/sessions/ps/annotations", { id: "p6", comment: "Make it blue", element: "Button", x: 1, y: 1 });
    await runOnce(1);
    const first = readFileSync(join(bin, "args.txt"), "utf8");
    const sessionId = /--session-id (\S+)/.exec(first)?.[1];
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);

    // A follow-up continues that session, and is asked only what is new.
    await post("/annotations/p6/thread", { content: "Darker, please" });
    const second = await runOnce(2);
    expect(readFileSync(join(bin, "args.txt"), "utf8")).toContain(`--resume ${sessionId}`);
    const prompt = readFileSync(join(bin, "prompt.txt"), "utf8");
    expect(prompt).toContain("They replied about the change you just made:");
    expect(prompt).toContain("Darker, please");
    expect(prompt).not.toContain("Make it blue");
    expect(second.runs?.map((r) => [r.outcome, r.resumed ?? false])).toEqual([["done", false], ["done", true]]);

    // A session that is gone: recorded as a failed continuation, then a fresh run.
    writeFileSync(join(bin, "fail-resume"), "");
    await post("/annotations/p6/thread", { content: "Bluer" });
    const third = await runOnce(4);
    rmSync(join(bin, "fail-resume"));
    expect(third.runs?.slice(2).map((r) => [r.outcome, r.resumed ?? false])).toEqual([["failed", true], ["done", false]]);
    expect(third.runs?.[2]?.error).toMatch(/started again from the thread/);
    const fresh = readFileSync(join(bin, "args.txt"), "utf8");
    expect(fresh).toMatch(/--session-id (?!.*--resume)/);
    expect(fresh).not.toContain(sessionId);
  }, 30_000);

  it("keeps a history of runs on the task, added to and never rewritten", async () => {
    type Run = { agent: { id: string; label: string }; model?: string; effort?: string; outcome: string; startedAt: string; finishedAt?: string; summary?: string };
    const runsOf = async (id: string) => ((await (await fetch(`${base}/annotations/${id}`)).json()) as { runs?: Run[] }).runs ?? [];
    const [first] = await runsOf("p2");
    expect(first).toEqual(expect.objectContaining({
      agent: { id: "claude", label: "Claude Code" }, model: "opus", effort: "high", outcome: "done", summary: "Made it blue.",
      // The agent's last line, taken out of its reply.
      title: "Blue button",
    }));
    const thread = ((await (await fetch(`${base}/annotations/p2`)).json()) as { thread?: { content: string }[] }).thread ?? [];
    expect(thread.some((m) => m.content.includes("Made it blue."))).toBe(true);
    expect(thread.some((m) => /Title:/.test(m.content))).toBe(false);
    expect(Date.parse(first!.finishedAt!)).toBeGreaterThanOrEqual(Date.parse(first!.startedAt));
    // Run it again: a second entry, the first untouched.
    await post("/annotations/send", { annotationIds: ["p2"] });
    let runs = await runsOf("p2");
    for (let i = 0; i < 60 && (runs.length < 2 || runs[1]!.outcome === "running"); i++) {
      await new Promise((r) => setTimeout(r, 100));
      runs = await runsOf("p2");
    }
    expect(runs.map((r) => r.outcome)).toEqual(["done", "done"]);
    expect(runs[0]).toEqual(first);
    // A client cannot write the history.
    await post("/sessions/ps/annotations", { id: "p4", comment: "x", runs: [{ outcome: "done" }] });
    expect(await runsOf("p4")).toEqual([]);
  }, 20_000);

  it("keeps only a well-formed choice on the task", async () => {
    await post("/sessions/ps/annotations", {
      id: "p3", comment: "x", element: "Button", x: 1, y: 1,
      agent: { id: "claude", model: "; rm -rf /", effort: "HIGH!" },
    });
    const a = (await (await fetch(`${base}/annotations/p3`)).json()) as { agent?: unknown };
    expect(a.agent).toEqual({ id: "claude" });
  });
});

// ── The app's assets (docs/assets.md) ────────────────────────────────────

describe("assets", () => {
  it("lists the app's assets/ folder, with what code uses and where the agent can look", async () => {
    const body = (await (await fetch(`${endpoint}/assets`)).json()) as {
      assets: { path: string; publicPath: string; agentPath: string; previewUrl?: string }[];
      writable: boolean;
    };
    const logo = body.assets.find((a) => a.path === "brand/logo.png");
    expect(logo).toEqual(expect.objectContaining({
      publicPath: "assets/brand/logo.png",
      agentPath: "assets/brand/logo.png",
      previewUrl: `${endpoint}/assets/raw/brand/logo.png`,
    }));
    expect(body.writable).toBe(true); // pasted images upload to assets/uploads/
  });

  it("serves a preview as an image that cannot be anything else", async () => {
    const res = await fetch(`${endpoint}/assets/raw/brand/logo.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
  });

  it("never serves a path outside the folder", async () => {
    for (const p of ["..%2F..%2Fpackage.json", "%2Fetc%2Fpasswd", "..%2Fapp.json", "brand%2F..%2F..%2Fapp.json"]) {
      expect((await fetch(`${endpoint}/assets/raw/${p}`)).status).toBe(404);
    }
  });

  it("takes an image into assets/uploads, never anywhere else, and deletes only there", async () => {
    const app = mkdtempSync(join(tmpdir(), "annokit-assets-app-"));
    mkdirSync(join(app, "assets", "brand"), { recursive: true });
    writeFileSync(join(app, "assets", "brand", "logo.png"), readFileSync(LOGO));
    const port = await freePort();
    const writer = spawn(process.execPath, [STUB, "--port", String(port)], {
      env: { ...process.env, AGENT: "0", AGENT_CMD: "", AGENT_DIR: app },
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      await new Promise<void>((resolve, reject) => {
        writer.stdout!.on("data", (c: Buffer) => { if (c.toString().includes("stub —")) resolve(); });
        writer.once("exit", (code) => reject(new Error(`stub exited with ${code}`)));
      });
      const at = `http://127.0.0.1:${port}`;
      const send = (bytes: Buffer, filename: string) => fetch(`${at}/assets`, {
        method: "POST",
        headers: { "Content-Type": "multipart/form-data; boundary=b" },
        body: Buffer.concat([
          Buffer.from(`--b\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`),
          bytes,
          Buffer.from("\r\n--b--\r\n"),
        ]),
      });
      const created = await send(readFileSync(LOGO), "../../pasted shot.png");
      expect(created.status).toBe(201);
      const asset = (await created.json()) as { path: string; publicPath: string };
      expect(asset).toEqual(expect.objectContaining({ path: "uploads/pasted-shot.png", publicPath: "assets/uploads/pasted-shot.png" }));
      expect(readFileSync(join(app, "assets", "uploads", "pasted-shot.png")).equals(readFileSync(LOGO))).toBe(true);
      expect((await send(Buffer.from("<script>1</script>"), "x.png")).status).toBe(415);
      expect((await fetch(`${at}/assets/brand/logo.png`, { method: "DELETE" })).status).toBe(403);
      expect((await fetch(`${at}/assets/uploads/pasted-shot.png`, { method: "DELETE" })).status).toBe(204);
    } finally {
      writer.kill();
    }
  });
});

// ── Who may talk to the stub ─────────────────────────────────────────────

describe("access", () => {
  it("answers no cross-site request from a page that is not on localhost", async () => {
    const preflight = (origin: string) =>
      fetch(`${endpoint}/annotations/send`, {
        method: "OPTIONS",
        headers: { Origin: origin, "Access-Control-Request-Method": "POST" },
      });
    expect((await preflight("https://evil.example")).status).toBe(403);
    const web = await preflight("http://localhost:8081");
    expect(web.status).toBe(204);
    expect(web.headers.get("access-control-allow-origin")).toBe("http://localhost:8081");
  });

  it("refuses a Host that is a domain name, which is what DNS rebinding sends", async () => {
    const { request } = await import("node:http");
    const status = await new Promise<number>((resolve, reject) => {
      const url = new URL(endpoint);
      request({ host: url.hostname, port: url.port, path: "/health", headers: { Host: `evil.example:${url.port}` } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      }).on("error", reject).end();
    });
    expect(status).toBe(403);
  });

  it("asks for nothing on this machine only", async () => {
    expect((await fetch(`${endpoint}/health`)).status).toBe(200);
  });

  it("needs the token once it has one, except for images the app loads without headers", async () => {
    const port = await freePort();
    const tokened = spawn(process.execPath, [STUB, "--port", String(port)], {
      env: { ...process.env, AGENT: "0", AGENT_CMD: "", STUB_TOKEN: "s3cret-token", AGENT_DIR: APP_FIXTURE },
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      await new Promise<void>((resolve, reject) => {
        tokened.stdout!.on("data", (c: Buffer) => { if (c.toString().includes("stub —")) resolve(); });
        tokened.once("exit", (code) => reject(new Error(`stub exited with ${code}`)));
      });
      const at = `http://127.0.0.1:${port}`;
      expect((await fetch(`${at}/health`)).status).toBe(401);
      expect((await fetch(`${at}/health`, { headers: { Authorization: "Bearer wrong-token!" } })).status).toBe(401);
      expect((await fetch(`${at}/health`, { headers: { Authorization: "Bearer s3cret-token" } })).status).toBe(200);
      expect((await fetch(`${at}/assets/raw/brand/logo.png`)).status).toBe(200);
    } finally {
      tokened.kill();
    }
  });
});

describe("screenshot memory", () => {
  it("drops the oldest screenshots past the cap, never the newest", async () => {
    const port = await freePort();
    const capped = spawn(process.execPath, [STUB, "--port", String(port)], {
      env: { ...process.env, AGENT: "0", AGENT_CMD: "", SCREENSHOTS_MB: "0.00001" }, // ~10 bytes
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      await new Promise<void>((resolve, reject) => {
        capped.stdout!.on("data", (c: Buffer) => { if (c.toString().includes("stub —")) resolve(); });
        capped.once("exit", (code) => reject(new Error(`stub exited with ${code}`)));
      });
      const t = new AnnoKitTransport({ endpoint: `http://127.0.0.1:${port}`, token: null, sessionId: "cap", author: null, envAuthor: null });
      const shotOf = async (id: string) => {
        await t.postJsonAt("/sessions/cap/annotations", { id, comment: "x", x: 1, y: 1 });
        const boundary = "cap-boundary";
        await fetch(`http://127.0.0.1:${port}/annotations/${id}/screenshot`, {
          method: "POST",
          headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
          body: Buffer.concat([
            Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="s.png"\r\nContent-Type: image/png\r\n\r\n`),
            PNG,
            Buffer.from(`\r\n--${boundary}--\r\n`),
          ]),
        });
        return (await fetchAnnotation(t, id)).annotation!.references!.find((r) => r.type === "screenshot")!.value;
      };
      const first = await shotOf("c1");
      const second = await shotOf("c2");
      expect((await fetch(first)).status).toBe(404);
      expect((await fetch(second)).status).toBe(200);
    } finally {
      capped.kill();
    }
  });
});
