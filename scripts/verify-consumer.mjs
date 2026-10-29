/**
 * Packed-install verification — proves the tarball works from the outside.
 *
 * `validate-package.mjs` inspects what we are about to publish. This does the
 * thing that inspection cannot: builds the real tarball, installs it into a
 * throwaway project with nothing of this repository on the resolution path,
 * and typechecks a consumer against it under BOTH module-resolution modes a
 * React Native app might use — `bundler` (Expo/Metro's default) and `node16`
 * (the strictest, and the one that actually reads the `exports` map).
 *
 * It also asserts each export condition lands where it claims to. A wrong
 * `exports` entry typechecks fine here and fails at runtime in someone's app.
 *
 * Native builds are NOT covered: an Expo prebuild or a bare Gradle/Xcode run
 * needs a toolchain this script has no business assuming. Those belong to the
 * fixture-app workstream in docs/audit/open-source-readiness.md.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { serverAnswers } from "./server-health.mjs";

const root = process.cwd();
const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const dir = mkdtempSync(join(tmpdir(), "annokit-consumer-"));
let failed = false;
const step = (label, fn) => {
  try { fn(); console.log(`  ✓ ${label}`); }
  catch (e) {
    failed = true;
    console.error(`  ✗ ${label}\n    ${String(e.stdout || e.message).trim().split("\n").slice(0, 6).join("\n    ")}`);
  }
};

try {
  console.log("building and packing…");
  run("npm", ["run", "build"], root);
  const tgz = run("npm", ["pack", "--ignore-scripts", "--silent"], root).trim().split("\n").pop();
  const tarball = resolve(root, tgz);

  console.log(`installing into ${dir}`);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "consumer", private: true, version: "1.0.0" }));
  run("npm", ["i", "--no-audit", "--no-fund", "--silent", tarball,
       "react@19.2.3", "react-native@0.86.2", "typescript@~6.0.3", "@types/react@~19.2.2"], dir);

  writeFileSync(join(dir, "app.tsx"), `
import { AnnoKitProvider, AnnoKitTransport, useAnnoKit, resolveTheme } from "${pkg.name}";
export function App({ children }: { children: React.ReactNode }) {
  return <AnnoKitProvider>{children}</AnnoKitProvider>;
}
export const probe = (): void => {
  const t = new AnnoKitTransport(
    { endpoint: "https://x.dev", token: null, sessionId: "s", author: null, envAuthor: null },
  );
  void t.isDisposed; void useAnnoKit; void resolveTheme;
};
`.trim());

  const base = {
    target: "ES2020", lib: ["ES2020", "DOM"], jsx: "react-jsx",
    strict: true, noEmit: true, skipLibCheck: true,
  };
  for (const [mode, module_, resolution] of [
    ["bundler (Expo/Metro)", "esnext", "bundler"],
    ["node16 (reads the exports map)", "node16", "node16"],
  ]) {
    const cfg = join(dir, `tsconfig.${resolution}.json`);
    writeFileSync(cfg, JSON.stringify({
      compilerOptions: { ...base, module: module_, moduleResolution: resolution },
      include: ["app.tsx"],
    }));
    step(`consumer typechecks under ${mode}`, () => run("npx", ["tsc", "-p", cfg], dir));
  }

  const installed = join(dir, "node_modules", pkg.name);
  step("require() resolves to the CommonJS build", () => {
    const got = run("node", ["-e", `process.stdout.write(require.resolve(${JSON.stringify(pkg.name)}))`], dir).trim();
    if (!got.endsWith("lib/commonjs/index.js")) throw new Error(`resolved to ${got}`);
  });
  step("every export condition points at a file that exists", () => {
    const conds = JSON.parse(readFileSync(join(installed, "package.json"), "utf8")).exports["."];
    for (const [cond, rel] of Object.entries(conds)) {
      if (!existsSync(join(installed, rel))) throw new Error(`${cond} -> ${rel} missing from the tarball`);
    }
  });
  step("the installed package carries no test files", () => {
    const stray = run("find", [installed, "-name", "*.test.*"], dir).trim();
    if (stray) throw new Error(stray);
  });

  // THE BIN IS THE QUICK START'S SECOND STEP. `npx annokit server` from the
  // app is all a new user is told to run, so it has to start from an install
  // — no clone, nothing of this repository beside it — and answer /health
  // with the protocol version the client gates on.
  try {
    await serverAnswers(dir);
    console.log("  ✓ npx annokit server starts from the install and answers /health");
  } catch (e) {
    failed = true;
    console.error(`  ✗ npx annokit server starts from the install and answers /health\n    ${e.message}`);
  }

  rmSync(tarball, { force: true });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failed) { console.error("\n✗ consumer verification failed\n"); process.exit(1); }
console.log("\n✓ a clean consumer installs, resolves and typechecks against the tarball\n");
