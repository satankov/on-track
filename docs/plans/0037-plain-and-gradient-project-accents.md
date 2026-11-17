# Twelve project accents

Approved for v0.2.1 with one Accent picker and individually named gradients.

## Picker and appearance

Create project and Edit project will offer twelve choices in one native radio group. The visual order and keyboard order will be the same.

| Finish   | 1     | 2     | 3    | 4      | 5      | 6          |
| -------- | ----- | ----- | ---- | ------ | ------ | ---------- |
| Plain    | Coral | Amber | Moss | Ocean  | Iris   | Slate      |
| Gradient | Guava | Honey | Jade | Lagoon | Orchid | Periwinkle |

Restore the solid swatches, outgoing message fills, and composer action colors from `30cc82f` for the first six. Use the approved working-tree gradients for the second six. Keep both sets usable in Light, Neutral, and Dark, using the names above. All twelve swatches flow together in one strip and wrap as the available width requires. The name beside Accent follows the selection. Plain Coral is the initial selection for a new project.

## Existing projects and backups

The published palette and the gradient preview both saved a family name such as `ocean`. A saved value cannot identify which appearance the user saw. The default for these records is the original plain color. A project viewed in the gradient preview can recover that appearance by selecting its gradient in Edit. Each subthread follows its project's selection. Sender-name colors continue to use their existing six-family assignment.

## Implementation and verification

1. Extend `src/domain/validation.ts` and the existing accent picker in `src/client/App.tsx` to accept twelve project values. Plain choices retain the public IDs `coral` through `slate`. Gradients add a suffix, such as `ocean-gradient`. Keep the sender hash tied to the six families in `src/client/sender-color.ts`. Test ordering, exact accessible names, supported values and rejection of unknown choices.
2. Add an immutable migration under `drizzle/` and update `src/server/db/`. Schema 13 adds a checked `accent_style` column with values `plain` and `gradient` and a default of `plain`. Store family and style together on create and edit, and project both from the root on subthread reads. This additive migration keeps the existing six-value hue constraint and avoids rebuilding the chat table. Test an upgrade from schema 12 with existing notes and subthreads, rejection of invalid styles, style-only edits, persistence after reopening, and older-code refusal of schema 13.
3. Extend `src/server/database-transfer/` to validate schema 13 and preserve the selection on full restore, selected export and project merge. Validate older supported backups against their original schema before migration. Test round-trips for both finishes and rejection of malformed input before modifying the destination.
4. Update `src/client/styles.css`, the design contract, the UI cookbook and the release notes. Exercise Create, Edit, reload and subthread inheritance through desktop Chromium and mobile WebKit. Verify picker order, keyboard operation, contrast, forced colors and narrow-screen reflow.

Run focused domain, persistence, backup and UI tests first, then `npm run test:migrations`, `CI=true npm run verify` and `git diff --check`. Use disposable databases for migration and restore tests.

## Approval

Approval covers all twelve choices, the schema 13 migration, and the plain default for projects saved before style tracking.
