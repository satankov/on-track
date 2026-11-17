# Message drafts, checklists, search navigation, and line breaks

Approved and implemented on `codex/message-drafts-and-reading` from the schema-14 workspace. Outgoing drafts use schema 15.

## Goal and scope

Return to one automatically saved outgoing message in each project conversation or subthread after closing the app. Restore the exact text, attached files in order, and the values and open state of the sender and time pickers. The user confirmed these four fields. Edit sessions, history filters, and search queries retain their existing session lifetime.

Three additional changes affect reading messages. A single Enter should produce a visible line break, a task checkbox should be operable directly in a saved message, and opening a search result in history should briefly identify its row.

## Proposed changes and acceptance tests

### 1. Single Enter in Markdown

Use the existing remark pipeline in `MarkdownMessage` to convert soft line endings in parsed text into break nodes. Apply it when displaying both old and new messages. Keep the original source available for edit and copy. Enter in the composer already inserts a newline, and Cmd/Ctrl+Enter submits.

Test two lines of prose, a blank line between paragraphs, emphasis, explicit hard breaks, list continuations, fenced code, and tables. Verify the rendered result in history and in conversation search. Use the installed parser and the behavior illustrated by [remark-breaks](https://github.com/remarkjs/remark-breaks).

### 2. Highlight the opened search result

When the exact message is scrolled into place and focused, apply the message-selection fill to its entire row and fade it out within 900 ms. Keep its text, position, and keyboard focus indicator legible in all themes. Use a stationary fill for reduced motion and the system highlight color for forced colors.

Connect both `ChatWorkspace.openInHistory` and the project-wide result's `selectChat` path to the same feedback. Carry the search origin and target ID through navigation. Clear feedback on leaving the conversation or opening another result. Reopening the same result starts a fresh interval. A deleted result must never highlight a neighboring message. Use the existing history-position and message-feedback code. Extend the search and subthread journeys on desktop and mobile to cover nearby identical messages and a result in another conversation.

### 3. Click a Markdown task checkbox

Click, tap, or press Space on a rendered task to check or uncheck it and save immediately. Show the updated state when the message is reopened or copied as Markdown. A local parser check distinguished nested tasks with identical text and left a code sample literal. The generated checkbox receives its location from the enclosing parsed list item. Use this to replace exactly the task marker's middle character, preserving surrounding Markdown. [GFM task-list specification](https://github.github.com/gfm/#task-list-items-extension-) · [Upstream rendering implementation](https://github.com/syntax-tree/mdast-util-to-hast/blob/main/lib/handlers/list-item.js)

Extend the existing note PATCH with an optional expected body. Compare it in the write transaction and refresh the message on a conflict. A body-only change must preserve the message's timestamp, sender, labels, attachments, and the user's composer. Guard manual edit saves based on stale text as well. Give each checkbox an accessible name from its task text and extend collapsed-content focus handling to clipped controls. Honor read-only Examples and the existing message-selection gesture.

Test nested and ordered tasks, repeated text, uppercase X, escaped markers, code samples, keyboard operation, and reload. Exercise two tabs changing the same message, a failed save, and a separate unfinished message in the composer.

### 4. One durable outgoing draft per conversation

- Autosave locally while typing. Preserve whitespace and unfinished Markdown exactly. Restore a text-only, file-only, or picker-only draft after refresh or server restart. Keep unsent messages out of the timeline, project activity, and search results.
- Upload a newly attached file once using the existing managed store and file limits. Preserve its display order and distinguish an upload in progress, a saved attachment, and a failed upload. Report a draft as saved only after SQLite and its files acknowledge the write. Keep unsaved input available for retry on failure.
- Separate outgoing state from the edit composer in `App.tsx`. Editing or canceling an existing message must restore the outgoing draft. Opening another conversation during autosave must keep pending work bound to its original owner.
- Use a per-conversation revision token to serialize saves and reject stale updates from other tabs. Preserve the local text on a conflict. Flush pending changes on in-app navigation and send. A confirmed send atomically consumes the submitted draft revision. A failed send preserves the complete draft, and a delayed write cannot bring a sent draft back. Recover an ambiguous send from persisted state before offering a retry.
- Restore attachments with their original names, order, and availability. An unavailable file should be identifiable in the composer so the user can remove or reattach it before sending. Verify successful send with attachments, rollback, an interrupted upload, a late response after project deletion or replacement import, and a server restart on a disposable database.

## Data, migration, and backups

Add a conversation-owned draft table in the next versioned migration. Persist text, picker values and open flags, and revision identity. Extend the existing attachment table to enforce exactly one owner per attachment, either a saved note or a draft. Existing attachments retain their IDs, paths, and note ownership. Store a stable ordering for draft files and preserve that order on send. The local server validates ownership and limits on each operation. Sending transfers file ownership and clears the submitted draft inside the note transaction. Removing an attachment or deleting a conversation commits reference removal before managed-file cleanup. [Managed attachment ownership](../adr/0006-managed-mutable-attachments-and-native-file-actions.md)

Proposed backup behavior makes drafts part of their conversation. Full and selected-project backups include the selected conversations' drafts and file bytes. Replacement restores them. Merge assigns fresh identities and transfers each draft to the matching copied conversation. Preserve format 1's attachment payload inventory, add schema-14 legacy validation, and exercise supported older bundles with existing files. Test ownership, limits, pruning, counts, and invalid imports before activation. This also means an exported project can contain an unfinished message.

## Files and verification

- Client work centers on `src/client/App.tsx`, `api.ts`, `history-position.ts`, and `styles.css`. Use the existing Markdown, timeline, and composer components. Update the applicable states in `DESIGN.md` and `branding/threadstr/ui/` and describe the user-visible behavior in `docs/USER_GUIDE.md`.
- Persistence touches `src/domain/`, the note and draft routes in `src/server/app.ts`, `chat-service.ts`, `src/server/db/`, `drizzle/`, and `src/server/database-transfer/`. Update the project and architecture records when the session-only draft contract changes.
- Drive each phase with failing behavior tests first. Run `npm test -- src/client/App.test.tsx src/server/app.test.ts src/server/chat-service.test.ts src/server/database-transfer` and `npm run test:migrations`. Verify draft restart/transfer and both search routes in desktop Chromium and mobile WebKit using the project-chat, project-search, subthreads, and database-transfer journeys. Run `npm run verify` and review the storage and file changes before delivery.

## Verification evidence

The composer restore test initially returned an empty text field. The implemented client restores text, ordered files, and the sender and timestamp controls after a server restart in Chromium and mobile WebKit. The guarded note test initially returned HTTP 200 for stale text. It now returns 409, retains concurrent edits, and exports a valid backup after an edit with surrounding whitespace. Tests also cover lost send acknowledgements, unavailable draft files, SQLite rollback, whole and selected backups, and a stale first autosave after replacement.

On 2026-11-17, `CI=true THREADSTR_E2E_PORT_BASE=25750 npm run verify` passed on Node 22.18.0 against the schema-14 base at `0dee547`. The run passed 1,243 Vitest tests (9 skipped), 32 focused migration tests, 100 browser tests (22 skipped), and the managed lifecycle, upgrade recovery, and uninstall checks. Line coverage was 91.61%. The production audit reported three moderate findings in the existing dependency tree and passed its high-severity threshold.
