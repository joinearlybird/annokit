/**
 * Package validation — run by `prepack`, so a broken tarball cannot be
 * published by accident.
 *
 * This checks the things that are invisible until someone else installs the
 * package: that every advertised entry point exists, that none of them lead
 * back into unbuilt repository internals, and that the tarball carries what
 * the README needs and nothing it does not.
 *
 * It deliberately does NOT check that `import` resolves under Node's ESM
 * resolver. The emitted ESM keeps extensionless relative specifiers, which
 * Metro and every bundler resolve and strict Node does not — and strict Node
 * cannot load this package regardless, because `react-native` ships Flow
 * syntax. Asserting it would fail for a reason no consumer will ever hit.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const problems = [];
const fail = (message) => problems.push(message);

// ── Entry points exist, and none of them point at source ────────────────────
const entries = [
  ["main", pkg.main],
  ["module", pkg.module],
  ["types", pkg.types],
  ["react-native", pkg["react-native"]],
  ...Object.entries(pkg.exports?.["."] ?? {}).map(([k, v]) => [`exports["."].${k}`, v]),
];
for (const [field, value] of entries) {
  if (!value) { fail(`${field} is not set`); continue; }
  const path = value.replace(/^\.\//, "");
  if (!existsSync(path)) fail(`${field} -> ${value} does not exist (run \`npm run build\`)`);
  if (/^(\.\/)?src\//.test(value)) fail(`${field} -> ${value} points at unbuilt source`);
}

// ── The three build outputs are all present and non-trivial ─────────────────
for (const [label, path] of [
  ["CommonJS", "lib/commonjs/index.js"],
  ["ESM", "lib/module/index.js"],
  ["declarations", "lib/typescript/index.d.ts"],
]) {
  if (!existsSync(path)) { fail(`${label} build missing: ${path}`); continue; }
  if (statSync(path).size < 500) fail(`${label} build looks empty: ${path}`);
}
// The format markers that make each directory load as what it claims to be.
for (const [path, expected] of [
  ["lib/commonjs/package.json", "commonjs"],
  ["lib/module/package.json", "module"],
]) {
  if (!existsSync(path)) { fail(`missing format marker: ${path}`); continue; }
  const type = JSON.parse(readFileSync(path, "utf8")).type;
  if (type !== expected) fail(`${path} declares type "${type}", expected "${expected}"`);
}

// ── Declarations must not leak types a consumer has no reason to install ────
// The source compiles against DOM/@types/node for fetch and friends; none of
// that may surface in what a consumer's tsc has to resolve.
const dts = readFileSync("lib/typescript/index.d.ts", "utf8");
for (const leaked of ["NodeJS.", "import(\"node:", "undici"]) {
  if (dts.includes(leaked)) fail(`public declarations reference ${leaked}`);
}

// ── Tarball contents ────────────────────────────────────────────────────────
// --ignore-scripts is load-bearing: `prepack` runs this validator, so a pack
// that honoured scripts would re-enter it forever.
const packed = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
  encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
}));
const files = packed[0].files.map((f) => f.path);
const has = (re) => files.some((f) => re.test(f));

if (!has(/^lib\/commonjs\//)) fail("tarball has no lib/commonjs");
if (!has(/^lib\/module\//)) fail("tarball has no lib/module");
if (!has(/^lib\/typescript\//)) fail("tarball has no lib/typescript");
if (!files.includes("README.md")) fail("tarball has no README.md");
if (!files.includes("LICENSE")) fail("tarball has no LICENSE");
if (has(/^test\//)) fail("tarball contains test/");
if (has(/\.test\.[jt]sx?$/)) fail("tarball contains test files");
if (has(/^docs\//)) fail("tarball contains docs/ — README links are absolute, so this is dead weight");

// ── The bin: `npx annokit server` is the quick start's second step ─────────
for (const [name, target] of Object.entries(pkg.bin ?? {})) {
  if (!files.includes(target)) { fail(`bin ${name} -> ${target} is not in the tarball`); continue; }
  if (!readFileSync(target, "utf8").startsWith("#!/usr/bin/env node\n")) fail(`bin ${name} -> ${target} has no node shebang`);
}
// The unscoped `annokit` shim (shim/cli.mjs) imports this path from the
// installed package, so moving it breaks `npx annokit` outside an app.
if (pkg.bin?.annokit !== "server/cli.mjs") fail(`bin annokit must stay server/cli.mjs: shim/cli.mjs runs it by that path`);
// Zero runtime dependencies covers the server too: every import is a Node
// built-in or a sibling file that ships with it.
for (const file of files.filter((f) => /^server\/.*\.mjs$/.test(f))) {
  for (const m of readFileSync(file, "utf8").matchAll(/^import\b[^;]*?from\s+"([^"]+)"|\bimport\(\s*"([^"]+)"\s*\)/gms)) {
    const spec = m[1] ?? m[2];
    if (spec.startsWith("node:")) continue;
    if (spec.startsWith("./") && files.includes(`server/${spec.slice(2)}`)) continue;
    fail(`${file} imports "${spec}", which is neither a node: built-in nor a shipped sibling`);
  }
}

// A soft ceiling: this package is source and declarations, nothing vendored.
const MAX_UNPACKED_MB = 5;
const unpackedMb = packed[0].unpackedSize / 1_000_000;
if (unpackedMb > MAX_UNPACKED_MB) {
  fail(`unpacked size ${unpackedMb.toFixed(1)} MB exceeds ${MAX_UNPACKED_MB} MB`);
}

// ── README must not point at files the tarball does not carry ───────────────
// npmjs.com rewrites relative links to the repo, but a local install and any
// other registry UI do not, so the README uses absolute URLs throughout.
const readme = readFileSync("README.md", "utf8");
for (const m of readme.matchAll(/(?:\]\(|src=")(?!https?:|#)([^)"]+)/g)) {
  const target = m[1].replace(/^\.\//, "").split("#")[0];
  if (!target || files.includes(target)) continue;
  fail(`README references ${target}, which is not in the tarball (use an absolute URL)`);
}

// ── Report ──────────────────────────────────────────────────────────────────
if (problems.length > 0) {
  console.error(`\n✗ package validation failed (${problems.length}):\n`);
  for (const p of problems) console.error(`  • ${p}`);
  console.error("");
  process.exit(1);
}
console.log(
  `✓ package valid — ${files.length} files, ` +
  `${(packed[0].size / 1000).toFixed(0)} kB packed, ${unpackedMb.toFixed(1)} MB unpacked`,
);
