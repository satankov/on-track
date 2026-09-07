# Participant message attribution implementation plan

## Status

Implemented and verified on 2026-09-05 after the desktop UX mockup was revised
and approved to use the current On Track composer and message patterns.

## Goal

Let a local user record a message on behalf of a named participant. Messages
from **You** remain right-aligned; attributed participant messages use one
standard neutral bubble on the left with the sender name above the content.

## Context and reusable precedent

On Track already treats text, files, Markdown, timestamps, labels, filters, and
message actions as capabilities of one `Note`. The composer already reveals
Timestamp and Markdown controls as compact 46px horizontal rows from 36px icon
buttons. This feature extends those seams instead of introducing participant
accounts, a separate message type, or a new component system.

The approved design direction is desktop-first. Existing responsive breakpoints
remain regression targets, but they do not define a separate mobile workflow.

## Acceptance criteria

1. A compact sender icon beside Markdown, Attachments, and Timestamp toggles a
   horizontal Sender row using the same composer dimensions, tokens, focus
   treatment, and disclosure semantics as those controls.
2. The row offers **You** and one text field named **Sender name**. A blank field
   means You; a nonblank value is trimmed and limited to 80 characters.
3. A new participant message renders on the left with no avatar or initials.
   Its sender name appears above attachments/body content.
4. Every participant bubble uses the same neutral message surface. Only the
   sender name varies by a deterministic six-color mapping; the same normalized
   name always receives the same accessible color in every render and theme.
5. Own messages retain the existing right alignment and project-accent bubble.
6. Sender selection persists across successful new-message sends until the user
   chooses You, but project navigation/reset does not leak it into another
   project.
7. Editing loads the message's stored sender. Saving can change the name or set
   it back to You. Canceling edit restores the pre-edit new-message sender.
8. Failed writes preserve text, files, timestamp, and sender so the user can
   retry.
9. Participant messages keep the existing labels, filters, attachments,
   Markdown, collapse behavior, timestamp, copy, edit, and delete functions.
10. Sender attribution persists across restart, export, import, and migration
    from schema 5. Older notes migrate as You.
11. Sender input is validated at public and service boundaries and constrained
    in SQLite. Multipart create/update distinguishes an omitted sender from an
    explicit reset to You.
12. The primary desktop flow is keyboard accessible and has no layout overlap;
    existing mobile widths retain usable controls without page overflow.

## Non-goals

- Participant accounts, identities, avatars, invitations, or project settings.
- Autocomplete, recent-sender history, mentions, permissions, or collaboration.
- Sender-specific bubble colors or a second label/filter/action implementation.
- A mobile-specific redesign.

## Proposed design

- Add `sender: string | null` to the stored and returned note contract.
- Accept `sender?: string | null` in create/update inputs. Omitted update means
  preserve; explicit `null` means switch to You.
- Encode explicit null as a present empty multipart field, while an omitted
  field remains absent. Use an explicit repository flag instead of `COALESCE`
  so PATCH can write SQL `NULL` intentionally.
- Add one nullable `notes.sender` column with a trimmed 1–80 character check and
  schema version 6 migration. Preserve schema 5 as an accepted legacy backup
  that migrates to schema 6 during restore.
- Keep sender draft state with the existing composer state. Temporarily replace
  it while editing and restore it on edit completion/cancel.
- Render one shared message subtree and switch only row alignment, bubble
  surface/corner, action placement, and the optional sender-name element.
- Map normalized sender names to six semantic sender-name tokens through a pure,
  deterministic hash helper. Define contrast-safe token values per theme.

## Data and migration impact

Add immutable migration `0006_message_senders`:

```sql
ALTER TABLE notes ADD COLUMN sender text
  CONSTRAINT notes_sender_length
  CHECK (sender IS NULL OR sender = trim(sender, <ECMAScript whitespace>)
    AND length(sender) BETWEEN 1 AND 80);
UPDATE app_metadata SET schema_version = 6 WHERE id = 1;
```

Existing rows receive `NULL`. Active backup schema becomes 6. Exact schema-5
bundles remain accepted through the checked-in migration set, while malformed
sender values are rejected during active and bundle validation. No data
backfill, new table, index, or production dependency is needed.

## Phases

1. Add failing domain, API, service, repository, migration, backup, component,
   theme, and desktop journey guarantees.
2. Implement persistence and transport while preserving partial-update and
   restore safety.
3. Implement the existing-pattern composer row, message alignment, and stable
   sender-name presentation.
4. Review the complete diff, run focused security checks, and execute the full
   repository verification loop plus desktop visual inspection.

## Test plan

- Unit: sender normalization/length and deterministic color mapping.
- Client API: omitted, named, and explicit-null multipart serialization.
- Service/repository: create, reload, rename, reset to You, invalid values, and
  preservation when sender is omitted.
- Migration/backup: schema-5 migration default, schema-6 round trip, malformed
  sender rejection, and schema-5 bundle restore into schema 6.
- Component: disclosure semantics, You/name selection, sender persistence,
  edit/cancel restoration, failed-write preservation, left/right rendering,
  absence of initials, and shared labels/actions/filter behavior.
- Theme: every sender-name token meets WCAG AA text contrast on the neutral
  participant bubble in Light, Neutral, and Dark.
- E2E: desktop create/edit/reset and geometry; narrow-width no-overflow
  regression.

## Risks and mitigations

- **Accidental sender clearing on PATCH:** retain three states—omitted, named,
  and explicit null—through FormData, parsing, service, and SQL.
- **Backup lockout:** register schema 5 as a legacy descriptor before bumping the
  active backup version and exercise staged migration in integration tests.
- **Identity implied by free text:** label the field as attribution only; store
  plain display text and add no account semantics.
- **Color instability or low contrast:** normalize only for hashing, use fixed
  ordered tokens, and test every theme pair.
- **Duplicate message behavior:** keep one message renderer and branch only on
  sender presentation.

## Open decisions

None. The approved slice defines free-form attribution, persistent sender
selection, neutral participant bubbles, stable name colors, and desktop-first
scope.

## Completion evidence

- `npm run verify` passed: release contract, production build, typecheck, lint,
  formatting, coverage, migrations, desktop/mobile E2E, and the configured
  high-severity production audit gate.
- Vitest: 22 files passed; 465 tests passed and 1 skipped. Coverage was 91.35%
  statements, 86.21% branches, 94.28% functions, and 92.78% lines.
- Migration verification: 20 tests passed, including schema-5 upgrade and
  strict sender constraints.
- Playwright: 23 tests passed and 3 intentionally skipped across desktop
  Chromium and mobile WebKit. The participant journey is desktop-only by
  design; existing mobile compatibility journeys passed.
- Desktop screenshot inspection confirmed neutral left bubbles, sender names as
  the only participant color cue, no avatars, and the compact 36px trigger / 46px
  disclosure-row composition.
- `npm audit --omit=dev --audit-level=high` passed its configured gate and
  reported one pre-existing moderate Fastify advisory with an out-of-range fix;
  no dependency change was made in this feature.
