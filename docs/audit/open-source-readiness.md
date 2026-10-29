# Open-source engineering gaps and release readiness

Audit date: 2026-08-19

Audit baseline: `6a066f4ef7a915650499a0426cd94b5513934fb7`

This document tracks the work required to publish and maintain the repository
as a dependable public package. It covers licensing, package contents,
compatibility, automation, testing, governance, and release operations.

## Suggested order of work

Assign an owner and target milestone before moving an item into progress. The
order matters: packaging must exist before CI can validate packed consumer
installs. Licensing is no longer a gate — see the provenance finding below for
why the original P0 was withdrawn.

| Order | Workstream | Owner | Target | Depends on |
|---|---|---|---|---|
| 1 | Provenance record and positioning | Unassigned | Before 1.0 | — |
| 2 | Registry-ready build and package contents | **done 2026-09-17** | — | — |
| 3 | Compatibility contract and reproducible installs | Unassigned | Before public release | Package format |
| 4 | Packed consumer/native integration fixtures | **Metro level done 2026-10-28**; native builds open | Before public release | Build + compatibility |
| 5 | CI and release gates | **done 2026-09-18** (lint pending) | — | — |
| 6 | Governance and long-term release policy | Unassigned | Before 1.0 | Support ownership |

## P2 — Record provenance and keep compat-mode positioning clear

Audit correction, 2026-09-17. The original finding at baseline `6a066f4` opened
this as a P0 on the premise that "the project is described as replicating and
extending Agentation for React Native." That description has no source in the
repository. `git log --all -S"replicating and extending"` returns exactly one
commit — `6a066f4`, this audit's own commit. The phrase never appeared in the
README, the source, or any other document, so the finding cited its own
assertion as evidence. The licensing blocker is withdrawn on the evidence
below; what remains is documentation hygiene.

Current state:

- This repository declares the MIT License, copyright Feliz Labs, with one
  third-party notice: Lucide icon paths in `src/icon-set.ts` under ISC.
- `src/agentation.ts` is an OUTBOUND COMPAT ADAPTER, not adapted source. Its
  header records five wire deltas — server-assigned annotation IDs,
  non-deduped sessions, absent upload routes, differing field spellings, and
  the missing `protocolVersion` that serves as flavor detection — each
  obtained by probing `agentation-mcp@1.2.0` as a black box and recording its
  responses.
- The test suite preserves that methodology as evidence. `test/handshake.test.ts:64`
  notes "Verified live: agentation-mcp@1.2.0 answers {"status":"ok","mode":"local"}",
  and detection keys off the ABSENCE of a field rather than any upstream
  constant.
- The dependency direction is the reverse of derivation: AnnoKit Protocol v1
  is this package's native path, and agentation compat is a degraded mode that
  disables screenshots and attachments to fit a server with no upload routes.

Writing an independent client that speaks another project's wire protocol is a
different question from adapting that project's code. The evidence in this
repository supports the former. No Agentation notice is owed in LICENSE
because no Agentation material is present.

Work:

- [x] Verify the compat adapter against a live server. (Done 2026-09-23
      against agentation-mcp@1.3.2 — a MINOR version ahead of the 1.2.0 the
      wire facts were probed from. Flavor detection, session registration
      and the server-assigned-id re-keying all held. 2026-10-29: an
      annotation created on the simulator through compat mode reached its
      pending list.)
- [ ] Preserve the wire-recon record (`docs/agentation-mcp-wire-recon.md`,
      platform repo) as durable provenance evidence for the compat adapter,
      or copy it into this repository.
- [x] State in the README that agentation compatibility is interoperability,
      not affiliation or endorsement. (README, "Agentation": inspired by it, not
      a port or a clone, and no shared code.)
- [ ] Keep the Lucide ISC notice accurate as the icon set changes.
- [ ] Re-open as a licensing question ONLY if Agentation source, copy, visual
      assets, or documentation are later adapted into this repository.

Relevant files: `LICENSE`, `README.md`, `src/agentation.ts`, `test/handshake.test.ts`.

Definition of done: provenance for the compat adapter is documented where
future contributors will find it, and the README states the non-affiliation.

## P0 — Build and validate a registry-ready package

**Status: done, 2026-09-17**, except the native fixture apps noted below.

Built with `tsc` alone — three passes over `tsconfig.build.json`, no new
dependency. `react-native-builder-bob` is the ecosystem default and would
have been correct, but this package has zero runtime dependencies as a
matter of design, and the dual-format plumbing is ~40 lines we can read.

What ships and why:

- `lib/typescript` (declarations), `lib/commonjs`, `lib/module`. Each build
  directory carries a `package.json` declaring its own `type`, which is what
  makes the same `.js` extension load as CJS in one and ESM in the other.
- `exports` orders `types`, `react-native`, `import`, `require`, `default`.
  `react-native` and `main`/`module` are kept alongside it for Metro versions
  that predate `exports`.
- `src` and both map kinds are published ON PURPOSE. This overlay only runs
  under `__DEV__`, so a consumer hitting a stack trace should land on the
  real commented source rather than generated output. It costs ~3.3 MB
  unpacked and nothing at runtime, since nothing imports `src`.
- The emitted ESM keeps extensionless relative specifiers. Metro and every
  bundler resolve them; strict Node ESM does not — and cannot load this
  package regardless, because `react-native` ships Flow syntax. Recorded
  rather than worked around.

Two scripts hold the line, and `prepack` runs the first so a broken tarball
cannot be published by accident:

- `npm run validate:package` — entry points exist and none lead back into
  `src`, both format markers are right, declarations leak no Node/DOM types,
  the tarball carries `lib` and omits `test/`, size is under ceiling, and no
  README link points at a file the tarball does not have.
- `npm run verify:consumer` — packs, installs into a throwaway project with
  nothing of this repository on the resolution path, and typechecks a
  consumer under both `bundler` and `node16` resolution, asserting each
  export condition lands on a file that exists.

Work:

- [x] Choose and configure a React Native library build tool.
- [x] Emit Metro-compatible JavaScript and `.d.ts` declarations.
- [x] Define `main`, `module`, `types`, `react-native`, and `exports` conditions
      intentionally for supported consumers.
- [x] Add `clean`, `build`, `prepack`, and package-validation scripts.
- [x] Keep source maps and source files only when intentionally supported.
- [x] Include `docs/` and media in the tarball, or replace relative README
      references with durable repository-hosted links. (Rewritten to absolute
      GitHub URLs; the validator fails the build if a relative one returns.)
- [ ] Install the generated tarball into clean Expo and bare React Native
      fixture apps and build them. (`verify:consumer` covers install,
      resolution and typecheck. `verify:starter`, run locally, installs the
      tarball into both examples (now plain scaffolds) and into fresh
      `create-expo-app` / RN CLI apps, and bundles each for iOS and
      Android. A native prebuild/Gradle/Xcode run still needs a toolchain
      in CI, so this stays open.)
- [x] Verify ESM/CJS interop and TypeScript resolution with package-focused
      tooling.
- [x] Check tarball contents and unpacked size in CI. (Enforced by
      `validate:package`; wiring it to a CI trigger is the CI workstream.)

Relevant files: `package.json`, `tsconfig.build.json`, `scripts/validate-package.mjs`,
`scripts/verify-consumer.mjs`, `README.md`.

Definition of done: a clean consumer can install the packed tarball, typecheck,
bundle, and run without importing unbuilt repository internals or following
broken documentation links.

## P1 — Declare a truthful compatibility contract

**Partly done, 2026-09-17.** The floors are derived rather than guessed, and
the reasoning is the point:

- `react >=18.0.0` — `useSyncExternalStore` is used directly in `src/`, and
  React 18.0 is the first version that has it.
- `react-native >=0.69.0` — 0.69 was the first release to ship React 18, so
  the line above sets this one. It is DERIVED, not tested: only the current
  pair (RN 0.86.2 / React 19.2.3) is exercised. Testing the declared minimum
  is the open matrix item below.
- `react-native-view-shot` moved from a required peer to an optional one.
  `src/screenshot.ts` already resolved it through a guarded require and
  capability-checked `captureScreen` and `releaseCapture` independently, so
  declaring it required was never true. Moving it revealed that the test
  suite had been relying on npm auto-installing it; it is now an explicit
  devDependency, which is what it always was in substance.
- The four optional peers keep `*` DELIBERATELY. Each is reached through a
  guarded require with per-function capability checks, so a version missing
  a function degrades rather than breaks. A narrow range here would produce
  false peer warnings for no protection. This is a reasoned `*`, not an
  unset one.


Current state:

- Every peer dependency uses `*`.
- The implementation requires React APIs introduced in React 18.
- Layout styles and native integrations imply minimum React Native and Expo
  capabilities, but no supported ranges are stated.
- Development validation is concentrated on React 19.2 and React Native 0.86.
- Optional integrations are tested mainly as Node module-load fallbacks, not
  through consumer Metro builds.

Work:

- [x] Set a minimum React version of at least the first version providing every
      API used by the package.
- [x] Determine and document the minimum supported React Native version.
- [ ] Set tested ranges for `expo-router`, `expo-sensors`,
      `react-native-view-shot`, and `react-native-svg`.
- [x] Decide whether screenshot support is required or optional and make
      `peerDependenciesMeta` and README wording agree.
- [ ] Add a compatibility matrix for Expo managed, Expo dev client, bare React
      Native, and react-native-web.
- [ ] Test at least the minimum and current supported combinations.
- [x] Add Node/package-manager engine constraints where needed.

Relevant files: `package.json`, `README.md`, optional-peer integration modules.

Definition of done: package managers reject clearly unsupported combinations,
and every advertised combination is exercised by automation or a documented
manual release check.

## P1 — Add continuous integration and release gates

**Mostly done, 2026-09-18.** `.github/workflows/ci.yml` runs on every pull
request and push to `main`; `.github/workflows/release.yml` publishes from a
tag. Two items stay open and are named below rather than quietly ticked.

`ci.yml` is split by what each job proves:

- **check** — `npm ci`, `npm run check`, `npm test`, across Node 22, 24 and
  26. The matrix floor is vitest's (`^22.12 || ^24 || >=26`), not the package's;
  `engines.node >=18` is the looser consumer claim and is deliberately
  different, because the emitted JavaScript targets ES2020 and touches no
  Node API.
- **package** — `build`, `validate:package`, `verify:consumer`, a Metro
  bundle proving the package RESOLVES under React Native's bundler (the
  one thing no other check covers, and the cause of both times the
  examples stopped booting), then asserts the build left no tracked file
  modified. A build that dirties the tree
  means the published artifact and the repository disagree.
- **supply-chain** — `npm audit --audit-level=high`; an assertion that
  `dependencies` is still empty, because "zero runtime dependencies" is this
  package's central claim and is one careless `npm i` away from being false;
  a check that LICENSE keeps its Lucide ISC notice for as long as
  `src/icon-set.ts` carries Lucide paths; and a refusal of tracked
  credential-shaped files.

Merging to main is the release. `npm run bump` sets the three version
literals together (`version` in package.json, the lockfile, and
`PACKAGE_VERSION` in src/env.ts, which `test/env.test.ts` holds to the
manifest), and `version.yml` fails a pull request that changes shipped files
without raising the version. On main, `release.yml` publishes a version the
registry does not have after re-running the full CI gate set on the merged
commit, rather than trusting a green tick from another commit, and then tags
it. It publishes with `--provenance` under OIDC (`id-token: write`), so npm
can attest which workflow and commit produced the tarball.

Work:

- [x] Run typecheck and tests on every pull request.
- [ ] Add lint and formatting checks. (No linter exists yet — see the
      linting workstream. CI has nothing to run until it does.)
- [x] Run dependency and secret scanning. (`npm audit` and a tracked-file
      check. GitHub's own secret scanning and push protection are repository
      SETTINGS and cannot be enabled from a workflow — someone with admin
      rights must turn them on.)
- [x] Build and validate the npm tarball.
- [x] Install the tarball into clean fixture consumers.
- [x] Add a supported-version test matrix where cost is reasonable. (Node
      20/22/24. A React Native / React matrix is NOT covered: the unit tests
      stub the RN surface, so a matrix there would prove little without the
      native fixture apps that remain open under the P0 build item.)
- [x] Add license/provenance checks for bundled third-party material.
- [x] Require the release workflow to start from a clean, verified commit.
      (Main, after the gates re-run on it; the tag is created by the release,
      not trusted by it.)
- [x] Publish with npm provenance and least-privilege automation credentials.
      (npm Trusted Publishing: no stored npm token; the package trusts only
      release.yml in the `npm-publish` environment, which is limited to
      `main`.)
- [x] Add a release checklist covering version literals such as
      `PACKAGE_VERSION`.

Two things a workflow cannot do for itself, and which someone with
repository admin must do before the first publish: enable secret scanning
with push protection, and create the `npm-publish` environment limited to
`main`. The very first version is published by hand with 2FA, because a
trusted publisher is configured on a package that already exists; every
release after that comes from the workflow.

Definition of done: an unbuilt, untested, improperly licensed, or malformed
package cannot be published through the normal project workflow.

## P1 — Make development reproducible

Current state:

- README development commands use pnpm.
- No lockfile is committed.
- `package-lock.json` is ignored.
- No `packageManager` field pins a package manager/version.
- Dependency ranges can therefore resolve differently across contributors and
  CI runs.

Work:

- [x] Select npm, pnpm, or another supported package manager.
- [x] Add `packageManager` to `package.json`.
- [x] Commit that manager's lockfile for contributor and CI reproducibility.
- [x] Update `.gitignore` and README commands to match the decision.
- [ ] Use frozen-lockfile installs in CI.
- [x] Document supported Node versions.

Definition of done: a fresh clone installs the same dependency graph with the
documented single command.

## P1 — Add linting, formatting, and package-quality tooling

Current state: source files contain ESLint suppression comments, but the
repository has no ESLint dependency or configuration. There is no formatter or
package-lint script.

Work:

- [ ] Add a React/React Hooks/TypeScript-aware linter.
- [ ] Enable hooks dependency checks instead of relying on inert comments.
- [ ] Add a formatter and committed configuration.
- [ ] Add package manifest/tarball linting.
- [ ] Run all checks locally through one `check` or `validate` command.
- [ ] Run the same command in CI.

Definition of done: suppression comments correspond to active rules, formatting
is deterministic, and package metadata is automatically validated.

## P1 — Expand tests across actual package and native boundaries

Current state: the pure-logic suite is extensive, but the README accurately
states that tests do not render the React Native tree or touch the network.
There are no mounted component tests, clean consumer fixtures, or automated
device smoke tests.

Work:

- [ ] Add React Native Testing Library tests for provider activation,
      composer, queue, comments, settings, details, and accessibility state.
- [ ] Add integration tests with a local protocol server covering handshake,
      authentication, timeouts, malformed responses, and mutations.
- [x] Add packed-package Expo and bare React Native fixture apps.
      (2026-10-28: the examples, rebuilt from the official scaffolds;
      `npm run verify:starter`.)
- [x] Verify optional peers both installed and absent through Metro builds.
      (The Expo example has all of them, the bare example none but
      view-shot; both are bundled on every PR.)
- [ ] Add iOS and Android smoke-test instructions or automation.
- [ ] Cover react-native-web if it remains supported.
- [ ] Add contract fixtures or scheduled integration tests for supported
      `agentation-mcp` versions so compatibility drift is detected.

Definition of done: tests exercise the same tarball, bundler, component tree,
and major native integrations that consumers receive.

## P2 — Add public project governance and support files

Work:

- [ ] Add `SECURITY.md` with a private vulnerability-reporting channel,
      supported versions, and response expectations.
- [ ] Add `CONTRIBUTING.md` with setup, tests, style, provenance, and pull
      request requirements.
- [ ] Add a code of conduct appropriate for the project/community.
- [ ] Add a changelog or generated release-note policy.
- [ ] Add issue and pull-request templates.
- [ ] Add ownership/maintainer information and a support policy.
- [ ] Add a roadmap or clearly label experimental APIs before 1.0.
- [ ] Add repository topics/keywords and npm keywords for discovery.

Definition of done: users know how to report security problems, request help,
contribute safely, and understand which releases receive fixes.

## P2 — Document release and compatibility policy

Work:

- [ ] Adopt semantic versioning and define what counts as a protocol, API, or
      visual breaking change.
- [ ] State whether the package remains development-only permanently.
- [ ] Document deprecation periods and supported release lines.
- [ ] Define compatibility policy for AnnoKit Protocol and Agentation mode.
- [ ] Document data/privacy behavior and link the security findings checklist.
- [ ] Add a pre-release channel for native compatibility changes.

Definition of done: maintainers and users can predict the impact and support
lifetime of a release.

## Verified baseline from the audit

- 44 test files passed.
- 899 tests passed.
- Strict TypeScript checking passed.
- `npm audit` reported zero known production or development vulnerabilities at
  the time of the audit.
- A common-secret signature scan found no matches in the current tree or the
  37 pre-audit commits inspected. Re-run it before release and record the new
  baseline rather than treating this historical count as a permanent claim.
- `npm pack --dry-run` completed and exposed the documentation/build gaps above.

These results are a useful baseline, not a substitute for CI, provenance
review, native integration testing, or a security assessment of the server.
