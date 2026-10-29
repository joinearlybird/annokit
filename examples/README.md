# Examples

Two apps, each made with an official scaffold command and then given the
overlay the way the [quick start](../README.md#quick-start) says. Neither
has any configuration you would not have in your own app. Each one's README
lists the commands that made it.

| | Made with | What it shows |
|---|---|---|
| [`expo/`](./expo) | `npx create-expo-app@latest` | The ordinary integration: Expo Router, env config, every optional peer |
| [`bare-react-native/`](./bare-react-native) | `npx @react-native-community/cli@latest init` | No Expo at all: configured by props, optional peers left out |

Both install `@joinearlybird/annokit` from npm and run the
stub server it ships, `npx annokit server`. The stub is the AnnoKit
Protocol v1 in one file, in memory, with no database.

## Run one

```bash
cd examples/expo                     # or examples/bare-react-native
npm install
```

Then follow that example's README. Neither needs this repository built.

## Why there is a server at all

The overlay is a **strict no-op** unless `__DEV__` is true, an endpoint and a
session id resolve, *and* `GET /health` answers with a matching
`protocolVersion`. Without a server an example would render your app and
nothing else, which is the worst possible first impression of a tool whose
entire point is visible.

The stub is not a reference implementation. It has no authorization, no
tenancy and no retention — see [Server obligations](../docs/protocol.md#server-obligations)
for what a real one must enforce.

## Trying an unreleased change

The examples run the published package, so a change in this repository
does not reach them by itself. From the repository root:

```bash
npm run examples:local               # build, pack, install over the release in both
npm run examples:local -- expo       # or just one
```

That installs the packed tarball with `--no-save`, so `package.json` and the
lockfile keep naming the release, and `npm ci` in the example puts it back.
Re-run it after each change and restart Metro without its cache
(`npx expo start --clear`, or `npm start -- --reset-cache` for the bare
app). It is a
tarball and not a link because a linked package lives outside the app, and
Metro then resolves its imports from the wrong `node_modules`.

To check both examples the same way, `npm run verify:starter --
--examples` installs the tarball into each, bundles each for iOS and
Android, and starts `npx annokit server` from each.

`npm run verify:starter -- --fresh` goes further. It runs both scaffold
commands from scratch, applies the quick start's steps, and checks the
result the same way, which is how a new Expo SDK breaking the instructions
shows up. Both are run locally, not in CI.

## Letting an agent actually make the change

The stub hands every task you send to a coding agent running headless, in
the directory the server was started from. That is the example app, which is
what Metro is watching, so the edit hot-reloads onto the device that asked
for it. From an example's directory:

```bash
npx annokit server                  # the first agent installed
npx annokit server --agent=claude   # or name it
npx annokit server --agent=codex
npx annokit server --no-agent       # store tasks only
```

It looks for Claude Code, Codex, Cursor, OpenCode, Gemini CLI and Grok, in
that order, and the app's Agent item switches between whichever are
installed while it runs. Claude Code and Codex get file tools only:

| | Install | Invoked as |
|---|---|---|
| **Claude Code** | `npm i -g @anthropic-ai/claude-code` | `claude -p … --permission-mode acceptEdits` |
| **Codex** | `npm i -g @openai/codex` | `codex exec … --sandbox workspace-write` |

The other four have no file-only headless mode, and the startup banner says
so when one of them is in use.

**Or any other agent.** `AGENT_CMD` runs whatever you point it at:

```bash
AGENT_CMD="aider --yes --message {prompt}" npx annokit server
AGENT_CMD="my-agent.sh {prompt} --dir {dir}" …
AGENT_CMD="some-cli --task" …        # no {prompt} → appended as the last argument
```

`{prompt}` and `{dir}` are substituted, and whatever the command prints on
stdout becomes the reply in the app. Arguments split on whitespace, so
anything needing real quoting wants a wrapper script — which is also where
your agent's own flags belong. Its permissions are whatever you gave it:
`AGENT_TOOLS` and `AGENT_SANDBOX` apply to the two named agents only, and
the startup banner says a custom command is in use so that is never a
silent difference.

Naming an agent that is not installed is an error rather than a quiet
fallback — if you asked for Codex, running something else would make the
result a lie. With none installed, the startup banner says so and each task
gets a thread reply explaining what to install.

`AGENT_MODEL` overrides the model; unset means whatever that CLI is already
configured to use. None of them needs an API key if you are already signed
in.

Annotate some text, write "change this to Ship it", send it — the agent
edits the file, Metro reloads, and the change appears on the device that
asked for it. What the agent says comes back as a reply in the task's
thread, so the answer arrives where the request came from.

### Agent edits land in your working tree

That is the point — Metro reloads them — but it means a test run leaves
changes that look exactly like your own work, and a `git add -A` will
commit them. Three things keep that honest:

- every run names what it changed, in the server log and in the reply
  inside the app ("Edited src/app/index.tsx — these are in your working
  tree"), with the `git restore` line that undoes it;
- `npm run examples:reset`, from the repository root, throws away every
  edit in both examples;
- a pre-commit hook (`.githooks/`, wired up by `npm install`) refuses a
  commit that stages example-app files together with anything outside
  them, which is the shape of the accident. `git commit --no-verify`
  overrides it when you mean it.

**This writes to your files.** The agent's working directory is the one the
server started in, and Claude Code and Codex get file tools only — no shell
— but it is still an agent editing code unattended. `--no-agent` turns it
off.

That sandbox is a **default, not a position**. It is right for a demo: an
agent reachable from a text field on a phone, running unattended on
whoever's laptop is hosting this, has no business running arbitrary
commands. An adopter running this inside their own platform knows things
this example cannot — whose repository it is, what the agent may touch,
whether it may push — so the decision is theirs to take back:

```bash
AGENT_TOOLS="Read Edit Write Glob Grep Bash" …   # Claude: let it run git
AGENT_SANDBOX=danger-full-access …               # Codex: drop the sandbox
```

Widen either and the agent can commit, push and open its own pull request.
The server says so at startup every time, because a widened sandbox should
never be the quiet part. `--pr` exists precisely so you do **not** have to
widen anything just to get a PR: the server does the push itself, with one
known command, while the agent stays sandboxed.

### A worktree per task, for real parallelism

```bash
npx annokit server --worktree --jobs 2
npx annokit server --worktree --pr         # also opens a PR
```

Each task gets its own `git worktree` and its own `annokit/<id>` branch, so
runs cannot overwrite each other and several go at once. When one finishes,
whatever it changed is committed to that branch and the thread reply names
the commit and the files, in this shape:

> Changed the title in `src/app/index.tsx` from "Welcome to Expo" to
> "Ship it".
>
> Committed c027271 to `annokit/wt1`: examples/expo/src/app/index.tsx

With `--pr` the branch is pushed and a pull request opened (needs `gh`), and
its link rides on the task as a `url` reference as well as in the reply.
The PR is based on the branch the task forked from, not the repository
default — a worktree is cut from `HEAD`, so basing it on `main` would show
every commit between the two with the actual change buried in them.

Verified end to end: an annotation produced a pull request of exactly one
file, `+1 -1`.

#### Reading the diff on the phone

A worktree run changes nothing you can see, so the task carries two things
you can open from the detail pane:

- **the branch**, as a `branch` reference — `annokit/d1 (1fe150f)`;
- **the diff**, as a link the stub serves at
  `/annotations/:id/diff` in plain text. With `--pr`, the pull request's
  link is there too, and GitHub renders a diff better than a phone pane
  ever will.

Reference links are tappable in the task detail and open in the browser.

**On a physical device, set `PUBLIC_ORIGIN`.** The diff link is built from
it, and the default (`http://localhost:4788`) means *the device itself* —
so the link would be unopenable exactly where opening it matters:

```bash
PUBLIC_ORIGIN=http://192.168.1.20:4788 npx annokit server --worktree
```

**This is the mode that gives up hot reload**, and the trade is worth
understanding rather than discovering. The worktrees are checked out in the
OS temp directory, deliberately outside this repository — Metro watches the
repo root and would otherwise crawl and rebuild every copy. So the agent is
not editing the tree Metro is serving: nothing changes on the device, and
the result arrives as a branch you review. That is the right shape for real
work and the wrong one for showing someone what this package does.

It is also what the overlay's **One task at a time** switch exists for
(Settings → This session). Turn it off here: the server can genuinely take
another task, and the switch is the only thing still saying otherwise.

Your own working tree is never touched in this mode.

#### Seeing a worktree's change on the device

You cannot point the running app at a worktree without more trouble than it
is worth. Tried and measured, so the reasons are concrete rather than
theoretical:

- **A worktree has no `node_modules`** — it is a fresh checkout, and they
  are gitignored. Symlinking them from the main checkout FAILS: Metro will
  not serve files outside its watched roots, and the link points back out
  of the worktree. You would need a real `npm install` per worktree, which
  is minutes and hundreds of megabytes for a preview.
- **Only one Metro can hold port 8081**, which is the port the dev build
  looks for (see [the Expo example](./expo/README.md)). So previewing a
  worktree means stopping the Metro serving your own work.

**Check the branch out instead.** The Metro you already have is watching the
tree, so the change appears with hot reload the moment you switch to it:

```bash
git checkout annokit/<id>      # look at it running
git checkout -                  # go back
```

That is the same review you would do anyway, and it costs nothing. If you
want a worktree to be viewable as a first-class thing, the real answer is
`expo-dev-client` — its launcher lets the app pick a dev server at runtime,
so a second Metro on another port becomes reachable. That is a change to
the example app, not to this bridge.

### Why this is the demo worth running

Annotate the big "Welcome to Expo" title. The annotation tells the agent
the component is `ThemedText`, defined in `src/components/themed-text.tsx`.
That file renders whatever it is given — the words are not there. They
live at the call site, `src/app/index.tsx`, which the annotation never
names. The agent finds them by searching for `nearbyText`, the text that
was on screen:

```diff
  <ThemedText type="title" style={styles.title}>
-   Welcome to&nbsp;Expo
+   Ship it
  </ThemedText>
```

That is the whole argument for sending the on-screen text by default
([Settings](../docs/settings.md), *Output detail*), demonstrated rather than asserted.

## What to actually do once it runs

1. Tap the floating pencil — that arms annotate mode.
2. Touch any element. It outlines and names the nearest **user** component
   (`ThemedText`, not `Text`), with its file and line.
3. Write a sentence, then pick the commit that names the destination:
   **Create Agent Task** or **Comment**. The tap that chooses is the tap that
   sends.
4. The mark stays on the element. Tap it to reply, resolve or delete.
5. Watch the server log — every step is one small HTTP call.
