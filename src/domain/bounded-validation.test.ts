import { describe, expect, it } from "vitest";

import { projectSelectionSchema } from "./database-transfer.js";
import { updateChatInputSchema, updateNoteInputSchema } from "./validation.js";

describe("oversized collection validation", () => {
  // Invalid elements must not allocate one error each once the size cap fails.
  // Small fixtures reproduce GHSA-mrhx-c7xc-m3w5 without exhausting memory.
  it.each([
    {
      name: "project labels",
      schema: updateChatInputSchema,
      input: { enabledLabels: Array(256).fill(null) },
      field: "enabledLabels",
    },
    {
      name: "kept attachment IDs",
      schema: updateNoteInputSchema,
      input: { keepAttachmentIds: Array(256).fill(null) },
      field: "keepAttachmentIds",
    },
  ])("bounds error allocation for $name", ({ schema, input, field }) => {
    const result = schema.safeParse(input);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("Oversized input was accepted");
    expect(result.error.issues.length).toBe(1);
    expect(result.error.issues[0]).toMatchObject({
      code: "too_big",
      path: [field],
    });
  });

  it("bounds errors inside backup project selection's union", () => {
    const result = projectSelectionSchema.safeParse(Array(10_001).fill(null));
    expect(result.success).toBe(false);
    if (result.success) throw new Error("Oversized selection was accepted");
    const issue = result.error.issues[0];
    expect(issue.code).toBe("invalid_union");
    if (issue.code !== "invalid_union") throw new Error("Expected union error");
    expect(issue.errors.flat().length).toBe(2);
    expect(issue.errors[1][0]).toMatchObject({ code: "too_big" });
  });
});
