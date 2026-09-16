# Branding package verification

Verified for this asset handoff on 2026-09-16. This is an isolated branding
package; the application has not been renamed or integrated with these files.

## Export and source checks

- Rebuilt with `python3 branding/threadstr/build-assets.py` using Python 3.12.14,
  Pillow 12.3.0, and NumPy 2.3.5. A second rebuild produced an identical manifest
  and identical SHA-256 hashes for all 26 generated files.
- Verified every manifest hash, PNG dimension/mode, and the selected source hash.
- Light/dark wordmark alpha channels match exactly at native, 1024, 512, and
  256-pixel widths. Light/dark SVG path data also match exactly.
- Rasterized the full SVG with Sharp at the native 1452 × 324 viewBox size.
  Its thresholded silhouette matched the cleaned PNG silhouette (intersection
  over union 1.00000).
- Verified all SVG elements are limited to `svg`, `title`, `g`, `path`, `rect`,
  and `circle`; no scripts, event handlers, embedded raster images, fonts, or
  external resource references are present.
- Both circular PNGs have transparent corners. Avatar ink is within a radius of
  0.359 times the canvas width, inside the reserved 0.42 circular safe radius.
- All 18 archived concept PNGs match their saved source files byte-for-byte.
  Prompt Markdown formatting was normalized without changing the design brief.

## Rendering and documentation

- Inspected desktop (1440-pixel width) and mobile (390-pixel width) previews,
  both light and dark, including the full mark at 256/192/160 pixels and avatars
  at 128/64/48/32 pixels.
- Playwright confirmed no horizontal overflow and no broken images in either
  preview, and confirmed all 18 gallery figures are present.
- Verified local documentation and preview links resolve.
- `node_modules/.bin/prettier --check branding/threadstr` passed.
- Read-only reviewer found no actionable defects in the archive, export script,
  manifest, SVG structure, or documentation.

## Scope and limits

Only new files under `branding/threadstr/` belong to this task. Existing feature
work may continue independently outside this folder. Nothing was staged,
committed, pushed, or renamed in the application.

Application build, typecheck, lint, unit/E2E suites, database checks, and dependency
audit were not run: no application behavior, dependency, schema, or configuration
was changed. The relevant checks were asset generation, rendering, file integrity,
documentation, and change-scope isolation.

The vectors are traced polygonal outlines of the approved raster, not manually
redrawn Bézier masters. Fine ribbon separators soften at very small sizes. The
documented minimums are design recommendations, not accessibility certification
for a future app integration or a guarantee about third-party social rendering.
