# UI cookbook

Open [index.html](index.html) for the interactive visual reference. The normative
rules are in [DESIGN.md](../../../DESIGN.md). This accompanies the logo handoff;
it is not an application route or a new design-system dependency.

[Preview image](preview.png) shows the Dark palette section. The interactive
page is authoritative for other themes and component states.

## View

The page uses relative paths and can be opened locally. For a browser preview
served from the repository root:

```sh
python3 -m http.server 4196 --bind 127.0.0.1 --directory .
```

Then open <http://127.0.0.1:4196/branding/threadstr/ui/>. This static server is for
local documentation review only; stop it when finished. It is unrelated to the
app server and reads no project database.

## What stays live

- `index.html` imports `src/client/styles.css`. Component specimens reuse real
  selectors for fields, checkboxes, swatches, messages, composer, popup, and modal.
- `cookbook.js` reads computed CSS variables to show the active palette. Theme
  switching is page-local; nothing enters localStorage or application state.
- `cookbook.css` styles the documentation navigation/layout. Its few specimen
  placement overrides are for visibility inside the reference, not new product
  standards. The settings specimen omits the full sidebar and workspace gutter;
  the layout diagram and specification explain those separately.
- Sample Save/Archive/Delete/Send actions only demonstrate feedback. Native
  checkboxes/radios, Show more, focus, and the Create modal can be exercised.
  This is not a replacement for testing the real React workflows.

## Maintain

Update `DESIGN.md` when a shared design rule intentionally changes. Update a
specimen's markup when its production component anatomy changes; CSS/token
changes flow into the reference automatically. Keep the palette values in the
application stylesheet rather than duplicating them here. Keep instructions
discoverable from `AGENTS.md` and `.agents/skills/design/SKILL.md`.

For documentation changes, run Prettier, `node --check` on `cookbook.js`, local
link checks, and render the affected specimens in each theme and at desktop and
mobile widths. Validate the changed skill using the skill-creator validator.
Product UI changes still need the app's focused tests and rendered flows.

## Verification baseline

2026-10-26: Light/Neutral/Dark switching, checkbox states, Show more/less, Save
preview, and modal open/Escape/Cancel/Create were exercised in Chromium. Layout
checks at 1440, 1024, 390, and 320px found no document overflow. Settings and
typography specimens were also visually reviewed. Only the six expected local
assets loaded; no storage writes or JavaScript errors occurred.

`node --check branding/threadstr/ui/cookbook.js`, focused ESLint and Prettier,
local-link validation, and both design skill validators passed. An independent
review exercised the skill against a new Settings-section scenario and found
enough concrete guidance to specify layout, controls, type, and feedback.
This evidence covers the documentation, not a new app release or a complete
assistive-technology audit.
