# ADR-0014: Flat project subthreads with linked provenance

## Status

Accepted, 2026-10-30; implemented in [plan 0034](../plans/0034-project-subthreads.md),
commit `7eaba47`. Unreleased.

## Context

Side topics need separate conversations without duplicating a project or
overloading its main history. The approved product model keeps the project itself
as Main, with one flat level of subthreads. A continuation identifies where work
branched while keeping each conversation's messages and settings independent.

## Decision

Reuse `chats` for both roots and subthreads. Schema 10 adds nullable
`chats.project_id`; a child points directly to its root. Creating from any child
resolves that same root, producing a sibling. Existing projects remain roots,
and notes, attachments and label assignments retain one conversation owner.

Both creation modes accept a name and start with no messages. Independent
creation has no origin record. Continue in subthread adds a `subthread_origins`
row referencing the source conversation and note. The repository validates that
the note belongs to that source and that both conversations share a project.
Origin markers and source backlinks are derived from this metadata, not stored
messages or history snapshots. SET NULL source references preserve continuations
after source deletion; a deleted note retains a conversation link, while a
deleted source conversation leaves an explicit unavailable marker.

Only accent inherits dynamically from the root; child accent writes are rejected.
Labels and the long-message display setting are seeded from the root, with fresh
custom-label identities, and then edited independently. Pins and archive states
belong to each conversation. Archiving a root moves its group into Archive without
rewriting child archive states. Deleting a root deletes its children and collects
their managed attachment paths before cascading rows; deleting a child preserves
sibling continuations.

Project search resolves any conversation to Main and all children, including
archives. Matching remains local; results open their owning conversation before
mutation. Queries, drafts, pending files, edits and reading anchors remain
session-only and conversation-scoped. The Project checkbox does not create
persistent search data.

Backup format remains 1. Project selection lists roots and includes the complete
set of their children, messages and attachments. Import validates flat ownership
and same-project provenance before pruning or activation. Merge remaps chat,
note, custom-label and origin identities together, inserting origins after notes.
Schema 3–9 backups migrate in validated staging; older code refuses schema 10.

## Alternatives considered

- A project folder with a separate Main chat conflicts with the approved
  project-as-conversation navigation model and would add a second ownership layer.
- Recursive nesting adds navigation and lifecycle complexity; branching from a
  subthread instead creates a sibling with a source link.
- Copied history or shared message ownership introduces duplicate content and
  ambiguous edits/deletion. Provenance links preserve the branch point without
  inheriting message text or publishing messages between conversations.
- Live inheritance of all settings prevents independent topic workflows. Only
  the visual accent stays shared; other settings are copied once.

## Consequences

Existing conversation APIs and tools remain reusable, while backup and root
deletion must handle complete projects. Foreign keys enforce existence and
deletion behavior; repository and import validation additionally enforce flat
hierarchy and provenance ownership. Project search loads all conversations and
remains bounded by the existing unvirtualized history approach.

AI responses remain a distant product possibility, with no selected provider,
message-role model or context policy. Provenance does not imply automatic AI
context inheritance; any future AI integration requires its own design.

## Verification

Migration, repository/API, backup selection/replacement/merge, invalid-graph,
attachment cleanup, client race and desktop browser tests cover these contracts.
[Plan 0034](../plans/0034-project-subthreads.md#completion-evidence) owns the exact
verification results and qualification limits. [DESIGN.md](../../DESIGN.md#project-subthreads)
owns the approved desktop interaction and visual contract.

## Amendment — persistent source positions, 2026-11-02

The user requires continuation links to remain at the source message's position
when that message is deleted, and return links to navigate to that position.
Schema 11 adds a retained source date and opaque ordering key. Deletion captures
the latest date before the source reference is cleared. The source timeline then
renders a standalone link at that date; no message body is preserved. Backups and
merge retain the anchor metadata. Live schema-10 sources are backfilled on upgrade;
previously deleted sources retain the conversation-only fallback because their
dates are no longer available. Source-conversation deletion still makes the source
unavailable, and deleting a subthread removes its continuation marker.
