import { describe, expect, it } from "vitest";

import {
  ACCENTS,
  CONFIGURABLE_LABELS,
  DEFAULT_ENABLED_LABELS,
  LABELS,
  createChatInputSchema,
  createNoteInputSchema,
  labelSchema,
  updateChatInputSchema,
  updateNoteInputSchema,
} from "./validation.js";

describe("chat input validation", () => {
  it("trims a valid title and accepts a built-in accent", () => {
    expect(
      createChatInputSchema.parse({
        title: "  Launch plan  ",
        accent: "coral",
      }),
    ).toEqual({
      title: "Launch plan",
      accent: "coral",
    });
  });

  it.each(["", "   ", "x".repeat(81)])("rejects an invalid title", (title) => {
    expect(() =>
      createChatInputSchema.parse({ title, accent: "coral" }),
    ).toThrow();
  });

  it("rejects accents outside the stable token set", () => {
    expect(ACCENTS).toHaveLength(6);
    expect(() =>
      createChatInputSchema.parse({ title: "Project", accent: "neon" }),
    ).toThrow();
  });

  it("requires at least one customization field", () => {
    expect(() => updateChatInputSchema.parse({})).toThrow();
  });

  it("accepts a complete unique configurable-label selection", () => {
    expect(CONFIGURABLE_LABELS).toEqual([
      "todo",
      "decision",
      "open-question",
      "risk",
      "milestone",
    ]);
    expect(DEFAULT_ENABLED_LABELS).toEqual(["todo", "milestone"]);
    expect(
      updateChatInputSchema.parse({
        enabledLabels: ["decision", "risk"],
      }),
    ).toEqual({ enabledLabels: ["decision", "risk"] });
  });

  it("rejects unknown and duplicated project labels", () => {
    expect(LABELS).toEqual(["pin", "attention", ...CONFIGURABLE_LABELS]);
    expect(labelSchema.parse("open-question")).toBe("open-question");
    expect(() => labelSchema.parse("urgent")).toThrow();
    expect(() =>
      updateChatInputSchema.parse({ enabledLabels: ["todo", "todo"] }),
    ).toThrow();
    expect(() =>
      updateChatInputSchema.parse({ enabledLabels: ["pin"] }),
    ).toThrow();
  });
});

describe("note input validation", () => {
  it("trims boundary whitespace but preserves multiline text", () => {
    expect(createNoteInputSchema.parse({ body: "  first\nsecond  " })).toEqual({
      body: "first\nsecond",
    });
  });

  it.each(["", "   ", "x".repeat(10_001)])(
    "rejects an invalid body",
    (body) => {
      expect(() => createNoteInputSchema.parse({ body })).toThrow();
    },
  );

  it("accepts note text and timestamp updates", () => {
    expect(
      updateNoteInputSchema.parse({
        body: "  revised\nnote  ",
        createdAt: 1_700_000_000_000,
      }),
    ).toEqual({
      body: "revised\nnote",
      createdAt: 1_700_000_000_000,
    });
  });

  it.each([
    {},
    { body: " " },
    { createdAt: -1 },
    { createdAt: 1.5 },
    { createdAt: Number.MAX_SAFE_INTEGER + 1 },
  ])("rejects invalid note updates", (input) => {
    expect(() => updateNoteInputSchema.parse(input)).toThrow();
  });
});
