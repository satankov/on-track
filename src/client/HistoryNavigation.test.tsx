// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { HistoryNavigation } from "./HistoryNavigation.js";

afterEach(() => vi.unstubAllGlobals());

it("shows only reachable boundaries, scrolls the history, and preserves focus when a control disappears", () => {
  const history = document.createElement("section");
  history.tabIndex = -1;
  document.body.append(history);
  const ref = createRef<HTMLElement>();
  ref.current = history;
  Object.defineProperties(history, {
    clientHeight: { configurable: true, value: 200 },
    scrollHeight: { configurable: true, value: 900 },
  });
  history.scrollTo = vi.fn();
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  const view = render(<HistoryNavigation historyRef={ref} contentKey="all" />);
  expect(
    screen.queryByRole("button", { name: "Scroll to beginning" }),
  ).toBeNull();
  const down = screen.getByRole("button", { name: "Scroll to end" });
  down.focus();
  fireEvent.click(down);
  expect(history.scrollTo).toHaveBeenCalledWith({
    top: 900,
    behavior: "smooth",
  });
  act(() => {
    history.scrollTop = 700;
    fireEvent.scroll(history);
  });
  expect(history).toHaveFocus();
  expect(screen.queryByRole("button", { name: "Scroll to end" })).toBeNull();
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  fireEvent.click(screen.getByRole("button", { name: "Scroll to beginning" }));
  expect(history.scrollTo).toHaveBeenLastCalledWith({
    top: 0,
    behavior: "instant",
  });
  Object.defineProperty(history, "scrollHeight", { value: 200 });
  act(() => {
    history.scrollTop = 0;
    fireEvent(window, new Event("resize"));
  });
  expect(screen.queryByRole("button")).toBeNull();
  view.unmount();
  history.remove();
});
