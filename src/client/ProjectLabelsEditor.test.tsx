// @vitest-environment jsdom
import { useState } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import {
  defaultProjectLabels,
  labelConfigurationSchema,
} from "../domain/labels.js";
import { ProjectLabelsEditor } from "./ProjectLabelsEditor.js";
import {
  labelConfiguration,
  withLabelPlaceholder,
  type LabelDraft,
} from "./label-drafts.js";

const initial = () =>
  defaultProjectLabels().map(({ id, name, symbol, enabled }) => ({
    key: id,
    id,
    name,
    symbol,
    enabled,
  }));
function Editor({
  start = initial(),
  disabled = false,
  showErrors = true,
}: {
  start?: LabelDraft[];
  disabled?: boolean;
  showErrors?: boolean;
}) {
  const [labels, setLabels] = useState(() => withLabelPlaceholder(start));
  return (
    <>
      <ProjectLabelsEditor
        labels={labels}
        onChange={setLabels}
        glyph={() => null}
        showErrors={showErrors}
        disabled={disabled}
      />
      <output data-testid="saved">
        {JSON.stringify(labelConfiguration(labels, 0))}
      </output>
    </>
  );
}
function order() {
  return screen
    .getAllByRole("button", { name: /^Reorder / })
    .map((button) =>
      button.getAttribute("aria-label")!.replace("Reorder ", ""),
    );
}
function saved() {
  return labelConfigurationSchema.safeParse(
    JSON.parse(screen.getByTestId("saved").textContent!),
  );
}
function pointer(element: HTMLElement, type: string, x: number, y: number) {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: 0,
    clientX: x,
    clientY: y,
  });
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    pointerType: { value: "touch" },
  });
  fireEvent(element, event);
}
function measureRows() {
  const list = document.querySelector<HTMLElement>(".project-label-options")!;
  vi.spyOn(list, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 600, 500),
  );
  for (const row of list.children)
    vi.spyOn(row, "getBoundingClientRect").mockImplementation(
      () =>
        new DOMRect(0, Array.from(list.children).indexOf(row) * 60, 600, 60),
    );
}
afterEach(() => vi.restoreAllMocks());

it("shows name and symbol limits while typing before Save and clears corrected errors", async () => {
  const user = userEvent.setup();
  render(<Editor showErrors={false} />);
  const name = screen.getByRole("textbox", { name: "Label name 1" });
  await user.type(name, "123456789");
  expect(name).toHaveAttribute("aria-invalid", "true");
  expect(
    screen.getByText("Use 1–8 visible characters for the label name."),
  ).toBeVisible();
  expect(name).toHaveAttribute("placeholder", "Label name");
  expect(screen.queryByText("Symbol", { exact: true })).toBeNull();
  expect(screen.queryByText("Name", { exact: true })).toBeNull();
  await user.keyboard("{Backspace}");
  expect(name).toHaveAttribute("aria-invalid", "false");
  const symbol = screen.getByRole("textbox", { name: "Label symbol 1" });
  await user.type(symbol, "ab");
  expect(symbol).toHaveAttribute("aria-invalid", "true");
  expect(
    screen.getByText("Use one symbol or emoji, or leave it empty."),
  ).toBeVisible();
  await user.clear(symbol);
  await user.type(symbol, "👨‍👩‍👧‍👦");
  expect(symbol).toHaveAttribute("aria-invalid", "false");
});

it("collapses cleared saved labels into one empty row and omits them from Save", async () => {
  const user = userEvent.setup();
  render(
    <Editor
      start={[
        ...initial(),
        {
          key: "a",
          id: "custom-00000000-0000-0000-0000-000000000001",
          name: "Review",
          symbol: "✓",
          enabled: true,
        },
        {
          key: "b",
          id: "custom-00000000-0000-0000-0000-000000000002",
          name: "Ready",
          symbol: null,
          enabled: true,
        },
      ]}
    />,
  );
  await user.clear(screen.getByRole("textbox", { name: "Label symbol 1" }));
  await user.clear(screen.getByRole("textbox", { name: "Label name 1" }));
  const remaining = screen.getByRole("textbox", { name: "Label name 1" });
  expect(remaining).toHaveValue("Ready");
  await user.clear(remaining);
  expect(remaining).toHaveFocus();
  expect(screen.getAllByRole("textbox", { name: /^Label name/ })).toHaveLength(
    1,
  );
  expect(saved().data?.labels).toHaveLength(7);
  await user.type(remaining, "Again");
  expect(saved().data?.labels.at(-1)?.id).toBe(
    "custom-00000000-0000-0000-0000-000000000002",
  );
});

it("activates symbol-first drafts, keeps one empty row, and never submits empty placeholders", async () => {
  const user = userEvent.setup();
  render(<Editor />);
  expect(saved().success).toBe(true);
  expect(saved().data?.labels).toHaveLength(7);
  await user.type(screen.getByRole("textbox", { name: "Label symbol 1" }), "✓");
  expect(
    screen.getByRole("button", { name: "Reorder new label" }),
  ).toBeVisible();
  expect(screen.getByRole("textbox", { name: "Label name 2" })).toHaveValue("");
  expect(saved().success).toBe(false);
  await user.type(
    screen.getByRole("textbox", { name: "Label name 1" }),
    "Review",
  );
  expect(saved().success).toBe(true);
  await user.clear(screen.getByRole("textbox", { name: "Label symbol 1" }));
  const name = screen.getByRole("textbox", { name: "Label name 1" });
  await user.clear(name);
  expect(name).toHaveFocus();
  expect(screen.queryByRole("textbox", { name: "Label name 2" })).toBeNull();
  expect(saved().data?.labels).toHaveLength(7);
});

it("stops at five custom labels and restores an empty row when an unsaved draft is discarded", async () => {
  const user = userEvent.setup();
  render(<Editor />);
  for (let i = 1; i <= 5; i++)
    await user.type(
      screen.getByRole("textbox", { name: `Label name ${i}` }),
      `Extra${i}`,
    );
  expect(screen.queryByRole("textbox", { name: "Label name 6" })).toBeNull();
  expect(saved().data?.labels).toHaveLength(12);
  await user.click(screen.getByRole("button", { name: "Discard Extra3" }));
  expect(screen.getByRole("textbox", { name: "Label name 5" })).toHaveValue("");
  expect(saved().data?.labels).toHaveLength(11);
});

it("reorders with the keyboard while retaining focus and keeping permanent labels fixed", async () => {
  const user = userEvent.setup();
  render(<Editor />);
  const handle = screen.getByRole("button", { name: "Reorder Risk" });
  handle.focus();
  await user.keyboard("{Home}");
  await waitFor(() => expect(handle).toHaveFocus());
  expect(order()[0]).toBe("Risk");
  await user.keyboard("{ArrowUp}{End}");
  await waitFor(() => expect(handle).toHaveFocus());
  expect(order().at(-1)).toBe("Risk");
  await user.keyboard("{ArrowDown}");
  expect(
    saved()
      .data?.labels.slice(0, 2)
      .map((label) => label.id),
  ).toEqual(["pin", "attention"]);
  expect(saved().data?.labels).toHaveLength(7);
});

it("supports selecting a handle and then its destination without dragging", async () => {
  const user = userEvent.setup();
  render(<Editor />);
  const first = screen.getByRole("button", { name: "Reorder Todo" });
  await user.click(first);
  expect(first).toHaveAttribute("aria-pressed", "true");
  await user.click(screen.getByRole("button", { name: "Reorder Milestone" }));
  expect(order().at(-1)).toBe("Todo");
  expect(first).toHaveAttribute("aria-pressed", "false");
  await user.click(first);
  await user.keyboard("{Escape}");
  expect(first).toHaveAttribute("aria-pressed", "false");
});

it("commits pointer reordering on release and ignores the click that follows a drag", () => {
  render(<Editor />);
  measureRows();
  const handle = screen.getByRole("button", { name: "Reorder Todo" });
  pointer(handle, "pointerdown", 20, 30);
  pointer(handle, "pointermove", 20, 270);
  expect(order()[0]).toBe("Todo");
  expect(handle.closest(".project-label-edit-row")).toHaveStyle({
    transform: "translateY(240px)",
  });
  expect(
    screen
      .getByRole("button", { name: "Reorder Risk" })
      .closest(".project-label-edit-row"),
  ).toHaveStyle({ transform: "translateY(-60px)" });
  pointer(handle, "pointerup", 20, 270);
  fireEvent.click(handle, { detail: 1 });
  expect(order().at(-1)).toBe("Todo");
  expect(handle).toHaveAttribute("aria-pressed", "false");
});

it.each(["pointercancel", "lostpointercapture", "Escape", "outside"])(
  "cancels a pointer drag without changing order: %s",
  (cancel) => {
    render(<Editor />);
    measureRows();
    const before = order();
    const handle = screen.getByRole("button", { name: "Reorder Todo" });
    pointer(handle, "pointerdown", 20, 30);
    pointer(handle, "pointermove", 20, 270);
    if (cancel === "Escape") fireEvent.keyDown(handle, { key: "Escape" });
    else if (cancel === "outside") pointer(handle, "pointermove", 700, 270);
    else pointer(handle, cancel, 20, 270);
    pointer(handle, "pointerup", cancel === "outside" ? 700 : 20, 270);
    fireEvent.click(handle, { detail: 1 });
    expect(order()).toEqual(before);
    expect(handle).toHaveAttribute("aria-pressed", "false");
  },
);

it("keeps the editor inert while a save is pending", async () => {
  const user = userEvent.setup();
  render(<Editor disabled />);
  const before = order();
  await user.click(screen.getByRole("button", { name: "Reorder Todo" }));
  expect(order()).toEqual(before);
  expect(screen.getByRole("textbox", { name: "Label name 1" })).toBeDisabled();
});

it("deletes a saved custom label after it is moved among built-ins", async () => {
  const user = userEvent.setup();
  render(
    <Editor
      start={[
        ...initial(),
        {
          key: "saved",
          id: "custom-00000000-0000-0000-0000-000000000001",
          name: "Review",
          symbol: "✓",
          enabled: true,
        },
      ]}
    />,
  );
  screen.getByRole("button", { name: "Reorder Review" }).focus();
  await user.keyboard("{Home}");
  expect(order()[0]).toBe("Review");
  const remove = screen.getByRole("button", { name: "Delete Review" });
  expect(screen.queryByRole("button", { name: "Delete Todo" })).toBeNull();
  remove.focus();
  await act(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  expect(remove).toHaveFocus();
  await user.keyboard("{Enter}");
  expect(order()[0]).toBe("Todo");
  expect(saved().data?.labels).toHaveLength(7);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Reorder Todo" })).toHaveFocus(),
  );
});

it.each([
  { name: "Todo", start: 5, end: 55, index: 1 },
  { name: "Todo", start: 55, end: 65, index: 0 },
  { name: "Risk", start: 235, end: 195, index: 2 },
])(
  "places $name by its visible center when grabbed at $start",
  ({ name, start, end, index }) => {
    render(<Editor />);
    measureRows();
    const handle = screen.getByRole("button", { name: `Reorder ${name}` });
    pointer(handle, "pointerdown", 20, start);
    pointer(handle, "pointermove", 20, end);
    pointer(handle, "pointerup", 20, end);
    expect(order()[index]).toBe(name);
  },
);

it("does not steal newer input focus after deleting a custom row", async () => {
  render(
    <Editor
      start={[
        ...initial().slice(0, 2),
        {
          key: "saved",
          id: "custom-00000000-0000-0000-0000-000000000001",
          name: "Review",
          symbol: null,
          enabled: true,
        },
        ...initial().slice(2),
      ]}
    />,
  );
  const remove = screen.getByRole("button", { name: "Delete Review" });
  remove.focus();
  fireEvent.click(remove);
  const input = screen.getByRole("textbox", { name: "Label name 1" });
  input.focus();
  await act(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  expect(input).toHaveFocus();
});

it.each([20, 700])(
  "uses final release coordinates, including leaving the list at x=%i",
  (x) => {
    render(<Editor />);
    measureRows();
    const handle = screen.getByRole("button", { name: "Reorder Todo" });
    pointer(handle, "pointerdown", 20, 30);
    pointer(handle, "pointermove", 20, 90);
    pointer(handle, "pointerup", x, 270);
    expect(order()[x === 20 ? 4 : 0]).toBe("Todo");
  },
);

it("keeps a taller validation row in place during a small off-center drag", () => {
  render(<Editor />);
  measureRows();
  const list = document.querySelector(".project-label-options")!;
  Array.from(list.children).forEach((row, i) => {
    vi.mocked(row.getBoundingClientRect).mockReturnValue(
      new DOMRect(0, i === 0 ? 0 : 100 + (i - 1) * 60, 600, i === 0 ? 100 : 60),
    );
  });
  const handle = screen.getByRole("button", { name: "Reorder Todo" });
  pointer(handle, "pointerdown", 20, 40);
  pointer(handle, "pointermove", 20, 50);
  pointer(handle, "pointerup", 20, 50);
  expect(order()[0]).toBe("Todo");
});
