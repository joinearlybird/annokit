/**
 * Put THIS checkout's package into the examples, in place of the release.
 *
 * The examples install @joinearlybird/annokit from npm, as
 * any app does, so they show the published package. To try an unreleased
 * change in one, this builds and packs the repository and installs the
 * tarball over it with --no-save: package.json and the lockfile keep naming
 * the release, and `npm ci` in the example puts the release back.
 *
 * A tarball rather than a link on purpose. A linked package lives outside
 * the app, and Metro then resolves its imports from the wrong node_modules
 * (the examples used to carry a metro.config.js for exactly that). An
 * installed tarball is what a user has, so there is nothing to configure.
 *
 *   npm run examples:local                # both examples
 *   npm run examples:local -- expo        # just one
 *
 * Re-run it after changing the package, then restart Metro without its
 * cache (`--clear` for Expo, `--reset-cache` for the bare app).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = process.cwd();
const all = ["expo", "bare-react-native"];
const picked = process.argv.slice(2);
const examples = picked.length ? picked : all;
for (const name of examples) {
  if (!all.includes(name)) { console.error(`no example "${name}" (one of: ${all.join(", ")})`); process.exit(1); }
}

const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
const scratch = mkdtempSync(join(tmpdir(), "annokit-local-"));
try {
  run("npm", ["run", "build"], root);
  const tgz = run("npm", ["pack", "--ignore-scripts", "--silent", "--pack-destination", scratch], root).trim().split("\n").pop();
  for (const name of examples) {
    const dir = resolve(root, "examples", name);
    run("npm", ["install", "--no-save", "--no-audit", "--no-fund", join(scratch, tgz)], dir);
    console.log(`✓ examples/${name} now runs this checkout (${tgz}) — restart Metro without its cache`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
