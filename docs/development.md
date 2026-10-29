# Development

Node **22.12 or newer** to develop — vitest requires `^22.12 || ^24 || >=26`,
and CI runs 22, 24 and 26, the supported LTS lines. That is stricter than
`engines.node` (`>=18`), which is the CONSUMER claim: the published JavaScript
targets ES2020 and touches no Node API, so an app on Node 18 can install and
bundle it fine. npm is the package manager (pinned in `packageManager`), with a committed
`package-lock.json` so a checkout installs what CI installs:

```bash
npm ci          # exact, from the lockfile
npm run check   # tsc --noEmit
npm test        # vitest, no network, no RN tree
npm run build   # lib/{typescript,commonjs,module}
npm run validate:package   # what prepack enforces before a publish
npm run verify:consumer    # packs, installs elsewhere, typechecks against it
npm run verify:starter -- --examples   # the tarball in both examples: bundles, serves
npm run verify:starter -- --fresh      # the same from today's scaffolds
npm run examples:local     # run this checkout in the examples instead of the release
```

`npm run verify:consumer` is the one worth running before a release: it
installs the real tarball into a throwaway project with nothing of this
repository on the resolution path, then typechecks a consumer against it
under both `bundler` and `node16` module resolution.

`npm run verify:starter` asks whether the setup instructions work, and is
run locally rather than in CI. With `--examples` it installs the tarball
into both examples and bundles each for iOS and Android with Metro, then
starts `npx annokit server` from each: run it before a release, since it is
the only check that loads the package under Metro. With `--fresh` it first
makes new apps with `create-expo-app@latest` and the React Native CLI and
applies the quick start: run it after a new Expo SDK or React Native
release, which is when the instructions break.

`skills/annokit-setup/SKILL.md` is the same quick start written for a
coding agent, installed with `npx skills add`. Nothing tests it, so change
it whenever the README's quick start changes, and now and then point an
agent at a fresh `create-expo-app` with only the skill to check it still
works. `npx skills add . --list` from the repository root checks it is
discoverable.

The examples install the package from npm, as any app does. To try an
unreleased change in one, `npm run examples:local` packs this checkout and
installs it over the release with `--no-save`; see the
[examples guide](../examples/README.md#trying-an-unreleased-change).

## Tests

`npm test` (vitest, node environment) covers the logic that does not need a
device: config resolution, the protocol handshake, the inspector adapter
(driven by real device payloads recorded on Expo SDK 57 / RN 0.86 / Fabric —
`test/fixtures/spike-payloads.ts` for the Expo Go hit-test spike and
`test/fixtures/devclient-payloads.ts` for the iOS dev-client run), Metro
symbolication parsing, scroll-offset measurement and its degradation paths,
the annotation payload contract and Output Detail trimming, the attach
panel, threads and the shared poll cadence (`src/poll.ts`), comments and the
per-message task bridge, marker appearance and tap priority, the
per-platform screenshot upload, the transport against real loopback HTTP
servers, and the aim-highlight geometry (`src/aim.ts`).

Nothing renders the React Native tree. Where a rule lives in a component,
it is enforced at the source instead (`test/accessibility.test.ts`,
`test/tree-stability.test.ts`); mounted component tests are still owed —
see the [release audit](./audit/README.md). `npm run test:watch` for the
watch loop, `npm run check` for types.

## Icons

One call site (`<AnnoKitIcon name="delete" …/>`, `src/icon.tsx`), two
renderings, chosen at load: Lucide when `react-native-svg` resolves AND its
native views are actually registered in the running app, the text glyph
otherwise. The native check matters — a dev client built before the
dependency was added imports the JS half happily and then renders every icon
as a red *unimplemented component* box, which is a worse failure than the
glyph it replaced.

Two rules hold the set together, and both are tested: every semantic name
has BOTH a Lucide path and a glyph (`test/icon-set.test.ts`), and no glyph is
a colour emoji (`test/icons.test.ts` scans the source). What a test cannot
see is a glyph the device has no font for, which renders as an empty box —
so when adding one, look at it on a device: open the toolbar (pencil/cancel,
list, message, chevron), a queue row (check, ×), and a task detail (trash,
chevron, and the agent mark in the thread). That is every icon in the set.

## Releasing

Merging a pull request is the release. A PR that changes the published
package raises the version in the same PR:

```bash
npm run bump patch    # or minor, major, or an exact X.Y.Z
```

That sets the version in all three places it lives: `package.json`,
`package-lock.json` and `PACKAGE_VERSION` in `src/env.ts`. Commit the result
with the change.

- **The Version check fails a PR that forgets.** It counts `src/`,
  `server/` (the `annokit` bin) and the published fields of
  `package.json`. Docs, tests, examples and CI need no bump. For a change to
  shipped files that can wait for the next release (a comment, say), add the
  `no release` label.
- **Merging publishes.** On `main`, the Release workflow sees a version npm
  does not have, re-runs every gate on the merged commit, publishes with
  provenance through npm Trusted Publishing (no token), and creates the
  `vX.Y.Z` tag and a GitHub release with notes from the merged PRs.
- **A push with an already-published version publishes nothing**, unless it
  changed the package, which fails the run. That catches two PRs that bumped
  to the same version: bump again in a new PR.
- **A failed release** is retried by re-running the failed jobs of its run.
  Running the workflow by hand is a dry run of the gates and never
  publishes.

`README.md` is in the tarball too, so README changes reach the npm page
with the next release.

### The `annokit` shim

`shim/` is the unscoped `annokit` package on npm. It holds the name the
docs tell people to run, so `npx annokit` outside an app reaches us and not
whoever registers it. Inside an app with `@joinearlybird/annokit`
installed, npx runs that install's bin and never downloads the shim.
Elsewhere, the shim runs the `@joinearlybird/annokit` that resolves from
the current directory, or prints how to install it. It has no dependencies,
because npx would install the package's `react` and `react-native` peers
just to start a server.

It changes only when the bin's path or the install instructions do, and is
published by hand, outside the Release workflow:

```bash
cd shim && npm version patch --no-git-tag-version && npm publish
```

## Release audit

The pre-release review is tracked in three actionable checklists covering
[security and privacy](./audit/high-priority-security-privacy.md),
[performance and correctness](./audit/performance-correctness.md), and
[open-source release readiness](./audit/open-source-readiness.md). Start at
the [audit index](./audit/README.md) for scope, priorities, and the pinned
baseline.
