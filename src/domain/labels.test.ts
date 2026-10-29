import { describe, expect, it } from "vitest";
import {
  defaultProjectLabels,
  labelConfigurationSchema,
  labelCharacterCount,
  labelNameKey,
} from "./labels.js";
const builtins = () =>
  defaultProjectLabels().map(({ id, name, symbol, enabled }) => ({
    id,
    name,
    symbol,
    enabled,
  }));
const config = (name: string, symbol: string | null = null) => ({
  revision: 0,
  labels: [...builtins(), { name, symbol, enabled: true }],
});
describe("custom project label boundaries", () => {
  it.each(["12345678", "🧑🏽‍💻", "e\u0301quipe", "Review"])(
    "accepts bounded visible name %s",
    (name) => {
      expect(
        labelConfigurationSchema.safeParse(config(name, "👨‍👩‍👧‍👦")).success,
      ).toBe(true);
    },
  );
  it.each([
    "",
    "   ",
    "123456789",
    "\u200d",
    "\u0301",
    "x\nname",
    "a\u202eb",
    "todo",
    "x" + "\u0301".repeat(260),
  ])("rejects invalid name %j", (name) => {
    expect(labelConfigurationSchema.safeParse(config(name)).success).toBe(
      false,
    );
  });
  it.each(["", "ab", "\u200d", "\u0301", "x\n", "x".repeat(65)])(
    "rejects invalid glyph %j",
    (symbol) => {
      expect(
        labelConfigurationSchema.safeParse(config("Review", symbol)).success,
      ).toBe(false);
    },
  );
  it("normalizes names and counts complete emoji clusters", () => {
    expect(labelCharacterCount("🇳🇱👨‍👩‍👧‍👦👍🏽")).toBe(3);
    expect(labelNameKey(" Équipe ")).toBe("équipe");
    expect(
      labelConfigurationSchema.parse(config("  Cafe\u0301 ")).labels.at(-1)
        ?.name,
    ).toBe("Café");
  });
  it("bounds quantity, preserves built-ins and rejects duplicate IDs or names", () => {
    const labels = [
      ...builtins(),
      ...Array.from({ length: 5 }, (_, i) => ({
        name: `Extra${i}`,
        symbol: null,
        enabled: true,
      })),
    ];
    expect(
      labelConfigurationSchema.safeParse({ revision: 0, labels }).success,
    ).toBe(true);
    expect(
      labelConfigurationSchema.safeParse({
        revision: 0,
        labels: [...labels, { name: "Sixth", symbol: null, enabled: true }],
      }).success,
    ).toBe(false);
    expect(
      labelConfigurationSchema.safeParse({
        revision: 0,
        labels: builtins().slice(1),
      }).success,
    ).toBe(false);
    expect(
      labelConfigurationSchema.safeParse({
        revision: 0,
        labels: [...builtins(), builtins()[2]],
      }).success,
    ).toBe(false);
    const renamed = builtins();
    renamed[2]!.name = "Renamed";
    expect(
      labelConfigurationSchema.safeParse({ revision: 0, labels: renamed })
        .success,
    ).toBe(false);
  });
});
