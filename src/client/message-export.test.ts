import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { markdownParser } from "./markdown-parser.js";
import { exportBody } from "./message-export-markdown.js";
import { selectedMessageSource } from "./message-export-source.js";
import { defaultProjectLabels } from "../domain/labels.js";
import { formatMessageExport } from "./message-export.js";
import type { ExportMessage, ExportSource } from "./message-export-source.js";

const note = (
  body: string,
  options: Partial<ExportMessage> = {},
): ExportMessage => ({
  body,
  sender: null,
  createdAt: Date.parse("2026-11-16T09:18:00Z"),
  labels: [],
  attachmentCount: 0,
  ...options,
});
const sample: ExportSource = {
  titles: ["Riverside Move", "Move day"],
  messages: [
    note(
      "Use the **east entrance** on Mill Lane. The front steps are closed for repairs.",
      { sender: "Maya", createdAt: Date.parse("2026-11-16T09:10:00Z") },
    ),
    note(
      "Before the van arrives:\n\n- [x] Reserve the loading bay until 10:00.\n- [ ] Leave the lift key with reception.",
    ),
    note("Reception has the key. Meet the driver at 09:30.", {
      sender: "Maya",
      createdAt: Date.parse("2026-11-17T08:05:00Z"),
      attachmentCount: 1,
    }),
  ],
};
const render = (
  messages: ExportMessage[],
  format: "md" | "txt",
  titles = ["Notes"],
  includeLabels = false,
) =>
  formatMessageExport(
    { titles, messages },
    { format, includeLabels, timeZone: "Europe/London" },
  );
describe("readable selected-message exports", () => {
  it.each(["md", "txt"] as const)(
    "matches the reviewed .%s file with LF output",
    (format) => {
      const actual = render(sample.messages, format, sample.titles);
      const name = "riverside-move_move-day_2026-11-16." + format;
      expect(actual.filename).toBe(name);
      // Git may check out the reference with CRLF on Windows. Normalize only
      // that reference; the exported bytes must retain the specified LF format.
      expect(actual.text).toBe(
        readFileSync(
          "branding/threadstr/message-export/examples/" + name,
          "utf8",
        ).replace(/\r\n/g, "\n"),
      );
      expect(actual.text).not.toContain("\r");
    },
  );
  it("keeps the timeline's hard prose breaks and literal code whitespace", () => {
    const md = exportBody(
      "First line\nSecond line\n\n~~~\nlet x;  \n~~~",
      "md",
      1,
    );
    const [paragraph, code] = markdownParser.parse(md).children;
    expect(paragraph).toMatchObject({
      type: "paragraph",
      children: [{ type: "text" }, { type: "break" }, { type: "text" }],
    });
    expect(code).toMatchObject({ type: "code", value: "let x;  " });
    expect(exportBody("~~~\nlet x;  \n~~~", "txt", 1)).toBe("    let x;  ");
  });
  it("preserves ordered task numbers and paragraphs inside items", () => {
    expect(
      exportBody(
        "3. [x] Book van\n\n   Confirm by Friday.\n4. [ ] Bring keys",
        "txt",
        1,
      ),
    ).toBe("3. [x] Book van\n\n  Confirm by Friday.\n4. [ ] Bring keys");
  });
  it("uses display names from the owning conversation and transferred labels in timeline order", () => {
    const definitions = defaultProjectLabels();
    const item = {
      ...sample.messages[0],
      id: "n1",
      chatId: "main",
      labels: ["custom-copied", "open-question"] as (
        "custom-copied" | "open-question"
      )[],
      labelSnapshots: [
        { ...definitions[0], id: "custom-copied" as const, name: "Finance" },
      ],
    };
    const excluded = { ...item, id: "omit", body: "Never export me" };
    const source = selectedMessageSource(
      ["Notes"],
      [item, excluded],
      new Set(["n1"]),
      definitions,
    );
    expect(source.messages).toHaveLength(1);
    expect(source.messages[0].labels).toEqual(["Question", "Finance"]);
    expect(render(source.messages, "txt", source.titles, true).text).toContain(
      "Maya · Question · Finance",
    );
  });
  it("resolves references and footnotes independently and closes open blocks", () => {
    const messages = ["first", "second"].map((n) =>
      note(
        "# Update\n\n[Map][here] [^x]\n\n[here]: https://example.org/" +
          n +
          "\n\n[^x]: " +
          n +
          " footnote\n\n~~~js\nconst x = 1;",
      ),
    );
    const out = render(messages, "md").text;
    expect(out).toContain("### Update");
    expect(out).toMatch(/\[Map\]\(https:\/\/example\.org\/first\)/);
    expect(out).toContain("https://example.org/second");
    const footnotes = [...out.matchAll(/^\[\^([^\]]+)\]: /gm)].map(
      (match) => match[1],
    );
    expect(new Set(footnotes).size).toBe(2);
    expect(out.match(/const x = 1;\n`{3,}(?=\n)/g)).toHaveLength(2);
  });
  it.each(["md", "txt"] as const)(
    "keeps images and HTML inert and excludes unused destinations in %s",
    (format) => {
      const out = render(
        [
          note(
            "## Read\n\n![Moving van](https://private.test/image) ![](local.jpg) [local](file:///private/notes) [site][ok] <em>hello</em>\n\n[ok]: https://example.org\n[unused]: https://secret.test\n\n[^unused]: hidden definition",
          ),
        ],
        format,
      ).text;
      for (const value of [
        "Moving van",
        "Image omitted",
        "local",
        "site",
        "https://example.org",
        "hello",
      ])
        expect(out).toContain(value);
      for (const value of [
        "https://private",
        "file:///",
        "![",
        "<em>",
        "secret.test",
        "hidden definition",
      ])
        expect(out).not.toContain(value);
    },
  );
  it("preserves readable text structures, links and file-only notes", () => {
    const out = render(
      [
        note(
          "> **Review** [map](https://example.org)\n\n1. First\n   - [x] Nested\n\n| Room | Boxes |\n| - | - |\n| Kitchen | 4 |\n\n~~~\n  keep  spacing\n~~~",
        ),
        note("", { attachmentCount: 2 }),
      ],
      "txt",
    ).text;
    for (const value of [
      "> Review map (https://example.org)",
      "1. First",
      "  [x] Nested",
      "Room: Kitchen; Boxes: 4",
      "  keep  spacing",
      "2 attachments omitted.",
    ])
      expect(out).toContain(value);
  });
  it("keeps generated metadata on one line, uses portable basenames and omits labels by default", () => {
    const item = note("Hello", { sender: "Bo\n# quote", labels: ["Internal"] });
    const out = render([item], "md", ["../CON", "/"]);
    expect(out.filename).toBe("messages_2026-11-16.md");
    expect(out.text).not.toContain("\n# quote");
    expect(out.text).not.toContain("Internal");
    expect(render([item], "txt", ["A"], true).text).toContain(
      "Bo # quote · Internal",
    );
    expect(render([item], "txt", ["移動"]).filename).toMatch(/^移動_/);
  });
  it("distinguishes the two occurrences of the same local time", () => {
    const messages = ["2026-10-25T00:30:00Z", "2026-10-25T01:30:00Z"].map(
      (time) => note("Call", { createdAt: Date.parse(time) }),
    );
    const out = render(messages, "txt").text;
    expect(out).toContain("01:30 UTC+01:00");
    expect(out).toContain("01:30 UTC+00:00");
  });
});
