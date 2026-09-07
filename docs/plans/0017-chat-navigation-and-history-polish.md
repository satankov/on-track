# Chat navigation and history polish implementation plan

## Status

Approved, implemented, and verified on 2026-09-07. The user selected remembered last-viewed position and
confirmed future messages remain accessible through normal scrolling, without a
separate preview. All required verification gates pass.

## Goal

Implement the six requested improvements: Home navigation from the brand,
remembered chat reading position, an eight-line composer, collapsible sidebar
sections, plain-text Markdown previews, and an automatic Links history filter.

## Context and reusable precedent

- `src/client/App.tsx`: `backToProjects` already resets navigation and cancels
  stale selections; `ProjectRail` already separates Pinned and Projects.
- `ChatWorkspace` remounts by project ID. Its `.history` is the sole history
  scroll owner, and `futureStartId` already identifies the live future boundary.
  There is no existing auto-scroll or reading-position model.
- `resizeComposerTextarea` and `.composer textarea` currently cap height at
  144 pixels: five 24-pixel lines plus desktop padding.
- `projectPreview` currently only normalizes whitespace on the bounded server
  preview. `MarkdownMessage` uses `react-markdown` and `remark-gfm`.
- Files is an inferred client filter, independent of durable message labels.
  Links can follow the same pattern.
- Plans 0005, 0013, 0014, and 0015 describe the existing scroll containment,
  sidebar, disclosure, and shared composer patterns. These remain in place.

## Acceptance criteria

1. The top-left On Track brand is an accessible Home link. Activating it from a
   project or its editor returns to “Choose a project to continue.” Existing
   first-run behavior remains when no projects exist. Use the existing Back
   reset semantics, save guard, and stale-selection cancellation.
2. Switching away records the visible reading position per project; switching
   back restores that message and its viewport offset. Store a stable message
   ID and timestamp as well as offset so changed heights and deleted messages
   have a deterministic fallback. Keep this state in the current app session,
   including trips through Home, Settings, and project editing.
3. A first visit without a remembered position opens near the latest message
   dated now or earlier, with the first future message below it when present.
   With no future messages, open at the newest message; empty history stays at
   the top. Future-only history starts at its first message. Never jump to the
   final future message merely because it is last in the document.
4. Restore the remembered position without a separate future-message preview.
   Future messages remain in the normal timeline. A long message can exceed a viewport, and short history cannot
   always put later future messages below the viewport through scrolling alone.
5. User scrolling, live clock updates, note/label refreshes, and filter changes
   must not repeatedly trigger initial auto-scroll. Filtered views must not
   overwrite the remembered unfiltered reading position. Database replacement
   clears obsolete reading positions.
6. Add and edit composers grow to eight content lines, then scroll internally.
   Calculate the cap from line height and actual vertical padding (216 pixels
   on the current desktop layout). Preserve shrink/reset and width resizing.
7. Pinned and Projects independently collapse using their section headers.
   Label and count remain visible; hidden chats leave keyboard navigation and
   the accessibility tree. The chevron points down when open and right when
   closed. Reveal it on hover or keyboard focus; keep it visible on touch.
   Sections start expanded and retain state through in-app navigation.
8. Sidebar previews show readable text without heading, emphasis, list, or
   other parsed Markdown delimiters. Keep link labels, code text, image alt
   text, and spacing between blocks. Keep existing empty-preview fallbacks;
   previews remain inert text inside the project selection button.
9. Links is always available immediately after Files, with a compact chain
   icon, message count, pressed state, and useful empty state. It automatically
   matches messages containing actual Markdown/GFM links, including bare web
   URLs, autolinks, email links, and resolved reference links. Multiple links
   count as one matching message. Code-only URLs, image sources, unused link
   definitions, raw HTML, and destinations rejected by the existing Markdown
   URL policy do not count. Editing/deleting messages updates the filter.
10. Existing theme tokens, focus treatment, desktop/mobile reflow, and
    reduced-motion behavior remain consistent.

## Non-goals

No accounts, read receipts, database schema changes, backup format changes,
server-side search, fetching link targets, new label assignments, or release
publication. Remembered UI state does not persist across browser reloads in
this slice.

## Proposed design

- Wire Home through the current navigation reset function and explicitly return
  workspace mode to projects. Use a real same-app link with guarded handling.
- Own section expansion and per-project reading anchors in `App`, above the
  components that unmount during navigation. Use message IDs on row elements
  and measure only the history container. Restore after message collapse
  measurements, without stealing focus or scrolling the document.
- Use one pure client Markdown analysis helper for text extraction and link
  detection. Parse using the same GFM stack as message rendering, traverse the
  parsed tree, and resolve references against definitions. Reuse
  `react-markdown`'s exported URL transform for link eligibility.
- Declare the already installed `unified@11.0.5` and `remark-parse@11.0.0` as
  direct dependencies so the helper does not depend on accidental hoisting.
  Both are MIT-licensed packages from the existing unified/remark ecosystem,
  already pinned transitively in the lockfile. No new parser family or version
  upgrade is proposed. Avoid broad regex-based Markdown stripping.
- Memoize analysis by the relevant note bodies/preview inputs so typing in the
  composer does not reparse every historical message.
- Extend the existing HistoryFilter union and inferred-filter rendering. Links
  does not enter the label picker or project label settings.

Primary references checked during planning:

- [remark-parse documentation](https://github.com/remarkjs/remark/tree/main/packages/remark-parse)
- [unified parsing API](https://github.com/unifiedjs/unified)
- [react-markdown URL handling and security](https://github.com/remarkjs/react-markdown)
- [remark-gfm syntax](https://github.com/remarkjs/remark-gfm)

## Data and migration impact

No API, database, migration, attachment, or backup changes. Reading anchors and
section disclosure state are session-local metadata only. Stored message bodies
are unchanged. Existing sidebar snippets remain bounded at 512 characters;
Markdown cut off at that boundary can be interpreted as incomplete syntax.

## Affected files

- `src/client/App.tsx`, `src/client/styles.css`.
- New focused Markdown analysis and reading-position helper/hook files and
  their unit tests under `src/client/` as needed.
- `src/client/App.test.tsx`, `e2e/project-chat.spec.ts` or a focused sibling.
- `package.json`, `package-lock.json` for explicit existing parser dependencies.
- `docs/PROJECT.md`, `docs/ARCHITECTURE.md`, `CHANGELOG.md`, and this plan for
  concise implemented-capability and verification updates.

## Phases

1. Home, eight-line composer, and sidebar disclosures. Add failing component
   tests, implement the controls using existing patterns, and verify keyboard
   operation plus desktop/mobile composer geometry.
2. Markdown analysis, plain previews, and Links. Add failing pure analysis and
   filter tests; declare the existing parser dependencies after approval;
   implement and verify safe inert previews and automatic count updates.
3. Reading-position restoration. Implement the resolved scroll contract with
   tests for first visits, returning visits, deleted anchors, future-only
   histories, long messages, filters, and navigation races. Prove actual scroll
   geometry in desktop Chromium and mobile WebKit.
4. Review and verification. Use the reviewer role and security-review skill
   for the Markdown/URL boundary. Fix actionable findings and run full gates.

## Test plan

- TDD: focused helper tests and `npm test -- src/client/App.test.tsx` with
  recorded RED and GREEN outcomes.
- Browser geometry: build then focused Playwright tests for Home, independent
  disclosures, eight/nine-line boundaries, and remembered reading positions.
- Final gate: `npm run verify` (release contract, build, typecheck, lint,
  formatting, coverage, migrations, desktop/mobile E2E, production audit).
- Inspect the complete diff and any visual regressions before reporting ready.

## Risks and mitigations

- DOM heights change after collapsing Markdown or resizing: anchor by message,
  restore after measurement, and verify long messages in a real browser.
- Restoring raw scrollTop can point at the wrong note after edits: retain a
  stable ID and timestamp fallback, and clear state after import/deletion.
- Future visibility and restored history can conflict: the approved behavior
  prioritizes remembered position; future messages remain in normal scrolling.
- Markdown references may extend beyond a sidebar snippet: keep current bounded
  summary behavior and test incomplete syntax; full note bodies drive Links.
- Dependency audit during planning passed the high-severity threshold but
  reported an existing moderate Fastify advisory group. No parser advisory was
  reported. A Fastify upgrade is outside this UI slice.

## Open decisions

None. The user approved normal scrolling with no separate future preview,
session-only reading/section state, and the parsed-link eligibility above.

## Approval

The six-feature slice was explicitly approved on 2026-09-07.

## Implementation and verification evidence

- Home navigation, independent sidebar disclosures, the eight-line add/edit
  composer, plain Markdown previews, and automatic Links filtering are complete.
- Reading anchors remain session-local. Returning restores the same viewport;
  a shortened collapsed anchor stays visible. Future messages use normal scrolling.
- The parser dependencies were already installed transitively; the lockfile adds
  only their direct declarations. Stored messages and database schema are unchanged.
- Preview extraction also handles the requested spaced `** bold text **` example
  while preserving code literals.

TDD evidence:

- `npm test -- src/client/App.test.tsx` demonstrated missing Home/disclosure/Links
  controls and the old 144-pixel composer cap before implementation; the completed
  component suite passes.
- `npm run test:e2e -- e2e/project-chat.spec.ts --grep 'opens near current work'`
  failed initially because both engines opened at scrollTop 0. Returning visits,
  normal future scrolling, filter isolation, and long expanded-message anchors
  now pass in Chromium and WebKit.
- Reviewer regression tests reproduced shortened-anchor overscroll, unused
  footnote false positives, and keyboard focus loss when pinning into a collapsed
  section. All three are fixed; a follow-up review found no remaining actionable
  issues. A subsequent browser regression led to preserving exact offsets when
  only a few pixels of an unchanged anchor remain visible.

Final verification:

- `npm run verify`: PASS, including release contract, build, types, lint,
  formatting, coverage, migration tests, E2E, and production audit. Browser
  processes required an escalated run because sandbox launches were blocked.
- Unit/component/integration suite: 512 passed, 1 existing platform skip.
- Coverage: 92.12% statements, 86.83% branches, 94.78% functions, 93.50% lines.
- Focused migration suite: 20 passed; no migrations were added.
- Browser suite: 29 passed, 3 existing desktop-only skips on mobile WebKit.
- Desktop and mobile screenshots were visually inspected for layout, Links
  styling, preview text, and composer containment.
- Security review found no new boundary issues. Production audit passed the
  high-severity gate and still reports the pre-existing moderate Fastify advisory.
- Full diff and whitespace review completed. No commit, push, or release made.
