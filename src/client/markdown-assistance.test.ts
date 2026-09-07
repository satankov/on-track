import { describe, expect, it } from "vitest";

import {
  applyMarkdownAction,
  MARKDOWN_TOOLS,
  markdownActionForShortcut,
} from "./markdown-assistance.js";

describe("Markdown assistance transformations", () => {
  it("wraps selected text and keeps the content selected", () => {
    expect(applyMarkdownAction("alpha beta", "bold", 6, 10)).toEqual({
      ok: true,
      value: "alpha **beta**",
      selectionStart: 8,
      selectionEnd: 12,
    });
    expect(applyMarkdownAction("alpha", "italic", 0, 5)).toEqual({
      ok: true,
      value: "*alpha*",
      selectionStart: 1,
      selectionEnd: 6,
    });
  });

  it("inserts editable placeholders when no text is selected", () => {
    expect(applyMarkdownAction("alpha", "bold", 5, 5)).toEqual({
      ok: true,
      value: "alpha**text**",
      selectionStart: 7,
      selectionEnd: 11,
    });
    expect(applyMarkdownAction("", "link", 0, 0)).toEqual({
      ok: true,
      value: "[label](https://)",
      selectionStart: 8,
      selectionEnd: 16,
    });
  });

  it("uses selected text as the link label and selects the URL", () => {
    expect(applyMarkdownAction("Guide", "link", 0, 5)).toEqual({
      ok: true,
      value: "[Guide](https://)",
      selectionStart: 8,
      selectionEnd: 16,
    });
  });

  it("prefixes every complete affected line", () => {
    expect(
      applyMarkdownAction("before\nalpha\nbeta\nafter", "quote", 8, 15),
    ).toEqual({
      ok: true,
      value: "before\n> alpha\n> beta\nafter",
      selectionStart: 7,
      selectionEnd: 21,
    });
    expect(applyMarkdownAction("one\ntwo", "numbered-list", 0, 7)).toEqual({
      ok: true,
      value: "1. one\n2. two",
      selectionStart: 0,
      selectionEnd: 13,
    });
    expect(applyMarkdownAction("todo", "checklist", 0, 4)).toEqual({
      ok: true,
      value: "- [ ] todo",
      selectionStart: 0,
      selectionEnd: 10,
    });
  });

  it("uses inline code for one line and a fence for multiple lines", () => {
    expect(applyMarkdownAction("alpha", "code", 0, 5)).toEqual({
      ok: true,
      value: "`alpha`",
      selectionStart: 1,
      selectionEnd: 6,
    });
    expect(applyMarkdownAction("one\ntwo", "code", 0, 7)).toEqual({
      ok: true,
      value: "```\none\ntwo\n```",
      selectionStart: 4,
      selectionEnd: 11,
    });
  });

  it("inserts a valid table block without discarding selected text", () => {
    expect(applyMarkdownAction("Intro", "table", 5, 5)).toEqual({
      ok: true,
      value:
        "Intro\n\n| Header | Header |\n| --- | --- |\n| Value | Value |\n| Value | Value |\n",
      selectionStart: 9,
      selectionEnd: 15,
    });

    const result = applyMarkdownAction("alpha beta", "table", 0, 5);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toContain("alpha");
    expect(result.value).toContain(" beta");
    expect(result.value).toContain("| Header | Header |");
  });

  it("refuses a transformation that would exceed the message limit", () => {
    expect(applyMarkdownAction("a".repeat(9_999), "bold", 0, 1)).toEqual({
      ok: false,
      error: "This formatting would exceed the 10,000-character message limit.",
    });
  });
});

describe("Markdown assistance shortcuts", () => {
  it.each([
    [{ key: "и", code: "KeyB", metaKey: true }, "MacIntel", "bold"],
    [{ key: "I", ctrlKey: true }, "Linux x86_64", "italic"],
    [{ key: "k", metaKey: true }, "MacIntel", "link"],
    [{ key: "e", ctrlKey: true }, "Win32", "code"],
    [
      { key: "&", code: "Digit7", metaKey: true, shiftKey: true },
      "MacIntel",
      "numbered-list",
    ],
    [
      { key: "*", code: "Digit8", ctrlKey: true, shiftKey: true },
      "Linux x86_64",
      "bulleted-list",
    ],
    [
      { key: "(", code: "Digit9", metaKey: true, shiftKey: true },
      "MacIntel",
      "checklist",
    ],
    [
      { key: ">", code: "Period", ctrlKey: true, shiftKey: true },
      "Win32",
      "quote",
    ],
  ] as const)("maps %j on %s to %s", (shortcut, platform, action) => {
    expect(markdownActionForShortcut(shortcut, platform)).toBe(action);
  });

  it("requires the platform's exact primary modifier", () => {
    expect(
      markdownActionForShortcut({ key: "b", ctrlKey: true }, "MacIntel"),
    ).toBeUndefined();
    expect(
      markdownActionForShortcut({ key: "b", metaKey: true }, "Win32"),
    ).toBeUndefined();
    expect(
      markdownActionForShortcut(
        { key: "b", ctrlKey: true, metaKey: true },
        "MacIntel",
      ),
    ).toBeUndefined();
  });

  it("advertises the printable Quote shortcut to assistive technology", () => {
    expect(
      MARKDOWN_TOOLS.find((tool) => tool.action === "quote"),
    ).toMatchObject({
      ariaKeyShortcuts: "Meta+Shift+. Control+Shift+.",
    });
  });

  it("leaves unrelated, repeated, composing, and Alt-modified keys alone", () => {
    expect(markdownActionForShortcut({ key: "b" }, "Win32")).toBeUndefined();
    expect(
      markdownActionForShortcut(
        { key: "b", metaKey: true, repeat: true },
        "MacIntel",
      ),
    ).toBeUndefined();
    expect(
      markdownActionForShortcut(
        {
          key: "b",
          ctrlKey: true,
          isComposing: true,
        },
        "Win32",
      ),
    ).toBeUndefined();
    expect(
      markdownActionForShortcut(
        { key: "b", ctrlKey: true, altKey: true },
        "Win32",
      ),
    ).toBeUndefined();
    expect(
      markdownActionForShortcut({ key: "Enter", metaKey: true }, "MacIntel"),
    ).toBeUndefined();
  });
});
