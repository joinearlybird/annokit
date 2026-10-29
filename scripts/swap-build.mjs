/**
 * Put the freshly built output in place with one rename.
 *
 * `build` used to start with `rm -rf lib` and write the ESM entry LAST, so
 * `lib/module/index.js` was missing for the whole build — several seconds.
 * That is invisible in CI and poisonous in development: Metro watches this
 * directory for the examples, resolves the package during the gap, fails,
 * and CACHES the failure. The app then shows "Unable to resolve
 * @joinearlybird/annokit" until Metro is restarted with
 * --clear, which reads as "my change did not take" rather than "the build
 * moved the file out from under the bundler".
 *
 * So the build writes to a staging directory and this swaps it in. The
 * window where `lib` does not exist is now two renames rather than a
 * compile, and nothing watching has time to notice.
 */
import { renameSync, rmSync, existsSync } from "node:fs";

const STAGING = ".lib-staging";
const FINAL = "lib";
const RETIRED = "lib.previous";

if (!existsSync(STAGING)) {
  console.error(`✗ ${STAGING} does not exist — did the build steps run?`);
  process.exit(1);
}

rmSync(RETIRED, { recursive: true, force: true });
if (existsSync(FINAL)) renameSync(FINAL, RETIRED);
renameSync(STAGING, FINAL);
rmSync(RETIRED, { recursive: true, force: true });

console.log(`✓ ${FINAL} swapped in`);
