import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { ACCENT_FAMILIES } from "../domain/validation.js";
import { THEME_COLORS, THEME_STORAGE_KEY, THEMES, isTheme } from "./theme.js";

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

const gradientTokens = [
  "guava",
  "honey",
  "jade",
  "lagoon",
  "orchid",
  "periwinkle",
] as const;

describe("accent accessibility", () => {
  it("shows each project's identity color in the accent picker", () => {
    const swatch = stylesheet.match(
      /\.project-settings-fields \.accent-swatch\s*\{([^}]+)\}/,
    );
    expect(swatch?.[1]).toContain("background: var(--swatch-fill)");
    expect(swatch?.[1]).toContain("color: var(--swatch-ink)");
  });

  it.each(THEMES)(
    "keeps accent selections and Send readable in %s",
    (theme) => {
      const tokens = themeBlock(theme) + themeBlock("light");
      for (const accent of gradientTokens) {
        const tint = readColorToken(tokens, `${accent}-tint`);
        const end = readColorToken(tokens, `${accent}-end`);
        for (const stop of [
          tint,
          readColorToken(tokens, accent),
          mixHex(end, tint, 0.75),
        ]) {
          expect(
            contrastRatio(readColorToken(tokens, "swatch-check"), stop),
            `Check mark on the ${theme} ${accent} swatch`,
          ).toBeGreaterThanOrEqual(3);
        }
        for (const stop of [readColorToken(tokens, `${accent}-action`), end]) {
          expect(
            contrastRatio(readColorToken(tokens, "on-action"), stop),
            `Send text on the ${theme} ${accent} gradient`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    },
  );

  it.each(THEMES)(
    "keeps the original solid swatches, actions and messages readable in %s",
    (theme) => {
      const tokens = themeBlock(theme) + themeBlock("light");
      const weight =
        Number(tokens.match(/--plain-message-strength: ([\d.]+)%/)![1]) / 100;
      for (const family of ACCENT_FAMILIES) {
        const action = readColorToken(tokens, family + "-action");
        expect(
          contrastRatio(readColorToken(tokens, "on-action"), action),
        ).toBeGreaterThanOrEqual(4.5);
        const message = mixHex(
          readColorToken(tokens, family),
          readColorToken(tokens, "paper"),
          weight,
        );
        for (const foreground of ["ink", "message-muted", "message-link"]) {
          expect(
            contrastRatio(readColorToken(tokens, foreground), message),
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    },
  );

  it("uses the readable project accent for Send and the action palette for primary buttons", () => {
    expect(stylesheet).toMatch(
      /\.send-button\s*\{[^}]*color:\s*var\(--on-action\);[^}]*background:\s*var\(--accent-action\)/s,
    );
    expect(stylesheet).toMatch(
      /\.button-primary\s*\{[^}]*color:\s*var\(--on-action\);[^}]*background:\s*var\(--button-primary\)/s,
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
  it("validates the closed theme vocabulary", () => {
    expect(THEMES).toEqual(["light", "neutral", "dark"]);
    expect(isTheme("neutral")).toBe(true);
    expect(isTheme("system")).toBe(false);
  });

  it("keeps the pre-render bootstrap synchronized with the typed theme model", () => {
    const bootstrap = readFileSync(
      resolve(process.cwd(), "src/server/preferences-routes.ts"),
      "utf8",
    );
    const page = readFileSync(resolve(process.cwd(), "index.html"), "utf8");

    expect(bootstrap).toContain(THEME_STORAGE_KEY);
    for (const theme of THEMES) {
      expect(bootstrap).toContain(THEME_COLORS[theme]);
    }
    expect(page.indexOf("/api/preferences/bootstrap.js")).toBeLessThan(
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
      "sender-coral",
      "sender-amber",
      "sender-moss",
      "sender-ocean",
      "sender-iris",
      "sender-slate",
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
    "keeps every stable sender-name color readable on participant messages in %s",
    (theme) => {
      for (const accent of ACCENT_FAMILIES) {
        expect(
          contrastRatio(
            readThemeToken(theme, `sender-${accent}`),
            readThemeToken(theme, "paper"),
          ),
          `--sender-${accent} on --paper in ${theme}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it.each(THEMES)(
    "keeps focus visible against main surfaces in %s",
    (theme) => {
      for (const background of ["paper", "history", "field", "control"]) {
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

    for (const accent of [...ACCENT_FAMILIES, ...gradientTokens]) {
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

  it("separates rail sections", () => {
    expect(stylesheet).toMatch(
      /\.project-section \+ \.project-section\s*\{[^}]*margin-top:\s*10px/s,
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

  it.each(THEMES)(
    "keeps dates readable over the future fade in %s",
    (theme) => {
      const fade = stylesheet.match(
        /\.future-message-boundary-surface\s*\{([^}]+)\}/,
      );
      const stops = [
        ...fade![1]!.matchAll(
          /color-mix\(\s*in srgb,\s*var\(--accent(-tint)?\) var\((--future-(?:start|middle)-weight)\),\s*var\(--history\)\s*\)/g,
        ),
      ];
      expect(stops).toHaveLength(2);
      const tokens = themeBlock(theme) + themeBlock("light");
      const history = readColorToken(tokens, "history");
      const text = readColorToken(tokens, "muted");
      for (const [selector, accents] of [
        ["[data-accent]", ACCENT_FAMILIES],
        ['[data-accent$="-gradient"]', gradientTokens],
      ] as const) {
        const rule = stylesheet.split(selector + " {")[1]!.split("}")[0]!;
        for (const [, suffix = "", weightToken] of stops) {
          const weight = rule.match(new RegExp(weightToken + ": ([\\d.]+)%"));
          expect(weight).not.toBeNull();
          for (const accent of accents) {
            const color = readColorToken(
              tokens,
              accent + (accents === gradientTokens ? suffix : ""),
            );
            const background = mixHex(color, history, Number(weight![1]) / 100);
            expect(
              contrastRatio(text, background),
              `${theme} ${accent}${suffix} fade`,
            ).toBeGreaterThanOrEqual(4.5);
          }
        }
      }
    },
  );

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
      expect(rule?.groups?.body).toContain("border: 0");
      expect(rule?.groups?.body).not.toContain("var(--control-border)");
    }
  });

  it("uses message-specific colors for bubble surfaces, metadata and links", () => {
    const bubbleRule = stylesheet.match(
      /\.message-bubble\s*\{(?<body>[^}]+)\}/,
    );

    expect(bubbleRule?.groups?.body).toContain(
      "var(--accent-tint) var(--message-tint-weight)",
    );

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

  it.each(THEMES)("keeps project-colored messages readable in %s", (theme) => {
    const tokens = themeBlock(theme) + themeBlock("light");
    const strength = tokens.match(/--message-accent-strength:\s*([\d.]+)%/);
    expect(strength, `Missing message tint in ${theme}`).not.toBeNull();
    const tailWeight = tokens.match(/--message-end-strength:\s*([\d.]+)%/);
    expect(
      tailWeight,
      `Missing gradient end strength in ${theme}`,
    ).not.toBeNull();
    const paper = readColorToken(tokens, "paper");
    const labelTint = stylesheet.match(
      /\.message-label\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--message-muted\) ([\d.]+)%, transparent\)/,
    );
    expect(labelTint, "Missing message label tint").not.toBeNull();
    const metadata = readColorToken(tokens, "message-muted");
    for (const accent of gradientTokens) {
      const bubble = mixHex(
        readColorToken(tokens, `${accent}-tint`),
        paper,
        Number(strength![1]) / 100,
      );
      if (theme === "light") {
        expect(
          contrastRatio(bubble, readColorToken(tokens, "history")),
          `Light --${accent} message against --history`,
        ).toBeGreaterThanOrEqual(1.45);
      }
      const stops = [
        mixHex(bubble, paper, 0.43),
        bubble,
        mixHex(
          readColorToken(tokens, `${accent}-end`),
          paper,
          Number(tailWeight![1]) / 100,
        ),
      ];
      for (const stop of stops) {
        for (const foreground of ["ink", "message-muted", "message-link"]) {
          expect(
            contrastRatio(readColorToken(tokens, foreground), stop),
            `${theme} --${foreground} on --${accent} message`,
          ).toBeGreaterThanOrEqual(4.5);
        }
        expect(
          contrastRatio(
            metadata,
            mixHex(metadata, stop, Number(labelTint![1]) / 100),
          ),
          `${theme} label text on --${accent} message`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it.each(THEMES)(
    "keeps project-colored attachment insets readable in %s",
    (theme) => {
      for (const accent of [...ACCENT_FAMILIES, ...gradientTokens]) {
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

  it.each(
    ACCENT_FAMILIES.map(
      (family, index) => [family, gradientTokens[index]] as const,
    ),
  )(
    "maps the %s project to its identity, action, message and attachment colors",
    (family, accent) => {
      const rule = stylesheet.match(
        new RegExp(
          `\\[data-accent="${family}-gradient"\\]\\s*\\{(?<body>[^}]+)\\}`,
        ),
      );
      expect(rule?.groups?.body).toContain(`--accent: var(--${accent})`);
      expect(rule?.groups?.body).toContain(
        `--accent-end: var(--${accent}-end)`,
      );
      expect(rule?.groups?.body).toContain(
        `--accent-action: var(--${accent}-action)`,
      );
      expect(rule?.groups?.body).toContain(
        `--accent-tint: var(--${accent}-tint)`,
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
      "outline: 1px solid var(--attachment-ink)",
    );
    expect(forcedColors?.groups?.body).toMatch(
      /\.message-bubble,\s*\.attachment-list,\s*\.message-label-popover\s*\{[^}]*border: 1px solid CanvasText/s,
    );
  });

  it("gives the quiet new-project control clear hover feedback", () => {
    const hoverRule = stylesheet.match(
      /\.new-project-button:hover\s*\{(?<body>[^}]+)\}/,
    );

    expect(hoverRule?.groups?.body).toContain("background: var(--selection)");
    expect(hoverRule?.groups?.body).toContain("color: var(--ink)");
  });
});
