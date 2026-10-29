# Open-source readiness audit

Audit date: 2026-08-19

Audit baseline: `6a066f4ef7a915650499a0426cd94b5513934fb7`

The findings are split by the kind of work they require:

- [High-priority security and privacy](./high-priority-security-privacy.md) —
  data handling, transport boundaries, credentials, and server obligations.
- [Performance and correctness](./performance-correctness.md) — runtime cost,
  lifecycle isolation, deterministic behavior, and accessibility correctness.
- [Open-source engineering gaps and release readiness](./open-source-readiness.md)
  — licensing, packaging, compatibility, CI, testing, and project governance.

Priority meanings:

- **P0:** a blocker for the first public package release.
- **P1:** should be completed before public release unless an owner records and
  accepts a narrower launch scope.
- **P2:** important hardening or maintainability work that must have an owner
  and target milestone, even if it does not block the first prerelease.

Each finding has one canonical checklist. When work affects more than one
area, the other document links to that checklist rather than restating it.

These are living engineering documents, not a legal opinion or proof of
security. Update the baseline commit, evidence, owner, and completion state as
the repository changes.
