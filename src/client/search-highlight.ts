type Range = { start: number; end: number };
const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const normalize = (text: string) =>
  text.normalize("NFC").toLowerCase().normalize("NFC");

/** Map normalized matches back to original graphemes, including combining marks. */
export function searchRanges(text: string, terms: readonly string[]): Range[] {
  if (!terms.length) return [];
  const starts: number[] = [],
    ends: number[] = [];
  for (const { segment, index } of segments.segment(text)) {
    for (let i = 0; i < normalize(segment).length; i++) {
      starts.push(index);
      ends.push(index + segment.length);
    }
  }
  const normalized = normalize(text);
  const ranges: Range[] = [];
  for (const term of terms) {
    if (!term) continue;
    let offset = normalized.indexOf(term);
    while (offset !== -1) {
      ranges.push({
        start: starts[offset],
        end: ends[offset + term.length - 1],
      });
      offset = normalized.indexOf(term, offset + 1);
    }
  }
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Range[] = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range.start <= last.end)
      last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

export function highlightParts(text: string, ranges: Range[]) {
  const result: { text: string; match: boolean }[] = [];
  let offset = 0;
  for (const range of ranges) {
    if (range.start > offset)
      result.push({ text: text.slice(offset, range.start), match: false });
    result.push({ text: text.slice(range.start, range.end), match: true });
    offset = range.end;
  }
  if (offset < text.length)
    result.push({ text: text.slice(offset), match: false });
  return result;
}

type Node = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: Node[];
};
const inline = new Set([
  "a",
  "strong",
  "em",
  "del",
  "code",
  "span",
  "sup",
  "sub",
]);

/** Highlight rendered text only; never rewrite Markdown source, attributes or URLs. */
export function rehypeSearchHighlight({ terms }: { terms: readonly string[] }) {
  return (tree: Node) => {
    if (!terms.length) return;
    let run: { node: Node; parent: Node; start: number }[] = [];
    let text = "";
    function flush() {
      const ranges = searchRanges(text, terms);
      for (const { node, parent, start } of run) {
        const value = node.value ?? "";
        const local = ranges
          .filter((r) => r.end > start && r.start < start + value.length)
          .map((r) => ({
            start: Math.max(0, r.start - start),
            end: Math.min(value.length, r.end - start),
          }));
        if (!local.length) continue;
        const replacement = highlightParts(value, local).map((part): Node =>
          part.match
            ? {
                type: "element",
                tagName: "mark",
                properties: { className: ["search-highlight"] },
                children: [{ type: "text", value: part.text }],
              }
            : { type: "text", value: part.text },
        );
        parent.children!.splice(
          parent.children!.indexOf(node),
          1,
          ...replacement,
        );
      }
      run = [];
      text = "";
    }
    function visit(node: Node, parent?: Node) {
      if (node.type === "text" && parent) {
        run.push({ node, parent, start: text.length });
        text += node.value ?? "";
        return;
      }
      const boundary = !inline.has(node.tagName ?? "");
      if (boundary) flush();
      for (const child of [...(node.children ?? [])]) visit(child, node);
      if (boundary) flush();
    }
    visit(tree);
  };
}
