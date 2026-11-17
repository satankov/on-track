// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownMessage } from "./MarkdownMessage.js";

describe("rendered Markdown tasks", () => {
  it("targets the parser's task after a continued quote prefix and preserves the rest of its source", () => {
    const body =
      "> 1.\r\n>    [X] **Book** tickets  \r\n>    online\r\n\r\n- \\[ ] escaped\r\n\r\n```\r\n- [x] sample\r\n```";
    const change = vi.fn();
    render(
      <MarkdownMessage
        body={body}
        pending={false}
        searchTerms={["tickets"]}
        onChange={change}
      />,
    );
    const task = screen.getByRole("checkbox", { name: "Book tickets online" });
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(task).toBeChecked();
    fireEvent.click(task);
    expect(change).toHaveBeenCalledExactlyOnceWith(body.replace("[X]", "[ ]"));
  });

  it("exposes the checked state of read-only tasks and keeps table and code structure", () => {
    const body =
      "- [x] Kept\n\n| one | two |\n| --- | --- |\n| a | b |\n\n`a\nb`";
    const { container } = render(
      <MarkdownMessage body={body} pending={false} searchTerms={[]} />,
    );
    const task = screen.getByRole("checkbox", { name: "Kept" });
    expect(task).toBeChecked();
    expect(task).toBeDisabled();
    expect(screen.getAllByRole("cell")).toHaveLength(2);
    expect(container.querySelector("code")).toHaveTextContent("a b");
    expect(container.querySelector("code br")).toBeNull();
  });
});
