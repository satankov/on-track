export type MarkdownAction =
  | "bold"
  | "italic"
  | "link"
  | "quote"
  | "bulleted-list"
  | "numbered-list"
  | "checklist"
  | "code"
  | "table";

export type MarkdownEditResult =
  | {
      ok: true;
      value: string;
      selectionStart: number;
      selectionEnd: number;
    }
  | { ok: false; error: string };

export interface MarkdownShortcutEvent {
  key: string;
  code?: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
  isComposing?: boolean;
}

export interface MarkdownTool {
  action: MarkdownAction;
  label: string;
  syntax: string;
  shortcutLabel?: string;
  ariaKeyShortcuts?: string;
}

export const MARKDOWN_TOOLS: readonly MarkdownTool[] = [
  {
    action: "bold",
    label: "Bold",
    syntax: "**text**",
    shortcutLabel: "⌘B / Ctrl+B",
    ariaKeyShortcuts: "Meta+B Control+B",
  },
  {
    action: "italic",
    label: "Italic",
    syntax: "*text*",
    shortcutLabel: "⌘I / Ctrl+I",
    ariaKeyShortcuts: "Meta+I Control+I",
  },
  {
    action: "link",
    label: "Link",
    syntax: "[label](url)",
    shortcutLabel: "⌘K / Ctrl+K",
    ariaKeyShortcuts: "Meta+K Control+K",
  },
  {
    action: "quote",
    label: "Quote",
    syntax: "> cited text",
    shortcutLabel: "⌘⇧. / Ctrl+Shift+.",
    ariaKeyShortcuts: "Meta+Shift+. Control+Shift+.",
  },
  {
    action: "bulleted-list",
    label: "Bulleted list",
    syntax: "- item",
    shortcutLabel: "⌘⇧8 / Ctrl+Shift+8",
    ariaKeyShortcuts: "Meta+Shift+8 Control+Shift+8",
  },
  {
    action: "numbered-list",
    label: "Numbered list",
    syntax: "1. item",
    shortcutLabel: "⌘⇧7 / Ctrl+Shift+7",
    ariaKeyShortcuts: "Meta+Shift+7 Control+Shift+7",
  },
  {
    action: "checklist",
    label: "Checklist",
    syntax: "- [ ] item",
    shortcutLabel: "⌘⇧9 / Ctrl+Shift+9",
    ariaKeyShortcuts: "Meta+Shift+9 Control+Shift+9",
  },
  {
    action: "code",
    label: "Code",
    syntax: "`code`",
    shortcutLabel: "⌘E / Ctrl+E",
    ariaKeyShortcuts: "Meta+E Control+E",
  },
  {
    action: "table",
    label: "Table",
    syntax: "| Header | Header |",
  },
] as const;

const MESSAGE_LENGTH_LIMIT = 10_000;
const LIMIT_ERROR =
  "This formatting would exceed the 10,000-character message limit.";

function normalizedSelection(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): [number, number] {
  const start = Math.max(0, Math.min(selectionStart, value.length));
  const end = Math.max(0, Math.min(selectionEnd, value.length));
  return start <= end ? [start, end] : [end, start];
}

function editResult(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): MarkdownEditResult {
  if (value.length > MESSAGE_LENGTH_LIMIT) {
    return { ok: false, error: LIMIT_ERROR };
  }
  return { ok: true, value, selectionStart, selectionEnd };
}

function wrapSelection(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  open: string,
  close: string,
  placeholder: string,
): MarkdownEditResult {
  const selected = value.slice(selectionStart, selectionEnd);
  const content = selected || placeholder;
  const replacement = `${open}${content}${close}`;
  return editResult(
    `${value.slice(0, selectionStart)}${replacement}${value.slice(selectionEnd)}`,
    selectionStart + open.length,
    selectionStart + open.length + content.length,
  );
}

function linePrefix(
  action: Extract<
    MarkdownAction,
    "quote" | "bulleted-list" | "numbered-list" | "checklist"
  >,
  lineIndex: number,
): string {
  if (action === "quote") return "> ";
  if (action === "bulleted-list") return "- ";
  if (action === "checklist") return "- [ ] ";
  return `${lineIndex + 1}. `;
}

function prefixLines(
  value: string,
  action: Extract<
    MarkdownAction,
    "quote" | "bulleted-list" | "numbered-list" | "checklist"
  >,
  selectionStart: number,
  selectionEnd: number,
): MarkdownEditResult {
  const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
  const effectiveEnd =
    selectionEnd > selectionStart && value[selectionEnd - 1] === "\n"
      ? selectionEnd - 1
      : selectionEnd;
  const nextNewline = value.indexOf("\n", effectiveEnd);
  const lineEnd = nextNewline === -1 ? value.length : nextNewline;
  const block = value.slice(lineStart, lineEnd);

  if (selectionStart === selectionEnd && block.length === 0) {
    const prefix = linePrefix(action, 0);
    const placeholder = action === "quote" ? "text" : "item";
    const replacement = `${prefix}${placeholder}`;
    return editResult(
      `${value.slice(0, lineStart)}${replacement}${value.slice(lineEnd)}`,
      lineStart + prefix.length,
      lineStart + replacement.length,
    );
  }

  const replacement = block
    .split("\n")
    .map((line, index) => `${linePrefix(action, index)}${line}`)
    .join("\n");
  return editResult(
    `${value.slice(0, lineStart)}${replacement}${value.slice(lineEnd)}`,
    lineStart,
    lineStart + replacement.length,
  );
}

function tableSpacingBefore(value: string): string {
  if (!value) return "";
  if (value.endsWith("\n\n")) return "";
  return value.endsWith("\n") ? "\n" : "\n\n";
}

function tableSpacingAfter(value: string): string {
  if (!value) return "\n";
  if (value.startsWith("\n\n")) return "";
  return value.startsWith("\n") ? "\n" : "\n\n";
}

export function applyMarkdownAction(
  value: string,
  action: MarkdownAction,
  selectionStart: number,
  selectionEnd: number,
): MarkdownEditResult {
  const [start, end] = normalizedSelection(value, selectionStart, selectionEnd);

  if (action === "bold") {
    return wrapSelection(value, start, end, "**", "**", "text");
  }
  if (action === "italic") {
    return wrapSelection(value, start, end, "*", "*", "text");
  }
  if (action === "link") {
    const label = value.slice(start, end) || "label";
    const url = "https://";
    const replacement = `[${label}](${url})`;
    const urlStart = start + label.length + 3;
    return editResult(
      `${value.slice(0, start)}${replacement}${value.slice(end)}`,
      urlStart,
      urlStart + url.length,
    );
  }
  if (
    action === "quote" ||
    action === "bulleted-list" ||
    action === "numbered-list" ||
    action === "checklist"
  ) {
    return prefixLines(value, action, start, end);
  }
  if (action === "code") {
    const selected = value.slice(start, end);
    if (selected.includes("\n")) {
      return wrapSelection(value, start, end, "```\n", "\n```", "code");
    }
    return wrapSelection(value, start, end, "`", "`", "code");
  }

  const insertionPoint = end;
  const before = value.slice(0, insertionPoint);
  const after = value.slice(insertionPoint);
  const spacingBefore = tableSpacingBefore(before);
  const spacingAfter = tableSpacingAfter(after);
  const table =
    "| Header | Header |\n| --- | --- |\n| Value | Value |\n| Value | Value |";
  const nextValue = `${before}${spacingBefore}${table}${spacingAfter}${after}`;
  const headerStart = insertionPoint + spacingBefore.length + 2;
  return editResult(nextValue, headerStart, headerStart + "Header".length);
}

export function markdownActionForShortcut(
  event: MarkdownShortcutEvent,
  platform = "",
): MarkdownAction | undefined {
  const usesCommand = /Mac|iPhone|iPad|iPod/i.test(platform);
  const hasExactPrimaryModifier = usesCommand
    ? Boolean(event.metaKey) && !event.ctrlKey
    : Boolean(event.ctrlKey) && !event.metaKey;
  if (
    event.altKey ||
    event.repeat ||
    event.isComposing ||
    !hasExactPrimaryModifier
  ) {
    return undefined;
  }

  const key = event.key.toLowerCase();
  if (!event.shiftKey) {
    if (event.code === "KeyB" || key === "b") return "bold";
    if (event.code === "KeyI" || key === "i") return "italic";
    if (event.code === "KeyK" || key === "k") return "link";
    if (event.code === "KeyE" || key === "e") return "code";
    return undefined;
  }

  if (event.code === "Digit7" || key === "7") return "numbered-list";
  if (event.code === "Digit8" || key === "8") return "bulleted-list";
  if (event.code === "Digit9" || key === "9") return "checklist";
  if (event.code === "Period" || key === "." || key === ">") return "quote";
  return undefined;
}
