// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { Chat } from "../domain/types.js";
import { MessageDestinationPicker } from "./MessageBatchControls.js";

function chat(
  id: string,
  title: string,
  projectId?: string,
  archivedAt: number | null = null,
): Chat {
  return {
    id,
    title,
    projectId,
    archivedAt,
    accent: "ocean",
    enabledLabels: [],
    collapseLongMessages: false,
    manualAlert: false,
    createdAt: 1,
    updatedAt: 1,
    pinnedAt: null,
    latestAttentionAt: null,
    nextAttentionAt: null,
  };
}

const chats = [
  chat("source", "Inbox"),
  chat("sibling", "Ideas", "source"),
  chat("project", "Garden"),
  chat("child", "Planting", "project"),
  chat("other", "Kitchen"),
  chat("archived-child", "Winter", "project", 2),
  chat("archived-project", "Museum", undefined, 2),
  chat("hidden-child", "Exhibit", "archived-project"),
];

function openPicker() {
  const props = {
    chats,
    sourceId: "source",
    action: "move" as const,
    count: 2,
    busy: false,
    error: "",
    onBack: vi.fn(),
    onConfirm: vi.fn(),
    backIcon: null,
  };
  const view = render(<MessageDestinationPicker {...props} />);
  const list = within(
    screen.getByRole("region", { name: "Destination conversations" }),
  );
  const submit = screen.getByRole("button", { name: "Move 2 messages" });
  const search = screen.getByRole("searchbox");
  return { props, view, list, search, submit, user: userEvent.setup() };
}

it("selects a project directly, expands it for subthread selection and collapses it on a second project click", async () => {
  const { props, list, submit, user } = openPicker();
  const root = list.getByRole("button", {
    name: "Garden",
    expanded: false,
    pressed: false,
  });
  expect(list.queryByText("Main")).not.toBeInTheDocument();
  expect(list.queryByText("Planting")).not.toBeInTheDocument();
  expect(submit).toBeDisabled();
  await user.click(root);
  expect(root).toHaveAttribute("aria-pressed", "true");
  const child = list.getByRole("button", {
    name: "Garden / Planting",
    pressed: false,
  });
  expect(root).toHaveAttribute("aria-expanded", "true");
  await user.click(submit);
  expect(props.onConfirm).toHaveBeenLastCalledWith("project");
  await user.click(child);
  expect(root).toHaveAttribute("aria-pressed", "false");
  expect(child).toHaveAttribute("aria-pressed", "true");
  await user.click(submit);
  expect(props.onConfirm).toHaveBeenLastCalledWith("child");
  await user.click(root);
  await user.click(root);
  expect(root).toHaveAttribute("aria-expanded", "false");
  expect(root).toHaveFocus();
  expect(child).not.toBeInTheDocument();
  await user.click(submit);
  expect(props.onConfirm).toHaveBeenLastCalledWith("project");
});

it("opens the source project only for its other subthreads and omits archived branches", async () => {
  const { props, list, submit, user } = openPicker();
  const source = list.getByRole("button", { name: "Inbox", expanded: false });
  await user.click(list.getByRole("button", { name: "Garden" }));
  expect(submit).toBeEnabled();
  await user.click(source);
  expect(source).not.toHaveAttribute("aria-pressed");
  expect(submit).toBeDisabled();
  await user.keyboard("{Tab}{Enter}");
  await user.click(submit);
  expect(props.onConfirm).toHaveBeenCalledWith("sibling");
  await user.click(source);
  expect(submit).toBeDisabled();
  await user.click(list.getByRole("button", { name: "Garden" }));
  expect(list.queryByText(/Winter|Museum|Exhibit/)).not.toBeInTheDocument();
});

it("reveals search matches in context and prevents submitting a filtered or newly archived destination", async () => {
  const { props, view, list, search, submit, user } = openPicker();
  expect(search).toHaveFocus();
  await user.type(search, "plant");
  expect(
    list.getByRole("button", { name: "Garden", expanded: true }),
  ).toBeInTheDocument();
  await user.click(list.getByRole("button", { name: "Garden / Planting" }));
  expect(submit).toBeEnabled();
  await user.clear(search);
  await user.type(search, "exhibit");
  expect(list.getByText("No matching conversations.")).toBeInTheDocument();
  expect(submit).toBeDisabled();
  fireEvent.submit(submit.closest("form")!);
  expect(props.onConfirm).not.toHaveBeenCalled();
  await user.clear(search);
  await user.click(list.getByRole("button", { name: "Kitchen" }));
  view.rerender(
    <MessageDestinationPicker
      {...props}
      chats={chats.map((item) =>
        item.id === "other" ? { ...item, archivedAt: 3 } : item,
      )}
    />,
  );
  expect(submit).toBeDisabled();
  fireEvent.submit(submit.closest("form")!);
  expect(props.onConfirm).not.toHaveBeenCalled();
});
