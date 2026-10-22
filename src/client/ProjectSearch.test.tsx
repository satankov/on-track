// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectSearch, SearchSaveStatus } from "./ProjectSearch.js";

afterEach(() => vi.useRealTimers());

it("shows the current count and remembers pending input immediately without committing early", () => {
  vi.useFakeTimers();
  const remember = vi.fn(),
    commit = vi.fn(),
    close = vi.fn();
  render(
    <ProjectSearch
      id="search"
      initialValue="hotel"
      count={3}
      onValueChange={remember}
      onCommit={commit}
      onClose={close}
      status="3 matching messages"
    />,
  );
  const input = screen.getByRole("searchbox");
  expect(input).toHaveValue("hotel");
  expect(screen.getByLabelText("Matching messages")).toHaveTextContent("3");
  fireEvent.change(input, { target: { value: "budget" } });
  expect(remember).toHaveBeenLastCalledWith("budget");
  expect(screen.getByLabelText("Matching messages")).toHaveTextContent("…");
  expect(commit).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Escape" });
  act(() => vi.advanceTimersByTime(150));
  expect(close).toHaveBeenCalledOnce();
  expect(commit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(remember).toHaveBeenLastCalledWith("");
  expect(commit).toHaveBeenLastCalledWith("");
});

it("debounces typing, cancels on clear and unmount, and uses the current filter callback", () => {
  vi.useFakeTimers();
  const first = vi.fn(),
    latest = vi.fn();
  const view = render(
    <ProjectSearch
      id="search"
      onCommit={first}
      onClose={vi.fn()}
      status="0 matching messages"
    />,
  );
  const input = screen.getByRole("searchbox");
  fireEvent.change(input, { target: { value: "hotel" } });
  act(() => vi.advanceTimersByTime(100));
  expect(first).not.toHaveBeenCalled();
  view.rerender(
    <ProjectSearch
      id="search"
      onCommit={latest}
      onClose={vi.fn()}
      status="0 matching messages"
    />,
  );
  act(() => vi.advanceTimersByTime(50));
  expect(latest).toHaveBeenCalledWith("hotel");
  expect(first).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "budget" } });
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(input).toHaveValue("");
  expect(input).toHaveFocus();
  act(() => vi.advanceTimersByTime(200));
  expect(latest.mock.calls).toEqual([["hotel"], [""]]);
  fireEvent.change(input, { target: { value: "never" } });
  view.unmount();
  act(() => vi.advanceTimersByTime(200));
  expect(latest).toHaveBeenCalledTimes(2);
});

it("commits completed IME composition and ignores Escape during composition", () => {
  vi.useFakeTimers();
  const commit = vi.fn(),
    close = vi.fn();
  render(
    <ProjectSearch id="search" onCommit={commit} onClose={close} status="" />,
  );
  const input = screen.getByRole("searchbox");
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: "東京" } });
  fireEvent.keyDown(input, { key: "Escape", isComposing: true });
  act(() => vi.advanceTimersByTime(200));
  expect(commit).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  act(() => vi.advanceTimersByTime(150));
  expect(commit).toHaveBeenCalledWith("東京");
  fireEvent.change(input, { target: { value: "pending" } });
  fireEvent.keyDown(input, { key: "Escape" });
  act(() => vi.advanceTimersByTime(200));
  expect(close).toHaveBeenCalledOnce();
  expect(commit).toHaveBeenCalledTimes(1);
  screen.getByRole("button", { name: "Clear search" }).focus();
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(close).toHaveBeenCalledTimes(2);
});

it("announces hidden successful writes once without replay on query changes or remount", () => {
  vi.useFakeTimers();
  const view = render(<SearchSaveStatus savedNoteId="old" hidden />);
  expect(screen.getByRole("status")).toBeEmptyDOMElement();
  view.rerender(<SearchSaveStatus savedNoteId="new" hidden />);
  expect(screen.getByRole("status")).toHaveTextContent(
    "Saved. Hidden by the current search.",
  );
  act(() => vi.advanceTimersByTime(4000));
  expect(screen.getByRole("status")).toBeEmptyDOMElement();
  view.rerender(<SearchSaveStatus savedNoteId="new" hidden={false} />);
  view.rerender(<SearchSaveStatus savedNoteId="new" hidden />);
  expect(screen.getByRole("status")).toBeEmptyDOMElement();
});
