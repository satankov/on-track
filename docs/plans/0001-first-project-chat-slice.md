# First project-chat vertical slice implementation plan

## Goal

Deliver a browser-based local application in which one user can create project
chats, customize their title and accent, append plain-text notes, and recover the
same state after restarting the process.

## Context and reusable precedent

This is a greenfield repository: no application code, tests, migrations, or Git
history exist. The architecture and confidentiality posture are recorded in
[ADR-0001](../adr/0001-localhost-typescript-sqlite.md) and
[ADR-0002](../adr/0002-defer-at-rest-encryption.md).

Relevant maintained precedents include local-first tools such as Anytype and
AppFlowy, but their collaboration/sync complexity is intentionally not copied.
The implementation reuses maintained framework capabilities for routing,
validation, migrations, backup primitives, and testing rather than inventing
them.

## Acceptance criteria

1. Starting with an empty database shows a useful empty state and a keyboard-
   reachable "New project" action.
2. A user can create multiple chats with a trimmed title (1-80 characters) and an
   allowed accent token, select any chat, and see recent activity ordering.
3. A user can later rename a chat and change its accent; both persist after
   navigation and process restart.
4. A user can append a trimmed plain-text note (1-10,000 characters). Multiline
   text is preserved and notes appear exactly once in `(created_at, id)` order.
5. Appending a note and updating chat activity succeed or roll back together.
6. Blank, oversized, malformed, unknown-chat, invalid-accent, Host, and Origin
   input is rejected without partial writes. A recoverable UI error does not erase
   the current note draft.
7. User text renders literally and cannot execute markup or script.
8. State survives closing and reopening all database connections and restarting
   the local server against the same data directory.
9. Foreign-key constraints and schema migrations are verified against disposable
   real SQLite databases.
10. The primary flow is keyboard operable, has semantic names and visible focus,
    works at 390px and 1440px widths and 200% zoom, and respects reduced motion.
11. Runtime assets and requests are same-origin; the server binds to `127.0.0.1`
    and the product has no telemetry or outbound runtime dependency.
12. Behavior-bearing modules reach at least 80% statement/branch/function/line
    coverage without low-value assertions.

## Non-goals

Accounts, collaboration, attachments, labels, filters, search, edit/delete,
Markdown, encryption, backup UI, desktop/mobile packaging, sync, CRDTs, telemetry,
and public deployment.

## Proposed design

- One npm package with `src/client`, `src/server`, `src/shared`, and `src/domain`
  boundaries and checked-in `drizzle/` migrations.
- React renders a two-pane desktop workbench and a list/detail mobile flow.
- A typed API client is the UI's only persistence gateway.
- Fastify validates transport input, restricts Host/Origin, and maps domain errors
  to non-sensitive responses.
- Application services implement create/list/update chat and append/list note.
- Repository interfaces isolate synchronous SQLite details.
- React text nodes preserve plain text safely; no raw HTML or Markdown parser.
- IDs use `crypto.randomUUID()` and timestamps are UTC epoch milliseconds. Tests
  inject ID/time factories for deterministic ordering and collision cases.

### UI direction

A calm, dense project workbench: warm neutral surfaces, strong ink text, restrained
accent tokens, and a narrow colored project thread beside the active history. The
rail prioritizes project name and most recent activity. Empty, loading, error, and
offline/local states are explicit. No decorative imagery or generic landing page
is part of the application.

## Data and migration impact

The initial migration set creates:

- `chats(id, title, accent, created_at, updated_at)` with checks;
- `notes(id, chat_id, body, created_at)` with checks and a foreign key;
- `app_metadata(id, schema_version)` with a single-row constraint;
- indexes for chat activity and deterministic chat-note history.

The data path is platform-specific and overrideable by `ON_TRACK_DATA_DIR`. Tests
always use disposable directories. No shipped migration is edited. Backup/restore
is documented but deferred; therefore the slice is not production-ready for
important data.

## Phases

1. **Scaffold and quality harness.** Add pinned manifests/configuration, the
   client/server entry points, lint/format/type/build/test commands, and an empty
   render/server smoke test. Evidence: focused harness tests and build gates run.
2. **RED: domain and database guarantees.** Add failing tests for validation,
   migrations, constraints, create/update/list, deterministic order, reopen
   persistence, and append/activity rollback. Evidence: failures are caused by
   missing behavior, not setup.
3. **GREEN/REFACTOR: local API.** Implement the minimum domain, repositories,
   application services, migration startup, Host/Origin controls, and routes.
   Evidence: focused domain/database/API tests pass.
4. **RED: user-visible workflow.** Add failing component tests for empty/create,
   select/customize, composer keyboard behavior, literal text, draft-preserving
   errors, and mobile navigation. Evidence: intended UI assertions fail.
5. **GREEN/REFACTOR: product UI.** Implement the accessible responsive workbench
   and connect it to the typed API client. Evidence: component suite passes.
6. **Critical E2E and hardening.** Exercise create/customize/note/restart in a real
   browser at desktop and mobile sizes; verify CSP/no external requests and run a
   security review. Evidence: E2E and security gates pass with no High/Critical
   findings.
7. **Review and verification.** Run the reviewer role, address findings, execute
   every documented verification gate, inspect the full diff/status, and record
   exact evidence below. Stop before commit.

## Test plan

- Unit: title/body/accent validation, error mapping, ordering helpers.
- Database integration: migration from empty, idempotent reopen, constraints,
  foreign keys, CRUD, ordering, transactions/rollback, path isolation.
- API integration: schema errors, missing resources, Host/Origin rejection, and
  successful JSON contracts against a real temporary database.
- Component: empty/loading/error states, create/edit flows, note draft recovery,
  literal rendering, focus movement, and keyboard behavior.
- E2E: the full persisted journey at 1440x900 and 390x844, plus restart/reopen and
  no unexpected outbound request.
- Coverage: 80% minimum across behavior-bearing client/domain/server modules.

## Risks and mitigations

- **Plaintext sensitive data:** show an evaluation warning and make no NDA-safe
  claim; complete the encryption ADR before confidential use.
- **Loopback exposure:** bind to IPv4 loopback, validate Host/Origin, use a strict
  CSP, keep mutation requests JSON-only, and expose no permissive CORS.
- **Native dependency portability:** pin the lockfile and run install/build/E2E on
  every supported OS before release.
- **Lost/corrupt data:** do not call the slice production-ready; add online backup,
  restore, integrity check, and recovery UX next.
- **Future sync rework:** stable IDs, deterministic ordering, narrow repositories,
  and migrations reduce coupling; do not guess at conflict semantics now.
- **Scope creep from chat metaphor:** keep notes plain, personal, and append-only;
  no social chat concepts enter the schema.

## Open decisions

- Select the public repository license before release.
- Approve the future encryption unlock/recovery model before confidential use.

Neither decision blocks this evaluation slice.

## Completion evidence

### TDD evidence

- Domain/database RED: `npm test -- src/domain/validation.test.ts
src/server/db/database.test.ts` failed because the validation and persistence
  modules did not exist. GREEN: 14 focused tests passed after the initial schema,
  migration, constraints, repositories, and transaction were implemented.
- API RED: `npm test -- src/server/app.test.ts` failed because the local API did
  not exist. GREEN: route, validation, error, Host, Origin, and persistence
  contracts passed against disposable SQLite databases.
- UI RED: `npm test -- src/client/App.test.tsx` failed because the workspace did
  not exist. GREEN: create, customize, compose, literal rendering, error recovery,
  ordering, and async race cases pass.
- Hardening RED: dedicated tests reproduced `0644` database permissions, accepted
  future schema/migration versions, coral/amber contrast below 4.5:1, stale
  selection responses, cross-project delayed note insertion, and stale activity
  order. Each test passed after the corresponding fix.

### Review evidence

The independent reviewer reported one High and six Medium/Low findings. The High
database-downgrade risk was addressed with both schema-version and bundled-
migration ceilings. Async UI races, activity sorting, accent contrast, mobile
focus transfer, real process-restart E2E isolation, and API-client coverage were
also addressed and regression tested. No SQL injection, XSS, secret exposure,
plaintext-posture misrepresentation, or file-permission defect remained.

### Verification report

- Build: PASS — `npm run build`.
- Types: PASS — `npm run typecheck`.
- Lint/format: PASS — `npm run lint` and `npm run format:check`.
- Unit/component/integration: PASS — 48 tests in 7 files.
- Coverage: PASS — statements 86.02%, branches 80.55%, functions 83.69%, lines
  88.88%.
- Database: PASS — 8 migration/persistence tests including foreign keys,
  transaction rollback, reopen, `0600` permissions, and downgrade refusal.
- E2E/UI: PASS — 2 isolated Playwright journeys at 1440×900 Chromium and iPhone
  WebKit size, including server process restart, fresh temporary data directories,
  no outbound hosts, and mobile focus restoration.
- Security: PASS — production and full `npm audit` report zero vulnerabilities;
  secret-pattern scan and `git diff --check` are clean.
- Diff/status: reviewed; no commit was created.

Overall: READY for the plaintext evaluation slice.

Remaining risks: backup/restore and corruption recovery are intentionally absent;
the native SQLite dependency is verified only on the current macOS environment;
and confidential/NDA use remains blocked until the encryption/key-recovery ADR is
implemented.
