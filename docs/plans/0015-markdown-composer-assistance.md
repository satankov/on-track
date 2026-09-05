# Markdown composer assistance plan

## Status

Implemented and verified on 2026-09-05 after project-owner approval of the
revised compact presentation and familiar keyboard shortcuts.

Verification evidence:

- focused transformation and component suites: 78 tests passed;
- full `npm run verify`: release contract, build, typecheck, lint, formatting,
  444 unit/integration/component tests (1 skipped), migrations, 22 browser tests
  across desktop Chromium and mobile WebKit (2 intentionally skipped), and the
  high-severity production dependency gate passed;
- coverage: 91.20% statements, 85.58% branches, 93.91% functions, and 92.67%
  lines;
- the production audit still reports one moderate Fastify advisory below the
  repository's configured high-severity failure threshold; no dependency was
  changed in this client-only slice;
- actual UI captures were inspected at desktop, iPhone 13, and 320px. The open
  strip is 46px, the 320px tool row scrolls internally, and all edit controls fit
  inside the composer.

## Goal

Help people recall and apply useful Markdown while they write or edit an On
Track message, without replacing the compact composer with a document editor or
hiding the Markdown source that the application stores.

## Context and reusable precedent

New messages and message edits already share one controlled textarea in
`ChatWorkspace`. Pending attachments and timestamp editing already establish a
pattern for optional rows inside the composer. Programmatic draft updates reuse
the existing textarea auto-sizing path, and submitted content already renders
through `react-markdown` with `remark-gfm` and raw HTML skipped.

The existing flat-workspace direction describes a quiet project ledger with
native-messenger speed: notes are the visual subject, project accent is an
orientation and action role, persistent surfaces remain flat, and the composer
stays compact at rest. Markdown assistance should extend that system rather
than add a permanently visible word-processor ribbon, a modal reference page,
or a split preview.

GitHub's maintained
[`markdown-toolbar-element`](https://github.github.com/markdown-toolbar-element/)
confirms the established selection-aware toolbar model for textareas.
[GitHub's Markdown shortcuts](https://docs.github.com/en/get-started/accessibility/keyboard-shortcuts#comments)
also cover bold, italic, link, inline code, ordered list, bulleted list, and
quote. [Google Docs](https://support.google.com/docs/answer/179738) uses the same
list chords and adds Cmd/Ctrl+Shift+9 for checklist. This slice will reuse those
interaction conventions, not either product or package: On Track already has
the required controls, icons, and styling primitives. Browser textarea
selection and range APIs are sufficient, so no production dependency is
proposed.

## Direction brief

- **Job:** recall and apply common Markdown without leaving the note in progress.
- **Audience and environment:** managers and individuals making quick,
  private project notes, primarily on desktop with mobile regression coverage.
- **Design thesis:** reveal one compact formatting strip at the moment of need,
  letting the note remain dominant while direct manipulation and familiar
  shortcuts expose Markdown only when useful.
- **System choices:** reuse current system-sans typography, semantic theme
  tokens, flat borders, compact density, 36px composer controls, project accent
  for the active disclosure, and existing focus treatment. Add no shadow,
  gradient, font, icon package, or essential motion.
- **Signature:** a focused tool updates a tiny trailing teaching hint containing
  its name, literal Markdown mark, and shortcut—for example
  `Bold · **text** · ⌘B`—without making every tool permanently large.
- **Risk and restraint:** icon-first controls are denser and require careful
  labels. A visible hover/focus hint, accessible names, and `aria-keyshortcuts`
  carry that meaning while the open strip adds only about 44–46px.
- **Rejections:** full WYSIWYG editing, live split preview, floating selection
  toolbar, full-screen cheat sheet, or an always-visible formatting ribbon.

## Visual integration

- [Desktop open state](../visuals/markdown-composer-assistance-desktop.svg)
- [Mobile open state](../visuals/markdown-composer-assistance-mobile.svg)

The Markdown control sits beside Attach and Timestamp. Activating it adds one
44–46px in-flow formatting strip above the textarea, following the existing
conditional-row pattern. It has no heading block or cards. Nine 32px tool
buttons sit in a single row. Hovering or focusing a tool updates a compact hint
at the trailing end of that same row with the action name, source syntax, and
shortcut. The strip stays open while actions are used, is collapsed by default,
and never covers the draft.

On narrow screens the same single row scrolls horizontally inside the composer;
it does not reflow into a tall grid. A subtle edge cue communicates that more
tools are available. The page itself must not gain horizontal overflow.

## Proposed first slice

The strip contains nine actions:

1. **Bold** wraps the selection in `**`; with no selection, it inserts and
   selects a `text` placeholder.
2. **Italic** wraps the selection in `*`; with no selection, it inserts and
   selects a `text` placeholder.
3. **Link** creates `[label](url)` using selected text as the label when
   available, then selects the editable URL.
4. **Quote** prefixes the current line or each selected line with `> `.
5. **Bullets** prefixes the current line or each selected line with `- `.
6. **Numbered list** prefixes the current line or each selected line with an
   ordered Markdown marker.
7. **Checklist** prefixes the current line or each selected line with
   `- [ ] `.
8. **Code** uses backticks for a single-line selection and a fenced code block
   for a multiline selection.
9. **Table** inserts a two-column, two-row GFM skeleton at a valid block
   boundary, including the blank line required before the table, then selects
   the first header placeholder.

Assumption: the user's example of making text look like a citation means a
Markdown blockquote, presented as **Quote**. Academic citation or footnote
syntax is not part of this slice.

Selection behavior is deterministic. Inline actions wrap only the selected
text. Line actions prefix complete affected lines. Table insertion never
discards a non-empty selection. After every successful action, focus returns to
the textarea and the intended placeholder or transformed text remains selected.
An operation that would exceed the existing 10,000-character limit leaves the
draft unchanged and announces the reason.

### Keyboard shortcuts

Shortcuts work whenever the shared message textarea is focused, whether the
formatting strip is open or closed:

| Action        | macOS            | Windows/Linux     |
| ------------- | ---------------- | ----------------- |
| Bold          | Cmd+B            | Ctrl+B            |
| Italic        | Cmd+I            | Ctrl+I            |
| Link          | Cmd+K            | Ctrl+K            |
| Code          | Cmd+E            | Ctrl+E            |
| Numbered list | Cmd+Shift+7      | Ctrl+Shift+7      |
| Bulleted list | Cmd+Shift+8      | Ctrl+Shift+8      |
| Checklist     | Cmd+Shift+9      | Ctrl+Shift+9      |
| Quote         | Cmd+Shift+Period | Ctrl+Shift+Period |

Table remains click/tap only because there is no broadly recognized table
shortcut. The handler intercepts these exact chords only while the textarea is
focused, ignores IME composition and key-repeat events, and leaves every other
browser or operating-system shortcut untouched. Cmd/Ctrl+Enter continues to
submit.

## Acceptance criteria

1. A native button named **Show Markdown assistance** appears beside the
   existing attachment and timestamp controls in both add and edit states.
2. The button exposes `aria-expanded` and `aria-controls`; its accessible name
   changes to **Hide Markdown assistance** while open.
3. The closed state preserves the current desktop composer height contract,
   textarea auto-sizing, and message-history space.
4. The open strip adds no more than 46px above the textarea and contains the
   nine actions above in one row. It has no large cards or heading block.
5. Every icon-first control has an accessible name, `aria-keyshortcuts` where
   applicable, and a hover/focus hint with its name, syntax, and shortcut when
   space permits. Narrow touch layouts retain the accessible name and shortcut
   metadata without adding another row.
6. Selected text is wrapped or line-prefixed without content loss. With no
   selection, an editable placeholder is inserted and selected.
7. Quote produces a rendered blockquote, and Table produces a rendered GFM
   table after the note is saved.
8. Formatting never submits, clears, truncates, or silently replaces unrelated
   draft content.
9. The strip remains open after insertion. Escape closes it, and focus returns
   sensibly to the editor or disclosure control.
10. Every action is keyboard operable with a visible focus state. No custom
    roving-tabindex toolbar behavior is introduced; normal tab order remains
    predictable.
11. The documented formatting shortcuts produce exactly the same transformation
    and restored selection as clicking their controls, even while the strip is
    closed. They are ignored during IME composition and key repeat.
12. Existing Cmd/Ctrl+Enter submission, attachments, timestamp, Cancel,
    Add/Save, draft preservation after errors, and textarea resizing remain
    unchanged.
13. The open and closed states work without document-level overflow at the
    desktop, iPhone 13, 320px, and 200% zoom review widths.
14. On narrow screens only the formatting strip scrolls horizontally, retains
    usable pointer targets, and visibly indicates additional offscreen tools.
15. Light, Neutral, Dark, forced-colors, and reduced-motion modes remain usable;
    meaning is not conveyed by project accent alone.
16. Raw HTML remains inert. No API, server, domain, database, migration,
    backup, or stored-preference contract changes.
17. No production dependency is added.

## Non-goals

- WYSIWYG editing or live Markdown preview.
- Parser-aware toggling or removal of existing syntax.
- Academic citations, footnotes, images, mentions, alerts, diagrams, or custom
  Markdown extensions.
- Persisting whether the formatting strip is open.
- A keyboard shortcut for Table or the Markdown-strip disclosure itself.
- A guaranteed browser-native Undo entry for programmatic formatting.
- Server, API, domain, database, migration, backup, or security-boundary work.

## Proposed design and affected files

- Add `src/client/markdown-assistance.ts` with action definitions and a pure
  transformation contract returning the next value and selection range.
- Add `src/client/markdown-assistance.test.ts` for wrapping, line prefixes,
  placeholders, multiline code, table block placement, content preservation,
  and the character limit.
- Update `src/client/App.tsx` with the disclosure state, compact labelled
  formatting strip, inline stroke icons, exact shortcut handling, and controlled
  textarea focus/selection restoration. Keep draft ownership and submission in
  `App` unchanged.
- Update `src/client/styles.css` with the flat 44–46px in-flow strip, 32px tool
  controls, trailing hover/focus teaching hint, narrow-screen horizontal scrolling,
  theme mappings, focus, and forced-colors behavior.
- Extend `src/client/App.test.tsx` for disclosure semantics, Escape and focus,
  add/edit reuse, every shortcut, closed-strip shortcut use, IME/key-repeat
  handling, limit feedback, and composer regressions.
- Extend `src/client/theme.test.ts` only where a token or theme regression
  assertion is valuable; no new color system is expected.
- Extend `e2e/project-chat.spec.ts` with a real Quote and Table create/edit
  journey, responsive overflow checks, and the unchanged closed-composer
  geometry guarantee.
- After implementation is verified, update `README.md`, `docs/PROJECT.md`, and
  `docs/ARCHITECTURE.md` to describe the delivered client-only capability and
  critical journey. No ADR is expected.

## Data and migration impact

None. Existing Markdown source remains ordinary note text. There is no schema,
migration, transport, stored preference, backup-format, or data-conversion
impact. Rollback is limited to the client helper, component, styles, tests, and
delivered-capability documentation.

## Phases

1. **RED — transformation guarantees.** Add failing pure tests for every action,
   selection/caret result, safe table placement, preservation of selected text,
   and the 10,000-character boundary. Expected evidence: focused tests fail only
   because the helper is absent.
2. **RED — composer workflow.** Add failing component tests for compact
   disclosure semantics, Escape/focus behavior, create/edit reuse, exact
   shortcut mapping, shortcuts while closed, IME/key-repeat handling, limit
   feedback, and unchanged submission. Expected evidence: the new guarantees
   fail against the current composer while existing tests remain green.
3. **GREEN — transformation core.** Implement the pure helper and connect it to
   the shared controlled textarea, restoring focus and selection after React
   updates. Expected evidence: helper and focused integration tests pass.
4. **GREEN — compact formatting strip and shortcuts.** Add the single-row
   in-flow strip with native buttons, existing tokens/icons, a teaching hint,
   and textarea-scoped shortcut handling. Expected evidence: component tests
   pass in add and edit modes, the open strip adds at most 46px, and the closed
   desktop composer remains no taller than 72px.
5. **Responsive and accessibility hardening.** Verify internal horizontal
   scrolling, normal tab order, visible focus, the hint on hover and focus,
   Escape, 200% zoom, forced colors, long text, and no page overflow. Expected
   evidence: rendered desktop/mobile inspection plus targeted browser
   assertions.
6. **Rendered workflow and durable docs.** Insert Quote and Table syntax, save,
   verify the rendered semantic elements, edit again, and save another
   transformation. Update durable docs only after the behavior is verified.
7. **Review and full verification.** Inspect the complete diff, run the
   repository verification gate, and record evidence and remaining risks in
   this plan.

## Test plan

```sh
npm test -- src/client/markdown-assistance.test.ts src/client/App.test.tsx src/client/theme.test.ts
npx playwright test e2e/project-chat.spec.ts --grep "formats Markdown selections in a compact, responsive composer strip"
npx playwright test e2e/project-chat.spec.ts --grep "uses compact desktop chrome and an auto-growing composer"
npm run verify
git diff --check
git status --short
```

Rendered inspection covers 1440x900, 1024x768, iPhone 13, 320px width, and a
640px effective viewport representing 200% zoom. States include strip closed
and open, selected text, focused hint, narrow horizontal scrolling, add and edit,
attachments, timestamp, all three themes, keyboard-only use, long or localized
hint text, and an insertion refused at the character limit.

## Risks and mitigations

- **Caret drift after controlled React renders:** return explicit offsets from
  the pure helper and restore them in a layout effect; test add/edit and
  auto-resize together.
- **Undo behavior differs across browsers:** browser checks confirmed that the
  controlled React draft update does not create a native Undo entry in Chromium
  or WebKit. Guaranteed one-step Undo is explicitly deferred, and this slice
  does not claim it; adding it safely requires a separate editor-state decision.
- **Text loss from complex insertion:** Table never replaces selected text, and
  exact before/after strings are unit tested.
- **Icon ambiguity:** give every tool an accessible name and update the trailing
  hover/focus hint with the action, syntax, and shortcut when space permits.
- **Composer crowding:** keep the strip collapsed by default, constrain it to
  one 44–46px row, and scroll that row internally on narrow screens.
- **Browser shortcut conflicts:** handle exact chords only while the textarea is
  focused, ignore composition/repeat events, and cover unhandled shortcuts with
  regression tests.
- **Markdown nesting surprises:** keep the first slice insertion-based rather
  than parser-aware; repeated actions may intentionally nest source marks.
- **Character-limit bypass:** calculate the transformed length before committing
  and announce a refusal without mutating the draft.
- **Terminology mismatch:** label blockquote behavior as Quote and keep academic
  citations or footnotes out of the approved slice.

## Resolved decisions

The proposed defaults are:

- interpret “citation” as **Quote** (`> text`);
- implement the nine-action compact client-only strip shown in the revised
  mockups;
- support the familiar textarea-scoped shortcuts documented above;
- defer live preview, footnotes, and WYSIWYG behavior.

Changing any of these choices materially changes the first slice and should be
resolved before implementation.

## Approval

Approved for implementation on 2026-09-05, including the Quote interpretation,
compact nine-action strip, and documented shortcuts.
