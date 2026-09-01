# Attachments and file-filter implementation plan

## Goal

Add the first attachment slice to project messages and the first history filter:
messages can include local files with optional text context, and the project
history can show only messages with attached files.

## Context and reusable precedent

The existing project chat stores messages as ordered `notes`, renders them as
chat bubbles, and transfers the whole SQLite database through Settings
export/import. Keeping attachment bytes in SQLite preserves the current backup,
import, deletion, and single-writer transaction model without introducing a
sidecar file lifecycle.

## Acceptance criteria

1. A user can attach one or more files while composing a message.
2. A user can send text plus files, or files without text.
3. Attachments persist after restart and are included in database export/import.
4. Message bubbles show compact attachment cards with filename, type, size, and
   an open action.
5. Attachment reads are scoped by project, message, and attachment ID.
6. Message deletion and project deletion delete attachment rows through database
   ownership constraints.
7. File uploads reject empty files, files over 100 MB, too many files, malformed
   timestamps, and empty multipart messages without partial writes.
8. The project header exposes `All` and `Files` history filters with counts.
9. The `Files` filter shows only messages with attachments while preserving date
   grouping and accessible controls.
10. Editing a message can keep, remove, and add attachments.

## Non-goals

- File previews, document parsing, OCR, drag-and-drop, search, or labels.
- Sidecar attachment directories.
- Native app opening and in-place mutable files.
- Encryption, secure erase, or confidential-data claims.

## Proposed design

Add a `note_attachments` table with metadata and BLOB content. Rebuild the
`notes` table constraint so attachment-only messages may store an empty body,
while JSON text-only note creation still validates non-empty message text.

Use `@fastify/multipart` for upload parsing with a 100 MB per-file limit and a
small multipart overhead allowance at the server body boundary. Store sanitized
filenames and MIME strings as display/open metadata only. The client fetches
attachment bytes on demand and opens them as local blob URLs for browser-supported
types; native app opening and write-back require a separate sidecar/OS bridge
design.

In the client, keep pending `File` objects in composer state, send multipart
`FormData` only when files are present, and otherwise preserve the existing JSON
note route. Render attachment metadata from chat detail and fetch bytes only on
open.

## Data and migration impact

Migration `0002_attachment_messages` adds `note_attachments`, recreates `notes`
with an empty-body-compatible check, restores the existing note history index,
and bumps `app_metadata.schema_version` to 2.

Attachments are plaintext database BLOBs. Database backups now include attached
file bytes and can grow quickly.

## Test plan

- Domain/API-client: multipart note upload and update use `FormData`;
  attachment opening fetches the scoped route.
- Database: migration creates attachment table; note metadata and bytes
  round-trip; note deletion cascades attachment rows.
- API: multipart creation, scoped download, oversized upload rejection, and
  no-partial-write behavior.
- Client: pending file chips, removal, edit-mode attachment changes, attachment
  cards, opening, and `Files` filter behavior.
- E2E: create an attachment message, filter by files, open the attachment, and
  confirm the flow works in desktop Chromium and mobile WebKit.

## Risks and mitigations

- Large SQLite files: cap each uploaded file at 100 MB and keep the first slice
  intentionally simple.
- Untrusted filenames and MIME types: sanitize stored/displayed values and avoid
  native execution in this slice.
- Plaintext storage: keep existing warnings accurate and avoid confidential-data
  claims until encryption is designed.

## Completion evidence

Implemented on the active development branch for the future v0.0.3 release.

Verified behavior:

- Messages can include one or more local attachments with optional text context.
- Attachment-only messages are accepted through multipart creation.
- Attachment metadata and bytes persist in SQLite and participate in database
  export/import.
- Existing message edits can keep, remove, and add attachments.
- The `Files` filter shows only messages with attachments and preserves date
  grouping.
- Attachment cards open fetched bytes as browser blob URLs.
- Pending attachment chips have visible top-right remove controls.

Verification commands passed:

- `npm test -- src/server/db/database.test.ts src/server/app.test.ts src/client/api.test.ts src/client/App.test.tsx`
- `npm test -- src/client/theme.test.ts`
- `npm run verify`

Remaining risk:

- Attachments are plaintext SQLite BLOBs, so large files grow the database and
  exports directly.
- Native app opening, revealing in a folder, and in-place mutable attachment
  editing are intentionally deferred to
  `docs/plans/0008-managed-mutable-attachments.md`.
