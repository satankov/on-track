# Threadstr v1 logo kit

Approved direction: **c / O — Dense ribbon wordmark**, following D — Story Knot.
The selected [source board](../explorations/O-threadstr-ribbon-dense.png) is the
geometry reference. “Thin version” is interpreted here as preserving its fine
ribbon separators and existing letter weight; no lighter-font redesign was made.

Use the full **threadstr** wordmark in the app and **thr** for compact marks and
round social avatars. [Open the visual preview](../preview.html).

## Recommended files

| Environment                                   | Light surface                                                                       | Dark surface                                                                      |
| --------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| App / scalable full logo                      | [Wordmark SVG](wordmark/threadstr-wordmark-on-light.svg)                            | [Wordmark SVG](wordmark/threadstr-wordmark-on-dark.svg)                           |
| App / transparent raster                      | [Native PNG](wordmark/threadstr-wordmark-on-light.png)                              | [Native PNG](wordmark/threadstr-wordmark-on-dark.png)                             |
| Social upload, square with circular safe area | [1024 PNG](social/threadstr-thr-light-1024.png)                                     | [1024 PNG](social/threadstr-thr-dark-1024.png)                                    |
| Already-round image, transparent corners      | [512 PNG](social/threadstr-thr-circle-light-512.png)                                | [512 PNG](social/threadstr-thr-circle-dark-512.png)                               |
| Scalable round mark                           | [Circle SVG](social/threadstr-thr-circle-light.svg)                                 | [Circle SVG](social/threadstr-thr-circle-dark.svg)                                |
| Standalone transparent thr                    | [SVG](social/threadstr-thr-on-light.svg) / [PNG](social/threadstr-thr-on-light.png) | [SVG](social/threadstr-thr-on-dark.svg) / [PNG](social/threadstr-thr-on-dark.png) |

Additional PNG wordmarks are provided at 1024, 512, and 256 pixels wide.
Social square PNGs are provided at 1024 and 512 pixels. Square social SVGs are
also included. Native wordmark PNGs are 1452 × 324; native transparent thr PNGs
are 530 × 324. The [manifest](manifest.json) lists dimensions and SHA-256 hashes.

## Color and placement

- On light surfaces: ink `#17191c` with a transparent background.
- On dark surfaces: white `#ffffff` with a transparent background.
- Social mattes: white `#ffffff` or near-black `#111417`.
- Light and dark files use identical masks or path geometry. Ribbon gaps are
  transparent in standalone marks, not painted white or black.
- Square avatars center the thr mark at 68% of the canvas width, leaving safe
  margins for a circular crop. Prefer the square 1024 PNG when uploading to a
  service that applies its own circular mask.
- Use the full wordmark at 192 CSS pixels wide or larger where practical.
  Prefer SVG, or a PNG with at least twice the displayed width on high-density
  screens. At smaller sizes the fine separators become less distinct.
- Prefer 64 pixels or larger for the social avatar when the ribbon detail must
  remain clear. The preview includes 48- and 32-pixel comparisons; those are
  compact recognizability checks, not a guarantee that every seam stays visible.
- Preserve aspect ratio and the supplied clear space. Do not stretch the logo,
  add outlines/shadows, rotate it, or recolor individual ribbon segments.
- For app integration, use accessible alternative text `threadstr`, or the
  destination name when the logo is a navigation link. Do not depend on the
  visual letters to supply an accessible name.

## Source and export method

The concepts were created with the built-in image-generation tool. Initial
generative export attempts produced inconsistent transparency; they are not the
delivered assets. The user explicitly authorized local image processing for
clean, matching variants.

The final exports are derived deterministically from the approved c/O board:

1. Map near-black ink to opaque and near-white paper to transparent, preserving
   antialiased edges and the original ribbon cuts.
2. Isolate the leftmost three connected source shapes for thr. The original
   diagonal ribbon end is retained; no new glyphs or loops are invented.
3. Crop with clear space, then recolor the same alpha masks for both themes.
4. Trace closed polygonal SVG outlines with a 0.35-source-pixel simplification
   tolerance. SVG files contain actual paths, no embedded images, fonts, scripts,
   external resources, or raster wrappers.
5. Export transparent wordmarks, circular marks, and circle-safe square avatars.

The SVG outlines are traced from the raster design, not manually redrawn Bézier
masters. They scale cleanly at normal app and social sizes; very large print
production may benefit from a designer's curve cleanup. The 1024 social PNG is
resampled from the source; SVG is preferable when native vector scaling is
available. Source alpha masks are retained in `source/`.

The reconstruction script is [../build-assets.py](../build-assets.py). It needs
Python 3, Pillow, and NumPy in a separate asset-tooling environment; these are
not application dependencies.

The verified toolchain is Python 3.12.14, Pillow 12.3.0, and NumPy 2.3.5.
PNG encoding and therefore file hashes can differ with other library versions.
From the repository root:

```sh
python3 branding/threadstr/build-assets.py
```

It reads only the selected archived board and writes generated assets under this
v1 folder. It performs no Git operations or application edits. Rebuilding replaces
the generated v1 files, so preserve any manual edits elsewhere first.

## Scope of this handoff

The app has not been renamed or wired to these assets. Existing historical title
mentions, package metadata, routes, data directories, and feature work are
untouched.
