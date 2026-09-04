import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { ACCENTS } from "../domain/validation.js";
import {
  THEME_COLORS,
  THEME_STORAGE_KEY,
  THEMES,
  isTheme,
  persistTheme,
  readStoredTheme,
} from "./theme.js";

const stylesheet = readFileSync(
  resolve(process.cwd(), "src/client/styles.css"),
  "utf8",
);

function luminance(hex: string): number {
  const channels = [0, 2, 4]
    .map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((channel) =>
      channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    );
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function mixHex(
  foreground: string,
  background: string,
  weight: number,
): string {
  const colors = [foreground, background].map((hex) =>
    [0, 2, 4].map((offset) =>
      Number.parseInt(hex.slice(offset, offset + 2), 16),
    ),
  );

  return colors[0]!
    .map((channel, index) =>
      Math.round(channel * weight + colors[1]![index]! * (1 - weight))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");
}

function readColorToken(stylesheet: string, token: string): string {
  const match = stylesheet.match(
    new RegExp(`--${token}:\\s*#([0-9a-f]{6})`, "i"),
  );
  expect(match, `Missing --${token} CSS token`).not.toBeNull();
  return match![1]!;
}

function themeBlock(theme: (typeof THEMES)[number]): string {
  const selector = theme === "light" ? ":root" : `:root[data-theme="${theme}"]`;
  const start = stylesheet.indexOf(`${selector} {`);
  expect(start, `Missing ${selector} theme block`).toBeGreaterThanOrEqual(0);
  const bodyStart = stylesheet.indexOf("{", start) + 1;
  const bodyEnd = stylesheet.indexOf("}", bodyStart);
  return stylesheet.slice(bodyStart, bodyEnd);
}

function readThemeToken(theme: (typeof THEMES)[number], token: string): string {
  return readColorToken(themeBlock(theme), token);
}

describe("accent accessibility", () => {
  it.each(ACCENTS)("keeps white action text readable on %s", (accent) => {
    const match = stylesheet.match(
      new RegExp(`--${accent}-action:\\s*#([0-9a-f]{6})`, "i"),
    );
    expect(match, `Missing --${accent}-action CSS token`).not.toBeNull();
    const ratio = 1.05 / (luminance(match![1]!) + 0.05);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("uses the action-safe accent for the filled composer action", () => {
    expect(stylesheet).toMatch(
      /\.send-button\s*\{[^}]*background:\s*var\(--accent-action\)/s,
    );
  });

  it("renders pending attachment remove icons with visible strokes", () => {
    const match = stylesheet.match(
      /\.pending-attachment button svg\s*\{(?<body>[^}]+)\}/,
    );

    expect(match?.groups?.body).toContain("stroke: currentColor");
    expect(match?.groups?.body).toContain("fill: none");
  });

  it.each([
    ["ink", "paper"],
    ["muted", "paper"],
    ["ink", "history"],
    ["muted", "history"],
  ])("keeps --%s readable on --%s", (foreground, background) => {
    const stylesheet = readFileSync(
      resolve(process.cwd(), "src/client/styles.css"),
      "utf8",
    );
    const ratio = contrastRatio(
      readColorToken(stylesheet, foreground),
      readColorToken(stylesheet, background),
    );
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});

describe("appearance theme contract", () => {
  it("validates stored values and safely falls back to light", () => {
    expect(THEMES).toEqual(["light", "neutral", "dark"]);
    expect(isTheme("neutral")).toBe(true);
    expect(isTheme("system")).toBe(false);
    expect(
      readStoredTheme({ getItem: () => "dark" } as unknown as Storage),
    ).toBe("dark");
    expect(
      readStoredTheme({ getItem: () => "invalid" } as unknown as Storage),
    ).toBe("light");
    expect(
      readStoredTheme({
        getItem: () => {
          throw new Error("blocked");
        },
      } as unknown as Storage),
    ).toBe("light");
  });

  it("survives browsers that block access to the localStorage property", () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "localStorage",
    );
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    });

    try {
      expect(readStoredTheme()).toBe("light");
      expect(() => persistTheme("dark")).not.toThrow();
    } finally {
      if (descriptor) {
        Object.defineProperty(globalThis, "localStorage", descriptor);
      } else {
        Reflect.deleteProperty(globalThis, "localStorage");
      }
    }
  });

  it("keeps the pre-render bootstrap synchronized with the typed theme model", () => {
    const bootstrap = readFileSync(
      resolve(process.cwd(), "public/theme-init.js"),
      "utf8",
    );
    const page = readFileSync(resolve(process.cwd(), "index.html"), "utf8");

    expect(bootstrap).toContain(THEME_STORAGE_KEY);
    for (const theme of THEMES) {
      expect(bootstrap).toContain(`${theme}: "${THEME_COLORS[theme]}"`);
    }
    expect(page.indexOf("/theme-init.js")).toBeLessThan(
      page.indexOf("/src/client/main.tsx"),
    );
  });

  it("keeps each miniature preview independent from the active outer theme", () => {
    expect(stylesheet).toMatch(
      /\.theme-option\s*\{[^}]*--preview-accent:\s*#[0-9a-f]{6}/is,
    );
    for (const theme of ["neutral", "dark"]) {
      expect(stylesheet).toMatch(
        new RegExp(
          `\\.theme-option\\[data-preview-theme="${theme}"\\]\\s*\\{[^}]*--preview-accent:\\s*#[0-9a-f]{6}`,
          "is",
        ),
      );
    }
    expect(stylesheet).toMatch(
      /\.theme-preview-rail i:first-child\s*\{[^}]*background:\s*var\(--preview-accent\)/s,
    );
  });

  it.each(THEMES)("defines every semantic color role for %s", (theme) => {
    for (const token of [
      "canvas",
      "paper",
      "rail",
      "history",
      "control",
      "selection",
      "field",
      "code-inline",
      "code-block",
      "attachment-ink",
      "attachment-muted",
      "attachment-warning",
      "attachment-critical",
      "message-muted",
      "message-link",
      "ink",
      "muted",
      "line",
      "line-strong",
      "control-border",
      "placeholder",
      "focus",
      "button-primary",
      "button-primary-hover",
      "on-action",
      "critical",
      "critical-soft",
      "success",
      "overlay",
    ]) {
      expect(readThemeToken(theme, token)).toMatch(/^[0-9a-f]{6}$/i);
    }
  });

  it.each(THEMES)("meets text contrast requirements in %s", (theme) => {
    const pairs = [
      ["ink", "paper"],
      ["ink", "canvas"],
      ["muted", "paper"],
      ["muted", "history"],
      ["ink", "field"],
      ["placeholder", "field"],
      ["on-action", "button-primary"],
      ["critical", "critical-soft"],
      ["success", "paper"],
    ];

    for (const [foreground, background] of pairs) {
      expect(
        contrastRatio(
          readThemeToken(theme, foreground!),
          readThemeToken(theme, background!),
        ),
        `--${foreground} on --${background} in ${theme}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(THEMES)(
    "keeps focus visible against main surfaces in %s",
    (theme) => {
      for (const background of ["paper", "history", "field"]) {
        expect(
          contrastRatio(
            readThemeToken(theme, "focus"),
            readThemeToken(theme, background),
          ),
        ).toBeGreaterThanOrEqual(3);
      }
    },
  );

  it.each(THEMES)("keeps controls and accents identifiable in %s", (theme) => {
    for (const background of ["control", "field"]) {
      expect(
        contrastRatio(
          readThemeToken(theme, "control-border"),
          readThemeToken(theme, background),
        ),
        `--control-border against --${background} in ${theme}`,
      ).toBeGreaterThanOrEqual(3);
    }

    for (const accent of ACCENTS) {
      for (const background of ["selection", "paper"]) {
        expect(
          contrastRatio(
            readThemeToken(theme, accent),
            readThemeToken(theme, background),
          ),
          `--${accent} against --${background} in ${theme}`,
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it.each(THEMES)(
    "keeps current and earlier Attention marks identifiable in %s",
    (theme) => {
      for (const status of ["critical", "muted"]) {
        expect(
          contrastRatio(
            readThemeToken(theme, status),
            readThemeToken(theme, "rail"),
          ),
          `--${status} against --rail in ${theme}`,
        ).toBeGreaterThanOrEqual(3);
      }

      const earlierRule = stylesheet.match(
        /\.project-attention-dot--earlier\s*\{(?<body>[^}]+)\}/,
      );
      expect(earlierRule?.groups?.body).toContain("background: var(--muted)");
      expect(earlierRule?.groups?.body).not.toContain("border");
      expect(earlierRule?.groups?.body).not.toContain("opacity");
    },
  );

  it("centers the project status cluster and separates rail sections", () => {
    expect(stylesheet).toMatch(
      /\.project-section \+ \.project-section\s*\{[^}]*margin-top:\s*10px/s,
    );
    expect(stylesheet).toMatch(
      /\.project-pin-button svg\s*\{[^}]*transform:\s*translateY\(-3px\)/s,
    );
    expect(stylesheet).toMatch(
      /\.project-attention-dot\s*\{[^}]*bottom:\s*13px/s,
    );
  });

  it("renders icon-only message labels without a surrounding border", () => {
    expect(stylesheet).toMatch(
      /\.message-label--icon-only\s*\{[^}]*border:\s*0/s,
    );
  });

  it.each(THEMES)("keeps structural dividers quiet in %s", (theme) => {
    for (const background of ["paper", "history", "rail"]) {
      expect(
        contrastRatio(
          readThemeToken(theme, "line"),
          readThemeToken(theme, background),
        ),
        `--line against --${background} in ${theme}`,
      ).toBeLessThanOrEqual(1.35);
    }
  });

  it("uses soft geometry and a united attachment surface", () => {
    const filterRule = stylesheet.match(
      /\.history-filter\s*\{(?<body>[^}]+)\}/,
    );
    const bubbleRule = stylesheet.match(
      /\.message-bubble\s*\{(?<body>[^}]+)\}/,
    );
    const attachmentListRule = stylesheet.match(
      /\.attachment-list\s*\{(?<body>[^}]+)\}/,
    );
    const attachmentCardRule = stylesheet.match(
      /\.attachment-card\s*\{(?<body>[^}]+)\}/,
    );

    expect(filterRule?.groups?.body).not.toContain("border-right");
    expect(bubbleRule?.groups?.body).toContain(
      "border-radius: 14px 14px 5px 14px",
    );
    expect(attachmentListRule?.groups?.body).toContain(
      "background: var(--attachment-surface)",
    );
    expect(attachmentCardRule?.groups?.body).toContain("border: 0");
  });

  it("uses a square full-width fade for future messages", () => {
    const historyRule = stylesheet.match(/\.history\s*\{(?<body>[^}]+)\}/);
    const futureSurfaceRule = stylesheet.match(
      /\.future-message-boundary-surface\s*\{(?<body>[^}]+)\}/,
    );
    const futureBoundaryRule = stylesheet.match(
      /\.future-message-boundary\s*\{(?<body>[^}]+)\}/,
    );

    expect(historyRule?.groups?.body).toContain("--history-inline-padding");
    expect(historyRule?.groups?.body).toContain("overflow-x: hidden");
    expect(futureSurfaceRule?.groups?.body).toContain("linear-gradient");
    expect(futureSurfaceRule?.groups?.body).toContain("var(--accent)");
    expect(futureSurfaceRule?.groups?.body).toContain("left: -100vw");
    expect(futureSurfaceRule?.groups?.body).toContain("inset-block: 0");
    expect(futureSurfaceRule?.groups?.body).toContain(
      "background-size: 100% min(320px, 100%)",
    );
    expect(futureSurfaceRule?.groups?.body).not.toContain("height: 320px");
    expect(futureSurfaceRule?.groups?.body).toContain(
      "border-block-start: 1px solid",
    );
    expect(futureSurfaceRule?.groups?.body).not.toContain("border-radius");
    expect(futureBoundaryRule?.groups?.body).toContain("align-self: stretch");
    expect(stylesheet).toMatch(
      /@media \(forced-colors: active\)[\s\S]*\.future-message-boundary-surface\s*\{[^}]*border-block-start-color:\s*CanvasText/,
    );
  });

  it("keeps the composer and rail icon controls visually quiet at rest", () => {
    for (const selector of [
      "\\.composer",
      "\\.new-project-button",
      "\\.settings-icon-button,\\s*\\.settings-back-button",
    ]) {
      const rule = stylesheet.match(
        new RegExp(`${selector}\\s*\\{(?<body>[^}]+)\\}`),
      );
      expect(rule?.groups?.body).toContain(
        "border: 1px solid var(--line-strong)",
      );
      expect(rule?.groups?.body).not.toContain("var(--control-border)");
    }
  });

  it("gives Light messages a clearer project-colored surface", () => {
    const root = themeBlock("light");
    const bubbleRule = stylesheet.match(
      /\.message-bubble\s*\{(?<body>[^}]+)\}/,
    );

    expect(root).toContain("--message-accent-strength: 36%");
    expect(bubbleRule?.groups?.body).toContain(
      "var(--accent) var(--message-accent-strength)",
    );

    for (const accent of ACCENTS) {
      const bubble = mixHex(
        readThemeToken("light", accent),
        readThemeToken("light", "paper"),
        0.36,
      );
      expect(
        contrastRatio(bubble, readThemeToken("light", "history")),
        `Light --${accent} message against --history`,
      ).toBeGreaterThanOrEqual(1.45);

      for (const foreground of ["ink", "message-muted", "message-link"]) {
        expect(
          contrastRatio(readThemeToken("light", foreground), bubble),
          `Light --${foreground} on --${accent} message`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }

    expect(stylesheet).toMatch(
      /\.message-bubble \.note-body blockquote\s*\{[^}]*color:\s*var\(--message-muted\)/s,
    );
    expect(stylesheet).toMatch(
      /\.message-bubble \.note-body a\s*\{[^}]*color:\s*var\(--message-link\)/s,
    );
    expect(stylesheet).toMatch(
      /\.message-time\s*\{[^}]*color:\s*var\(--message-muted\)/s,
    );
  });

  it.each(THEMES)(
    "keeps project-colored attachment insets readable in %s",
    (theme) => {
      for (const accent of ACCENTS) {
        const surface = `attachment-${accent}`;
        expect(readThemeToken(theme, surface)).toMatch(/^[0-9a-f]{6}$/i);
        for (const foreground of [
          "attachment-ink",
          "attachment-muted",
          "attachment-warning",
          "attachment-critical",
        ]) {
          expect(
            contrastRatio(
              readThemeToken(theme, foreground),
              readThemeToken(theme, surface),
            ),
            `--${foreground} on --${surface} in ${theme}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    },
  );

  it.each(ACCENTS)(
    "maps the %s project accent to its attachment surface",
    (accent) => {
      const rule = stylesheet.match(
        new RegExp(`\\[data-accent="${accent}"\\]\\s*\\{(?<body>[^}]+)\\}`),
      );
      expect(rule?.groups?.body).toContain(
        `--attachment-surface: var(--attachment-${accent})`,
      );
    },
  );

  it("keeps attachment focus and forced-color grouping explicit", () => {
    const focusRule = stylesheet.match(
      /\.attachment-action:focus-visible\s*\{(?<body>[^}]+)\}/,
    );
    const forcedColors = stylesheet.match(
      /@media \(forced-colors: active\)\s*\{(?<body>[\s\S]+)\}\s*$/,
    );

    expect(focusRule?.groups?.body).toContain(
      "outline: 2px solid var(--attachment-ink)",
    );
    expect(forcedColors?.groups?.body).toMatch(
      /\.message-bubble,\s*\.attachment-list\s*\{[^}]*border: 1px solid CanvasText/s,
    );
  });

  it("gives the quiet new-project control clear hover feedback", () => {
    const hoverRule = stylesheet.match(
      /\.new-project-button:hover\s*\{(?<body>[^}]+)\}/,
    );

    expect(hoverRule?.groups?.body).toContain("background: var(--selection)");
    expect(hoverRule?.groups?.body).toContain("color: var(--focus)");
  });
});
