# threadstr UI cookbook

Stable design contract · established 2026-10-26 from the current flat UI.

Read this before changing any product UI, including a small control or dialog.
The [visual cookbook](branding/threadstr/ui/index.html) demonstrates the rules
with the real [application stylesheet](src/client/styles.css). The
[logo kit](branding/threadstr/v1/README.md) owns artwork usage.

## Overview

threadstr is a private project notebook used repeatedly throughout the day.
The interface should feel quiet, compact, and flat: content establishes hierarchy;
tonal surfaces group controls; borders and motion communicate specific states.
The signature is a restrained project accent, a chronological message stream,
and the approved ribbon wordmark. Settings remain a desktop workspace.

### Authority and maintenance

- The user's latest explicit direction takes precedence. Otherwise use this
  contract without asking the user to repeat fonts, margins, or control styling.
- `src/client/styles.css` owns executable color tokens and component geometry.
  This document owns their intended use and the preferred patterns for new work.
  The cookbook imports that stylesheet; it is a visual reference, not a second
  component library or a copy of the token declarations.
- Values below are the approved baseline, not permission to silently redesign
  existing screens. When code and this contract disagree, inspect the affected
  component and Git diff. Preserve explicit user decisions; fix or document the
  discrepancy in the same scoped change. Do not infer a new standard from a
  legacy selector or an accidentally duplicated value.
- Changes to a shared rule must update this contract, its cookbook specimen, and
  the affected production selectors together. No new design-system dependency,
  font package, CSS framework, or broad token migration is needed to use this.
- Pixel equivalents assume the browser's normal 16px root. Preserve browser font
  scaling; do not impose a root pixel size to force the equivalents below.

## Colors

Use semantic custom properties. Do not put raw white, black, brand hex values, or
per-theme conditionals inside new component styling. The visual cookbook lists
the complete active palette, including inherited values, directly from CSS.

| Role / token                        | Light   | Neutral | Dark    |
| ----------------------------------- | ------- | ------- | ------- |
| App canvas `--canvas`               | #f3f5f7 | #30343a | #111417 |
| Group / bubble `--paper`            | #ffffff | #383d44 | #181c20 |
| Sidebar `--rail`                    | #eef1f4 | #292d32 | #0d1013 |
| Workspace `--history`               | #f6f7f9 | #32373d | #13171b |
| Icon control `--control`            | #ffffff | #444a52 | #242a30 |
| Selected / hover `--selection`      | #f8fafc | #454b53 | #222830 |
| Composer `--field`                  | #ffffff | #3e444b | #20262c |
| Primary text `--ink`                | #17191c | #f4f6f8 | #f4f6f8 |
| Secondary text `--muted`            | #626a75 | #c4cbd3 | #b6bec8 |
| Placeholder `--placeholder`         | #6f7780 | #aeb6c0 | #929ca8 |
| Structural separator `--line`       | #e8ebef | #3a4047 | #252b31 |
| Strong separator `--line-strong`    | #d8dde3 | #626b76 | #444c56 |
| Control boundary `--control-border` | #8a929c | #939eaa | #6e7a87 |
| Control focus `--focus`             | #0b63ce | #8bb8ff | #8bb8ff |
| Primary action `--button-primary`   | #20242a | #1f66ad | #1f66ad |
| Action text `--on-action`           | #ffffff | #ffffff | #ffffff |

### Accents and specialized surfaces

- The single Accent picker lists Coral, Amber, Moss, Ocean, Iris and Slate, then
  Guava, Honey, Jade, Lagoon, Orchid and Periwinkle. Both Create and Edit use
  this order. The name beside Accent follows the checked swatch.
- The first six use the original flat palette, with solid action fills and a
  message tint mixed into paper at 36% in Light and 8% in Neutral and Dark.
- Guava moves from apricot to rose, Honey from gold to copper, Jade from sage
  to teal, Lagoon from teal to blue, Orchid from lavender to plum and
  Periwinkle from powder blue to violet. Their 118° outgoing message gradients
  put the project tint at 47%. Their composer actions use deeper versions for
  white text. Swatches and the rail marker share the project hue.
- Participant messages use solid paper in conversation history and search.
- Message links and metadata use `--message-link` and `--message-muted`.
  Attachments use their own `--attachment-*` foreground, status, and surface
  pairs. Do not substitute generic muted text on a dark attachment inset.
- Errors, warnings, success, and search use `--critical`, `--critical-soft`,
  `--warning`, `--success`, `--search-match`, and `--search-match-ink`. Include
  text or an icon/state marker; color alone cannot communicate status.
- Theme preference is Light/Neutral/Dark, database-backed; Light is the fresh-database fallback.
  Theme changes colors and native `color-scheme`, never layout or type metrics.

## Typography

Use `Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.
Inter is a preference in the stack, **not a bundled or downloaded font**. Rendering
uses available system fonts. `font-synthesis: none`; controls inherit the family.
Do not add a second display font. Use monospace only for code, commands, or
technical values. Use the approved SVG for the logo; preserve the existing
`.brand-fallback` text in forced-colors mode when the SVG is hidden.

| Role             | Size              | Weight | Line height / tracking     | Existing selector                       |
| ---------------- | ----------------- | ------ | -------------------------- | --------------------------------------- |
| Settings title   | 1.4rem / 22.4px   | 650    | normal / −0.02em           | `.settings-workspace-header h1`         |
| Dialog title     | 1.4rem / 22.4px   | 650    | 1.3 / −0.025em             | `.project-dialog h2`                    |
| Chat title       | 1.12rem / 17.92px | 650    | 1.3 / −0.025em             | `.chat-heading h1`                      |
| Message prose    | 0.95rem / 15.2px  | normal | 1.52 / normal              | `.note-body`                            |
| Settings section | 0.9rem / 14.4px   | 650    | normal / −0.02em           | `.settings-panel-copy h2`               |
| Settings row     | 0.84rem / 13.44px | 500    | normal                     | `.project-label-option`                 |
| Field label      | 0.78rem / 12.48px | 650    | normal                     | `.project-settings-fields .field-label` |
| Help below group | 0.75rem / 12px    | normal | 1.5                        | `.field-help`                           |
| Standard button  | 0.8rem / 12.8px   | 700    | normal                     | `.button`                               |
| Composer Send    | 0.72rem / 11.52px | 750    | normal                     | `.send-button`                          |
| Participant name | 0.72rem / 11.52px | 800    | 1.2                        | `.message-sender`                       |
| Timestamp        | 0.68rem / 10.88px | 700    | normal                     | `.message-time`                         |
| Message label    | 0.65rem / 10.4px  | 700    | 1.2                        | `.message-label`                        |
| Toolbar caption  | 0.6rem / 9.6px    | 800    | normal / 0.09em, uppercase | `.composer-timestamp-row .field-label`  |

The small metadata/caption roles are existing compact UI exceptions, not sizes
for new body text, instructions, or ordinary controls. Use the nearest role;
do not invent intermediate font sizes. Keep sentence case except established
rail/toolbar captions. Long message text wraps; project names and chat titles
may truncate with ellipsis. Preserve full accessible names.

Large Home/empty-state headings and the mobile chat title (1.65rem) are existing
contextual exceptions. Never transplant their display sizes into settings.
Do not infer guaranteed font-file weight availability from the CSS weight number.

## Layout & Spacing

Default spacing vocabulary for new compositions: **4, 8, 12, 16, 24, 32, 48px**.
Existing component contracts below include deliberate 6/10/14/20/28px values;
reuse them inside those families rather than rounding every value globally.

| Relationship             | Contract                                                                      |
| ------------------------ | ----------------------------------------------------------------------------- |
| App frame                | 100dvh; rail `clamp(260px, 22vw, 300px)`; remaining workspace `minmax(0,1fr)` |
| History column           | `--chat-column-width: 1040px`; filter rail 128px                              |
| Settings right gutter    | `--settings-gutter: clamp(20px, 3vw, 40px)`                                   |
| Settings left gutter     | **3 × right gutter**, measured from workspace edge, after sidebar             |
| Desktop settings content | max 840px; left aligned; no auto-centered narrow card                         |
| Settings heading         | 28px above; align left edge with panels and backup feedback                   |
| Settings sections        | 24px vertical margin; clear background on outer panel                         |
| Edit form                | 24px top, 32px bottom; content width plus both gutters, capped at 100%        |
| Edit controls            | Back at the top left, Save changes at the bottom right after the fields       |
| Field groups             | 24px between; label 8px above; help 8px below, inset 4px                      |
| Group row                | min 48px, padding 10px 14px, gap 12px; natural height for wrapped text        |
| Name / General row       | min or fixed height 50px as implemented                                       |
| Messages                 | 18px between day groups; 10px date-to-list; 8px between messages              |
| Bubble                   | padding 10px 12px 6px; max stack `min(760px,82%)`                             |

At a 1440px viewport, sidebar ends at x=300 and settings content starts at x=420:
120px left gutter, 840px maximum content, 40px minimum right gutter. At 1024px,
left gutter is 92.16px; width shrinks to fit. **Do not change both gutters when
the requested adjustment is to the left margin.**

### Responsive rules

- Above 760px keep the desktop sidebar/workspace model. At ≤960px message
  actions sit below the bubble. Devices with coarse pointers or no hover
  keep those actions visible below the bubble at every width.
- At ≤760px use the single-pane app; project detail hides the project rail.
  Settings navigation is horizontal, theme previews become one column, and
  **both settings gutters are 16px**. The triple desktop inset does not apply.
- At ≤420px preserve composer toolbar access and full-width input. Use the
  existing compact control rules, not a second mobile composition.
- Chat has 600px container queries independent of viewport width; inspect these
  when changing search or examples. Home's 1100px breakpoint is Home-specific.
- Verify 1440×900, 1024×768, 390×844 and 320px-wide reflow. At 200% zoom, wrap
  labels/help and keep actions reachable. Local tables/code may scroll; the
  document must not gain horizontal overflow. Mobile remains an alpha target.

## Elevation & Depth

Flat does not mean removing state or accessibility. Resting containers use tonal
separation, whitespace, and alignment. No decorative bright outline around a
composer, participant bubble, message label, rail Add/Settings button, history
arrow, label popup, or settings group. Never nest a cosmetic card behind a group.

| Treatment                       | Allowed use                                                                      |
| ------------------------------- | -------------------------------------------------------------------------------- |
| No border / no shadow           | Normal grouped settings, bubbles, composer, icon buttons, labels                 |
| 1px `--line`                    | Composer toolbar separators and table cells                                      |
| 1px `--line-strong`             | Existing compact sender/timestamp control boundaries                             |
| 1.5px `--muted`                 | Unchecked square checkbox; meaningful off-state affordance                       |
| 1px `--focus`, offset 1px       | Keyboard focus for non-text controls                                             |
| `0 12px 34px` shadow at 22%     | Floating message action and label popups                                         |
| `0 20px 60px` shadow at 22%     | Create dialog only                                                               |
| Transparent → `--history`, 32px | Composer's top fade; `pointer-events:none`; no black band                        |
| Content mask, final 3.75rem     | Collapsed message text fades into the underlying bubble gradient above Show more |

Overlay backdrops use `--overlay` at 54% with 3px blur, applied once to the native
`::backdrop`. The full-viewport dialog shell is transparent and resets native
maximum dimensions so its content stays centered. Blur is an overlay
exception, not a glass visual system for ordinary product surfaces.
The future-message boundary keeps its subtle top line and full-width fade.
It starts with the project marker color, passes through the message tint,
and ends on the history background.

Keep the existing stacking relationships: normal content 0–2, composer 3,
history arrows 4, global error 5, dialog backdrop 10, label popup 12 inside its
message context. Native modal dialogs use the top layer. A larger number alone
does not fix clipping or a parent stacking context.

### Motion

- Small hover/reveal transitions: 140ms ease. New transitions belong inside
  `prefers-reduced-motion: no-preference` when movement is involved.
- Message arrival: 220ms, opacity and translateY(6px),
  `cubic-bezier(0.2,0.75,0.25,1)`.
- Accepted send/edit-save attempt: 720ms accent outline pulse; it starts before
  the API completes and must not imply persistence. Message arrival follows the
  saved result. Reduced motion gives 180ms static feedback and no translation.
- Read-only example feedback is its existing 800ms state. No loops, parallax,
  animated gradients, or spring effects for ordinary controls.
- In forced colors, hide decorative fades and restore system-colored boundaries
  and checked states. Never suppress focus in the name of flatness.

## Shapes

| Family                                           | Radius / size                                          |
| ------------------------------------------------ | ------------------------------------------------------ |
| Settings groups, fields, composer, theme preview | 12px                                                   |
| Create dialog                                    | 16px; max-width 560px; padding `clamp(20px,4vw,32px)`  |
| Standard buttons                                 | 8px; min-height 40px; horizontal padding 15px          |
| Rail Add / Settings                              | 9px; 38×38px; visible keyboard focus                   |
| History arrows                                   | Circle; 44×44px; 20px icon                             |
| Checkbox                                         | 5px; 22×22px square inside a clickable row             |
| Accent swatch                                    | Circle 28px inside a 44px target; wrap at tight widths |
| Own bubble                                       | 14px 14px 5px 14px; participant: 14px 14px 14px 5px    |
| Message-label popup                              | 9px; width 218px; padding 10px                         |
| Text label                                       | Pill 999px; min-height 18px; padding 1px 6px           |
| Attachment group / row                           | 10px / 7px                                             |

Radii are component families, not permission to round every wrapper. A new
settings surface uses 12px; it does not get an arbitrary 18px radius.
Prefer 44px targets for new standalone icon actions. Existing compact controls
may be smaller; verify target size/spacing and do not shrink them further.

## Components

### Project rail

The rail header, footer and edge meet the surrounding surfaces without dividing lines.
The footer contains the Settings icon. The conversation header shares the history surface.

A project or child occupies one title row, at least 40px high (44px on narrow/touch layouts).
Hover or keyboard focus reveals a trailing strip ordered **Alert, Pin/Unpin, Archive, Delete**.
Use the shortcut disclosure on touch. Preserve title truncation and an independent title target.
Archived conversations offer Restore in the Archive position. Keep the actions reachable
while the pointer moves between them. On a hover-capable device, leaving the row
closes mouse-revealed shortcuts, including after selecting the title or toggling an action.
Keyboard users can tab across the actions and use Escape to dismiss.

An enabled manual Alert uses the same red dot and soft halo as the Alert history filter,
both at rest and in the expanded strip. The inactive shortcut uses the muted dot.
Clearing it returns the row to its message-derived Attention state. Expose the meaning
and current state in accessible text. Display mutation errors beside the affected row.
Section headings contain their name and disclosure chevron. The wordmark stands alone.

### Settings and Edit project

Use **heading → one adjustable group → useful note below**. Reuse
`.settings-workspace`, `.settings-panel`, `.project-settings-fields`, `.field-label`
and `.field-help`. Outer panels are transparent. No title echo, eyebrow, or
introductory sentence explaining that this is the settings screen.

- Edit has an accessible main landmark named Edit project, no visible duplicate
  title. The Settings-style back arrow (accessible name “Back to project”) comes first,
  at the top left. Save changes follows the last field at the bottom right.
- Project accent: one wrapping swatch strip, native radios, visible check on
  selected swatch. Color names remain accessible, not printed beside every dot.
- Project labels: one column, icon then name then right-aligned square checkbox.
  On = filled square with check; off = empty outlined square. No iPhone switch.
  Optional rows use a quiet two-line drag handle in a 36px left column with a
  44px target. The entire row follows the pointer; neighbors shift to open its
  destination. Stable layout slots support hit testing and autoscroll. Use the
  dragged row's center, including its grab offset, and the final release coordinates
  to choose the destination. Arrow keys and
  Home/End reorder from the focused handle; selecting a handle and then another
  provides a tap alternative. Escape cancels. Keep touch scrolling on the rest
  of the row; only the handle has `touch-action:none`.
  Built-in and custom rows share a 48px base height, 44px symbol and checkbox
  columns, flexible name, 44px controls, and settings-row typography. Built-in
  values stay read-only. Custom inputs have accessible names and visible `☆` /
  `Label name` placeholders; no field headings. Every filled custom row has a
  small × action right of its checkbox, including saved and shuffled labels;
  removal applies on Save and restores focus to a neighboring control. Keep one empty
  row last until five custom slots are occupied. Typing a name or symbol
  activates it and reveals the next empty row without losing focus. Empty rows
  have no handle/actions and never enter Save. Fully cleared custom rows collapse
  into one blank, including saved labels; Save removes their definitions and
  message tags. Retyping before Save retains the current row's identity.
  Custom names allow eight grapheme characters and one optional glyph; field
  errors appear while typing. Keep the concise limits/disablement note,
  with keyboard/tap reordering details in the handle's accessible description.
  Display the built-in `open-question` label as “Question”; its stored canonical
  name remains unchanged for backup compatibility.
- General uses the same row/checkbox. Backups keep left-side selection checkboxes
  because these are bulk selection lists, not setting switches.
- Archive, Restore and Delete belong to the project or subthread’s rail shortcuts.
  A save error appears beside the bottom submit button, with the draft ready to retry.
- Create project reuses the same field/swatch treatment in a real modal dialog.
  Keep its accessible title, Cancel/Create actions, Escape and focus restoration.
  Place “More settings in Edit project.” in the action footer using `.field-help`,
  vertically aligned with Cancel/Create. Keep the buttons together and right
  aligned; wrap the hint above them when narrow.
  Let `showModal()` establish initial focus and remember the opener; do not move
  focus into the form before opening the native modal.
- Appearance uses native radio previews, a check, and Selected text. Selection
  does not require an extra bright card outline. Focus is still visible.
  Previews wrap into as many 180px-minimum columns as the workspace can hold;
  a constrained desktop window must keep all choices reachable.
- Backups reuse field-label, settings-row, and help typography. Put export
  feedback directly after export actions, file-check feedback beside the file
  picker, and import feedback after import actions. Announce progress and errors,
  show the active action's busy label, and preserve selections for retry.

### Buttons, fields, and state

New project, Edit and Settings use transparent, borderless controls. Primary
commands such as Save changes and Create use the theme’s primary fill and action
text. The composer’s Add and Save buttons use the project’s accent-action fill.
Attachment actions use their local surface and foreground pair. Preserve disabled,
pressed and keyboard-focus states.

Text-entry fields use the native insertion caret to indicate focus. Keep their
edges clear of borders, outlines and focus shadows, including the surrounding
search and composer containers. Apply the same rule to names, custom labels,
sender, timestamp and add/edit textareas. Buttons, checkboxes, swatches and other
non-text controls retain visible keyboard focus. Associate validation errors
with their fields and announce submission feedback near its action.

### Project subthreads

The project row is Main, with no project-level chevron. Clicking it opens Main
and reveals children; clicking the already-open Main collapses children without
closing Main. Child text and Show all indent 24px; child titles use normal (400)
weight. Child hover/selection backgrounds span the same full width as Main.
Show five active children, pins first, keeping the selected child visible;
Show all expands in place. Preserve
candidate title-only rows and Attention indicators.

Child headers contain a muted clickable root, slash, and child title. Both titles
have min-width:0, single-line overflow and independent ellipsis; actions stay
visible. The root consumes at most 40% of available title space and short names
remain adjacent. Use the same branch glyph in New subthread and message actions.

Centered muted date-style markers show Independent subthread, Subthread from a
linked source, or Continued in a linked child. Never quote the source. Deleting a source message leaves its continuation link
at the same date and history position; the child’s source link focuses that marker.
Deleted source conversations receive explicit fallback text. Links retain visible keyboard focus.

Editable messages expose Label and More. Label opens the checkbox picker. In history,
Select messages comes first in More. The remaining actions are Continue in subthread,
Copy message, Edit, Delete and Open message in history where available. Reserve space for the two triggers on desktop and keep the
actions reachable on narrow screens, by keyboard and by touch. Creation asks for a name only. Child Edit exposes name, labels and message display. Children inherit their project accent. Search uses a native Project checkbox for whole-project
scope, including archived conversations. These new layout decisions target desktop.

### History filters

Preserve the existing filter width and button geometry. Labels use the existing
icon/name/count columns and truncation; adding definitions must not widen the
sidebar. On desktop its grid area spans both history and composer rows down to
the viewport bottom; composer growth cannot shorten the rail. Composer padding
and fade start in the right grid column. The filter list scrolls only when its
contents exceed that available height; its natural height puts the
centered, quiet `⌘/Ctrl + multiple` hint immediately below the final label, without a
checkbox or bottom anchoring. The hint shares the send shortcut's 0.64rem size,
normal line height, 400 weight, inherited font and muted color. Each selected button is pressed; All represents
the empty selection. Mobile retains horizontal filters with the hint underneath.
Touch taps toggle selections directly; mouse clicks use platform modifiers. Counts represent the
whole project even when the selected filters intersect.

### Message stream, composer, labels, attachments

- **Select messages** checks the invoking message and opens a selection bar
  in the composer's place. Align native square checkboxes in one left gutter
  for both senders. Shift-click or Shift+Space extends the selection from the
  last picked message through the current message, inclusive. Select all picks
  every message in the current filtered history. Show the count alongside
  Select all, Cancel, Copy, Move and Delete.
  Keep the draft and reading position when returning from the destination
  picker. Confirm deletion with the count and source conversation.
- Copy and Move use the Edit project's workspace layout. Keep Back, the
  title and search field above a scrolling list, with the counted action
  always visible below it. Use compact project rows matching the sidebar.
  A disclosure chevron marks projects with available subthreads.
  Clicking a project selects its main conversation and expands or collapses
  its indented subthreads. The project row itself names that destination.
  Choosing a subthread selects it instead. Search reveals matching subthreads.
  Omit archived projects and their children, and archived subthreads in active
  projects. Destination messages use the ordinary bubble,
  sender, time, label chips and editing controls.

- General’s **Always show message time** defaults on. When switched off, hovering
  anywhere across a message row reveals its bottom-right time. Keyboard focus
  within the row or a tap also reveals the time. Reserve its space to keep
  labels and bubble geometry stable.
- Own bubbles align right; participants align left with a sender label and
  neutral surface. Preserve readable Markdown, long-word wrapping, code/table
  scrolling, collapse/expand state, and complete copy/edit behavior.
- Render a single Enter as a line break in Markdown prose. Task list items use
  the same 22px square, 5px corners and checkmark as message selection.
  Each native checkbox has the task text as its accessible name. A click,
  tap, or Space saves the check. Keep clipped tasks outside the Tab order until
  Show more reveals them. Read-only Examples and message selection disable edits.
- Wrap Markdown tables in `.message-table-scroll`, a named keyboard-focusable
  region with local horizontal scrolling. Tables retain their content width;
  the bubble and its grid track stay within the message column. Collapsed content
  must not leave clipped links or table regions in the Tab order.
- Align draft save status to the trailing edge of the composer in muted 0.68rem text.
  Show “Draft saved” after the local write and file uploads finish. Unavailable
  files identify themselves inside the existing attachment chips. Place a
  retryable error directly above the composer.
- Reuse the full-width composer input above its toolbar. Sender, Timestamp,
  Format share compact 46px helper rows and left alignment. Timestamp is a
  native datetime-local input, 34px tall, max 240px wide; no `margin-left:auto`.
- The textarea uses 24px line height and grows to eight lines through existing
  logic. Keep the outer height cap and reachable toolbar on short viewports.
  At mobile widths reserve 260px above/below the composer (300px with search)
  within its viewport height cap, accounting for the two-row filter area.
- Label chips are borderless muted tonal pills; icon-only labels have transparent
  backgrounds. Reuse `LabelGlyph`, existing SVG icon components and catalog.
- Label popup: native checkbox choices, keyboard/Escape/focus behavior, automatic
  up/down placement within the viewport. Shadow separates the floating layer;
  do not add a bright keyline. In forced colors, restore a system-colored border.
- Attachments share one inset surface, compact metadata, and named Open/Show in
  Folder actions. Missing/unavailable/error states remain readable. Never make
  a decorative card imply that a blocked native action is available.
  Wrap explanations instead of ellipsizing them. The visible file-picker button
  is the composer's attachment Tab stop; its hidden file input is not a second one.
- Search defaults to the current conversation; Project includes Main and all
  children. Reuse the quiet compact field, counts,
  clear action, no-results feedback, and the existing highlight color pair.
  Search matches inside bubbles have a thin outline in the match text color so
  they stay distinct on every project tint. Opening a result marks the
  entire destination row with the message-selection fill and fades it out
  within 900 ms. Keep its position and focus stable. Reduced motion shows
  the same fill briefly without animation. Forced colors use the system highlight.
- Hover anywhere across a message row to reveal Label and More, including the
  empty space beside the bubble. A mouse-opened popup stays open while the
  pointer moves across the row or into the popup. Leaving both dismisses the
  popup and hides the hover toolbar. Keyboard navigation and touch also expose
  the controls.

### Icons, branding, copy, accessibility

- Reuse local inline SVGs: `currentColor`, no fill for line icons, rounded caps
  and joins, usually 1.8px stroke. Common glyphs 15–20px; project-label glyph 18px.
  Existing semantic emoji for Risk/Milestone remain catalog choices, not a new
  decorative emoji language. Icon-only buttons need accessible names.
- Full approved threadstr wordmark in the rail; thr only for compact marks.
  Preserve SVG geometry/aspect ratio and theme variant. The app's 115.2px rail
  wordmark is a compact integration exception to the branding kit's preferred
  192px display width; never enlarge the rail just to satisfy the general guide.
- Copy should name the outcome: Save changes, Back to project, Archive project.
  Retain instructions only for consequences, recovery, storage scope, or a
  non-obvious action. Plaintext backup and replacement warnings are necessary.
- Accessible semantics survive visual simplification: label/input, fieldset/
  legend, checked/pressed/expanded state, current navigation, alert/status regions.
  Avoid a custom div masquerading as a checkbox or button.
- Aim for WCAG 2.2 AA: normal text 4.5:1; applicable UI/focus boundaries 3:1.
  Subtle decorative dividers need not carry control recognition. Verify actual
  foreground/background pairs and keyboard behavior in all three themes.
  Passing token tests alone is not a complete accessibility audit.

## Do's and Don'ts

| Do                                                    | Avoid                                               |
| ----------------------------------------------------- | --------------------------------------------------- |
| Use one tonal surface for related controls            | Nested background wrappers and outlined rows        |
| Use the documented 3× desktop left gutter             | Centering a narrow mobile-like settings card        |
| Put meaningful notes below controls                   | Repeating the page title or explaining obvious tabs |
| Use empty/checked square states with native inputs    | Apple-style switches or color-only selection        |
| Fade into the adjacent surface                        | Black shadow bands behind the composer              |
| Reuse semantic roles and existing component selectors | New raw hex values and one-off type/spacing guesses |
| Keep errors beside the action that caused them        | A distant alert the user cannot see                 |
| Check focus and forced colors                         | Removing every border indiscriminately              |

### Legacy exceptions: do not copy into new UI

The generic `.file-input` and `.accent-option` still include older border/radius rules; current settings scope
overrides them. `.settings-control-row` and old note-thread rules are not the
canonical grouped settings/message recipe. The ≤430px accent grid rule does not
control the newer flex swatches. Old opacity transitions are not a mandate for
new reduced-motion behavior. Leave unrelated cleanup for its own task; use the
preferred scoped patterns when extending the touched surface.

### Change checklist and verification

Before implementation, name the nearest existing component, the roles reused,
and any intentional exception. Afterward inspect normal, hover, focus, selected,
off, disabled, error, loading, empty, and read-only states that can actually occur.
Use long names and real-looking content; verify destructive controls separately.

For CSS/UI changes run `npm run build`, `npm run typecheck`, `npm run lint`,
`npm run format:check`, `git diff --check`, the focused component/behavior tests,
and relevant Playwright journeys. `src/client/theme.test.ts` covers color/focus
contracts. Render Light/Neutral/Dark, narrow/reflow views, forced colors, and
reduced motion where affected. Add behavior tests for new state/error handling;
do not create tests that merely mirror each CSS literal. Check the full app,
not only the cookbook. Report unverified states honestly.

For a cookbook-only edit, validate its links and scripts, render the changed
specimens/themes, and validate the design skill. No database, release, or package
audit rerun is implied by a documentation-only update.
