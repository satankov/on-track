import { createContext, useContext } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkSoftBreaks } from "./markdown-parser.js";
import type { Element, ElementContent, Root } from "hast";
import { rehypeSearchHighlight } from "./search-highlight.js";

function taskLabel(node: ElementContent): string {
  if (node.type === "text") return node.value;
  if (node.type !== "element" || ["ol", "ul"].includes(node.tagName)) return "";
  if (node.tagName === "img") return String(node.properties.alt ?? "");
  if (node.tagName === "br") return " ";
  return node.children.map(taskLabel).join("");
}

/** Only parser-generated GFM items are eligible. Their input has no position;
 * the enclosing list item supplies the source range even in nested lists. */
function rehypeTaskMarkers({ body }: { body: string }) {
  return (tree: Root) => {
    function visit(node: Element) {
      if (node.tagName === "li" && node.position) {
        const first = node.children.find((item) => item.type === "element");
        const block = first?.tagName === "p" ? first : node;
        const input = block.children.find((item) => item.type === "element");
        const start = node.position.start.offset;
        const end = node.position.end.offset;
        if (
          input?.tagName === "input" &&
          input.properties.type === "checkbox" &&
          start !== undefined &&
          end !== undefined
        ) {
          const marker = /^(?:[-+*]|\d{1,9}[.)])[ \t\r\n>]*\[([ xX\t])\]/.exec(
            body.slice(start, end),
          );
          if (marker) {
            input.properties.dataTaskOffset = start + marker[0].length - 2;
            input.properties.ariaLabel =
              taskLabel(block).replace(/\s+/g, " ").trim() || "Task";
          }
        }
      }
      for (const child of node.children)
        if (child.type === "element") visit(child);
    }
    for (const child of tree.children)
      if (child.type === "element") visit(child);
  };
}

const TaskContext = createContext<{
  toggle?: (offset: number, checked: boolean) => void;
  pending: boolean;
}>({ pending: false });

const messageMarkdownComponents: Components = {
  input: function TaskCheckbox({ node, ...props }) {
    const { toggle, pending } = useContext(TaskContext);
    const offset = node?.properties.dataTaskOffset;
    const editable = typeof offset === "number" && toggle;
    return (
      <input
        {...props}
        disabled={!editable}
        aria-disabled={pending || undefined}
        onChange={(event) => {
          if (editable && !pending) toggle(offset, event.currentTarget.checked);
        }}
      />
    );
  },
  table: ({ node, ...props }) => {
    void node;
    return (
      <div
        className="message-table-scroll"
        role="region"
        aria-label="Scrollable table"
        tabIndex={0}
      >
        <table {...props} />
      </div>
    );
  },
  a: ({ node, ...props }) => {
    // The Markdown AST node is not a DOM attribute.
    void node;
    return props.href?.startsWith("#") ? (
      <a {...props} />
    ) : (
      <a {...props} target="_blank" rel="noopener noreferrer" />
    );
  },
};

export function MarkdownMessage({
  body,
  searchTerms,
  onChange,
  pending,
}: {
  body: string;
  searchTerms: string[];
  onChange?: (body: string) => void;
  pending: boolean;
}) {
  if (!body.trim()) return null;
  function toggle(offset: number, checked: boolean) {
    onChange?.(
      body.slice(0, offset) + (checked ? "x" : " ") + body.slice(offset + 1),
    );
  }
  return (
    <TaskContext.Provider
      value={{ toggle: onChange ? toggle : undefined, pending }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkSoftBreaks]}
        rehypePlugins={[
          [rehypeTaskMarkers, { body }],
          [rehypeSearchHighlight, { terms: searchTerms }],
        ]}
        skipHtml
        components={messageMarkdownComponents}
      >
        {body}
      </ReactMarkdown>
    </TaskContext.Provider>
  );
}
