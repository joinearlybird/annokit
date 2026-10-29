#!/usr/bin/env node
/**
 * The `annokit` bin. One command, subcommands under it:
 *
 *   npx annokit server [flags]   # the stub server (./stub-server.mjs)
 *   npx annokit [flags]          # the same: server is the default
 *   npx annokit help
 *
 * Node built-ins only, like the rest of the package.
 */
import { readFileSync } from "node:fs";

const USAGE = `Usage: annokit <command> [flags]

Commands:
  server     Start the stub server the overlay talks to (the default)
  help       Show this help

Server flags:
  --port <n>         Port to listen on (default 4788, or PORT)
  --no-agent         Store tasks only; no coding agent acts on them
  --agent=<name>     Start with this agent: claude, codex, cursor, opencode, gemini, grok
  --worktree         Run each task in its own git worktree and branch
  --jobs <n>         Tasks run at once with --worktree (default 2)
  --pr               Open a pull request for each finished worktree task

  HOST=0.0.0.0 opens the server to your network, behind a printed token.
`;

const [command] = process.argv.slice(2);

if (command === undefined || command.startsWith("-") && !["-h", "--help", "-v", "--version"].includes(command)) {
  await import("./stub-server.mjs");
} else if (command === "server") {
  // The server reads its flags from process.argv; the subcommand is not one.
  process.argv.splice(2, 1);
  await import("./stub-server.mjs");
} else if (command === "help" || command === "-h" || command === "--help") {
  process.stdout.write(USAGE);
} else if (command === "-v" || command === "--version") {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  console.log(pkg.version);
} else {
  process.stderr.write(`annokit: unknown command "${command}"\n\n${USAGE}`);
  process.exit(1);
}
