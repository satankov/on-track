# Managed mutable attachments implementation plan

## Goal

Replace the first SQLite BLOB attachment storage with managed local attachment
files so users can open attachments in native apps, reveal them in the containing
folder, edit them in place, and keep message attachment metadata current without
reattaching files.

## Context and reusable precedent

The current attachment slice stores attachment bytes in `note_attachments.content`
and opens fetched bytes as browser blob URLs. That keeps backup/import simple but
cannot support native mutable editing or "show in folder" because there is no
stable user-visible file path to reveal.

The existing architecture already has a single local Node.js process, a loopback
API, SQLite migrations, owner-only data-directory permissions, database
export/import paths, and security checks for filesystem work. Reuse those
boundaries.

## Acceptance criteria

1. New attachments are copied into a managed attachment directory under the On
   Track data directory, not stored as SQLite BLOBs.
2. SQLite stores attachment metadata plus a repository-owned relative file path,
   never a user-supplied absolute path.
3. Existing BLOB attachments migrate to managed files without losing metadata,
   message ownership, backup/import behavior, or note ordering.
4. Attachment cards expose `Open` and `Show in Folder` actions.
5. `Open` delegates to the OS default application for the managed local file.
6. `Show in Folder` reveals the managed local file in Finder, Explorer, or the
   platform file manager where supported.
7. If the user edits and saves the file in a native app, On Track keeps the same
   attachment record and refreshes byte size and modified timestamp on the next
   read or through an explicit refresh.
8. Missing, moved, or unreadable managed files are shown as recoverable broken
   attachments without crashing the project history.
9. Database export/import continues to create a restorable backup that includes
   managed attachment files, or the limitation is explicitly blocked before
   implementation.
10. Path traversal, symlink replacement, unsafe overwrite, and shell-open command
    injection are covered by tests and security review.

## Non-goals

- Cloud sync, sharing, collaboration, OCR, full document indexing, or attachment
  content previews.
- Encryption or confidential-data claims.
- Watching arbitrary source files outside the managed data directory.

## Proposed design

Use a managed sidecar directory such as
`<ON_TRACK_DATA_DIR>/attachments/<note-id>/<attachment-id>/<safe-filename>`.
Persist only repository-owned relative paths in SQLite. All reads and file
operations resolve paths through a single storage service that rejects traversal,
unexpected absolute paths, and symlink escapes.

Introduce platform-specific OS open/reveal helpers behind one server-side
interface. Prefer structured child-process calls with fixed command arguments,
not shell string construction. The browser UI should call same-origin API routes
such as `POST /api/chats/:chatId/notes/:noteId/attachments/:attachmentId/open`
and `/reveal`.

For metadata freshness, start with a simple refresh-on-read/update strategy:
when listing notes or opening/revealing an attachment, stat the managed file and
update `byte_size`/`updated_at` if it changed. Add file watching only after the
basic lifecycle is correct.

Backup/import must be designed before coding. The likely smallest coherent
option is an On Track export bundle that contains the SQLite database and managed
attachment files, replacing the current raw SQLite-only export for schema
versions that use sidecar attachments.

## Data and migration impact

Add a new migration after `0002_attachment_messages` to introduce path-backed
attachment columns and remove or deprecate BLOB storage. Include a one-time
backfill that writes existing BLOB content to managed files in a recoverable way,
with rollback behavior for partial filesystem failures.

This is a breaking backup-format change if raw SQLite export no longer contains
all attachment bytes. Decide the export bundle format before production code
changes.

## Phases

1. Produce an approved architecture plan for sidecar storage, backup/import
   bundle semantics, native open/reveal behavior, and security boundaries.
2. Implement managed storage for new attachments with migration tests.
3. Migrate existing BLOB attachments to managed files.
4. Add native `Open` and `Show in Folder` routes and UI actions.
5. Update export/import to include managed attachment files.

## Test plan

- Domain/API: validate new attachment metadata, broken-file states, and route
  contracts.
- Database/migration: backfill BLOBs to files, preserve ownership, reject
  downgrade/partial migrations, and cascade attachment records.
- Filesystem integration: safe relative-path resolution, symlink escape
  rejection, missing-file behavior, and owner-only permissions.
- API/security: scoped open/reveal routes, Host/Origin enforcement, malformed
  IDs, and no shell command construction from user data.
- Client: actions render accessibly, missing files display recoverably, and
  refreshed metadata appears after file changes.
- E2E: attach a file, reveal/open it through the UI, modify the managed file, and
  confirm the message keeps the same attachment with updated metadata after
  restart.

## Risks and mitigations

- Data loss during migration: use temporary files, atomic rename where practical,
  and tests for interrupted writes.
- Path traversal or symlink escape: store only generated relative paths and
  verify resolved paths stay under the managed attachment root.
- Shell-open injection: use fixed executable/argument arrays and never invoke a
  shell with user-controlled strings.
- Backup regression: block implementation until export/import has a coherent
  bundle design.
- Plaintext exposure: preserve existing warnings because managed files and
  bundles remain readable without encryption.

## Open decisions

- Export format for schema versions with sidecar attachments.
- Whether to remove BLOB content immediately or keep it during one compatibility
  version.
- Metadata refresh strategy: on-read only, explicit refresh button, or file
  watcher.
- Platform support matrix for reveal/open commands on macOS, Windows, and Linux.

## Approval request

Approve phase 1 first: design the managed sidecar storage and backup/import
architecture before changing production code.

## Completion evidence

Not started.
