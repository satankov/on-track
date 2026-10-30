# Subthreads desktop concept

Open [index.html](index.html) directly, or serve the repository root and visit
`/branding/threadstr/subthreads/`. The preview imports the real app stylesheet
and wordmarks. All interactions use disposable sample data in memory; reloading
resets the preview.

The four preview controls show:

- **Sidebar:** the project is Main. Clicking its row opens Main and displays up
  to five subthreads; clicking again while Main is open collapses the list.
  There is no project chevron; subthreads are indented 24px from the project
  name. Show all expands the remaining active subthreads in place.
- **From a message:** the continuation action opens a name-only dialog. Creation
  opens an empty subthread with a centered origin link. The source message has
  a centered link to its continuation.
- **Subthread:** a populated continuation, inherited accent, clickable project
  title, and a link back to the exact source message. Navigation ideas shows
  the independent opening state.
- **Titles:** project and subthread headers, a long-name example with independent
  ellipses for both names, plus both origin treatments. Full names remain in
  native hover titles and accessible text.

The header's branch icon creates an independent subthread. Subthreads created from other
subthreads stay at the same sidebar depth. Pins, archive/restore, basic Edit
controls, sample messages, and the search **Project** checkbox can be explored.
Project searches Main and every subthread belonging to that root project from
any conversation, including one started inside a subthread. Unchecked searches
only the open conversation.
Edit demonstrates separate name, labels and message-display settings without
an accent picker. It is a representative settings preview; the complete label
reordering/custom-label editor is not reimplemented here. Delete subthread is
below Message display in Edit, alongside the existing archive lifecycle controls.

Design choices for review: pinned subthreads precede unpinned ones inside the
project; archived subthreads appear in Archive with their project name; parent
names in subthread titles use muted text at the same size as the title. The
message action row is Change labels, Continue in subthread, Copy message, Edit
message, Delete message. All five use compact icons. The row sits beside the
bubble on larger desktops, using the app's existing below-bubble arrangement
at 960px and below. These are proposals, not changes to DESIGN.md.

Desktop only. No production feature, schema, AI behavior, message sharing, or
mobile design is included.

## Preview checks

Checked at 1440×900 and 1024×768 in Light, Neutral and Dark: no document
overflow; composer and header controls remain reachable. Exercised five-row
expansion, Show all, project/child switching, independent and continued creation,
source links, sibling depth, pin/archive/restore, separate settings, search scope,
keyboard dialog opening and Escape/focus restoration. Browser logs were clean.
The revision checks also cover independent ellipses in the live header and
comparison view, 24px sidebar indentation without a project chevron, icon order
and toolbar fit, whole-project results from a subthread started inside another
subthread, exclusion of other projects, disabled-label preservation, and a
thread-level backlink when a source message is deleted.
Source review findings were repaired. Full application verification, 200% zoom,
screen-reader and forced-colors checks are outside this concept review.

`node --check mockup.js`, focused ESLint, focused Prettier, local asset-link
validation and `git diff --check` passed. Production files were not changed.
