import { describe, expect, it } from "vitest";

import {
  ACCENTS,
  createChatInputSchema,
  createNoteInputSchema,
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
