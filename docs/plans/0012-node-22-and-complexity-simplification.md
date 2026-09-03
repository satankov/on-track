# Node 22 support and complexity simplification plan

## Status

Completed on 2026-09-03 as approved Slices A+B+C+D, including both breaking
compatibility choices.

Local completion evidence on Node 22.18/macOS arm64:

- `npm run verify` passed: release contract, build, typecheck, lint, formatting,
  376 tests passed with 1 intentional skip, 17 migration tests passed, 12 browser
  tests passed with 2 viewport-specific skips, and the high-severity production
  dependency gate passed.
- Native `better-sqlite3` loaded and executed an in-memory query.
- The independent correctness/security review findings were fixed and covered by
  regression tests, including maximum multipart edits, empty-note prevention,
  cross-project mutation races, index DDL tampering, and migration metadata.
- Exact Node 22.13 and Node 24 clean-install/OS evidence is configured in CI and
  remains pending until the branch runs on GitHub Actions.
- The production audit still reports one moderate Fastify advisory; its known
  schema-coercion and `trustProxy` paths are not used here, but dependency
  remediation remains separate release work.

## Goal

Prepare the v0.0.4 alpha to run on supported Node.js 22 and 24 LTS lines while
removing avoidable duplication in note writes, client state synchronization,
attachment delivery, and backup-schema validation. Preserve the product's
local-only boundary, current data model, strict import validation, restore
atomicity, managed-file safety, and native-action guards.

The work is divided into independently approvable slices:

- **Slice A — Node 22.13 support:** support Node 22 from 22.13.0 and Node 24,
  prove both in CI and release verification, and align durable documentation.
- **Slice B — behavior-preserving simplification:** use one multipart note-write
  path and one canonical client refresh path after mutations.
- **Slice C — alpha compatibility cleanup:** remove the unused browser download
  API and reject v0.0.3/schema-2 backup bundles while retaining current-format
  backup restore and crash recovery.
- **Slice D — trusted schema baseline:** derive the current expected active
  schema from a trusted freshly migrated database instead of duplicating it in
  handwritten backup-validation constants.

## Context and reusable precedent

- `package.json` and the lockfile root are the only constraints requiring Node 24. The current locked dependency tree's source-build floor is Node 22.13.0,
  set by ESLint and jsdom; Vite requires Node 22.12.0. `better-sqlite3` declares
  support for Node 22 and 24.
- The current checkout builds, typechecks, passes 366 unit/integration tests and
  12 applicable browser E2E tests, and loads native SQLite on Node 22.18.0 on
  macOS arm64. Clean installation and native loading on all supported operating
  systems remain release requirements.
- `src/client/api.ts` chooses JSON or multipart for note writes. `src/server/app.ts`
  branches again, and `src/server/chat-service.ts` maintains parallel append and
  update use cases. The browser UI is the only supported API client, so one
  multipart contract can replace both paths without preserving an external API.
- `src/client/App.tsx` keeps mutable project summaries and an active project
  detail synchronized after each mutation. Existing selection and mutation
  generations prevent stale responses and provide regression tests that a
  centralized refresh mechanism can reuse.
- Attachment cards use native Open and Show in Folder actions. The browser
  download client, route, and service method remain only for compatibility and
  have no production UI caller.
- `sqlite-backup-bundle.ts` strictly validates imported SQLite schema and data.
  It currently contains parallel schema-2/schema-3 descriptors and a staged
  schema-2 migration. The current checked-in migrations can construct a trusted
  blank schema for comparison; imported schema must never define its own
  validation baseline.
- Shipped migrations are immutable. This plan does not edit, squash, or delete
  them and does not weaken migration or downgrade refusal for live databases.

## Acceptance criteria

### Slice A — Node 22.13 support

1. Package metadata accepts Node 22 from 22.13.0 and Node 24 while excluding
   Node 22.0-22.12, odd-numbered majors, and unknown future majors.
2. The lockfile root and release contract agree with the manifest runtime range.
   The repository's preferred maintainer runtime may remain Node 24, but it must
   not be presented as the only supported runtime.
3. Node runtime types target the oldest supported major so typechecking cannot
   silently authorize Node 24/26-only APIs.
4. CI performs clean locked installation, native SQLite loading, build,
   typecheck, and tests on Node 22.13 and Node 24 across Linux, macOS, and
   Windows. Full Linux verification runs on both supported majors.
5. The release workflow completes its authoritative verification on both Node
   lines before publication.
6. README, CONTRIBUTING, PROJECT, ARCHITECTURE, release guidance, changelog, and
   ADR history consistently state the Node 22.13/24 support policy and Node 22's
   shorter support horizon.

### Slice B — behavior-preserving simplification

7. Browser note creation and editing always submit one bounded multipart
   representation, with or without attachments.
8. The server parses that representation once and calls one append or one update
   service use case. Validation, attachment installation, transactional metadata
   writes, compensation, and cleanup have no JSON/multipart forks.
9. Empty notes, attachment-only notes, timestamps, attachment limits, keep/add/
   remove editing, missing projects/messages, and partial failures retain their
   current observable behavior.
10. Client mutations use one centralized refresh/commit mechanism for project
    summaries and active project detail rather than manually reproducing
    synchronization logic in each handler.
11. Out-of-order selection, focus refresh versus mutation, navigation during a
    pending save, unsaved drafts, active-project identity, project activity
    ordering, labels, attachments, import replacement, and error recovery remain
    correct.
12. UI behavior, accessibility, responsive layouts, and persistent data do not
    change as part of this slice.

### Slice C — alpha compatibility cleanup

13. The client interface, service, and server no longer expose browser attachment
    download. Open and Show in Folder remain scoped, guarded, and unchanged.
14. Current schema-3/v0.0.4 backup export, validation, staging, replacement, and
    interrupted-restore recovery continue to work.
15. Schema-2/v0.0.3 backup bundles are rejected with the existing safe
    unsupported-version response and never partially stage or replace data.
16. Release notes clearly state that v0.0.3 backups cannot be restored by
    v0.0.4. Live-database migrations remain supported and shipped migration
    files remain unchanged.

### Slice D — trusted schema baseline

17. Exact schema validation compares an imported or prepared database with a
    descriptor obtained from a trusted blank database created from checked-in
    current migrations, not with values derived from the untrusted import.
18. Extra/missing tables, columns, indexes, constraints, or foreign keys; altered
    DDL; invalid migration metadata; and malformed application rows continue to
    fail closed.
19. Bundle-only tables keep explicit trusted definitions because they are not
    part of the active migrated schema. Current backup round-trip behavior and
    resource limits remain unchanged.
20. Trusted reference databases are closed deterministically and do not touch
    the user's application-data directory.

## Non-goals

- Background process management, global CLI installation, symbolic hostnames,
  npm-registry publication, native installers, or automatic updates.
- Support for Node 23, Node 25, future untested majors, or Node 22 before 22.13.
- New production dependencies.
- A database schema change, new migration, migration squashing, or removal of
  live-database upgrade and downgrade guards.
- Removing current-format import/restore, the maintenance gate, restore journal,
  staged-upload bounds, attachment path validation, or native-action security.
- Visual redesign, new product behavior, or file splitting that merely moves
  existing complexity.

## Proposed design

### Runtime support

Use an explicit engine range equivalent to Node 22.13-22.x or Node 24.x, rather
than an unbounded `>=22.13`. Align `@types/node` to the Node 22 major. Extend the
release contract so manifest and lockfile engine ranges cannot drift and so the
preferred `.nvmrc` line is deliberate. Make CI/release Node versions explicit;
test the exact minimum rather than a floating `22` alias.

Record the change in a new ADR that supersedes only ADR-0003's Node-24-only
runtime choice. Source distribution and the tag-gated release pipeline remain
unchanged.

### Unified note writes

Make `FormData` the sole browser note-write transport. Keep the existing bounded
Fastify multipart parser and normalize its output to a service command containing
trimmed body, optional timestamp, kept attachment IDs, and zero or more new
attachments. Retain separate append and update operations because their domain
semantics differ, but remove their attachment/no-attachment variants.

The service validates the normalized command once, installs new attachment bytes
before the database reference, compensates installed files on database failure,
and cleans removed files only after the repository transaction commits. The
repository transaction boundary does not change.

### Canonical client refresh

Introduce one canonical workspace server-state value for the project list and
active project detail, plus a shared commit helper that updates the active detail
and matching summary atomically. Mutation handlers preserve or clear local
draft/editor state according to current behavior and commit through that helper
instead of independently patching `chats` and `active`. This keeps the existing
single-request mutation behavior without adding a second network round trip.

Keep purely local UI state local: draft text, pending files, editor state, active
filter, theme, copy feedback, and navigation mode. A reducer or external server-
state dependency is not proposed; local refetch cost is negligible and adding a
state library would replace visible duplication with dependency complexity.

### Compatibility cleanup

Delete the unused attachment-download method from the API interface and client,
the GET route and content-disposition helper from Fastify, and the service byte-
read method. Keep attachment metadata refresh in project reads and native actions.

Delete schema-2 descriptors and migration branches from backup validation.
Detecting any non-current exact schema results in the same generic unsupported or
invalid backup error. Keep the existing current bundle format and current schema
version unchanged; no database migration is generated.

### Trusted current-schema descriptor

Create an in-memory SQLite database, apply the checked-in bundled migrations,
and introspect its non-internal schema objects, columns, foreign keys, indexes,
and normalized table definitions into an immutable descriptor. Use that trusted
descriptor for current active and bundle validation, merging only the explicit
bundle-table descriptor for the latter. Cache it per process if profiling shows
the validation setup is material; correctness and deterministic close behavior
take priority over premature caching.

The reference builder accepts no imported paths, SQL, or data. Tests mutate one
schema dimension at a time to prove that introspection does not weaken exact
validation.

## Affected surfaces

- Runtime/release: `package.json`, `package-lock.json`, `.nvmrc`,
  `.github/workflows/ci.yml`, `.github/workflows/release.yml`,
  `scripts/release-check.mjs`, `scripts/release-contract.mjs`, and contract tests.
- Durable documentation: `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`,
  `docs/PROJECT.md`, `docs/ARCHITECTURE.md`, `docs/RELEASING.md`, ADR-0003 status
  linkage, one new ADR, and this plan.
- Note transport/service: `src/client/api.ts`, `src/server/app.ts`,
  `src/server/chat-service.ts`, related client/service/API tests, and potentially
  shared normalized-command types in `src/domain` if reuse justifies them.
- Client state: `src/client/App.tsx`, `src/client/App.test.tsx`, and E2E tests only
  where an observable regression guarantee is missing.
- Attachment download cleanup: client API, service, Fastify app, tests, and stale
  architecture/plan references. Historical completed plans remain historical
  unless a statement is incorrectly presented as current truth.
- Backup validation: `src/server/database-transfer/sqlite-backup-bundle.ts` and
  its focused tests. Restore-journal, staged-upload, maintenance-gate, and shipped
  migration files remain untouched unless tests expose a necessary integration
  adjustment.

## Data and migration impact

- Slices A and B have no stored-data or migration impact.
- Slice C intentionally removes the ability to restore v0.0.3/schema-2 backup
  bundles and removes an unused HTTP download capability. It does not delete or
  rewrite an existing live database. Current startup migrations still upgrade a
  v0.0.3 live database to schema 3.
- Slice D changes validation implementation, not the accepted current schema.
- No user database, backup, attachment, or default application-data directory is
  used during implementation or verification; all fixtures remain disposable.
- Rollback is code-level for Slices A, B, and D. Rolling back Slice C restores
  compatibility only by reinstalling code that still supports the old backup;
  no current data conversion is required.

## Phases

1. **Node contract RED/GREEN.** Add failing release-contract tests for the exact
   engine range and metadata drift, then update runtime metadata, runtime types,
   CI/release matrices, ADR, and documentation. Evidence: focused contract tests,
   clean Node 22.13/24 installs, native SQLite smoke, and relevant CI-equivalent
   commands.
2. **Unified note-write RED/GREEN.** Add or adapt API and service tests so body-
   only and attachment note writes require the same normalized path. Convert the
   client and route, consolidate service methods, and preserve compensation
   ordering. Evidence: focused API-client, Fastify, service, repository, and
   attachment-store tests.
3. **Canonical client refresh RED/GREEN.** Strengthen tests around stale selection,
   focus/mutation races, drafts, pending navigation, import, and activity sorting;
   demonstrate the intended failure when manual synchronization is removed; then
   introduce the shared refresh/commit path and simplify handlers incrementally.
   Evidence: focused App tests plus critical desktop/mobile E2E journeys.
4. **Compatibility cleanup RED/GREEN.** Change tests to require absence of the
   download API and rejection of exact schema-2 bundles; remove the obsolete
   surfaces and legacy descriptors. Evidence: client/service/API searches and
   tests, current backup round trip, invalid/legacy rejection, and native Open/
   Show tests.
5. **Trusted-schema RED/GREEN.** Add tampering tests for each descriptor dimension,
   introduce the trusted migrated reference builder, replace handwritten active-
   schema constants, and retain explicit bundle-table validation. Evidence:
   focused backup tests, migration tests, current backup restore, and recovery
   integration tests.
6. **Security review and verification.** Review multipart input-to-filesystem/SQL,
   imported SQLite-to-validation/staging, and native-action boundaries. Run build,
   typecheck, lint, format check, coverage, migrations, desktop/mobile E2E,
   dependency audit, release checks on both supported Node lines, full diff review,
   and repository-status inspection.

## Test plan

- Release contract: accept the exact supported LTS range; reject a stale lockfile
  range, unsupported minimum, or accidental future-major range.
- Node portability: clean locked install and native SQLite query on Linux, macOS,
  and Windows under Node 22.13 and 24; full Linux `npm run verify` under both.
- Note writes: body-only, timestamped, attachment-only, body plus attachments,
  maximum count/size, malformed fields, keep/add/remove, missing scoped records,
  installation failure, transaction failure, and post-commit cleanup failure.
- Client state: out-of-order project requests, focus refresh racing a mutation,
  switching projects during requests, draft preservation on failure, navigation
  lock while saving, create/update/delete/import activity ordering, label changes,
  and attachment metadata refresh.
- Removed download: compile-time interface absence and route-level 404; existing
  Open/Show capability and security tests remain green.
- Backup: current export/validate/prepare/restore round trip; exact schema-2 and
  unknown schemas rejected; malformed application ID/manifest/data rejected;
  extra/missing/changed schema objects rejected; attachment count, size, hash,
  path, inventory, and interrupted-replacement guarantees remain green.
- Coverage: retain the repository's enforced 80% thresholds without padding.

## Risks and mitigations

- **Native addon variability:** a locally working Node 22 binary does not prove
  clean cross-platform installation. Mitigation: exact-minimum install and SQLite
  smoke on every supported OS before release.
- **Unsupported runtime drift:** broad semver ranges or Node 26 types could mask
  incompatible APIs. Mitigation: explicit 22/24 range, Node 22 types, release-
  contract checks, and dual-runtime CI.
- **Multipart regressions:** consolidating routes can change empty-string,
  timestamp, or keep-list semantics. Mitigation: behavioral tests precede code
  and repository transactions/cleanup ordering remain unchanged.
- **Client race regressions:** refetching can overwrite drafts or active selection.
  Mitigation: central generation/identity checks and existing race tests are
  strengthened before handler simplification.
- **Lost browser fallback:** removing download leaves Open/Show as the only file
  actions. Mitigation: make this an explicit alpha product decision and retain
  focused native-action tests; Windows/Linux manual smoke remains a release risk.
- **Old backup rejection:** users with a v0.0.3 bundle cannot restore it in
  v0.0.4. Mitigation: explicit changelog/README warning and retention of live-
  database migration. This risk is accepted only under the stated no-user alpha
  assumption.
- **Validation weakening:** generated expectations could become circular or trust
  imported SQL. Mitigation: construct only from checked-in migrations in an
  isolated in-memory database and retain independent tampering/data tests.

## Decisions resolved at approval

1. Remove browser attachment download before Windows and Linux native actions
   have been manually smoke-tested; retain that manual-smoke limitation in
   release documentation.
2. Deliberately remove v0.0.3/schema-2 backup restore support under the no-user
   alpha assumption; retain live-database migration.
3. Implement all four slices before v0.0.4.

## Approval record

The project owner approved **A+B+C+D** on 2026-09-03.
