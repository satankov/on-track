# Project keyword search implementation plan

Status: Complete and locally verified on 2026-10-22. Published in
[v0.1.0](https://github.com/satankov/on-track/releases/tag/v0.1.0) on 2026-10-23.

## Goal

Find saved messages within the current project using lightweight literal keywords,
while preserving the familiar timeline, composer drafts, and reading position.

## Context and reusable precedent

- `ChatService.getChat()` and `ChatRepository.listStoredNotes()` already return
  complete project notes in `created_at ASC, id ASC` order.
- `ChatWorkspace` in `src/client/App.tsx` derives existing history filters from
  loaded notes; `analyzeMarkdown()` extracts inert readable text and Links state.
- `history-position.ts` captures/restores anchors; search must not overwrite All.
  Existing message bubbles, labels, attachments, composer and themes are reused.
- Plans 0017/0020/0027 govern history behavior; ADR-0001 keeps database ownership
  on the server. No server boundary changes are necessary.
- Researched [MiniSearch](https://lucaong.github.io/minisearch/), its
  [package registry entry](https://www.npmjs.com/package/minisearch),
  [Fuse.js](https://www.fusejs.io/fuzzy-search.html), and
  [SQLite FTS5](https://www.sqlite.org/fts5.html). These supply indexing/ranking or
  fuzzy capabilities beyond this current-project literal slice. Native string
  matching avoids a new dependency and index synchronization. Revisit lexical
  indexing if measured project scale or global scope requires it.

## Acceptance criteria

### Matching

1. Search the open project's saved messages, including future notes, archived
   projects and read-only Examples. Other projects and unsaved drafts are excluded.
2. Search full readable Markdown text, displayed sender (`You` if absent), and
   attachment filenames. Include code, alt text and referenced footnotes according
   to existing Markdown analysis. Exclude hidden URL destinations, raw HTML,
   labels, timestamps, project title, local paths and attachment bytes.
3. Normalize fields/query using NFC, lowercase, NFC. Split on Unicode whitespace,
   deduplicate, and require every term as a literal substring in at least one
   field on the same note. Different fields can satisfy different terms; a term
   cannot span field boundaries. `hotel budg` finds `Hotel budget`; `cat` finds
   `vacation`. Ordinary Latin/Cyrillic case works; no full Unicode case folding,
   transliteration, stemming, accent removal or language-specific equivalence.
4. Punctuation is literal, including quotes, `C++`, `.pdf`, `%`, `_`, `*` and
   parentheses. No operators, regex, wildcards or quoted phrase syntax.
5. Blank query restores ordinary history. One character works. Over 256 UTF-16
   code units shows an error in the history area instead of silently truncating.
6. Intersect results with the selected All/Files/Links/label filter; preserve
   chronological ordering and future boundary. Existing filter badge counts stay
   project-wide. A screen-reader status reports settled matching message counts.
7. Edits, sends, labels, filenames and deletions refresh matches from saved state.
   Missing/unreadable/unsafe attachments remain searchable by stored filename,
   retaining all existing action restrictions. No new network request on typing.

### Approved minimal UI

- Header Search is **only a magnifier** with accessible name and tooltip.
- One compact input row, approximately input height; no visible heading, helper
  copy, result-count row, Close button, or separate Clear button.
- One cross **inside** the input clears it. Use an accessible custom cross for
  consistent keyboard/touch behavior; suppress the browser's duplicate cross.
- Use existing surfaces with no new resting borders or dividers. Preserve the
  thin 1px focus outlines throughout the app. Search uses the composer’s 12px
  radius and aligns with the message column.
- Render the original filtered messages, with no MATCH lines, excerpts,
  or duplicated body text. Highlight literal matches in rendered text, senders
  and filenames while retaining Markdown formatting. Normal Show more behavior remains; full
  body text is searched even if the matching part is collapsed.
- A persistent return-arrow outside each bubble opens the message in history.
  Place it right for own messages, left for participants, with a 52px reserved
  gutter keeping the 44px control inside the composer’s horizontal bounds.
  Its accessible name is `Open message in history`; tooltip is `Open in history`.
  No extra explanatory line is inserted above or below the message.

### Navigation and states

- Magnifier opens/focuses the input and toggles it closed. Escape within search
  controls closes and returns focus to the magnifier, except during IME input.
  Browser Find and composer shortcuts remain unchanged.
- Debounce about 150 ms; wait for completed IME composition. Cancel pending work
  on clear/close/unmount, and use the current filter callback after a filter change.
  A quiet count appears inside the field on the right; pending input shows an
  ellipsis rather than a stale count. Detailed announcements remain hidden.
- Capture the filter's anchor before first effective query. Result changes start
  at the beginning; same-query data refreshes do not force scrolling. Clear/close
  restores the entry anchor for that filter, or normal initial placement for a
  filter first selected during search. Preserve All independently; do not retain
  positions for every query.
- Open-in-history closes search while retaining the query, selects All, reveals and focuses the
  target. Use existing timestamp fallback if an anchor has disappeared. No send
  entrance animation on context navigation.
- Composer stays usable. Announce successful saves hidden by search through a
  visually hidden status; keep save feedback as a thin outline pulse and retain errors.
- Active search belongs to keyed ChatWorkspace; navigation closes it. An App-owned
  session map remembers each project's last draft, including pending input, until
  manually cleared. Reopening restores it. Project deletion/replacement clears
  relevant memory; app reload resets it. Queries never enter URLs, storage, logs
  or backups.
- No-match history offers fewer words/clear; when a filter hides otherwise matching
  messages, offer `Search all messages` within this project. Existing empty-project
  and load-error behavior remains. Invalid queries use explicit error copy.
- Accessible names, focus, 44px touch controls, responsive reflow and existing
  theme roles remain required; no added motion. Check desktop/mobile, 200% zoom,
  narrow Example headers, reduced motion, and long/Unicode content.

## Non-goals

Cross-project/semantic search, typo tolerance, stemming, ranking, suggestions,
search history, saved searches, phrase syntax, file-content extraction/OCR,
new global shortcuts, result pagination and general timeline virtualization.

## Accepted design

**Job:** find a remembered note and read its surrounding context.
**Audience:** existing local notebook users, primarily desktop with mobile support.
**Thesis:** search quietly narrows the existing conversation without adding another
visual layer. **Signature:** the unchanged message bubble plus a small context icon.
**System:** existing font, surfaces, accent, spacing, bubble shapes and icon style;
no new fonts, assets, dependencies or color system. The borderless field retains
keyboard focus treatment. **Restraint:** keep the count inside the field and omit
extra explanatory rows; screen readers retain useful state. **Risk:** a matched word may remain under Show more;
this follows the requested simple filtered-message presentation. Reject modal
palettes, separate results pages and relevance ordering for this slice.

Data flow:

`ChatDetail.notes -> cached Markdown analysis -> normalized searchable fields ->
AND matcher -> existing filter intersection -> existing message renderer`.

Affected files:

- `src/client/project-search.ts` and tests: normalization, field matching, bounded
  query validation and workspace-owned parsed-body cache, pruned on removal.
- `src/client/search-highlight.ts` / `HighlightText.tsx` and tests: safe rendered-text highlighting,
  Unicode offsets and inline Markdown runs.
- `src/client/ProjectSearch.tsx` and tests: compact control, debounce/IME,
  focus/clear/close and accessible status.
- `src/client/App.tsx` and tests: controls, filter composition, context action,
  and hidden-save status; share analysis with Links.
- `src/client/history-position.ts` and tests: independent search anchors and
  intentional context navigation; include query identity in HistoryNavigation.
- `src/client/send-feedback.ts`: successful saved-note identity, distinct from
  the existing new-note entrance identity so edits do not replay arrivals.
- `src/client/styles.css`: compact borderless row and context icon.
- `e2e/project-search.spec.ts`: real browser workflow and layout evidence.
- Project, architecture and user-guide documents: current behavior and limits.

Input/text are untrusted; use string matching and existing React/Markdown text
rendering, never query-generated regex or innerHTML. Filenames stay display data,
never paths. Existing attachment loading/action security is unchanged.

## Data and migration impact

None. No API, database, migration, index or backup format changes. Schema remains 7.
Removing client code rolls back the feature without data conversion.

## Phases

1. **Matching foundation:** RED then GREEN tests for literals, Unicode, Markdown,
   field boundaries and length. Outcome: deterministic client matching.
2. **Complete UI flow:** test compact controls, filters, read/return, anchors,
   drafts and mutations. Outcome: the approved minimal UI with reliable navigation.
3. **Review and verification:** browser flows, performance measurements,
   security/reviewer review and full repository gates. Outcome: verified feature
   with evidence and explicit limits. All three phases are complete.

## Test plan

- Unit: AND/substring/case/NFC, accents, Cyrillic/CJK/emoji, punctuation, blank and
  overlong queries, hidden URLs/HTML, sender/filename boundaries and cache refresh.
- Component: debounce/current callback/unmount, IME/Escape, clear focus, minimal
  controls, Files intersection/empty recovery, context focus, drafts, navigation,
  editing and sending notes that cease to match.
- History: filtered entry anchor, All preservation, query transitions, context
  target, existing deleted-anchor/rapid-navigation tests and history arrows.
- E2E: saved data; search without requests; mobile/desktop themes; compact field;
  clear restores position; open-in-history focuses target; examples/narrow/zoom.
- Performance: measure 1,000/10,000 synthetic ~1 KiB notes and a 10,000-character
  note. Record cold preparation separately from warm scans and DOM rendering.
  No promise of unbounded history support; revisit architecture on evidence.
- Final gate: `npm run verify` (release contract, build, types, lint/format,
  coverage, migrations, desktop Chromium/mobile WebKit E2E, dependency audit,
  managed install/update/uninstall smoke). Report exact failures/limits.

## Risks and mitigations

Linear matching and full-history rendering limit very large projects. Cache
parsed bodies and debounce input; benchmark instead of silently limiting results.
Anchor regressions are protected with component and real-browser tests.
Literal matching can surprise users expecting stemming/typos; explain it in the
user guide. Search reflects loaded saved data and existing refresh behavior, not
new multi-tab synchronization. No schema or data-loss exposure is added.

## Open decisions

None blocking. Scope and revised visual direction are approved. Full-text search
under collapsed content and accent-sensitive literal matching are documented.

## Remaining scope and tracking

No unfinished implementation remains in this slice. Cross-project/semantic search,
indexing and timeline virtualization remain non-goals, not committed follow-ups.
Manual history/composer accessibility validation remains tracked by
[issue #63](https://github.com/satankov/on-track/issues/63). Issue #61 remains open
for tracker reconciliation, but its focus fix and regression shipped in v0.1.0;
subsequent Linux Node 22.16/24 CI passed the attachment test. See
[the closure evidence](0025-security-audit-response.md#tracker-reconciliation).
Local search browser passes do not establish manual accessibility support.

## Verification evidence

- `npm run verify`: PASS, including release contract, build, types, lint,
  formatting, coverage, migrations, E2E, security audit, and all managed smoke
  checks. Node 22.18.0 on macOS arm64.
- Unit/integration: 78 files; 1,028 passed, 9 existing platform skips.
  Coverage: 91.85% lines, 90.74% statements, 93.01% functions, 84.83% branches.
  Search controls: 100% lines, 95.45% branches. Highlighting: 100% lines,
  92.5% branches before separating its React component from the pure helpers.
  History position: 100% lines, 95.23% branches.
- Migration integrity: 23 passed. Browser E2E: 66 passed, 6 existing skips.
  Search-specific flows passed desktop Chromium and mobile WebKit, including
  320px Examples, CSS 200% zoom, three themes, compact field geometry, 44px touch
  targets, no requests while typing, restoration and context focus. Representative
  screenshots were visually inspected. Final targeted search/example E2E: 8 passed, including
  thin composer feedback, Safari timestamp/participant focus, inline counts, highlights, exterior action
  bounds and retained queries. Build, types, lint (zero warnings), formatting,
  and focused tests were rechecked after extracting the highlight component.
  Real screen-reader/native keyboard
  validation and other OS/runtime matrices were not performed in this slice.
- Security audit: zero production dependency vulnerabilities. Reviewer/security
  tracing found no remaining actionable rendering, navigation, read-only, or
  database-boundary issue. Diff inspection and
  `git diff --check` passed. Build retains its existing >500 kB chunk warning.
- TDD: tests first reproduced absent search controls, missing counts, lost queries,
  incorrect anchor restoration and Safari's thick native timestamp outline.
  Matching, debounce/IME, navigation, hidden-save announcements, Unicode-safe
  highlights and query retention now pass. Pending typing updates session memory
  without rerendering the timeline before the debounced query commits.
- Synthetic matcher measurements (Apple M4, Node 22.18.0, ten warm scans):
  1,000 ~1 KiB notes prepared in 194 ms, slowest warm scan 0.26 ms; 10,000 notes
  prepared in 1,688 ms, slowest warm scan 1.78 ms. One 10,000-character note
  prepared in 1.12 ms. These measure parsing/matching, not browser DOM rendering;
  no large-history render-speed claim is made. General timeline virtualization
  remains outside this slice. No dependencies or migrations were added.
