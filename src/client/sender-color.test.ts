import { describe, expect, it } from "vitest";

import { senderColor } from "./sender-color.js";

describe("participant sender color", () => {
  it("keeps the same normalized sender on one stable closed color slot", () => {
    expect(senderColor("Maya Chen")).toBe(senderColor("  maya chen  "));
    expect(senderColor("ＭＡＹＡ　ＣＨＥＮ")).toBe(senderColor("maya chen"));
    expect(senderColor("Ipek IŞIK")).toBe(senderColor("ipek işik"));
    expect(senderColor("Maya Chen")).toMatch(
      /^(coral|amber|moss|ocean|iris|slate)$/,
    );
  });

  it("does not collapse every sender onto the same color", () => {
    expect(
      new Set([
        senderColor("Maya Chen"),
        senderColor("Omar Haddad"),
        senderColor("Priya Raman"),
        senderColor("Jon Bell"),
      ]).size,
    ).toBeGreaterThan(1);
  });
});
