// @vitest-environment jsdom
import { HighlightText } from "./HighlightText.js";
import { render, screen } from "@testing-library/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { expect, it } from "vitest";
import { rehypeSearchHighlight, searchRanges } from "./search-highlight.js";

it("maps Unicode normalization to complete original graphemes and merges overlapping literal matches", () => {
  expect(searchRanges("Cafe\u0301 CAFÉ", ["café"])).toEqual([
    { start: 0, end: 5 },
    { start: 6, end: 10 },
  ]);
  expect(searchRanges("banana", ["ana", "nan"])).toEqual([
    { start: 1, end: 6 },
  ]);
  expect(searchRanges("İx", ["x"])).toEqual([{ start: 1, end: 2 }]);
  expect(searchRanges("ΟΣ", ["ος"])).toEqual([{ start: 0, end: 2 }]);
  expect(searchRanges("東京 👨‍👧", ["京", "👧"])).toEqual([
    { start: 1, end: 2 },
    { start: 3, end: 8 },
  ]);
  expect(searchRanges("[.*]", [".*"])).toEqual([{ start: 1, end: 3 }]);
  expect(searchRanges("untouched", ["", "absent"])).toEqual([]);
  expect(searchRanges("untouched", [])).toEqual([]);
});

it("preserves formatting and URLs when a term spans inline Markdown nodes", () => {
  const { container } = render(
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[[rehypeSearchHighlight, { terms: ["hotel", "budget"] }]]}
      skipHtml
    >
      {
        "ho**te**l [budget](https://example.com/hotel)\n\n`hotel`\n\n| Plan |\n| --- |\n| Budget |\n\nho\n\ntel\n\n<script>hotel</script>"
      }
    </ReactMarkdown>,
  );
  expect(container.querySelector("strong mark")).toHaveTextContent("te");
  expect(screen.getByRole("link", { name: "budget" })).toHaveAttribute(
    "href",
    "https://example.com/hotel",
  );
  expect(container.querySelector("code mark")).toHaveTextContent("hotel");
  expect(container.querySelector("td mark")).toHaveTextContent("Budget");
  expect(container.querySelectorAll("mark")).toHaveLength(6);
  expect(container.querySelector("script")).toBeNull();
});

it("renders filenames and people safely and leaves nonmatches intact", () => {
  const { container, rerender } = render(
    <HighlightText
      text={"<img src=x onerror=alert(1)> Maya"}
      terms={["<img", "maya"]}
    />,
  );
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelectorAll("mark")).toHaveLength(2);
  expect(container).toHaveTextContent("<img src=x onerror=alert(1)> Maya");
  rerender(<HighlightText text="hotel.pdf" terms={[]} />);
  expect(container).toHaveTextContent("hotel.pdf");
  expect(container.querySelector("mark")).toBeNull();
});
