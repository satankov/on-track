# ADR-0001: Localhost TypeScript application with SQLite

## Status

Accepted for the first vertical slice.

## Context

On Track must present a normal browser UI while keeping project data on the
user's machine. The first slice needs to validate product behavior quickly but
must leave credible paths to attachments, encrypted storage, desktop packaging,
and an independent iPhone replica.

The repository has no existing runtime or code to preserve. Current primary
documentation confirms that Vite supports React/TypeScript, Fastify can bind
explicitly to the loopback interface and provides schema validation, Drizzle
supports `better-sqlite3` with generated migrations, and SQLite is suitable when
one local application process owns the database.

## Decision

Build one TypeScript codebase with:

- React and Vite for the browser UI;
- Fastify for a same-origin local JSON API bound to `127.0.0.1`;
- `better-sqlite3` behind repository interfaces;
- Drizzle schema definitions and checked-in SQL migrations;
- Zod schemas shared across the transport boundary;
- Vitest/Testing Library for unit and component tests and Playwright for the
  critical browser journey.

The local server is the only database owner. Browser code cannot access database
paths or submit raw SQL. Domain and repository interfaces remain independent of
Fastify so a future desktop shell can reuse or replace the transport.

## Alternatives considered

- Tauri 2 + Rust + SQLite: stronger native security/capability boundaries and a
  potential iOS path, but it is not a literal browser application and adds Rust,
  IPC, native packaging, and platform E2E complexity before product fit is proven.
- Electron: mature JavaScript desktop packaging, but heavy and offers no useful
  iPhone reuse path.
- Browser-only PWA with SQLite WASM/OPFS: avoids a local process but weakens
  database ownership, backup/recovery, storage eviction behavior, and native
  encryption options—especially on iOS.
- Hono instead of Fastify: healthy and portable, but portability adds little once
  a native Node SQLite driver is required; Fastify's validation lifecycle and
  mature local server controls better fit this slice.
- Node's built-in `node:sqlite`: reduces dependencies but remains release-candidate
  stability and has no documented custom SQLite/codec build seam. `better-sqlite3`
  supports custom SQLite builds and online backup.

## Consequences

- Development stays in one language and the product works in a normal browser.
- The user starts a trusted local process before opening the UI.
- A loopback HTTP service creates Host/Origin, CSRF, port, and lifecycle concerns
  that a native IPC shell would avoid; controls and tests are required.
- The native SQLite driver must be verified on supported Node/OS combinations.
- A later desktop/mobile client will reuse contracts and data semantics, not the
  Node runtime itself.

## Verification

- API integration tests prove loopback-oriented Host/Origin controls, validation,
  persistence, foreign keys, and transactional writes.
- Playwright proves the browser journey against a migrated temporary database.
- Build and dependency checks verify the native driver on the development OS.

## Sources

- [Vite guide](https://vite.dev/guide/)
- [Fastify validation](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)
- [Fastify server/listen behavior](https://fastify.dev/docs/latest/Reference/Server/)
- [Drizzle SQLite drivers](https://orm.drizzle.team/docs/sqlite/get-started-sqlite)
- [Drizzle migrations](https://orm.drizzle.team/docs/migrations)
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- [When to use SQLite](https://www.sqlite.org/whentouse.html)
