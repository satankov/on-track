"""Build the isolated Threadstr asset package from the approved c/O board.

Tooling only: requires Pillow and NumPy, not application dependencies.
No network access, fonts, application edits, or Git operations.
"""

from collections import defaultdict
from pathlib import Path
import hashlib
import json
import math
import platform

import numpy as np
from PIL import Image, ImageDraw, __version__ as pillow_version


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "explorations/O-threadstr-ribbon-dense.png"
OUT = ROOT / "v1"
INK = (23, 25, 28)
WHITE = (255, 255, 255)
DARK = (17, 20, 23)
PADDING = 24


def components(mask):
    """Separate the source's nine solid shapes at the white ribbon cuts."""
    work = mask.point(lambda value: 255 if value >= 128 else 0)
    result = []
    while True:
        ys, xs = np.where(np.asarray(work) == 255)
        if not len(xs):
            break
        ImageDraw.floodfill(work, (int(xs[0]), int(ys[0])), 128, thresh=0)
        pixels = np.asarray(work) == 128
        if int(pixels.sum()) > 20:
            yy, xx = np.where(pixels)
            result.append(
                (int(xx.min()), int(yy.min()), Image.fromarray(pixels.astype("uint8") * 255))
            )
        work = work.point(lambda value: 0 if value == 128 else value)
    return sorted(result, key=lambda component: component[0])


def padded(mask):
    box = mask.getbbox()
    if box is None:
        raise ValueError("Empty logo mask")
    cropped = mask.crop(box)
    result = Image.new("L", (cropped.width + 2 * PADDING, cropped.height + 2 * PADDING))
    result.paste(cropped, (PADDING, PADDING))
    return result


def simplify(points, tolerance=0.35):
    """Douglas–Peucker simplification, bounded in source-image pixels."""
    if len(points) <= 2:
        return points
    start, end = np.asarray(points[0], float), np.asarray(points[-1], float)
    delta = end - start
    length = float(np.dot(delta, delta))
    array = np.asarray(points, float)
    if length == 0:
        distance = np.linalg.norm(array - start, axis=1)
    else:
        t = np.clip(((array - start) @ delta) / length, 0, 1)
        distance = np.linalg.norm(array - (start + t[:, None] * delta), axis=1)
    index = int(np.argmax(distance))
    if float(distance[index]) <= tolerance:
        return [points[0], points[-1]]
    return simplify(points[: index + 1], tolerance)[:-1] + simplify(points[index:], tolerance)


def trace(mask):
    """Trace closed pixel-boundary outlines; retain holes via even-odd fill.

    These are true polygonal vector outlines, not embedded raster SVG wrappers.
    Their accuracy is limited by the approved raster source's native resolution.
    """
    a = np.asarray(mask) >= 128
    neighbors = np.pad(a, 1)
    edges = defaultdict(list)
    sides = [
        (a & ~neighbors[:-2, 1:-1], (0, 0), (1, 0)),
        (a & ~neighbors[1:-1, 2:], (1, 0), (1, 1)),
        (a & ~neighbors[2:, 1:-1], (1, 1), (0, 1)),
        (a & ~neighbors[1:-1, :-2], (0, 1), (0, 0)),
    ]
    for boundary, p, q in sides:
        ys, xs = np.where(boundary)
        for x, y in zip(xs.tolist(), ys.tolist()):
            edges[(x + p[0], y + p[1])].append((x + q[0], y + q[1]))
    directions = {(1, 0): 0, (0, 1): 1, (-1, 0): 2, (0, -1): 3}
    paths = []
    while edges:
        start = next(iter(edges))
        point, previous = start, None
        ring = [start]
        while True:
            candidates = edges[point]
            if previous is not None and len(candidates) > 1:
                incoming = directions[(point[0] - previous[0], point[1] - previous[1])]
                ranks = {1: 0, 0: 1, 3: 2, 2: 3}
                candidates.sort(
                    key=lambda q: ranks[
                        (directions[(q[0] - point[0], q[1] - point[1])] - incoming) % 4
                    ], reverse=True
                )
            following = candidates.pop()
            if not candidates:
                del edges[point]
            previous, point = point, following
            if point == start:
                break
            ring.append(point)
        if len(ring) < 4:
            continue
        # Split a closed ring into two open chains before simplification.
        split = max(range(len(ring)), key=lambda i: math.dist(ring[0], ring[i]))
        ring = simplify(ring[: split + 1])[:-1] + simplify(ring[split:] + [ring[0]])[:-1]
        paths.append("M" + " L".join(f"{x} {y}" for x, y in ring) + " Z")
    return " ".join(paths)


def hex_color(color):
    return "#" + "".join(f"{channel:02x}" for channel in color)


def svg(mark, size, color, label, transform="", background=""):
    width, height = size
    group = f'<g transform="{transform}">' if transform else "<g>"
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" '
        f'role="img" aria-label="{label}">\n'
        f'  <title>{label}</title>\n{background}'
        f'  {group}<path fill="{hex_color(color)}" fill-rule="evenodd" d="{mark}"/></g>\n'
        '</svg>\n'
    )


def rgba(mask, color):
    result = Image.new("RGBA", mask.size, color + (0,))
    result.putalpha(mask)
    return result


def write_png(path, image):
    image.save(path, optimize=True)


def main():
    for directory in ("source", "wordmark", "social"):
        (OUT / directory).mkdir(parents=True, exist_ok=True)
    source = Image.open(SOURCE).convert("L")
    # Saturate near-black ink and near-white paper; retain the real edge alpha.
    pixels = np.asarray(source, dtype=np.float32)
    cleaned = np.clip((224 - pixels) * (255 / 192), 0, 255).round().astype("uint8")
    full = Image.fromarray(cleaned)
    parts = components(full)
    if len(parts) != 9:
        raise ValueError(f"Expected nine source shapes, found {len(parts)}")
    # The leftmost source shapes are t, h and r; ribbon gaps separate them
    # from e. Preserve the selected source geometry, not a regenerated avatar.
    prefix_binary = np.maximum.reduce([np.asarray(part[2]) for part in parts[:3]])
    # Extend the selector slightly to include anti-aliased edge pixels only.
    from PIL import ImageFilter

    selector = Image.fromarray(prefix_binary).filter(ImageFilter.MaxFilter(3))
    prefix = Image.fromarray(np.minimum(np.asarray(selector), cleaned))
    word, monogram = padded(full), padded(prefix)
    write_png(OUT / "source/wordmark-alpha.png", word)
    write_png(OUT / "source/thr-alpha.png", monogram)
    word_path, thr_path = trace(word), trace(monogram)

    for theme, color in (("on-light", INK), ("on-dark", WHITE)):
        base = OUT / "wordmark" / f"threadstr-wordmark-{theme}"
        base.with_suffix(".svg").write_text(svg(word_path, word.size, color, "threadstr"))
        write_png(base.with_suffix(".png"), rgba(word, color))
        for width in (1024, 512, 256):
            height = round(word.height * width / word.width)
            scaled = word.resize((width, height), Image.Resampling.LANCZOS)
            write_png(base.with_name(base.name + f"-{width}").with_suffix(".png"), rgba(scaled, color))

    # Shared placement: the complete prefix fills 68% of the square width.
    bare = monogram.crop(monogram.getbbox())
    bare_path = trace(bare)
    for theme, color, background in (("light", INK, WHITE), ("dark", WHITE, DARK)):
        for size in (1024, 512):
            width = round(size * 0.68)
            height = round(bare.height * width / bare.width)
            x, y = (size - width) // 2, (size - height) // 2
            alpha = Image.new("L", (size, size))
            alpha.paste(bare.resize((width, height), Image.Resampling.LANCZOS), (x, y))
            square = Image.new("RGB", (size, size), background)
            square.paste(color, mask=alpha)
            write_png(OUT / "social" / f"threadstr-thr-{theme}-{size}.png", square)
            if size == 512:
                # Supersampled circle alpha avoids jagged transparent corners.
                circle = Image.new("L", (size * 4, size * 4))
                ImageDraw.Draw(circle).ellipse((0, 0, size * 4 - 1, size * 4 - 1), fill=255)
                circle = circle.resize((size, size), Image.Resampling.LANCZOS)
                rounded = square.convert("RGBA")
                rounded.putalpha(circle)
                write_png(OUT / "social" / f"threadstr-thr-circle-{theme}-512.png", rounded)
        scale = 1024 * 0.68 / bare.width
        dx, dy = (1024 - bare.width * scale) / 2, (1024 - bare.height * scale) / 2
        transform = f"translate({dx:.5f} {dy:.5f}) scale({scale:.8f})"
        for form in ("square", "circle"):
            bg = (f'  <rect width="1024" height="1024" fill="{hex_color(background)}"/>\n'
                  if form == "square" else
                  f'  <circle cx="512" cy="512" r="512" fill="{hex_color(background)}"/>\n')
            (OUT / "social" / f"threadstr-thr-{form}-{theme}.svg").write_text(
                svg(bare_path, (1024, 1024), color, "Threadstr: thr", transform, bg)
            )
        # Standalone transparent prefix, usable on arbitrary matching surfaces.
        (OUT / "social" / f"threadstr-thr-on-{theme}.svg").write_text(
            svg(thr_path, monogram.size, color, "Threadstr: thr")
        )
        write_png(OUT / "social" / f"threadstr-thr-on-{theme}.png", rgba(monogram, color))

    manifest = {
        "version": "1",
        "toolchain": {"python": platform.python_version(), "pillow": pillow_version, "numpy": np.__version__},
        "selected_concept": "c / O — dense ribbons",
        "source": "../explorations/O-threadstr-ribbon-dense.png",
        "source_sha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
        "geometry": "Native source weight and fine ribbon separators preserved",
        "vector_method": "Closed polygonal outlines traced at alpha 128, tolerance 0.35 source pixels",
        "files": [],
    }
    for path in sorted(OUT.rglob("*")):
        if path.suffix not in {".png", ".svg"}:
            continue
        record = {"path": str(path.relative_to(OUT)), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
        if path.suffix == ".png":
            im = Image.open(path)
            record.update(width=im.width, height=im.height, mode=im.mode)
        manifest["files"].append(record)
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Built {len(manifest['files'])} assets from {SOURCE.name}")
    print(f"Native wordmark: {word.size}; native thr: {monogram.size}")


if __name__ == "__main__":
    main()
