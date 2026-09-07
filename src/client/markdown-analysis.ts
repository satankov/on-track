import { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

const parser = unified().use(remarkParse).use(remarkGfm).freeze();

type MarkdownNode = {
  type: string;
  value?: string;
  alt?: string | null;
  url?: string;
  identifier?: string;
  children?: MarkdownNode[];
};

const blockTypes = new Set([
  "root",
  "paragraph",
  "heading",
  "blockquote",
  "list",
  "listItem",
  "table",
  "tableRow",
  "tableCell",
  "code",
]);

/** Analyze text only: never render HTML or load a link/image destination. */
export function analyzeMarkdown(body: string): {
  text: string;
  hasLinks: boolean;
} {
  const tree = parser.parse(body);
  const definitions = new Map<string, string>();
  const footnotes = new Map<string, MarkdownNode>();
  const referencedFootnotes = new Set<string>();
  const visitDefinitions = (node: MarkdownNode) => {
    if (
      node.type === "definition" &&
      node.identifier &&
      !definitions.has(node.identifier)
    ) {
      definitions.set(node.identifier, node.url ?? "");
    }
    if (
      node.type === "footnoteDefinition" &&
      node.identifier &&
      !footnotes.has(node.identifier)
    ) {
      footnotes.set(node.identifier, node);
    }
    node.children?.forEach(visitDefinitions);
  };
  visitDefinitions(tree);
  let hasLinks = false;
  const read = (node: MarkdownNode): string => {
    if (
      node.type === "definition" ||
      node.type === "html" ||
      node.type === "footnoteDefinition"
    )
      return "";
    if (node.type === "footnoteReference" && node.identifier) {
      referencedFootnotes.add(node.identifier);
      return "";
    }
    if (node.type === "link" || node.type === "linkReference") {
      const url =
        node.type === "link"
          ? node.url
          : definitions.get(node.identifier ?? "");
      if (url && defaultUrlTransform(url)) hasLinks = true;
    }
    if (node.type === "break") return " ";
    if (node.type === "image" || node.type === "imageReference")
      return node.alt ?? "";
    // Also tolerate the spaced bold markers used in quick notes, while keeping
    // code literals intact. All structural Markdown is handled by the parser.
    if (node.type === "text")
      return (node.value ?? "").replace(/\*\*\s+([^*]*?\S)\s+\*\*/g, "$1");
    const content = node.value ?? node.children?.map(read).join("") ?? "";
    return blockTypes.has(node.type) ? `${content} ` : content;
  };
  let content = read(tree);
  // Set iteration also visits newly referenced nested footnotes, once each.
  for (const identifier of referencedFootnotes) {
    content += footnotes.get(identifier)?.children?.map(read).join("") ?? "";
  }
  const text = content.replace(/\s+/g, " ").trim();
  return { text, hasLinks };
}
