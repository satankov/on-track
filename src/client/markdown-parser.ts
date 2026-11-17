import type { Root as MdRoot, RootContent } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

export const markdownParser = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .freeze();

export function remarkSoftBreaks() {
  return (root: MdRoot) => {
    function visit(parent: { children: RootContent[] }) {
      parent.children = parent.children.flatMap((child): RootContent[] => {
        if ("children" in child) visit(child);
        if (child.type !== "text" || !/[\r\n]/.test(child.value))
          return [child];
        const result: RootContent[] = [];
        for (const [index, line] of child.value
          .split(/\r\n|[\r\n]/)
          .entries()) {
          if (index) result.push({ type: "break" });
          if (line) result.push({ type: "text", value: line });
        }
        return result;
      });
    }
    visit(root);
  };
}
