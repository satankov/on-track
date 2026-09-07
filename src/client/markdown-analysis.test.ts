import { describe, expect, it } from "vitest";
import { analyzeMarkdown } from "./markdown-analysis.js";

describe("Markdown preview and link analysis", () => {
  it.each([
    ["### Header\n\n**bold text**", "Header bold text"],
    ["### Header  ** bold text ** ", "Header bold text"],
    ["`** bold text **`", "** bold text **"],
    ["- [x] **Done**\n- Next\n\n> A quote", "Done Next A quote"],
    [
      "[Read *this*](https://example.com) ![A diagram](https://example.com/a.png)",
      "Read this A diagram",
    ],
    [
      "Use `a_b` and ~~old~~ new.\n\n```ts\nconst x = 1;\n```",
      "Use a_b and old new. const x = 1;",
    ],
    [
      "| Name | State |\n| --- | --- |\n| Plan | Ready |",
      "Name State Plan Ready",
    ],
    ["First  \nsecond &amp; third", "First second & third"],
    ["Before <script>evil()</script> after", "Before evil() after"],
    ["[Guide][docs]\n\n[docs]: https://example.com", "Guide"],
    ["", ""],
    ["---", ""],
  ])("extracts readable text from %s", (body, text) => {
    expect(analyzeMarkdown(body).text).toBe(text);
  });

  it.each([
    "See https://example.com/path?q=yes.",
    "Visit www.example.org",
    "<https://example.com>",
    "Contact person@example.com",
    "[Email](mailto:person@example.com)",
    "[Nested **label**](https://example.com/path_(a))",
    "[Guide][REF]\n\n[ref]: https://example.com",
    "[Guide][]\n\n[guide]: /guide",
    "[Section](#section)",
  ])("recognizes a rendered link in %s", (body) => {
    expect(analyzeMarkdown(body).hasLinks).toBe(true);
  });

  it.each([
    "Plain text",
    "`https://example.com`",
    "```\nhttps://example.com\n```",
    "![Alt](https://example.com/image.png)",
    "[unused]: https://example.com",
    "[missing][ref]",
    "[Blocked](javascript:alert)",
    "[Blocked](file:///tmp/private)",
    "[Blocked](data:text/html,abc)",
    '<a href="https://example.com">HTML link</a>',
    "[Empty]()",
    "",
    "![Alt][img]\n\n[img]: https://example.com/image.png",
  ])("ignores non-rendered or disallowed links in %s", (body) => {
    expect(analyzeMarkdown(body).hasLinks).toBe(false);
  });

  it("uses the first reference definition like the renderer", () => {
    expect(
      analyzeMarkdown("[x]\n\n[x]: javascript:bad\n[x]: https://example.com")
        .hasLinks,
    ).toBe(false);
  });
});

it("includes only reachable footnotes like the message renderer", () => {
  expect(
    analyzeMarkdown("Plain text\n\n[^unused]: https://example.com"),
  ).toEqual({ text: "Plain text", hasLinks: false });
  expect(
    analyzeMarkdown(
      "See note[^used].\n\n[^used]: https://example.com\n\n[^unused]: Secret",
    ),
  ).toEqual({ text: "See note. https://example.com", hasLinks: true });
  expect(
    analyzeMarkdown(
      "See[^a]\n\n[^a]: Nested[^b]\n\n[^b]: https://example.com [^a]",
    ).hasLinks,
  ).toBe(true);
});
