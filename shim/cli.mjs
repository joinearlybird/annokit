#!/usr/bin/env node
/**
 * The unscoped `annokit` package: what `npx annokit` finds when the app it
 * runs in does not have @joinearlybird/annokit installed. Inside an app
 * that does, npx runs that install's own `annokit` bin and never gets here.
 *
 * It runs the @joinearlybird/annokit that resolves from the current
 * directory, and nothing else. It deliberately does not depend on it: npx
 * would install its react and react-native peers just to start a server.
 * Node built-ins only.
 */
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PACKAGE = "@joinearlybird/annokit";

let root;
try {
  const require = createRequire(join(resolve(process.cwd()), "noop.js"));
  root = dirname(require.resolve(`${PACKAGE}/package.json`));
} catch {
  process.stderr.write(
    `annokit: ${PACKAGE} is not installed here.\n\n` +
      `AnnoKit's server runs from your app, where the package is installed:\n\n` +
      `  npx expo install ${PACKAGE}   # or: npm install ${PACKAGE}\n` +
      `  npx annokit server\n\n` +
      `Setup: https://github.com/joinearlybird/annokit#quick-start\n`,
  );
  process.exit(1);
}

await import(pathToFileURL(join(root, "server", "cli.mjs")).href);
