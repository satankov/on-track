# ADR-0009: Application-owned examples with independent user copies

## Status

Accepted for the approved Examples slice, 2026-09-16.

## Context

New users need an example of the private project-notebook workflow. Its content
must evolve with the application without overwriting user experiments or adding
sample projects to backups. Archive intentionally remains editable.

## Decision

Keep one simple trip-planning example and its small plain-text attachment in a
server-only TypeScript catalog bundled with the application. Read-only originals
appear in a separate Examples group, outside SQLite and ordinary project APIs.
Stable slugs and content revisions identify them. A strict copy request checks
revision, creates independent managed files and fresh record identities, and
commits all project records in one transaction. It returns the committed ID even
when preparing project detail fails. Never automatically retry ambiguous requests.

Reuse the existing timeline with an explicit read-only context. Reading,
filtering, expansion, and copying text remain available; mutation and native file
actions require a copy. Copies use ordinary project behavior and backups. Settings
General can hide Examples using a default-on browser-local preference, matching
the locality of Appearance preferences.

## Alternatives

- Seed examples as editable database projects: updates would need conflict and
  user-ownership rules, or leave examples stale.
- Seed read-only database projects: adds provenance/schema and backup filtering
  without improving a small app-owned catalog.
- A remote tutorial or template engine: adds runtime network/dependency and
  lifecycle complexity outside the product's offline introduction needs.

## Consequences

Story revisions require no data migration. App updates replace originals and
never synchronize copies. Database restore leaves bundled originals and browser
preferences alone. Copies inherit the current file-before-reference crash limit:
precommit interruption may leave unreferenced new files. A lost response can be
ambiguous, so users check Projects before retrying. Visibility does not follow
backups or different browser origins. Storytelling and broader feature coverage
are deliberately deferred; the first story stays simple.
