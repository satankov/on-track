// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { useComposerFileDrop } from "./composer-file-drop.js";

function setup(saving = false) {
  const selected = vi.fn();
  function Composer({ busy }: { busy: boolean }) {
    const ref = useRef<HTMLDivElement>(null);
    const drop = useComposerFileDrop(ref, busy, selected);
    return (
      <>
        <div ref={ref} data-testid="composer">
          <textarea aria-label="Draft" />
          {drop.active && <p>Drop files here</p>}
          {drop.over && <p>Over target</p>}
        </div>
        {drop.error && <p role="alert">{drop.error}</p>}
      </>
    );
  }
  const view = render(<Composer busy={saving} />);
  return {
    selected,
    ...view,
    setSaving: (busy: boolean) => view.rerender(<Composer busy={busy} />),
  };
}

const hover = {
  types: ["Files"],
  items: [{ kind: "file" }],
  files: [],
  dropEffect: "none",
};

describe("composer file drops", () => {
  it("recognizes protected file drags, highlights nested targets, and appends once", () => {
    const { selected } = setup();
    fireEvent.dragEnter(window, { dataTransfer: hover });
    expect(screen.getByText("Drop files here")).toBeVisible();
    const target = screen.getByLabelText("Draft");
    expect(fireEvent.dragOver(target, { dataTransfer: hover })).toBe(false);
    expect(screen.getByText("Over target")).toBeVisible();
    const files = [new File(["one"], "one.txt"), new File(["two"], "two.txt")];
    fireEvent.drop(target, { dataTransfer: { ...hover, files } });
    expect(selected).toHaveBeenCalledExactlyOnceWith(files);
    expect(screen.queryByText("Drop files here")).toBeNull();
  });

  it("blocks outside file drops but preserves text drags", () => {
    const { selected } = setup();
    const transfer = { ...hover, files: [new File(["x"], "x.txt")] };
    expect(fireEvent.drop(document.body, { dataTransfer: transfer })).toBe(
      false,
    );
    expect(selected).not.toHaveBeenCalled();
    const text = {
      types: ["text/plain"],
      items: [{ kind: "string" }],
      files: [],
    };
    expect(
      fireEvent.dragOver(screen.getByLabelText("Draft"), {
        dataTransfer: text,
      }),
    ).toBe(true);
    expect(
      fireEvent.drop(screen.getByLabelText("Draft"), { dataTransfer: text }),
    ).toBe(true);
    expect(screen.queryByText("Drop files here")).toBeNull();
  });

  it("clears feedback on nested leave, window exit, Escape and blur", () => {
    setup();
    fireEvent.dragEnter(window, { dataTransfer: hover });
    fireEvent.dragEnter(screen.getByLabelText("Draft"), {
      dataTransfer: hover,
    });
    fireEvent.dragLeave(screen.getByLabelText("Draft"), {
      dataTransfer: hover,
    });
    expect(screen.getByText("Drop files here")).toBeVisible();
    fireEvent.dragLeave(window, { dataTransfer: hover });
    expect(screen.queryByText("Drop files here")).toBeNull();
    fireEvent.dragEnter(window, { dataTransfer: hover });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("Drop files here")).toBeNull();
    fireEvent.dragEnter(window, { dataTransfer: hover });
    fireEvent.blur(window);
    expect(screen.queryByText("Drop files here")).toBeNull();
  });

  it("rejects detectable folders without partially adding a mixed drop", () => {
    const { selected } = setup();
    fireEvent.drop(screen.getByLabelText("Draft"), {
      dataTransfer: {
        ...hover,
        files: [new File(["x"], "x.txt")],
        items: [
          { kind: "file", webkitGetAsEntry: () => ({ isDirectory: true }) },
        ],
      },
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Folders cannot be attached",
    );
    expect(selected).not.toHaveBeenCalled();
  });

  it("rejects files during saving and removes window listeners on unmount", () => {
    const { selected, setSaving, unmount } = setup();
    fireEvent.dragEnter(window, { dataTransfer: hover });
    setSaving(true);
    expect(screen.queryByText("Drop files here")).toBeNull();
    const transfer = { ...hover, files: [new File(["x"], "x.txt")] };
    expect(
      fireEvent.drop(screen.getByLabelText("Draft"), {
        dataTransfer: transfer,
      }),
    ).toBe(false);
    expect(selected).not.toHaveBeenCalled();
    unmount();
    expect(fireEvent.drop(window, { dataTransfer: transfer })).toBe(true);
  });
});
