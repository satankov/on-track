import type { Definition, FootnoteDefinition, Root, RootContent } from "mdast";
import remarkStringify from "remark-stringify";
import { markdownParser, remarkSoftBreaks } from "./markdown-parser.js";

const writer = markdownParser()
  .use(remarkStringify, {
    bullet: "-",
    listItemIndent: "one",
    fences: true,
    emphasis: "*",
    strong: "*",
  })
  .freeze();

function portableUrl(value: string | undefined) {
  if (!value || !/^(?:https?:\/\/|mailto:)/i.test(value)) return undefined;
  return URL.canParse(value) ? value : undefined;
}

type MdNode = Root | RootContent;
function walk(node: MdNode, visit: (node: MdNode) => void) {
  visit(node);
  if ("children" in node) node.children.forEach((child) => walk(child, visit));
}

function excerptTree(body: string, ordinal: number) {
  const tree = markdownParser.parse(body.replace(/\r\n?/g, "\n"));
  const references = new Map<string, Definition>();
  const footnotes = new Map<string, FootnoteDefinition>();
  const usedFootnotes = new Map<string, string>();
  walk(tree, (node) => {
    if (node.type === "definition" && !references.has(node.identifier))
      references.set(node.identifier, node);
    if (node.type === "footnoteDefinition" && !footnotes.has(node.identifier))
      footnotes.set(node.identifier, node);
  });
  function clean(node: RootContent): RootContent[] {
    switch (node.type) {
      case "definition":
      case "footnoteDefinition":
      case "html":
        return [];
      case "image":
      case "imageReference":
        return [{ type: "text", value: node.alt || "Image omitted" }];
      case "link":
      case "linkReference": {
        const target =
          node.type === "link" ? node : references.get(node.identifier);
        const url = portableUrl(target?.url);
        const children = node.children.flatMap(clean) as typeof node.children;
        return url ? [{ type: "link", url, children }] : children;
      }
      case "footnoteReference": {
        if (!footnotes.has(node.identifier)) return [];
        const identifier =
          usedFootnotes.get(node.identifier) ??
          ordinal + "-" + (usedFootnotes.size + 1);
        usedFootnotes.set(node.identifier, identifier);
        return [{ type: "footnoteReference", identifier, label: identifier }];
      }
      case "heading":
        node.depth = Math.min(6, node.depth + 2) as typeof node.depth;
        break;
    }
    if ("children" in node)
      node.children = node.children.flatMap(clean) as typeof node.children;
    return [node];
  }
  tree.children = tree.children.flatMap(clean);
  // Map iteration includes newly discovered nested references, once per original ID.
  for (const [id, identifier] of usedFootnotes) {
    const def = footnotes.get(id)!;
    tree.children.push({
      type: "footnoteDefinition",
      identifier,
      label: identifier,
      children: def.children.flatMap(clean) as typeof def.children,
    });
  }
  return tree;
}

function plain(node: MdNode): string {
  switch (node.type) {
    case "text":
    case "inlineCode":
      return node.value;
    case "code":
      return node.value
        .split("\n")
        .map((line) => "    " + line)
        .join("\n");
    case "break":
      return "\n";
    case "thematicBreak":
      return "—";
    case "blockquote":
      return node.children
        .map(plain)
        .join("\n\n")
        .split("\n")
        .map((line) => "> " + line)
        .join("\n");
    case "list":
      return node.children
        .map((item, i) => {
          const task =
            item.checked == null ? "" : item.checked ? "[x] " : "[ ] ";
          const marker = node.ordered
            ? (node.start ?? 1) + i + ". " + task
            : task || "- ";
          const content = item.children
            .map((child, index) => {
              const separator =
                index === 0 ? "" : child.type === "list" ? "\n" : "\n\n";
              return separator + plain(child);
            })
            .join("")
            .replace(/\n(?=.)/g, "\n  ");
          return marker + content;
        })
        .join("\n");
    case "table": {
      const [header, ...rows] = node.children;
      const names = header.children.map(plain);
      if (!rows.length) return names.join(" | ");
      return rows
        .map((row) =>
          Array.from(
            { length: Math.max(names.length, row.children.length) },
            (_, i) =>
              (names[i] || "Column " + (i + 1)) +
              ": " +
              (row.children[i] ? plain(row.children[i]) : ""),
          ).join("; "),
        )
        .join("\n");
    }
    case "link": {
      const label = node.children.map(plain).join("");
      return !label || label === node.url || "mailto:" + label === node.url
        ? label || node.url
        : label + " (" + node.url + ")";
    }
    case "delete":
      return "(struck out: " + node.children.map(plain).join("") + ")";
    case "footnoteReference":
      return "[" + node.identifier + "]";
    case "footnoteDefinition":
      return (
        "[" + node.identifier + "] " + node.children.map(plain).join("\n\n")
      );
    case "root":
      return node.children.map(plain).filter(Boolean).join("\n\n");
    default:
      return "children" in node ? node.children.map(plain).join("") : "";
  }
}
export function exportBody(
  body: string,
  format: "md" | "txt",
  ordinal: number,
) {
  const tree = excerptTree(body, ordinal);
  if (format === "txt") return plain(tree);
  remarkSoftBreaks()(tree);
  return writer.stringify(tree).replace(/\n$/, "");
}
