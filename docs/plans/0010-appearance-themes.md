# Appearance themes implementation plan

## Goal

Add Light, Neutral, and Dark appearance themes and let the user choose among
them from a new Appearance section in Settings using large preview-like radio
cards. Preserve the compact, flat project-ledger layout and all project, note,
attachment, and backup behavior.

## Context and reusable precedent

The current uncommitted visual refresh already centralizes the main palette in
semantic CSS variables in `src/client/styles.css`, uses a two-pane Settings
workspace in `src/client/App.tsx`, and tests real Settings navigation in Vitest
and Playwright. These are sufficient to add themes without a package, server
endpoint, or database migration.

The supplied screenshot is reference evidence rather than an instruction or an
asset to copy. On Track will borrow only the interaction principle: several
large miniature-workspace previews that can be understood before selection,
with a clear selected boundary. It will not copy the reference's product
branding, theme names, exact palettes, number of presets, or surrounding UI.

### Direction brief

- **Job:** let a desktop user choose a comfortable reading environment for
  long-lived project notes without distracting from the notes themselves.
- **Audience and environment:** one frequent desktop user working across
  different rooms and lighting conditions; content scanning and writing remain
  the dominant tasks.
- **Design thesis:** the same quiet project ledger under three lighting
  conditions, with structure, density, and project accents held constant.
- **Signature:** each choice is a miniature but recognizable On Track workspace
  showing rail, header, note stream, and composer—not a generic color swatch.
- **System choices:** keep system sans typography, compact spacing, flat
  surfaces, restrained radii, existing inline icons, and project-colored
  orientation. Change semantic color roles only.
- **Risk and restraint:** Neutral is intentionally a soft graphite midpoint,
  not another decorative colorway. Preview cards carry the visual emphasis;
  the surrounding Settings page stays quiet.
- **Reject:** theme-specific layouts, gradients, decorative wallpaper, colored
  dark modes, a tiny toggle, automatic OS switching, and copied preset names.

## Acceptance criteria

1. Settings contains two keyboard-accessible sections, Appearance and Backups,
   with exactly one section marked as the current page.
2. Appearance shows three large radio choices named Light, Neutral, and Dark.
   Each card includes a miniature On Track workspace and a text label.
3. Selecting a card applies the theme immediately to the complete application,
   including projects, history, messages, Markdown, composer, forms, settings,
   dialogs, error/status states, hover, focus, selected, and disabled states.
4. Selection is conveyed by native checked state plus a visible outline and
   check/Selected treatment, not color alone. Arrow/tab behavior follows native
   radio-group semantics and every card has a visible focus state.
5. The selected theme persists across page reloads in browser-local storage.
   Missing, inaccessible, or invalid stored values safely fall back to Light.
6. Light remains the default and retains the approved visual-refresh palette.
   Neutral is a medium graphite environment; Dark is a near-black environment.
   Neither changes layout, spacing, typography, or project accent identity.
7. The document `color-scheme` and browser theme-color metadata track the
   selected mode so native controls use an appropriate light or dark treatment.
8. Every real normal-text foreground/background pair in all three themes meets
   WCAG 2.2 AA 4.5:1. Large text and non-text interactive boundaries meet their
   applicable 3:1 requirements; project accent actions keep readable text.
9. Existing active-project, history-filter, settings-section, and focus states
   remain distinguishable in every theme and are not communicated by color
   alone.
10. Returning from Settings preserves the active project and the selected theme.
    Backup export/restore remains reachable and unchanged.
11. Desktop layouts at 1024, 1440, and 1920 CSS px remain free of clipping and
    document-level overflow. The existing mobile alpha remains functional; this
    slice does not redesign it.
12. No new runtime dependency, network request, API, database field, migration,
    or backup-format change is introduced.

## Non-goals

- Following the operating-system appearance automatically.
- Per-project themes, custom colors, additional presets, scheduled switching,
  or syncing the preference between browsers or computers.
- Changing the compact workspace arrangement or revisiting mobile navigation.
- Bundling fonts, images, theme libraries, or icons from the reference product.

## Proposed design

### Theme model and persistence

- Add a small client-only theme module defining the closed `Theme` union,
  storage key, validation, initial read, DOM application, metadata update, and
  best-effort persistence.
- Store only `light`, `neutral`, or `dark` in `localStorage`. Theme preference is
  browser-local UI state and is intentionally excluded from SQLite backups.
- Apply the stored value before CSS/React presentation through a tiny
  same-origin external bootstrap in `public/`, then let `App` own the selected
  theme so the Appearance workspace is controlled and immediately consistent.
- Set `data-theme` and `color-scheme` on the document root. Update the existing
  `meta[name="theme-color"]` without adding an inline script that would weaken
  the production content-security policy.

### Semantic palette

- Preserve the current Light values.
- Add `[data-theme="neutral"]` and `[data-theme="dark"]` mappings for stable
  semantic roles: canvas, base surface, rail, history/inset surface, control
  surface, selected surface, primary/muted text, subtle/strong border, focus,
  primary action, critical, success, code, field, and overlay.
- Replace remaining appearance-bearing raw whites, warm code colors, and alpha
  backgrounds with semantic variables. Project accent variables remain the
  category/orientation layer shared across themes unless contrast evidence
  requires a narrow per-theme adjustment.

### Settings interaction

- Generalize the current static Settings rail to accept an active section and
  selection callback. Add an Appearance row with a local inline icon above the
  existing Backups row.
- Split the current backup workspace from the new Appearance workspace while
  retaining the existing two-pane shell and Back to projects behavior.
- Preserve Backups as the initial Settings section, then remember section
  changes for the current app session. Theme choice itself persists across
  reloads.
- On the mobile alpha, keep both sections reachable through a minimal horizontal
  settings navigation; do not otherwise redesign the mobile experience.

### Preview-card contract

- Use a semantic `fieldset` with one native radio per theme.
- Each label contains a CSS-only miniature workspace with rail, header, two note
  marks, and composer. Preview colors are scoped theme tokens, so the three
  previews remain truthful even while the surrounding app uses another theme.
- Cards use a restrained 3:2-ish desktop ratio, clear label/footer, visible
  hover and focus states, and selected outline plus textual/check confirmation.
- At narrower Settings widths cards wrap from three columns to fewer columns;
  they never become a tiny switch or horizontal overflow strip.

## Data and migration impact

There is no server, SQLite, migration, API, attachment, or backup-format impact.
The only new persisted value is a non-sensitive appearance preference in browser
`localStorage`. If storage is unavailable, the selected theme remains usable for
the current page and Light is used on the next load. Rollback removes the theme
module, theme mappings, Appearance UI, tests, and documentation; project data is
untouched.

## Phases

1. **RED theme lifecycle tests.** Add failing unit/component guarantees for
   defaulting, invalid-storage fallback, immediate selection, DOM metadata,
   persistence, reload initialization, settings navigation, and active-project
   preservation. Expected evidence: focused Vitest failures against the current
   single-theme Settings implementation.
2. **Theme state foundation.** Add the dependency-free theme module, a tiny
   external same-origin pre-render bootstrap, controlled `App` state, safe
   storage handling, root data attribute, `color-scheme`, and theme-color
   metadata. Keep the bootstrap storage key and allowlist synchronized with the
   module through a contract test. Expected evidence: lifecycle tests pass
   without server or CSP changes and a stored theme exists before React mounts.
3. **RED palette contract.** Extend CSS token tests to enumerate required roles
   and contrast pairs in Light, Neutral, and Dark. Expected evidence: Neutral
   and Dark fail because their mappings do not yet exist.
4. **Semantic palette implementation.** Define the three token maps and replace
   remaining appearance-bearing literals with semantic roles across workspace,
   Markdown, attachments, composer, settings, forms, dialogs, and states.
   Expected evidence: token/contrast tests pass and no theme-specific layout
   declarations appear.
5. **Appearance workflow.** Generalize Settings navigation and build the native
   radio preview cards, including selected, hover, focus, and wrapped states.
   Preserve the Backups workspace unchanged. Expected evidence: component tests
   pass for keyboard names/current-section state and both settings sections.
6. **Browser journey and visual review.** Add a desktop E2E flow that selects all
   three themes, reloads to prove persistence, returns to an active project, and
   checks 1024/1440/1920 overflow. Render populated project, Appearance,
   Backups, dialogs, composer, and Markdown states in all themes, including 200%
   zoom and a mobile regression check. Expected evidence: screenshots and
   interaction assertions show no clipping, flash after app initialization, or
   inaccessible state.
7. **Review and verification.** Review the complete diff, run a read-only
   reviewer, update durable product/architecture documentation for the new
   browser-local preference, and run the authoritative repository gate. Expected
   evidence: no actionable review findings and `npm run verify` passes.

## Test plan

- Focused behavior: `npm test -- src/client/App.test.tsx src/client/theme.test.ts`
- Focused browser: `npm run build && npx playwright test e2e/project-chat.spec.ts --project desktop-chromium --grep "appearance themes"`
- Static checks: `npm run typecheck && npm run lint && npm run format:check`
- Full completion gate: `npm run verify`
- Manual rendered matrix: Appearance selector and populated project in Light,
  Neutral, and Dark at desktop width; project dialog, Markdown/code,
  attachment/status states, keyboard focus, 200% zoom, and one mobile-alpha
  regression pass.

## Affected files

- `src/client/theme.ts` (new): theme type, validation, storage, DOM application,
  and initial bootstrapping.
- `public/theme-init.js` (new) and `index.html`: same-origin pre-render
  preference application without weakening the content-security policy.
- `src/client/main.tsx`: apply the stored theme before React renders.
- `src/client/App.tsx`: theme/settings-section state, generalized Settings rail,
  Appearance workspace, preview-card markup, and local inline icon.
- `src/client/styles.css`: semantic color roles, three theme maps, appearance
  preview cards, settings navigation adaptation, and replacement of raw
  appearance colors.
- `src/client/App.test.tsx` and `src/client/theme.test.ts`: lifecycle,
  accessibility semantics, storage, and three-theme contrast/token coverage.
- `e2e/project-chat.spec.ts`: persisted desktop Appearance journey, wide/intermediate
  geometry, and functional mobile regression.
- `docs/PROJECT.md` and `docs/ARCHITECTURE.md`: durable capability and
  browser-local preference boundary after implementation.
- This plan record.

## Risks and mitigations

- **Theme flash on reload:** production CSP forbids an inline bootstrap. Load a
  tiny same-origin external bootstrap before application assets, keep it aligned
  with the typed module through a contract test, inspect reload visually, and do
  not weaken CSP.
- **Incomplete dark coverage from raw literals:** enumerate semantic roles,
  search all client styles for appearance-bearing literals, and render every
  compositionally different surface in each theme.
- **Contrast conflict between project accents and dark surfaces:** test actual
  action-text, keyline, message-surface, focus, and status pairs per theme;
  narrowly separate action/surface roles if one color cannot satisfy both.
- **Storage exceptions or stale values:** validate the closed value set and catch
  read/write failures; never let appearance prevent application startup.
- **Settings regression:** preserve backup components and test both navigation
  directions, export/restore reachability, and return to the active project.
- **Preview cards becoming decorative card soup:** previews exist only because
  they communicate the choice; the surrounding panel stays flat and no nested
  settings cards are added.
- **Dirty-worktree overlap:** build directly on the approved visual-refresh
  changes already present, preserve all unrelated user work, and review the
  combined diff rather than reverting the existing slice.

## Open decisions

No blocking product choice remains. This plan assumes:

- public names are **Light**, **Neutral**, and **Dark**;
- Light is the default and invalid-value fallback;
- Settings continues to open on Backups, with Appearance immediately above it
  in the section list;
- the preference is local to this browser profile and is not included in
  backups;
- Neutral uses a medium graphite palette rather than beige, colored, or
  system-adaptive styling.

## Approval request

Please approve the complete Appearance themes slice above. Approval authorizes
implementation of Phases 1–7 as one coherent change on top of the current
uncommitted visual refresh. To revise it, specify the theme names, default,
Neutral palette direction, Settings landing section, or persistence behavior to
change.

## Completion

Approved and implemented on 2026-09-02. The delivered slice uses three semantic
token maps, a validated browser-local preference, a pre-React same-origin
bootstrap, and native radio preview cards. Component and browser tests cover
selection, invalid-value fallback, persistence, metadata, contrast, responsive
reflow, and the existing Backups entry point. Final repository-wide verification
is recorded in the delivery response for this task.
