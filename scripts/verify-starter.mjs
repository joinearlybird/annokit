/**
 * Starter verification — do the setup instructions still work?
 *
 * `verify:consumer` proves the tarball installs and typechecks. This proves
 * the thing a new user actually does: make an app with the official
 * scaffold, install the package, wrap the root, start the server — and that
 * Metro bundles the result. Each check installs the PACKED TARBALL, so what
 * is tested is what would be published, with nothing of this repository on
 * the resolution path.
 *
 *   node scripts/verify-starter.mjs --examples   # the committed examples
 *   node scripts/verify-starter.mjs --fresh      # today's scaffolds, from scratch
 *
 * The two answer different questions. --examples asks whether THIS change
 * still loads in the apps the README points at: run it before a release.
 * --fresh runs `create-expo-app@latest` and the React Native CLI's `init`,
 * then applies the README's steps; it fails when a new SDK or template
 * breaks the instructions: run it when one ships. Both run locally, not in
 * CI.
 *
 * Native builds are NOT covered: an Xcode or Gradle build needs a toolchain
 * this script has no business assuming. A Metro bundle is the part every
 * React Native consumer shares, and it is where both past breakages of the
 * examples showed up.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { serverAnswers } from "./server-health.mjs";

const root = process.cwd();
const modes = process.argv.slice(2).filter((a) => a === "--examples" || a === "--fresh");
if (modes.length === 0) {
  console.error("usage: node scripts/verify-starter.mjs --examples | --fresh");
  process.exit(1);
}

const PACKAGE = JSON.parse(readFileSync("package.json", "utf8")).name;
/** The optional peers the Expo instructions install. */
const EXPO_PEERS = ["react-native-view-shot", "react-native-svg", "expo-sensors", "expo-paste-input"];

const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, {
    cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15 * 60_000,
    // A CI runner has no TTY, but say it anyway: a prompt here hangs forever.
    env: { ...process.env, CI: "1" },
  });

let failed = false;
async function step(label, fn) {
  try { await fn(); console.log(`  ✓ ${label}`); }
  catch (e) {
    failed = true;
    const detail = String(e.stderr || e.stdout || e.message).trim().split("\n").slice(-8).join("\n    ");
    console.error(`  ✗ ${label}\n    ${detail}`);
  }
}

const scratch = mkdtempSync(join(tmpdir(), "annokit-starter-"));
try {
  console.log("building and packing…");
  run("npm", ["run", "build"], root);
  const tgz = run("npm", ["pack", "--ignore-scripts", "--silent", "--pack-destination", scratch], root)
    .trim().split("\n").pop();
  const tarball = join(scratch, tgz);

  if (modes.includes("--examples")) {
    console.log("\nexamples/expo (committed)");
    const expo = resolve(root, "examples/expo");
    await step("npm ci, then the tarball over the published release", () => {
      run("npm", ["ci", "--no-audit", "--no-fund"], expo);
      run("npm", ["install", "--no-save", "--no-audit", "--no-fund", tarball], expo);
    });
    await expoChecks(expo);

    console.log("\nexamples/bare-react-native (committed)");
    const bare = resolve(root, "examples/bare-react-native");
    await step("npm ci, then the tarball over the published release", () => {
      run("npm", ["ci", "--no-audit", "--no-fund"], bare);
      run("npm", ["install", "--no-save", "--no-audit", "--no-fund", tarball], bare);
    });
    await bareChecks(bare);
  }

  if (modes.includes("--fresh")) {
    console.log("\na new Expo app (create-expo-app@latest)");
    const expo = join(scratch, "starter-expo");
    await step("npx create-expo-app@latest --yes", () => {
      run("npx", ["--yes", "create-expo-app@latest", "starter-expo", "--yes", "--no-install"], scratch);
      run("npm", ["install", "--no-audit", "--no-fund"], expo);
    });
    await step("install the package, and npx expo install its optional peers", () => {
      // The README's `npx expo install` line, split in two: given a tarball
      // path, `expo install` writes `"undefined": "<path>"` into package.json
      // and installs nothing, so the tarball standing in for the registry
      // goes through npm. The peers still get SDK-matched versions.
      run("npm", ["install", "--no-audit", "--no-fund", tarball], expo);
      run("npx", ["expo", "install", ...EXPO_PEERS], expo);
    });
    await step("wrap src/app/_layout.tsx as the README quick start shows", () => {
      // The README's diff, applied to the template's own layout: the import on
      // top, and the provider around everything the layout returns. If the
      // template stops having that shape, the README's diff is wrong too, and
      // this says so.
      const layout = join(expo, "src/app/_layout.tsx");
      if (!existsSync(layout)) throw new Error("no src/app/_layout.tsx — the template moved its routes; update the README");
      const source = readFileSync(layout, "utf8");
      const body = /\n  return \(\n([\s\S]*?)\n  \);\n/.exec(source);
      if (!body) throw new Error("the root layout no longer returns `(…)` the way the README's diff assumes");
      const wrapped = body[1].split("\n").map((line) => `  ${line}`).join("\n");
      writeFileSync(layout, `import { AnnoKitProvider } from '${PACKAGE}';\n` + source.replace(body[0],
        `\n  return (\n    <AnnoKitProvider>\n${wrapped}\n    </AnnoKitProvider>\n  );\n`));
      writeFileSync(join(expo, ".env.local"),
        "EXPO_PUBLIC_ANNOKIT_ENDPOINT=http://localhost:4788\nEXPO_PUBLIC_ANNOKIT_SESSION_ID=dev\n");
    });
    await expoChecks(expo);

    console.log("\na new bare React Native app (@react-native-community/cli init)");
    const bare = join(scratch, "StarterBare");
    await step("npx @react-native-community/cli@latest init", () => {
      run("npx", ["--yes", "@react-native-community/cli@latest", "init", "StarterBare",
        "--skip-git-init", "--install-pods", "false"], scratch);
    });
    await step("npm install the package and react-native-view-shot", () => {
      run("npm", ["install", "--no-audit", "--no-fund", tarball, "react-native-view-shot"], bare);
    });
    await step("wrap App.tsx in the provider, configured by props", () => {
      const app = join(bare, "App.tsx");
      const source = readFileSync(app, "utf8");
      // Rename the template's own component and wrap it, rather than editing
      // inside it: a template change should not break the step that matters.
      if (!/^export default App;$/m.test(source)) throw new Error("App.tsx no longer ends in `export default App;`");
      writeFileSync(app, `import { AnnoKitProvider } from "${PACKAGE}";
${source.replace(/^export default App;$/m, "")}
export default function Root() {
  return (
    <AnnoKitProvider endpoint="http://localhost:4788" sessionId="dev">
      <App />
    </AnnoKitProvider>
  );
}
`);
    });
    await bareChecks(bare);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

if (failed) { console.error("\n✗ starter verification failed\n"); process.exit(1); }
console.log("\n✓ the setup instructions produce an app that bundles and a server that answers\n");

/** Metro bundles it with the package in, for both platforms, and the bin runs from it. */
async function expoChecks(app) {
  for (const platform of ["ios", "android"]) {
    await step(`expo export --platform ${platform} bundles it`, () => {
      run("npx", ["expo", "export", "--platform", platform, "--output-dir", join(scratch, `export-${platform}`)], app);
      assertBundled(join(scratch, `export-${platform}`));
    });
  }
  await step("npx annokit server starts from the app and answers /health", () => serverAnswers(app));
}

async function bareChecks(app) {
  for (const platform of ["ios", "android"]) {
    await step(`react-native bundle --platform ${platform} bundles it`, () => {
      const out = join(scratch, `bare-${platform}.bundle`);
      // The app's own Metro config, with watchman off. This bundles straight
      // after `npm ci` replaced node_modules, and a watchman watch that is
      // already running (on a laptop, rarely in CI) can still serve the old
      // file list: Metro then reports files that are on disk as missing.
      const config = join(scratch, "metro.no-watchman.config.js");
      writeFileSync(config, `const config = require(${JSON.stringify(join(app, "metro.config.js"))});
module.exports = { ...config, projectRoot: ${JSON.stringify(app)}, resolver: { ...config.resolver, useWatchman: false } };
`);
      run("npx", ["react-native", "bundle", "--entry-file", "index.js", "--platform", platform,
        "--dev", "true", "--config", config, "--bundle-output", out], app);
      if (!readFileSync(out, "utf8").includes("AnnoKitProvider")) throw new Error("bundle has no AnnoKitProvider");
    });
  }
  await step("npx annokit server starts from the app and answers /health", () => serverAnswers(app));
}

/** An Expo export is Hermes bytecode, so look for the provider's name in its strings. */
function assertBundled(dir) {
  const files = run("find", [dir, "-name", "*.hbc", "-o", "-name", "*.js"], root).trim().split("\n").filter(Boolean);
  if (!files.some((f) => readFileSync(f).includes("AnnoKitProvider"))) throw new Error("no bundle mentions AnnoKitProvider");
}
