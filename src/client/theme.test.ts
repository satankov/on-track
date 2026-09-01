import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { ACCENTS } from "../domain/validation.js";

function luminance(hex: string): number {
  const channels = [0, 2, 4]
    .map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((channel) =>
      channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    );
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

describe("accent accessibility", () => {
  it.each(ACCENTS)("keeps white action text readable on %s", (accent) => {
    const stylesheet = readFileSync(
      resolve(process.cwd(), "src/client/styles.css"),
      "utf8",
    );
    const match = stylesheet.match(
      new RegExp(`--${accent}:\\s*#([0-9a-f]{6})`, "i"),
    );
    expect(match, `Missing --${accent} CSS token`).not.toBeNull();
    const ratio = 1.05 / (luminance(match![1]!) + 0.05);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("renders pending attachment remove icons with visible strokes", () => {
    const stylesheet = readFileSync(
      resolve(process.cwd(), "src/client/styles.css"),
      "utf8",
    );
    const match = stylesheet.match(
      /\.pending-attachment button svg\s*\{(?<body>[^}]+)\}/,
    );

    expect(match?.groups?.body).toContain("stroke: currentColor");
    expect(match?.groups?.body).toContain("fill: none");
  });
});
