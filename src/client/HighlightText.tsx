import { Fragment } from "react";
import { highlightParts, searchRanges } from "./search-highlight.js";

export function HighlightText({
  text,
  terms,
}: {
  text: string;
  terms: readonly string[];
}) {
  return highlightParts(text, searchRanges(text, terms)).map((part, index) =>
    part.match ? (
      <mark className="search-highlight" key={index}>
        {part.text}
      </mark>
    ) : (
      <Fragment key={index}>{part.text}</Fragment>
    ),
  );
}
