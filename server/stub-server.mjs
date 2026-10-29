#!/usr/bin/env node
/**
 * AnnoKit Protocol v1 — a stub server to try the overlay against.
 *
 * The overlay is a strict no-op until an endpoint and a session id resolve
 * AND `GET /health` answers with a matching `protocolVersion`. So an app
 * with no server shows nothing at all, and "nothing happens" is the worst
 * possible first impression of a tool whose whole point is visible. This
 * gives a fresh install, and every example, something real to talk to.
 *
 * It is deliberately IN MEMORY and single-process: restart it and the marks
 * are gone. That is the right trade for an example — there is no database to
 * install, no migration to run, and the entire protocol fits in one file you
 * can read in a sitting. It speaks every route the client calls, in the
 * shapes docs/protocol.md gives them (test/stub-server.test.ts holds it to
 * that), and it bounds its inputs. It is still NOT a server to deploy: see
 * "Server obligations" in docs/protocol.md for what a real one must enforce
 * (authorization, tenancy, retention), none of which is here.
 *
 *   npx annokit server [--port 4788]   # from your app, once the package is installed
 *   node server/stub-server.mjs          # from a clone of this repository
 *
 * It ships in the package as the `annokit` bin, so trying the overlay
 * needs no clone. Node built-ins only, like the rest of the package.
 */
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { execFile, spawnSync } from "node:child_process";
import { join, relative, resolve, sep } from "node:path";
import { networkInterfaces, tmpdir } from "node:os";
import { createLocalStore } from "./assets.mjs";
import {
  AGENT_SANDBOX, AGENT_TOOLS, PROVIDERS, PROVIDER_ORDER, checkConnections, customProvider, detectProviders, providerModels,
} from "./agents.mjs";

const PORT = Number(process.argv[process.argv.indexOf("--port") + 1]) || Number(process.env.PORT) || 4788;
const PROTOCOL_VERSION = 1;

/**
 * THE AGENT BRIDGE — on unless you turn it off.
 *
 *   node stub-server.mjs                # the first installed: Claude Code,
 *                                       # Codex, Cursor, OpenCode, Gemini, Grok
 *   AGENT=codex node stub-server.mjs    # start with this one
 *   node stub-server.mjs --no-agent     # or AGENT=0: store tasks only
 *
 * Tapping *Send to agent* hands the task to an agent running headless, and
 * the edit lands in your app — Metro reloads it, and you watch the change
 * you asked for appear on the device that asked for it. That is what this
 * server is for, so it is the default. Which agent and which model can
 * be changed while it runs, from the app's Agent item (`/agent` routes).
 *
 * It WRITES TO YOUR FILES. The agent's working directory is pinned to the
 * directory the server was started in (AGENT_DIR overrides it), and Claude
 * Code and Codex get file tools only — no shell. The other four have no
 * file-only headless mode; the stub says so when one of them is in use
 * (./agents.mjs). Every run names the files it edited, and the commands
 * that undo them.
 */
const AGENT_FLAG = process.argv.find((a) => a === "--agent" || a.startsWith("--agent="));
const AGENT_OFF =
  process.argv.includes("--no-agent") ||
  ["0", "false", "off", "no"].includes((process.env.AGENT ?? "").trim().toLowerCase());
const AGENT_ENABLED = !AGENT_OFF;

/**
 * THE CURRENT AGENT — mutable, because /agent switches it. A run takes the
 * agent and model at its start, so switching mid-run changes the NEXT task.
 */
const CUSTOM = customProvider();
let detected = {};
let AGENT = null;
let AGENT_MODEL = process.env.AGENT_MODEL || null;
let AGENT_ERROR = null;
/** Which installed agents are signed in (./agents.mjs, INSTALLED IS NOT CONNECTED). */
let connected = {};
let connectionsChecked = Promise.resolve();

function useAgent(id) {
  const provider = id === "custom" ? CUSTOM : PROVIDERS[id];
  const found = detected[id];
  AGENT = provider && found?.installed ? { id, ...provider, bin: found.bin, extra: found.extra ?? {} } : null;
}

/** Look for the CLIs again and settle on one: AGENT_CMD, the named one, else the first installed. */
function detectAgents() {
  detected = detectProviders(CUSTOM ? { ...PROVIDERS, custom: CUSTOM } : PROVIDERS);
  if (!AGENT_ENABLED) return;
  const asked = (AGENT_FLAG?.split("=")[1] || process.env.AGENT || "").trim().toLowerCase();
  const named = asked && !["1", "true", "on", "yes"].includes(asked) ? asked : null;
  const keep = AGENT && detected[AGENT.id]?.installed ? AGENT.id : null;
  // A NAMED agent that is missing is not swapped for another: whoever set
  // AGENT=codex wants Codex, and quietly running something else would make
  // the result a lie. They get the error, and can pick one in the app.
  const pick = CUSTOM ? "custom" : keep
    ?? (named ? (detected[named]?.installed ? named : null) : PROVIDER_ORDER.find((id) => detected[id]?.installed));
  if (pick) useAgent(pick);
  else AGENT = null;
  AGENT_ERROR = AGENT ? null
    : CUSTOM ? `AGENT_CMD names "${CUSTOM.bins[0]}", which is not on PATH`
    : named && !PROVIDERS[named] ? `unknown agent "${named}" — expected ${PROVIDER_ORDER.join(", ")}`
    : named ? `${PROVIDERS[named].label} is not installed (\`${PROVIDERS[named].bins[0]}\` not on PATH)`
    : `No agent is installed on the machine running this server.\n  Install one:\n` +
      `    Claude Code  npm i -g @anthropic-ai/claude-code   (then: claude)\n` +
      `    Codex        npm i -g @openai/codex               (then: codex)\n` +
      `    or Cursor, OpenCode, Gemini CLI or Grok\n` +
      `  ...or point AGENT_CMD at your own: AGENT_CMD="my-agent {prompt}"`;
  // Signed in or not, asked in the background: a few CLIs, under a second.
  connectionsChecked = checkConnections(detected, CUSTOM ? { ...PROVIDERS, custom: CUSTOM } : PROVIDERS).then((c) => {
    connected = c;
    // An agent nobody named, that is not signed in, would fail every task:
    // start on the first one that is, when there is one.
    if (AGENT && !CUSTOM && !named && c[AGENT.id] === false) {
      const signedIn = PROVIDER_ORDER.find((id) => detected[id]?.installed && c[id]);
      if (signedIn) {
        useAgent(signedIn);
        AGENT_MODEL = null;
      }
    }
    emit("agent.updated", {});
  });
}


/**
 * What the agent changed, as git sees it.
 *
 * Agent edits land in YOUR working tree, looking exactly like your own
 * work — which is how they get swept into an unrelated commit by a
 * `git add -A`. Naming them after every run is the cheap half of the fix:
 * they appear in this log and in the reply inside the app, so they are
 * never a surprise found later in `git status`. (The other half is the
 * pre-commit hook in .githooks, which refuses the mixed commit outright.)
 *
 * Returns null when git is unavailable or this is not a repository, in
 * which case the bridge simply says nothing about files.
 */
function changedFiles() {
  const probe = spawnSync("git", ["status", "--porcelain", "--", AGENT_DIR],
    { cwd: AGENT_DIR, encoding: "utf8", timeout: 10_000 });
  if (probe.error || probe.status !== 0) return null;
  return probe.stdout.split("\n").map((l) => l.slice(3).trim()).filter(Boolean);
}

/**
 * The changed files with a fingerprint of each one's contents, so a run can
 * tell what IT edited: a file already modified before the run (by the run
 * before it — a follow-up is exactly this case) counts when its contents
 * change, not only when it newly appears in `git status`.
 */
function changedSnapshot() {
  const root = repoRoot();
  const snap = new Map();
  for (const f of changedFiles() ?? []) {
    let print = "gone";
    try {
      print = createHash("sha1").update(readFileSync(join(root ?? AGENT_DIR, f))).digest("hex");
    } catch {}
    snap.set(f, print);
  }
  return snap;
}

/**
 * What changed between two snapshots: new to the list, different inside,
 * or gone from it — a file put back to how it was committed is an edit too.
 */
function editedSince(before, after) {
  const changed = [...after.keys()].filter((f) => before.get(f) !== after.get(f));
  const restored = [...before.keys()].filter((f) => !after.has(f));
  return [...changed, ...restored];
}

/**
 * The commands that put the agent's edits back, runnable from anywhere.
 * `git status --porcelain` names paths from the repository root, and the
 * server may have been started in a subdirectory (every example is one), so
 * the commands say `-C <root>`. A file the agent created has nothing to be
 * restored to, so those are listed for removal instead.
 */
function undoLines(files) {
  const root = repoRoot();
  if (!root) return [];
  const tracked = new Set((git(["ls-files", "--", ...files], root) ?? "").split("\n").filter(Boolean));
  const restore = files.filter((f) => tracked.has(f));
  const created = files.filter((f) => !tracked.has(f));
  return [
    ...(restore.length ? [`git -C ${root} restore -- ${restore.join(" ")}`] : []),
    ...(created.length ? [`(cd ${root} && rm -- ${created.join(" ")})   # new files`] : []),
  ];
}

/** Run a git command somewhere, and hand back trimmed stdout (or null). */
function git(args, cwd) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 120_000 });
  if (r.error || r.status !== 0) return null;
  return (r.stdout ?? "").trim();
}

/**
 * The repository AGENT_DIR lives in — worktrees are added from there.
 *
 * Resolved on first use rather than at module scope: these helpers are
 * declared above the AGENT_DIR they read, and a `const` evaluated up here
 * crashes the server on startup with a temporal dead zone error.
 */
let repoRootCache;
function repoRoot() {
  if (repoRootCache === undefined) repoRootCache = git(["rev-parse", "--show-toplevel"], AGENT_DIR);
  return repoRootCache;
}

/**
 * A private checkout for one task.
 *
 * OUTSIDE THE REPOSITORY, in the OS temp directory: Metro watches the repo
 * root, and a worktree inside it would be crawled, bundled, and rebuilt on
 * every agent keystroke. The path AGENT_DIR has relative to the repo is
 * preserved inside the worktree, so the agent lands in the same project it
 * would have edited in place.
 */
function makeWorktree(id) {
  const root = repoRoot();
  if (!root) return null;
  const branch = `annokit/${id.slice(0, 12)}`;
  // The branch this task forks FROM. A pull request must target it, not the
  // repository's default branch: the worktree is cut from HEAD, so basing
  // the PR on `main` shows every commit between main and here — the whole
  // feature branch — with the one-line change buried in it. Observed: a
  // task that edited one file opened a PR touching dozens.
  const base = git(["rev-parse", "--abbrev-ref", "HEAD"], root) ?? "main";
  const dir = join(tmpdir(), `annokit-wt-${id.slice(0, 12)}-${Date.now().toString(36)}`);
  // -B so a re-run of the same task reuses its branch instead of failing.
  if (git(["worktree", "add", "--quiet", "-B", branch, dir, "HEAD"], root) === null) return null;
  const rel = relative(root, AGENT_DIR);
  return { branch, base, dir, workDir: rel ? join(dir, rel) : dir };
}

/**
 * Commit whatever the agent did, and say what that was.
 *
 * Returns null when it changed nothing — which is a real outcome worth
 * reporting as itself rather than as an empty commit.
 */
function commitWorktree(wt, annotation) {
  if (git(["add", "-A"], wt.dir) === null) return null;
  const staged = git(["diff", "--cached", "--name-only"], wt.dir);
  if (!staged) return null;
  const subject = (annotation.comment ?? "annotation").split("\n")[0].slice(0, 68);
  git(["-c", "user.name=annokit-agent", "-c", "user.email=agent@example.invalid",
       "commit", "--quiet", "-m", `${subject}\n\nFrom an in-app annotation (${annotation.id}).`], wt.dir);
  return {
    files: staged.split("\n").filter(Boolean),
    sha: git(["rev-parse", "--short", "HEAD"], wt.dir) ?? "",
    // Kept so the phone has something to OPEN. Without a pull request the
    // branch is a name the device cannot reach, and a task that says "I
    // changed three files" without showing which lines is a worse report
    // than the in-place mode it replaced.
    patch: git(["show", "--no-color", "HEAD"], wt.dir) ?? "",
  };
}

/** Push the branch and open a PR. Best effort — never fails the task. */
function openPullRequest(wt, annotation) {
  if (git(["push", "--quiet", "-u", "origin", wt.branch], wt.dir) === null) return null;
  const title = (annotation.comment ?? "Annotation").split("\n")[0].slice(0, 68);
  const r = spawnSync("gh", ["pr", "create", "--base", wt.base, "--head", wt.branch, "--title", title,
      "--body", `From an in-app annotation on \`${annotation.element ?? "an element"}\`.\n\n> ${annotation.comment ?? ""}`],
    { cwd: wt.dir, encoding: "utf8", timeout: 120_000 });
  if (r.error || r.status !== 0) return null;
  return (/https:\/\/\S+/.exec(r.stdout ?? "") ?? [])[0] ?? null;
}


/**
 * THE DIRECTORY YOU STARTED IT IN IS THE DEFAULT ON PURPOSE — your app's
 * root, when run as `npx annokit server` (the examples' `npm run server`
 * does the same from theirs). It is the directory Metro is watching, and
 * that is the entire effect: the agent writes the file, Fast Refresh
 * rebuilds the one changed module, and the change appears on the device
 * that asked for it without a restart. An agent editing a copy somewhere else would make the same edit
 * and show you nothing.
 *
 * AGENT_DIR exists for the case where you would rather keep agent edits out
 * of your working tree; it costs you the hot reload.
 */
const AGENT_DIR = resolve(process.env.AGENT_DIR || process.cwd());

/**
 * THE APP'S ASSETS (docs/assets.md): the files in its assets/ folder, listed
 * for + Attach → Assets. Add one by putting it in the folder, or by pasting
 * an image into the app's composer, which uploads it to assets/uploads/.
 * Each is a file in the agent's checkout, so it reaches the agent as a path
 * it can open and require(). Uploads and deletes touch assets/uploads/ only.
 */
const ASSETS = createLocalStore({
  dir: process.env.ASSETS_DIR ? resolve(process.env.ASSETS_DIR) : join(AGENT_DIR, "assets"),
  appDir: AGENT_DIR,
  writable: true,
});
/** Unset means "whatever that CLI is already configured to use". */
const AGENT_TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS) || 180_000;

/**
 * WORKTREE MODE — `--worktree`, optionally `--jobs N`.
 *
 * Without it every run edits AGENT_DIR directly, which is what makes the
 * hot-reload demo work and what forces runs to be serial: two agents in one
 * tree overwrite each other. With it, each task gets its own `git worktree`
 * and its own branch, so runs cannot collide and several may go at once.
 *
 * THE TRADE IS THE LIVE RELOAD. A worktree is checked out in the OS temp
 * directory — deliberately outside the repository, since Metro watches the
 * repo root and would otherwise bundle and rebuild every copy. The agent is
 * therefore not editing the tree Metro is serving, so nothing appears on
 * the device; the result arrives as a branch and a thread reply instead.
 * That is the right shape for real work and the wrong one for a demo, which
 * is why this is a mode rather than the default.
 */
const WORKTREE_FLAG = process.argv.find((a) => a === "--worktree" || a.startsWith("--worktree="));
const WORKTREE = Boolean(WORKTREE_FLAG) || process.env.WORKTREE === "1";
const JOBS_FLAG = process.argv.indexOf("--jobs");
const MAX_JOBS = WORKTREE
  ? Math.max(1, Number(JOBS_FLAG > -1 ? process.argv[JOBS_FLAG + 1] : process.env.JOBS) || 2)
  : 1;
/** Open a PR per task. Off by default: it pushes, which is not a demo's business. */
const OPEN_PR = process.argv.includes("--pr") || process.env.PR === "1";
/**
 * What the PHONE should call this server. `localhost` is the device itself
 * on a simulator and wrong on hardware, so a diff link built from it would
 * be unopenable exactly where opening it matters most.
 */
const AGENT_ORIGIN = process.env.PUBLIC_ORIGIN || `http://localhost:${PORT}`;

/** Everything the server knows. Restarting is the reset button. */
const db = {
  sessions: new Map(),      // id -> { id, url, title, createdAt }
  annotations: new Map(),   // id -> ServerAnnotation (agent tasks)
  comments: new Map(),      // id -> ServerComment (team notes)
  screenshots: new Map(),   // id -> { contentType, bytes }
  patches: new Map(),       // annotation id -> unified diff, served as text
};

/**
 * Open SSE responses, by session. The overlay reconnects on its own, so
 * losing one is fine.
 */
const listeners = new Map();   // session id -> Set<response>

/**
 * Tell every connected overlay that something changed.
 *
 * The protocol's events carry no state — they are a nudge to re-read. That
 * is why this sends an (almost) empty payload: a client that trusted event
 * bodies would drift the moment one was missed.
 */
function emit(type, payload = {}, sessionId = null) {
  const frame = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  // An annotation belongs to one session, so only that session hears about
  // it. Team notes belong to the app, not a session, so every stream does.
  const targets = sessionId === null ? [...listeners.values()] : [listeners.get(sessionId) ?? new Set()];
  for (const set of targets) {
    for (const res of set) {
      try { res.write(frame); } catch { set.delete(res); }
    }
  }
}

/** emit() for an annotation: scoped to the session it was captured in. */
function emitAnnotation(type, a) {
  emit(type, { id: a.id }, a.sessionId ?? null);
}

/**
 * Turn an annotation into a prompt.
 *
 * THE TEXT IS THE SEARCH KEY, and this is where that pays off. `source`
 * names where the component is DEFINED — `PrimaryButton.tsx` holds
 * `{label}` — while the words the user actually tapped live at the CALL
 * SITE, in a file the annotation never names. Handing the agent
 * `nearbyText` lets it grep its way to the one line to edit. Before this
 * field rode at the default detail level, the agent had the component and
 * no way to tell which use of it was meant.
 */
/**
 * Every reference, as a line the agent can act on (docs/assets.md). A
 * reference the agent never sees does nothing: before this the prompt
 * left them out, so a picked asset reached nobody. Screenshots are the
 * server's own and go elsewhere; a type this stub does not know is still
 * passed on, by its label and value.
 */
function attachedLines(references) {
  const one = (s) => String(s ?? "").replace(/\s+/g, " ").slice(0, 300);
  const out = [];
  for (const r of Array.isArray(references) ? references.slice(0, 20) : []) {
    if (!r || typeof r.value !== "string" || r.type === "screenshot") continue;
    const label = r.label ? `${one(r.label)}: ` : "";
    if (r.type === "asset") {
      out.push(`  asset ${label}use ${JSON.stringify(one(r.value))} in code` +
        (r.open ? `; open ${one(r.open)} to see it` : ""));
    } else if (r.type === "url") out.push(`  link ${label}${one(r.value)}`);
    else if (r.type === "api") out.push(`  data API ${label}${one(r.value)}`);
    else out.push(`  ${one(r.type)} ${label}${one(r.value)}`);
  }
  return out;
}

function agentPrompt(a) {
  const lines = [
    "A developer annotated a running React Native screen. Make the change they asked for.",
    "",
    `THEY WROTE: ${a.comment ?? "(no text)"}`,
    "",
    "WHAT THEY TOUCHED:",
    `  component: ${a.element ?? "unknown"}`,
  ];
  if (a.source?.file) lines.push(`  defined at: ${a.source.file}:${a.source.line ?? "?"}`);
  if (a.nearbyText) {
    lines.push(`  text on it: ${JSON.stringify(a.nearbyText)}`);
    lines.push(`              (grep for this to find where the component is USED —`);
    lines.push(`               the definition file may only hold a prop)`);
  }
  if (a.testID) lines.push(`  testID: ${a.testID}`);
  if (a.routeName) lines.push(`  screen: ${a.routeName}`);
  const attached = attachedLines(a.references);
  if (attached.length) lines.push("", "ATTACHED (what they picked to go with the request):", ...attached);
  // Where the app's assets live, whether or not one was attached: "use our
  // logo" names no file, and the agent should not have to search for it.
  const assetsAt = relative(AGENT_DIR, ASSETS.dir).split(sep).join("/");
  if (existsSync(ASSETS.dir) && assetsAt && !assetsAt.startsWith("..")) {
    lines.push("", `The app's own assets (images, fonts, media) are in ${assetsAt}/; use them by path.`);
  }
  // A REOPENED task's instruction is its thread, not its comment: the
  // comment is what was asked first, and the agent may already have done it
  // (docs/protocol.md, "Reopening a task").
  const said = (a.thread ?? []).filter((m) => m.id !== a.placeholderId && m.content);
  if (said.some((m) => m.role === "user")) {
    lines.push(
      "",
      "SINCE THEN (the latest user message is what to do now; the first request",
      "may already be done):",
      ...said.map((m) => `  ${m.role === "agent" ? "you" : "they"}: ${m.content}`),
    );
  }
  lines.push(
    "",
    ...FINISH,
  );
  return lines.join("\n");
}

/** How every run's prompt ends: keep it small, say what changed, name it. */
const FINISH = [
  "Edit the source to satisfy the request. Keep it minimal — change what was",
  "asked and nothing else. Metro is watching, so the app reloads by itself.",
  "Finish with one short sentence saying what you changed, then a last line",
  "`Title: <3 to 6 words naming the change>` (e.g. `Title: Darker primary button`).",
];

/**
 * A RESUMED run's prompt: only what is new. The session already holds the
 * request, the files it read and what it did; what it lacks is what the
 * person said since — the user messages after its last reply.
 */
function followUpPrompt(a) {
  const thread = (a.thread ?? []).filter((m) => m.id !== a.placeholderId && m.content);
  const lastAgent = thread.map((m) => m.role).lastIndexOf("agent");
  const said = thread.slice(lastAgent + 1).filter((m) => m.role === "user").map((m) => m.content);
  return [
    said.length ? "They replied about the change you just made:" : "They sent this task to you again.",
    ...said.map((c) => `  ${c}`),
    "",
    ...FINISH,
  ].join("\n");
}

/**
 * Continue the agent's own session, or start one that can be continued
 * (agents.mjs, SESSIONS). Only in place: a worktree is removed after its
 * run, and a session belongs to the directory it ran in. Only on the same
 * agent and model — a switch is a fresh start by definition.
 */
function sessionFor(annotation, agent, model, inWorktree) {
  if (inWorktree || !agent.resumable) return null;
  const prev = annotation.agentSession;
  if (prev?.id && prev.agent === agent.id && (prev.model ?? null) === (model ?? null)) return { mode: "resume", id: prev.id };
  return { mode: "start", id: agent.resumable === "own-id" ? randomUUID() : null };
}

/**
 * Append a message to an annotation's thread and tell the app to re-read.
 * Returns the message id. The shape is the protocol's — `content` and
 * `timestamp` — because the overlay drops a message without a string
 * `content`.
 */
function addThreadMessage(id, role, text) {
  const a = db.annotations.get(id);
  if (!a) return null;
  const message = { id: randomUUID(), role, content: clampText(text), timestamp: now() };
  a.thread = [...(a.thread ?? []), message];
  emitAnnotation("annotation.updated", a);
  return message.id;
}

/**
 * Run the agent for one annotation, then post what it said back into the
 * thread — so the answer arrives in the detail pane the request came from,
 * rather than in a terminal the phone cannot see.
 */
/**
 * ONE AT A TIME.
 *
 * Every agent here edits the same working tree, and two let loose on it do
 * not take turns: both open the file, the second write wins, and one of the
 * two requests disappears with nothing on screen to say it did. Sending
 * three tasks from the queue is exactly that case, so runs are queued and
 * started one after another.
 *
 * The overlay closes its Send button while a task is `working`, but this is
 * not a duplicate of that check: the button is one client's courtesy, and
 * the server is what actually has to hold the line.
 */
const agentQueue = [];
let agentsInFlight = 0;

function enqueueAgent(id) {
  // ALREADY IN FLIGHT OR ALREADY WAITING — do nothing. Pressing send twice,
  // a retry, or two clients acting at once would otherwise run the same
  // task a second time and apply the same edit twice. The overlay disables
  // its button while a task is `working`, but that is one client's
  // courtesy and cannot be the thing standing between an agent and a
  // duplicated change.
  if (agentQueue.includes(id)) return;
  if (db.annotations.get(id)?.status === "working") return;
  agentQueue.push(id);
  startNextAgent();
}

function startNextAgent() {
  // MAX_JOBS is 1 unless --worktree gave each run its own checkout. Without
  // that isolation a second agent is not concurrency, it is two processes
  // overwriting one working tree.
  while (agentsInFlight < MAX_JOBS && agentQueue.length > 0) {
    const id = agentQueue.shift();
    agentsInFlight += 1;
    runAgent(id, () => { agentsInFlight -= 1; startNextAgent(); }, AGENT_ORIGIN);
  }
}

/**
 * The agent's `Title: …` line, which the prompt asks it to end with: taken
 * out of the reply (the thread shows the reply without it) and kept as the
 * run's title, which names the task in the app's Done list. An agent that
 * leaves it out loses nothing — the list falls back to the request.
 */
function takeTitle(text) {
  const lines = text.split("\n");
  let i = lines.length - 1;
  while (i >= 0 && !lines[i].trim()) i--;
  const m = i >= 0 ? /^\W*title\W*:\s*(.+?)\W*$/i.exec(lines[i].trim()) : null;
  if (!m) return { reply: text, title: undefined };
  return { reply: lines.slice(0, i).join("\n").trim(), title: m[1].replace(/[`*_]/g, "").trim().slice(0, 60) || undefined };
}

function runAgent(id, done, origin = `http://localhost:${PORT}`) {
  const annotation = db.annotations.get(id);
  // This run's agent, model and effort, taken now: the task's own choice,
  // or the server's current agent — switching that in /agent while it
  // works changes the NEXT task, not this one half-way through.
  const { agent, model, effort } = runFor(annotation ?? {});
  if (!annotation || !agent) return done?.();

  const wt = WORKTREE ? makeWorktree(id) : null;
  if (WORKTREE && !wt) {
    addThreadMessage(id, "agent", "Could not create a git worktree for this task.");
    annotation.status = "pending";
    return done?.();
  }
  const workDir = wt ? wt.workDir : AGENT_DIR;
  const session = sessionFor(annotation, agent, model, Boolean(wt));
  const resumed = session?.mode === "resume";
  const prompt = resumed ? followUpPrompt(annotation) : agentPrompt(annotation);
  const args = agent.args(prompt, workDir, model, agent.extra, effort, session);
  // Only meaningful in place: in a worktree the edits are committed to a
  // branch and reported from there, and nothing lands in your working tree.
  const before = wt ? null : changedSnapshot();
  const on = [model, effort && `${effort} effort`].filter(Boolean).join(", ");
  console.log(`    → ${agent.label}${on ? ` (${on})` : ""} ${resumed ? "continuing its session on" : "working on"} ${id.slice(0, 8)} in ${wt ? wt.branch : AGENT_DIR}`);
  // The protocol status the overlay's banner reads. Optional and additive:
  // a server that does not run agents never sets it and no banner appears.
  annotation.status = "working";
  annotation.refinedDuringRun = false;
  annotation.placeholderId = addThreadMessage(id, "agent", `${agent.label} is working on it…`);
  // RUN HISTORY (docs/protocol.md, "Run history"): one entry per run,
  // appended now and finished below — never rewritten after, so a re-run
  // adds to the record instead of replacing it.
  const run = {
    id: randomUUID().slice(0, 8),
    agent: { id: agent.id, label: agent.label },
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    startedAt: new Date().toISOString(),
    outcome: "running",
    ...(resumed ? { resumed: true } : {}),
  };
  annotation.runs = [...(annotation.runs ?? []), run];

  const child = execFile(agent.bin, args, { cwd: workDir, timeout: AGENT_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
    (err, stdout, stderr) => {
      // A session that could not be continued (cleared, expired, made on
      // another machine): say so in the record and start again from the
      // thread, rather than failing the follow-up.
      if (err && resumed && !err.killed) {
        console.log(`    ↺ ${agent.label} could not continue its session on ${id.slice(0, 8)}; starting fresh`);
        delete annotation.agentSession;
        Object.assign(run, {
          finishedAt: new Date().toISOString(),
          outcome: "failed",
          error: "Could not continue the earlier session, so it started again from the thread.",
        });
        annotation.thread = (annotation.thread ?? []).filter((m) => m.id !== annotation.placeholderId);
        delete annotation.placeholderId;
        return runAgent(id, done, origin);
      }
      // Keep the session for the next follow-up on this task.
      const sessionId = !err && session ? session.id ?? agent.sessionFrom?.(String(stderr)) : null;
      if (sessionId) annotation.agentSession = { agent: agent.id, model: model ?? null, id: sessionId };
      let reply;
      // For the run's record: what it changed, and its own one-line account.
      let files = [];
      let summary, title;
      if (err) {
        // Say what went wrong in the app. A silent failure here looks
        // exactly like an agent that decided to do nothing.
        reply = err.killed
          ? `Timed out after ${AGENT_TIMEOUT_MS / 1000}s.`
          : `${agent.label} could not run: ${String(stderr || err.message).trim().split("\n")[0]}`;
        console.log(`    ✗ ${agent.label} failed on ${id.slice(0, 8)}: ${reply}`);
      } else {
        ({ reply, title } = takeTitle(agent.read(stdout).trim()));
        reply ||= "Done.";
        summary = reply.split("\n").find((l) => l.trim())?.trim().slice(0, 200);
        console.log(`    ✓ ${agent.label} finished ${id.slice(0, 8)}`);
        if (wt) {
          // The work is on a branch, not in front of you — so the reply has
          // to carry everything you would otherwise see by looking.
          const committed = commitWorktree(wt, annotation);
          if (!committed) {
            reply += `\n\nNo files changed.`;
            console.log(`      no changes on ${wt.branch}`);
          } else {
            // The command to SEE it, not just the branch name. A worktree
            // run shows nothing on the device by design, so the reply is
            // the only place that can close that gap — and checking the
            // branch out in the tree Metro already watches is the whole
            // answer (examples/README.md, "Seeing a worktree's change").
            files = committed.files;
            reply += `\n\nCommitted ${committed.sha} to \`${wt.branch}\`: ${committed.files.join(", ")}`
              + `\n\nTo see it running: git checkout ${wt.branch}`;
            // The branch as DATA, not only as a sentence. Prose in a thread
            // cannot be queried, chipped in a UI, or followed by anything
            // but a human reading English — and "which branch came out of
            // this task" is a fact about the task. AnnotationReference
            // takes custom types (`string & {}`), so this needs no protocol
            // change; a client that does not know "branch" renders it with
            // the same one-line fallback it gives any other reference.
            annotation.references = [...(annotation.references ?? []),
              { type: "branch", value: wt.branch, label: `${wt.branch} (${committed.sha})` }];
            if (committed.patch) {
              db.patches.set(id, committed.patch);
              annotation.references = [...annotation.references,
                { type: "url", value: `${origin}/annotations/${encodeURIComponent(id)}/diff`,
                  label: `Diff — ${committed.files.length} file${committed.files.length === 1 ? "" : "s"}` }];
            }
            console.log(`      committed ${committed.sha} to ${wt.branch}: ${committed.files.join(", ")}`);
            if (OPEN_PR) {
              const url = openPullRequest(wt, annotation);
              if (url) {
                reply += `\n\n${url}`;
                // A `url` reference is where the protocol puts a link, so the
                // task carries the PR rather than only mentioning it.
                annotation.references = [...(annotation.references ?? []),
                  { type: "url", value: url, label: "Pull request" }];
                console.log(`      opened ${url}`);
              } else {
                reply += `\n\nCould not open a pull request — the branch is pushed or local.`;
              }
            }
          }
        } else {
          const touched = editedSince(before, changedSnapshot());
          files = touched;
          if (touched.length) {
            console.log(`      edited: ${touched.join(", ")}`);
            for (const line of undoLines(touched)) console.log(`      undo:   ${line}`);
            // Say it in the app too: the person watching the phone is the one
            // who will later wonder why their working tree is dirty.
            reply += `\n\nEdited ${touched.join(", ")} — these are in your working tree.`;
          }
        }
      }
      const a = db.annotations.get(id);
      // Out of "working" whichever way it went — a banner that outlives the
      // agent is worse than no banner, because it claims work is happening.
      // A reply that arrived DURING the run was not part of its prompt, so
      // the task goes back to the queue rather than reading as finished.
      if (a) {
        a.status = err || a.refinedDuringRun ? "pending" : "sent";
        if (!err && a.refinedDuringRun) reopen(a);
        // Replace the placeholder rather than stacking a second bubble —
        // by id, because a user may have replied after it.
        a.thread = (a.thread ?? []).filter((m) => m.id !== a.placeholderId);
        delete a.placeholderId;
        delete a.refinedDuringRun;
        delete a.progress;
      }
      Object.assign(run, {
        finishedAt: new Date().toISOString(),
        outcome: err ? "failed" : "done",
        ...(files.length ? { files: files.map((path) => ({ path })) } : {}),
        ...(err ? { error: reply.slice(0, 300) } : summary ? { summary } : {}),
        ...(title ? { title } : {}),
      });
      addThreadMessage(id, "agent", reply);
      // The checkout is disposable; the BRANCH is the artifact and stays.
      if (wt) git(["worktree", "remove", "--force", wt.dir], repoRoot());
      // Whatever happened, the next one may start — a failed run must not
      // wedge the queue behind it.
      done?.();
    });

  // PROGRESS, as it happens. execFile still buffers the whole output for the
  // callback above; these listeners only read it line by line on the way
  // past, and turn the agent's steps into the protocol's `progress` line.
  if (agent.progress) {
    const stream = agent.progressFrom === "stderr" ? child.stderr : child.stdout;
    let rest = "";
    stream?.on("data", (chunk) => {
      const parts = (rest + chunk).split("\n");
      rest = parts.pop() ?? "";
      for (const line of parts) {
        // A line may describe several steps; the latest is the one to show.
        const step = [].concat(agent.progress(line) ?? []).at(-1);
        const a = db.annotations.get(id);
        if (!step || !a || a.status !== "working") continue;
        const shown = String(step).slice(0, 120);
        a.progress = shown.charAt(0).toUpperCase() + shown.slice(1);
        emitAnnotation("annotation.updated", a);
      }
    });
  }

  // CLOSE STDIN OR CODEX WAITS FOREVER. `codex exec` appends piped stdin to
  // the prompt, so an open-but-silent pipe — which is exactly what execFile
  // hands a child — leaves it printing "Reading additional input from
  // stdin..." until the timeout, then exiting 0 with an empty answer. That
  // reads as a task the agent considered and declined; it never saw it.
  child.stdin?.end();
}

const now = () => new Date().toISOString();
const json = (res, status, body) => {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(text),
  });
  res.end(text);
};

/**
 * LIMITS. The client clamps its own input, but a limit only the client
 * applies is bypassed by curl (docs/protocol.md, "Server obligations").
 * TEXT_MAX and REFERENCES_MAX match src/limits.ts.
 */
const JSON_BODY_MAX = 1024 * 1024;
const UPLOAD_MAX = 16 * 1024 * 1024;
const TEXT_MAX = 4000;
const REFERENCES_MAX = 20;
const AUTHOR_NAME_MAX = 40;

/** Thrown by the helpers below and turned into a JSON error by the handler. */
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function readBody(req, limit = JSON_BODY_MAX) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    // Past the limit nothing more is KEPT — a stub with no limit can be
    // made to eat the machine — but the rest is still READ, up to a point,
    // so the 413 goes out on a connection the client can read it from and
    // use again. Answering mid-upload and closing broke the client's write
    // (EPIPE) before it saw the answer; answering and leaving the rest on
    // the socket reset its next request.
    if (bytes > limit * 4) throw new HttpError(413, "body too large");
    if (bytes <= limit) chunks.push(chunk);
  }
  if (bytes > limit) throw new HttpError(413, "body too large");
  return Buffer.concat(chunks);
}

/**
 * A JSON request body. An empty body is `{}`; a malformed one is a 400 on
 * EVERY route, never read as empty — on `/annotations/send` an empty body
 * means "send all pending", so a garbled request must not start them all.
 */
async function readJson(req) {
  const text = (await readBody(req)).toString("utf8");
  if (!text.trim()) return {};
  let body;
  try { body = JSON.parse(text); } catch { throw new HttpError(400, "invalid JSON"); }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HttpError(400, "expected a JSON object");
  }
  return body;
}

const clampText = (value, max = TEXT_MAX) => Array.from(String(value ?? "")).slice(0, max).join("");

/**
 * Who wrote a note or a reply. A real server takes this from the
 * authenticated user and IGNORES `authorName`; this stub has no auth, which
 * is exactly the case the advisory hint exists for (docs/protocol.md, "Who
 * you are"). The id is derived from the name, so the same name is the same
 * person and the overlay can put your own messages on your side.
 */
function authorFrom(authorName) {
  const name = typeof authorName === "string" ? clampText(authorName.trim(), AUTHOR_NAME_MAX) : "";
  return name ? { id: `name:${name.toLowerCase()}`, name } : { id: "anonymous" };
}

/** The reopen stamps a user reply puts on a task (docs/protocol.md). */
function reopen(a) {
  a.status = "pending";
  a.reopenedAt = now();
  a.reopenCount = (a.reopenCount ?? 0) + 1;
}

/**
 * Fields only the server writes. A client that sends them is ignored for
 * them: a task created with `run` or `progress` would have shown a fake
 * agent run, and `reopenedAt` a reopen that never happened.
 */
const SERVER_OWNED = [
  "sessionId", "createdAt", "updatedAt", "sentAt", "run", "progress", "reopenedAt", "reopenCount",
  "placeholderId", "refinedDuringRun", "resolvedAt", "runs", "agentSession",
];

/** One reference as the protocol has it — strings only, bounded — or null. */
function cleanReference(r) {
  if (!r || typeof r !== "object" || typeof r.type !== "string" || typeof r.value !== "string") return null;
  return {
    type: clampText(r.type, 40),
    value: clampText(r.value, 2000),
    ...(typeof r.label === "string" ? { label: clampText(r.label, 200) } : {}),
    ...(typeof r.open === "string" ? { open: clampText(r.open, 2000) } : {}),
    ...(typeof r.preview === "string" ? { preview: clampText(r.preview, 2000) } : {}),
  };
}

/** The captured fields of a new annotation or note, bounded. */
function boundCapture(body) {
  const capture = { ...body };
  for (const key of SERVER_OWNED) delete capture[key];
  for (const key of ["comment", "content", "nearbyText", "selectedText"]) {
    if (typeof capture[key] === "string") capture[key] = clampText(capture[key]);
  }
  if (capture.references !== undefined) {
    // A client never sends a screenshot reference: the server adds that
    // when the upload lands (docs/protocol.md), so one sent is a pointer
    // this server did not make.
    capture.references = (Array.isArray(capture.references) ? capture.references : [])
      .map(cleanReference).filter((r) => r && r.type !== "screenshot").slice(0, REFERENCES_MAX);
  }
  if (capture.agent !== undefined) capture.agent = cleanTaskAgent(capture.agent);
  if (capture.agent === null) delete capture.agent;
  return capture;
}

/** An effort level as the CLIs spell them: "low", "xhigh". */
const EFFORT = /^[a-z]{1,12}$/;

/**
 * The agent a task asked for (docs/protocol.md, "Agent"), or null. Only
 * the shape is checked here; whether that agent is installed is decided
 * when the task runs, since it can be installed in between.
 */
function cleanTaskAgent(a) {
  if (!a || typeof a !== "object" || typeof a.id !== "string" || !/^[a-z][\w-]{0,39}$/.test(a.id)) return null;
  return {
    id: a.id,
    ...(typeof a.model === "string" && MODEL_ID.test(a.model) ? { model: a.model } : {}),
    ...(typeof a.effort === "string" && EFFORT.test(a.effort) ? { effort: a.effort } : {}),
  };
}

/**
 * The agent, model and effort a run uses: the task's own choice when that
 * agent is installed here, else the server's current one on its model.
 * An effort only reaches an agent that takes one.
 */
function runFor(annotation) {
  const asked = annotation.agent;
  if (asked && asked.id !== AGENT?.id) {
    const provider = asked.id === "custom" ? CUSTOM : PROVIDERS[asked.id];
    const found = detected[asked.id];
    if (provider && found?.installed) {
      const agent = { id: asked.id, ...provider, bin: found.bin, extra: found.extra ?? {} };
      return { agent, model: asked.model ?? null, effort: provider.efforts ? asked.effort ?? null : null };
    }
  }
  if (!AGENT) return { agent: null, model: null, effort: null };
  const own = asked?.id === AGENT.id;
  return {
    agent: AGENT,
    model: own ? asked.model ?? null : AGENT_MODEL,
    effort: own && AGENT.efforts ? asked.effort ?? null : null,
  };
}

/**
 * SCREENSHOTS ARE CAPPED IN MEMORY. Each one is kept until the stub
 * restarts, and a long session of tasks with screenshots only grows; past
 * SCREENSHOTS_MAX bytes the oldest go first, and a task or note takes its
 * own with it when deleted. An evicted one answers 404, which the overlay
 * shows as "could not be loaded" rather than a broken image.
 */
const SCREENSHOTS_MAX = (Number(process.env.SCREENSHOTS_MB) || 256) * 1024 * 1024;
let screenshotBytes = 0;

function keepScreenshot(id, shot) {
  db.screenshots.set(id, shot);
  screenshotBytes += shot.bytes.length;
  for (const [old, held] of db.screenshots) {
    if (screenshotBytes <= SCREENSHOTS_MAX || old === id) break;
    db.screenshots.delete(old);
    screenshotBytes -= held.bytes.length;
  }
}

/** Drop the screenshots a task's or note's references point at. */
function dropScreenshots(references) {
  for (const r of references ?? []) {
    if (r?.type !== "screenshot") continue;
    const id = String(r.value ?? r.url ?? "").split("/").pop();
    const held = db.screenshots.get(id);
    if (!held) continue;
    db.screenshots.delete(id);
    screenshotBytes -= held.bytes.length;
  }
}

/** The first file part of a multipart body with its file name, or null. */
function namedFilePart(buf, contentType) {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  if (!boundary) return null;
  const marker = Buffer.from(`--${boundary[1] || boundary[2]}`);
  const headerEnd = Buffer.from("\r\n\r\n");
  let from = buf.indexOf(marker);
  while (from !== -1) {
    const headStop = buf.indexOf(headerEnd, from + marker.length);
    if (headStop === -1) break;
    const headers = buf.subarray(from + marker.length, headStop).toString("utf8");
    const next = buf.indexOf(marker, headStop);
    const name = /filename="([^"]*)"/i.exec(headers);
    if (name) {
      return { filename: name[1], bytes: buf.subarray(headStop + headerEnd.length, next === -1 ? buf.length : next - 2) };
    }
    from = next;
  }
  return null;
}

/**
 * Pull the first file out of a multipart body.
 *
 * Deliberately crude — enough for one screenshot part, which is all the
 * protocol's upload routes ever send. A real server uses a parser.
 */
function firstFilePart(buf, contentType) {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  if (!boundary) return null;
  const marker = Buffer.from(`--${boundary[1] || boundary[2]}`);
  const headerEnd = Buffer.from("\r\n\r\n");
  let from = buf.indexOf(marker);
  while (from !== -1) {
    const headStart = from + marker.length;
    const headStop = buf.indexOf(headerEnd, headStart);
    if (headStop === -1) break;
    const headers = buf.subarray(headStart, headStop).toString("utf8");
    const next = buf.indexOf(marker, headStop);
    if (/filename=/i.test(headers)) {
      return buf.subarray(headStop + headerEnd.length, next === -1 ? buf.length : next - 2);
    }
    from = next;
  }
  return null;
}

/**
 * The image type of an upload, from its first bytes. The part's own
 * Content-Type is chosen by the caller and is evidence of nothing, so it is
 * never stored or echoed back.
 */
function sniffImage(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

/**
 * Store an upload and hand back the reference the protocol expects:
 * `{type, value, label}`, where `value` is a URL the overlay can show.
 */
async function storeScreenshot(req, origin) {
  const bytes = firstFilePart(await readBody(req, UPLOAD_MAX), req.headers["content-type"]);
  if (!bytes) throw new HttpError(400, "no file part");
  const contentType = sniffImage(bytes);
  if (!contentType) throw new HttpError(415, "not a PNG or JPEG");
  const id = randomUUID();
  keepScreenshot(id, { contentType, bytes });
  return { type: "screenshot", value: `${origin}/screenshots/${id}`, label: "Screenshot" };
}

/** A model id as the CLIs write them: "sonnet", "gpt-5.6-sol", "anthropic/claude-x:1". */
const MODEL_ID = /^[A-Za-z0-9][\w.\/:\[\]-]{0,199}$/;

/** `GET /agent`: the current agent and model, and every agent this server knows. */
function agentState() {
  const ids = [...PROVIDER_ORDER, ...(CUSTOM ? ["custom"] : [])];
  return {
    enabled: AGENT_ENABLED,
    // Each task runs on the agent, model and effort it carries (runFor).
    perTask: true,
    current: AGENT ? { id: AGENT.id, label: AGENT.label, model: AGENT_MODEL, shell: Boolean(AGENT.shell) } : null,
    // The first line only: the rest is install instructions for a terminal.
    error: AGENT_ENABLED && !AGENT ? (AGENT_ERROR ?? "").split("\n")[0] : null,
    working: agentsInFlight,
    queued: agentQueue.length,
    agents: ids.map((id) => {
      const p = id === "custom" ? CUSTOM : PROVIDERS[id];
      const found = detected[id] ?? {};
      return {
        id, label: p.label, installed: Boolean(found.installed),
        ...(found.installed ? { connected: connected[id] !== false } : {}),
        ...(found.version ? { version: found.version } : {}),
        shell: Boolean(p.shell),
      };
    }),
  };
}

// Detected at startup, and again on `GET /agent?refresh=1`, so an agent
// installed while the stub runs can be picked up. Never per task.
detectAgents();

/**
 * ACCESS — who may talk to this server.
 *
 * It runs an agent that edits your checkout, so being reachable is being
 * able to change your code. By default it listens on THIS MACHINE ONLY,
 * which is all a simulator or an Android emulator needs, and asks for
 * nothing more. A physical phone has to reach it over the network:
 * HOST=0.0.0.0 opens it to the network, and then every request needs the
 * token printed at startup (or set with STUB_TOKEN) — home, office or café
 * Wi-Fi alike.
 *
 * Browsers are the other way in. A page you visit can send requests to
 * localhost, so the stub only answers cross-site requests from pages on
 * localhost itself (Expo's web mode) or listed in ALLOW_ORIGIN, and only
 * accepts a Host that is localhost or an IP address — which stops a page
 * pointing its own domain at 127.0.0.1 to look same-site (DNS rebinding).
 * The app itself sends no Origin, so none of that touches it.
 */
const HOST = (process.env.HOST || "127.0.0.1").trim();
const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);
const NETWORK = !LOOPBACK.has(HOST);
const TOKEN = process.env.STUB_TOKEN?.trim() || (NETWORK ? randomBytes(18).toString("base64url") : null);
const ALLOW_ORIGINS = (process.env.ALLOW_ORIGIN ?? "").split(",").map((o) => o.trim()).filter(Boolean);

function hostAllowed(host) {
  if (!host) return true; // HTTP/1.0 and some tools send none; nothing to rebind.
  const name = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase();
  return name === "localhost" || isIP(name) !== 0;
}

function allowedOrigin(origin) {
  if (!origin) return null;
  if (ALLOW_ORIGINS.includes(origin)) return origin;
  try {
    const { protocol, hostname } = new URL(origin);
    return protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(hostname) ? origin : null;
  } catch {
    return null;
  }
}

/**
 * The token, when there is one. Two routes are exempt because the app's
 * Image component cannot send headers: screenshots, served by an
 * unguessable id, and previews of the app's own assets.
 */
function tokenOk(req, seg) {
  if (!TOKEN) return true;
  if (req.method === "GET" && (seg[0] === "screenshots" || (seg[0] === "assets" && seg[1] === "raw"))) return true;
  const sent = Buffer.from(/^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "")?.[1]?.trim() ?? "");
  const want = Buffer.from(TOKEN);
  return sent.length === want.length && timingSafeEqual(sent, want);
}

/** Say once per address that it was turned away, so a wrong .env.local is findable. */
const rejected = new Set();
function warnRejected(req) {
  const who = req.socket.remoteAddress ?? "?";
  if (rejected.has(who)) return;
  rejected.add(who);
  console.log(`  ✗ ${req.method} from ${who} without the right token — check EXPO_PUBLIC_ANNOKIT_TOKEN`);
}

/** This machine's network addresses, for the .env.local line a phone needs. */
function lanAddresses() {
  return Object.values(networkInterfaces()).flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i.address);
}

const server = createServer(async (req, res) => {
  try {
    await handle(req, res);
  } catch (error) {
    // An oversized or malformed request is the caller's error, and must not
    // take the process down with it: an unhandled rejection here exits Node.
    const status = error instanceof HttpError ? error.status : 500;
    if (status === 500) console.error(error);
    // Answered with the body still unread (one far past its limit): the
    // rest is on the socket, so that connection cannot be used again.
    if (!req.complete && !res.headersSent) res.setHeader("Connection", "close");
    if (!res.headersSent) json(res, status, { error: error.message });
    else res.destroy();
  }
});

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host ?? `localhost:${PORT}`}`);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const origin = `http://${req.headers.host ?? `localhost:${PORT}`}`;
  const seg = path.split("/").filter(Boolean);

  // ── Who may talk to this server (see ACCESS above) ───────────────────
  if (!hostAllowed(req.headers.host)) {
    return json(res, 403, { error: "unexpected Host header: use localhost or an IP address" });
  }
  const corsOrigin = allowedOrigin(req.headers.origin);
  if (corsOrigin) {
    res.setHeader("Access-Control-Allow-Origin", corsOrigin);
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") {
    if (!corsOrigin) return json(res, 403, { error: "this origin may not call the stub (ALLOW_ORIGIN adds one)" });
    res.writeHead(204, {
      "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
    });
    return res.end();
  }
  if (!tokenOk(req, seg)) {
    warnRejected(req);
    return json(res, 401, { error: "missing or wrong token: set EXPO_PUBLIC_ANNOKIT_TOKEN to the one the stub printed" });
  }

  console.log(`  ${req.method} ${path}`);

  // ── Handshake ─────────────────────────────────────────────────────────
  // The overlay calls this once and disables itself on a version mismatch.
  // queuesTasks: a task sent while another is working waits its turn in
  // agentQueue (MAX_JOBS at a time), so the overlay need not block Send.
  if (path === "/health") {
    return json(res, 200, { status: "ok", protocolVersion: PROTOCOL_VERSION, queuesTasks: true });
  }

  // Identity is optional. `{"id": null}` is the protocol's "nobody": it
  // leaves the overlay on its local name tiers, which is what an example
  // should demonstrate, without the dev-log warning a 404 costs.
  if (path === "/me") return json(res, 200, { id: null });

  // ── Sessions ──────────────────────────────────────────────────────────
  if (path === "/sessions" && req.method === "POST") {
    const body = await readJson(req);
    // Passing an existing id is an idempotent register — the client posts
    // its configured sessionId once at startup.
    const id = typeof body.id === "string" && body.id ? body.id : randomUUID();
    const session = db.sessions.get(id) ?? { id, url: body.url ?? null, title: body.title ?? null, createdAt: now() };
    db.sessions.set(id, session);
    return json(res, 201, session);
  }
  if (path === "/sessions" && req.method === "GET") return json(res, 200, [...db.sessions.values()]);

  if (seg[0] === "sessions" && seg[1]) {
    const sid = decodeURIComponent(seg[1]);
    const mine = () => [...db.annotations.values()].filter((a) => a.sessionId === sid);

    // SSE. Everything else re-reads; this only says "something changed".
    if (seg[2] === "events" && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(": connected\n\n");
      if (!listeners.has(sid)) listeners.set(sid, new Set());
      listeners.get(sid).add(res);
      const keepAlive = setInterval(() => { try { res.write(": ping\n\n"); } catch {} }, 15000);
      req.on("close", () => { clearInterval(keepAlive); listeners.get(sid)?.delete(res); });
      return;
    }

    if (seg[2] === "annotations" && req.method === "POST") {
      const body = await readJson(req);
      // Protocol v1 ECHOES the client's id. (agentation-mcp assigns its own
      // instead, which is why the client always re-keys to what it gets back.)
      const id = typeof body.id === "string" && body.id ? body.id : randomUUID();
      // A RETRY repeats the id: the first POST may have timed out after it
      // was stored. It is the same annotation, so answer with what is held
      // rather than resetting its status, thread and screenshot.
      const existing = db.annotations.get(id);
      if (existing) {
        return existing.sessionId === sid
          ? json(res, 200, existing)
          : json(res, 409, { error: "that id belongs to another session" });
      }
      const { status: _status, thread: _thread, ...capture } = boundCapture(body);
      const annotation = { ...capture, id, sessionId: sid, status: "pending", createdAt: now() };
      db.annotations.set(id, annotation);
      db.sessions.set(sid, db.sessions.get(sid) ?? { id: sid, createdAt: now() });
      emitAnnotation("annotation.created", annotation);
      return json(res, 201, annotation);
    }
    if (seg[2] === "annotations" && req.method === "GET") return json(res, 200, mine());
    if (seg[2] === "pending" && req.method === "GET") {
      // "working" belongs here: a task an agent is mid-way through is not
      // finished, and dropping it from this list would make the queue empty
      // and the banner blind at exactly the moment both have something to
      // say.
      return json(res, 200, mine().filter((a) => a.status === "pending" || a.status === "working"));
    }
    if (!seg[2] && req.method === "GET") {
      return json(res, 200, { ...(db.sessions.get(sid) ?? { id: sid }), annotations: mine() });
    }
  }

  // ── Annotations (agent tasks) ─────────────────────────────────────────
  if (path === "/annotations/send" && req.method === "POST") {
    const body = await readJson(req);
    // The protocol field is `annotationIds`, and an EMPTY ARRAY means "send
    // all pending" (docs/protocol.md, Annotations). Getting this wrong is silent: the
    // POST still returns 200 and the app still clears its selection, so the
    // only symptom is an agent that never starts.
    const pending = () => [...db.annotations.values()]
      .filter((a) => a.status === "pending").map((a) => a.id);
    const asked = Array.isArray(body.annotationIds) ? body.annotationIds
      : Array.isArray(body.ids) ? body.ids   // tolerated alias
      : null;
    const ids = asked === null ? pending() : asked.length ? asked : pending();
    for (const id of ids) {
      const a = db.annotations.get(id);
      // With the bridge ON, a task is NOT "sent" yet — it is waiting its
      // turn, and runAgent moves it working → sent. Marking it sent here
      // dropped it out of the pending list, so two of three queued tasks
      // vanished from the queue while they had not been touched.
      // With the agent switched OFF, "sent" is the whole story. With it on
      // but none installed, the task stays pending: nothing took it, and it
      // should still be there to send once one is.
      if (a && !AGENT_ENABLED) db.annotations.set(id, { ...a, status: "sent", sentAt: now() });
    }
    if (AGENT) for (const id of ids) enqueueAgent(id);
    else if (AGENT_ENABLED) for (const id of ids) addThreadMessage(id, "agent", AGENT_ERROR);
    else console.log(`    → marked ${ids.length} task(s) sent (the agent is off: AGENT=0 / --no-agent)`);
    for (const id of ids) {
      const a = db.annotations.get(id);
      if (a) emitAnnotation("annotation.updated", a);
    }
    return json(res, 200, { sent: ids.length });
  }

  if (seg[0] === "annotations" && seg[1]) {
    const id = decodeURIComponent(seg[1]);
    const annotation = db.annotations.get(id);

    if (seg[2] === "screenshot" && req.method === "POST") {
      if (!annotation) return json(res, 404, { error: "no such annotation" });
      const ref = await storeScreenshot(req, origin);
      annotation.references = [...(annotation.references ?? []), ref];
      emitAnnotation("annotation.updated", annotation);
      return json(res, 201, ref);
    }
    if (seg[2] === "thread" && req.method === "POST") {
      if (!annotation) return json(res, 404, { error: "no such annotation" });
      const body = await readJson(req);
      if (typeof body.content !== "string" || !body.content.trim()) {
        return json(res, 400, { error: "content is required" });
      }
      // `role`, `id` and `timestamp` are the server's. A reply posted here
      // is always the user's, whatever the body claims: an agent's words
      // only ever come from the bridge itself.
      annotation.thread = [...(annotation.thread ?? []),
        { id: randomUUID(), role: "user", content: clampText(body.content), timestamp: now() }];
      // A human reply puts the task back in the queue — "reply to refine".
      // Mid-run it cannot: the run would overwrite the status when it ends,
      // so it is marked and the run reopens the task as it finishes.
      if (annotation.status === "working") annotation.refinedDuringRun = true;
      else if (annotation.status !== "pending") reopen(annotation);
      emitAnnotation("annotation.updated", annotation);
      return json(res, 201, annotation);
    }
    if (!seg[2] && req.method === "GET") {
      return annotation ? json(res, 200, annotation) : json(res, 404, { error: "no such annotation" });
    }
    if (!seg[2] && req.method === "DELETE") {
      if (annotation) {
        db.annotations.delete(id);
        dropScreenshots(annotation.references);
        emitAnnotation("annotation.deleted", annotation);
      }
      return json(res, 200, { ok: true });
    }
  }

  // ── Comments (team notes) ─────────────────────────────────────────────
  if (path === "/comments" && req.method === "POST") {
    const body = await readJson(req);
    if (typeof body.content !== "string" || !body.content.trim()) {
      return json(res, 400, { error: "content is required" });
    }
    // The server names the note: comment ids are not the client's.
    const id = randomUUID();
    const { content, authorName, id: _id, messages: _messages, status: _status, author: _author, ...capture } =
      boundCapture(body);
    const author = authorFrom(authorName);
    const at = now();
    // The note's text is its FIRST MESSAGE, not a field of its own: a note
    // is a conversation from the start.
    const comment = {
      ...capture, id, status: "open", author,
      messages: [{ id: randomUUID(), content, author, createdAt: at }],
      createdAt: at, updatedAt: at,
    };
    db.comments.set(id, comment);
    emit("comment.created", { id });
    return json(res, 201, { comment });
  }
  if (path === "/comments" && req.method === "GET") {
    const routeName = url.searchParams.get("routeName");
    const all = [...db.comments.values()];
    return json(res, 200, { comments: routeName ? all.filter((c) => c.routeName === routeName) : all });
  }

  if (seg[0] === "comments" && seg[1]) {
    const id = decodeURIComponent(seg[1]);
    const comment = db.comments.get(id);

    if (seg[2] === "screenshot" && req.method === "POST") {
      if (!comment) return json(res, 404, { error: "no such comment" });
      const ref = await storeScreenshot(req, origin);
      comment.references = [...(comment.references ?? []), ref];
      emit("comment.updated", { id });
      return json(res, 201, ref);
    }
    if (seg[2] === "messages" && req.method === "POST") {
      if (!comment) return json(res, 404, { error: "no such comment" });
      const body = await readJson(req);
      if (typeof body.content !== "string" || !body.content.trim()) {
        return json(res, 400, { error: "content is required" });
      }
      comment.messages = [...(comment.messages ?? []), {
        id: randomUUID(),
        content: clampText(body.content),
        author: authorFrom(body.authorName),
        createdAt: now(),
      }];
      comment.updatedAt = now();
      emit("comment.updated", { id });
      return json(res, 201, { comment });
    }
    if (!seg[2] && req.method === "GET") {
      return comment ? json(res, 200, { comment }) : json(res, 404, { error: "no such comment" });
    }
    if (!seg[2] && req.method === "PATCH") {
      if (!comment) return json(res, 404, { error: "no such comment" });
      const body = await readJson(req);
      // `converted` is legacy: old clients still send it.
      if (!["open", "resolved", "converted"].includes(body.status)) {
        return json(res, 400, { error: "status must be open or resolved" });
      }
      comment.status = body.status;
      comment.updatedAt = now();
      emit("comment.updated", { id });
      return json(res, 200, { comment });
    }
    if (!seg[2] && req.method === "DELETE") {
      if (comment) {
        db.comments.delete(id);
        dropScreenshots(comment.references);
        emit("comment.deleted", { id });
      }
      return json(res, 200, { ok: true });
    }
  }

  // ── A task's diff, as plain text a browser can render ─────────────────
  if (seg[0] === "annotations" && seg[1] && seg[2] === "diff" && req.method === "GET") {
    const patch = db.patches.get(decodeURIComponent(seg[1]));
    if (!patch) return json(res, 404, { error: "no diff for this task" });
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    });
    return res.end(patch);
  }

  // ── The agent: which one, which model (docs/protocol.md, "Agent") ─────
  if (path === "/agent" && req.method === "GET") {
    if (url.searchParams.get("refresh") === "1") detectAgents();
    // Answer with who is signed in, not a guess: the check takes under a
    // second, and is given ten before the answer goes without it.
    await Promise.race([connectionsChecked, new Promise((r) => setTimeout(r, 10_000).unref())]);
    return json(res, 200, agentState());
  }
  if (path === "/agent/models" && req.method === "GET") {
    const id = url.searchParams.get("agent") ?? AGENT?.id ?? "";
    const provider = id === "custom" ? CUSTOM : PROVIDERS[id];
    const found = detected[id];
    if (!provider) return json(res, 404, { ok: false, message: `unknown agent "${id.slice(0, 40)}"` });
    if (!found?.installed) return json(res, 200, { ok: false, message: `${provider.label} is not installed.` });
    return json(res, 200, await providerModels(id, provider, found.bin, url.searchParams.get("refresh") === "1"));
  }
  if (path === "/agent" && req.method === "PATCH") {
    if (!AGENT_ENABLED) throw new HttpError(409, "the agent is off on this server (AGENT=0 / --no-agent)");
    const body = await readJson(req);
    if (body.agent !== undefined) {
      const known = body.agent === "custom" ? CUSTOM : PROVIDERS[body.agent];
      if (!known) throw new HttpError(400, `unknown agent "${String(body.agent).slice(0, 40)}"`);
      if (!detected[body.agent]?.installed) throw new HttpError(400, `${known.label} is not installed`);
      // A model belongs to an agent: a new agent starts on its own default.
      if (AGENT?.id !== body.agent) AGENT_MODEL = null;
      useAgent(body.agent);
      AGENT_ERROR = null;
    }
    if (body.model !== undefined) {
      // One argv entry, never through a shell; the pattern only keeps it
      // to something that looks like a model id.
      if (body.model !== null && !(typeof body.model === "string" && MODEL_ID.test(body.model))) {
        throw new HttpError(400, "model must be null or a model id");
      }
      AGENT_MODEL = body.model;
    }
    console.log(`  agent: ${AGENT ? `${AGENT.label}${AGENT_MODEL ? ` · ${AGENT_MODEL}` : ""}` : "none"} (switched)`);
    emit("agent.updated", {});
    return json(res, 200, agentState());
  }

  // ── The app's assets (docs/assets.md) ─────────────────────────────────
  if (path === "/assets" && req.method === "GET") {
    return json(res, 200, { assets: await ASSETS.list(`${origin}/assets/raw`), writable: ASSETS.writable });
  }
  if (seg[0] === "assets" && seg[1] === "raw" && req.method === "GET") {
    const rel = seg.slice(2).map((s) => decodeURIComponent(s)).join("/");
    const file = await ASSETS.read(rel);
    if (!file) return json(res, 404, { error: "no such image" });
    // An image and nothing else: the type is the one its bytes have, the
    // browser may not guess another, and nothing in it may run.
    res.writeHead(200, {
      "Content-Type": file.contentType,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "no-store",
    });
    return res.end(file.bytes);
  }
  if (path === "/assets" && req.method === "POST") {
    const part = namedFilePart(await readBody(req, UPLOAD_MAX), req.headers["content-type"]);
    if (!part) throw new HttpError(400, "no file part");
    try {
      const asset = await ASSETS.put(part.filename, part.bytes, `${origin}/assets/raw`);
      console.log(`    + asset ${asset.publicPath}`);
      emit("asset.created", { path: asset.path });
      return json(res, 201, asset);
    } catch (err) {
      throw new HttpError(err.status ?? 500, err.message);
    }
  }
  if (seg[0] === "assets" && seg[1] && req.method === "DELETE") {
    try {
      const gone = await ASSETS.remove(seg.slice(1).map((s) => decodeURIComponent(s)).join("/"));
      if (!gone) return json(res, 404, { error: "no such asset" });
      emit("asset.deleted", {});
      res.writeHead(204);
      return res.end();
    } catch (err) {
      throw new HttpError(err.status ?? 500, err.message);
    }
  }

  // ── Uploaded screenshots, served back ─────────────────────────────────
  if (seg[0] === "screenshots" && seg[1] && req.method === "GET") {
    const shot = db.screenshots.get(seg[1]);
    if (!shot) return json(res, 404, { error: "expired" });
    res.writeHead(200, {
      "Content-Type": shot.contentType,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    });
    return res.end(shot.bytes);
  }

  json(res, 404, { error: `no route for ${req.method} ${path}` });
}

server.listen(PORT, HOST, () => {
  console.log(`\nAnnoKit Protocol v1 stub — http://localhost:${PORT}`);
  console.log(NETWORK
    ? `  open to your network (HOST=${HOST}): every request needs the token below`
    : `  this machine only — for a physical device, HOST=0.0.0.0 npx annokit server`);
  console.log(`  in memory; restart to clear`);
  const named = AGENT ? `${AGENT.label}${AGENT_MODEL ? ` · ${AGENT_MODEL}` : ""}` : "";
  const others = PROVIDER_ORDER.filter((id) => detected[id]?.installed && id !== AGENT?.id).map((id) => PROVIDERS[id].label);
  if (AGENT && WORKTREE) {
    console.log(`  agent: ${named} — worktree per task, ${MAX_JOBS} at a time${OPEN_PR ? ", opens PRs" : ""}`);
    console.log(`         edits land on annokit/* branches, NOT in your tree (so no hot reload)\n`);
  } else if (AGENT) console.log(`  agent: ${named} — "Send to agent" edits ${AGENT_DIR}`);
  if (AGENT) {
    console.log(`         also installed: ${others.length ? others.join(", ") : "nothing else"} — switch from the app's Agent item\n`);
  } else if (AGENT_ENABLED) console.log(`  agent: NONE — Send will say this in the task too\n    ${AGENT_ERROR}\n`);
  else console.log(`  agent: off (--no-agent / AGENT=0) — tasks are stored, nothing acts on them\n`);
  // Never let a widened sandbox be the quiet part: if someone handed this
  // agent a shell, say so every time it starts. Deliberately AFTER the
  // chain above rather than inside it — putting it in the middle detached
  // the "unavailable" branch and printed both.
  if (AGENT?.custom) {
    console.log(`  ⚠ custom agent command — its permissions are whatever you gave it\n`);
  }
  if (AGENT?.shell && !AGENT.custom) {
    console.log(`  ⚠ ${AGENT.label} runs with its edits auto-approved, which includes shell commands\n`);
  }
  if (AGENT?.id === "claude" && AGENT_TOOLS.includes("Bash")) {
    console.log(`  ⚠ agent has Bash — it can run commands, including git push\n`);
  }
  if (AGENT?.id === "codex" && AGENT_SANDBOX !== "workspace-write") {
    console.log(`  ⚠ agent sandbox is "${AGENT_SANDBOX}" — wider than the default\n`);
  }
  // THE LINES FOR .env.local, for the device actually in use: `localhost`
  // is the device reading the line, so a phone and an Android emulator each
  // need a different address — and printing only one handed the other an
  // endpoint that could not resolve. PUBLIC_ORIGIN wins when it is set.
  console.log(`  For your app's .env.local (Expo), or the provider's props:`);
  if (process.env.PUBLIC_ORIGIN) {
    console.log(`    EXPO_PUBLIC_ANNOKIT_ENDPOINT=${AGENT_ORIGIN}`);
  } else if (NETWORK) {
    const lan = lanAddresses();
    for (const ip of lan.length ? lan : ["<this machine's IP>"]) {
      console.log(`    EXPO_PUBLIC_ANNOKIT_ENDPOINT=http://${ip}:${PORT}      # a phone on this network`);
    }
  } else {
    console.log(`    EXPO_PUBLIC_ANNOKIT_ENDPOINT=http://localhost:${PORT}   # iOS simulator`);
    console.log(`    EXPO_PUBLIC_ANNOKIT_ENDPOINT=http://10.0.2.2:${PORT}    # Android emulator`);
  }
  if (TOKEN) console.log(`    EXPO_PUBLIC_ANNOKIT_TOKEN=${TOKEN}`);
  console.log(`    EXPO_PUBLIC_ANNOKIT_SESSION_ID=example-session\n`);
});
