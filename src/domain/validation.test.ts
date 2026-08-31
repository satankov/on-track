import { describe, expect, it } from "vitest";

import {
  ACCENTS,
  createChatInputSchema,
  createNoteInputSchema,
  updateChatInputSchema,
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
});
