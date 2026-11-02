import { describe, expect, it } from "vitest";
import type { Note } from "../domain/types.js";
import {
  buildSearchDocument,
  createSearchDocumentBuilder,
  matchesSearch,
  parseSearchQuery,
} from "./project-search.js";

const note = (body: string, extra: Partial<Note> = {}): Note => ({
  id: "n",
  chatId: "p",
  body,
  sender: null,
  createdAt: 1,
  labels: [],
  ...extra,
});
const finds = (body: string, query: string, extra: Partial<Note> = {}) =>
  matchesSearch(
    buildSearchDocument(note(body, extra)),
    parseSearchQuery(query),
  );

describe("literal project search", () => {
  it("refreshes changed text, senders and filenames and forgets removed messages", () => {
    const build = createSearchDocumentBuilder();
    const original = note("Hotel budget");
    expect(build([original]).get("n")?.fields).toContain("hotel budget");
    const changed = note("Museum tickets", { sender: "Maya" });
    expect(
      matchesSearch(build([changed]).get("n")!, parseSearchQuery("hotel")),
    ).toBe(false);
    expect(
      matchesSearch(build([changed]).get("n")!, parseSearchQuery("maya")),
    ).toBe(true);
    expect(build([]).size).toBe(0);
    expect(build([original]).get("n")?.fields).toContain("hotel budget");
  });
  it("requires every term, ignores order/case/duplicate whitespace, and matches fragments", () => {
    expect(finds("Hotel budget for our vacation", " BUDG\nHOTEL hotel ")).toBe(
      true,
    );
    expect(finds("Hotel budget for our vacation", "cat")).toBe(true);
    expect(finds("Hotel budget", "hotel museum")).toBe(false);
    expect(finds("anything", " \t\n")).toBe(true);
  });
  it("preserves literal punctuation without operators or regex", () => {
    for (const query of ["C++", ".pdf", "%", "_", "*", "[x]", '"quote"'])
      expect(finds('`C++ report.pdf 20% _ * [x] "quote"`', query)).toBe(true);
    expect(finds("hotel budget", "hotel OR budget")).toBe(false);
    expect(finds("hotels", "hotel*")).toBe(false);
  });
  it("normalizes Unicode without stripping accents or inventing language equivalents", () => {
    expect(finds("БЮДЖЕТ Café 東京 🧳", "бюдж cafe\u0301 東京 🧳")).toBe(true);
    expect(finds("café ёлка Straße", "cafe")).toBe(false);
    expect(finds("ёлка", "елка")).toBe(false);
    expect(finds("Straße", "STRASSE")).toBe(false);
  });
  it("searches readable Markdown/code/alt text, not hidden destinations or HTML", () => {
    expect(
      finds(
        "**Budget** [hotel](https://hidden.example)\n\n`C++` ![map](image.png)",
        "budget hotel C++ map",
      ),
    ).toBe(true);
    expect(finds("[hotel](https://hidden.example)", "hidden.example")).toBe(
      false,
    );
    expect(finds("<script>secret</script>", "secret")).toBe(false);
    expect(finds("https://visible.example", "visible.example")).toBe(true);
  });
  it("matches across fields but never across field boundaries, including unavailable filenames", () => {
    const extra = {
      sender: "Maya",
      attachments: [
        {
          id: "f",
          noteId: "n",
          filename: "hotel.pdf",
          status: "missing" as const,
          mediaType: "application/pdf",
          byteSize: 1,
          modifiedAt: 1,
          createdAt: 1,
        },
      ],
    };
    expect(finds("budget", "maya hotel budg", extra)).toBe(true);
    expect(finds("budget", "budgetmaya", extra)).toBe(false);
    expect(finds("", "hotel", extra)).toBe(true);
    expect(finds("budget", "you")).toBe(true);
    expect(finds("budget", "you", extra)).toBe(false);
  });
  it("rejects overlong queries without silently truncating them", () => {
    expect(parseSearchQuery("x".repeat(256)).error).toBeUndefined();
    const query = parseSearchQuery("x".repeat(257));
    expect(query.error).toMatch(/256/);
    expect(
      matchesSearch(buildSearchDocument(note("x".repeat(257))), query),
    ).toBe(false);
  });
});
