/**
 * The package version, which lives in three places that must agree:
 * `version` in package.json, the root entries of package-lock.json, and
 * PACKAGE_VERSION in src/env.ts (a literal on purpose — src/env.ts explains
 * why it does not import the manifest).
 *
 *   node scripts/version.mjs bump <patch|minor|major|X.Y.Z>
 *     Sets all three. `npm run bump patch` in a pull request is the whole
 *     release: merging it publishes (.github/workflows/release.yml).
 *
 *   node scripts/version.mjs gate <base-ref>
 *     Fails when the shipped package changed between <base-ref> and HEAD but
 *     the version did not go up. CI runs it on pull requests against main,
 *     and on main against the previous commit, so two PRs that claim the
 *     same version cannot merge into a release that silently never happens.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

/** package.json fields that do not reach a consumer, so changing them is not a release. */
const UNSHIPPED_FIELDS = new Set(["version", "scripts", "devDependencies", "packageManager"]);

function parse(version) {
  const m = SEMVER.exec(version ?? "");
  if (!m) throw new Error(`"${version}" is not X.Y.Z`);
  return m.slice(1).map(Number);
}

function compare(a, b) {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

function next(current, step) {
  const [major, minor, patch] = parse(current);
  if (step === "major") return `${major + 1}.0.0`;
  if (step === "minor") return `${major}.${minor + 1}.0`;
  if (step === "patch") return `${major}.${minor}.${patch + 1}`;
  parse(step);
  if (compare(step, current) <= 0) throw new Error(`${step} is not above the current ${current}`);
  return step;
}

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

function bump(step) {
  if (!step) throw new Error("usage: npm run bump <patch|minor|major|X.Y.Z>");
  const manifest = readJson("package.json");
  const version = next(manifest.version, step);

  manifest.version = version;
  writeJson("package.json", manifest);

  const lock = readJson("package-lock.json");
  lock.version = version;
  if (lock.packages?.[""]) lock.packages[""].version = version;
  writeJson("package-lock.json", lock);

  const env = readFileSync("src/env.ts", "utf8");
  const literal = /export const PACKAGE_VERSION = "[^"]*";/;
  if (!literal.test(env)) throw new Error("PACKAGE_VERSION not found in src/env.ts");
  writeFileSync("src/env.ts", env.replace(literal, `export const PACKAGE_VERSION = "${version}";`));

  console.log(`✓ ${manifest.name} ${version} (package.json, package-lock.json, src/env.ts)`);
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8" });

/** The package.json fields a consumer sees, as one comparable string. */
function shippedManifest(json) {
  return JSON.stringify(Object.entries(JSON.parse(json)).filter(([key]) => !UNSHIPPED_FIELDS.has(key)));
}

function gate(base) {
  if (!base) throw new Error("usage: node scripts/version.mjs gate <base-ref>");
  const before = git("show", `${base}:package.json`);
  const after = readFileSync("package.json", "utf8");
  const changed = git("diff", "--name-only", base, "HEAD").split("\n").filter(Boolean);

  // server/ ships too, as the `annokit` bin.
  const reasons = changed.filter((path) => path.startsWith("src/") || path.startsWith("server/"));
  if (shippedManifest(before) !== shippedManifest(after)) reasons.push("package.json (published fields)");

  const [from, to] = [JSON.parse(before).version, JSON.parse(after).version];
  if (reasons.length === 0) {
    console.log(`✓ nothing shipped changed (${to})`);
    return;
  }
  if (compare(to, from) > 0) {
    console.log(`✓ shipped changes release as ${to} (was ${from})`);
    return;
  }
  console.error(`::error::the published package changes but the version is still ${to}.`);
  console.error(`Run \`npm run bump patch\` (or minor/major) and commit the result. Changed:`);
  for (const reason of reasons.slice(0, 20)) console.error(`  ${reason}`);
  process.exit(1);
}

try {
  const [command, arg] = process.argv.slice(2);
  if (command === "bump") bump(arg);
  else if (command === "gate") gate(arg);
  else throw new Error("usage: node scripts/version.mjs <bump|gate> …");
} catch (error) {
  console.error(`✗ ${error.message}`);
  process.exit(1);
}
