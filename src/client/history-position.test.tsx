// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureReadingPosition,
  restoreReadingPosition,
  useHistoryPosition,
  type ReadingPosition,
} from "./history-position.js";

function geometry(history: HTMLElement, times = [1, 2, 3, 4, 5]) {
  Object.defineProperties(history, {
    clientHeight: { configurable: true, value: 200 },
    scrollHeight: { configurable: true, value: 600 },
  });
  vi.spyOn(history, "getBoundingClientRect").mockImplementation(
    () => ({ top: 100, bottom: 300, height: 200 }) as DOMRect,
  );
  history.innerHTML = times
    .map(
      (time, index) =>
        `<div data-note-id="n${index}" data-created-at="${time}"></div>`,
    )
    .join("");
  [...history.children].forEach((row, index) => {
    vi.spyOn(row, "getBoundingClientRect").mockImplementation(
      () =>
        ({
          top: 120 + index * 120 - history.scrollTop,
          bottom: 220 + index * 120 - history.scrollTop,
          height: 100,
        }) as DOMRect,
    );
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("message reading positions", () => {
  it("preserves an exact position when only a few pixels of the anchor remain visible", () => {
    const history = document.createElement("section");
    geometry(history);
    restoreReadingPosition(history, {
      noteId: "n1",
      createdAt: 2,
      offset: -95,
    });
    expect(history.scrollTop).toBe(235);
  });
  it("keeps a remembered message visible when it becomes collapsed on return", () => {
    const history = document.createElement("section");
    geometry(history);
    restoreReadingPosition(history, {
      noteId: "n1",
      createdAt: 2,
      offset: -900,
    });
    const anchor = history.children[1].getBoundingClientRect();
    expect(anchor.bottom).toBeGreaterThan(history.getBoundingClientRect().top);
    expect(anchor.top).toBeLessThan(history.getBoundingClientRect().bottom);
  });
  it("captures and restores a partially visible anchor, including changed earlier heights", () => {
    const history = document.createElement("section");
    geometry(history);
    history.scrollTop = 150;
    const position = captureReadingPosition(history);
    expect(position).toEqual({ noteId: "n1", createdAt: 2, offset: -10 });
    history.scrollTop = 0;
    const anchor = history.children[1];
    vi.mocked(anchor.getBoundingClientRect).mockImplementation(
      () =>
        ({
          top: 280 - history.scrollTop,
          bottom: 380 - history.scrollTop,
          height: 100,
        }) as DOMRect,
    );
    restoreReadingPosition(history, position);
    expect(history.scrollTop).toBe(190);
  });

  it("falls forward by timestamp when an anchor is deleted and falls back to the last message", () => {
    const history = document.createElement("section");
    geometry(history);
    restoreReadingPosition(history, {
      noteId: "deleted",
      createdAt: 3,
      offset: 0,
    });
    expect(history.scrollTop).toBe(260);
    restoreReadingPosition(history, {
      noteId: "deleted",
      createdAt: 99,
      offset: 0,
    });
    expect(history.scrollTop).toBe(500);
  });

  it("opens at the first future message with past context, or at the appropriate end", () => {
    const history = document.createElement("section");
    geometry(history);
    restoreReadingPosition(history, undefined, 3);
    expect(history.scrollTop).toBe(280);
    restoreReadingPosition(history, undefined, 0);
    expect(history.scrollTop).toBe(0);
    restoreReadingPosition(history, undefined, 99);
    expect(history.scrollTop).toBe(600);
  });

  it("handles empty history and a viewport below every row", () => {
    const history = document.createElement("section");
    expect(captureReadingPosition(history)).toBeUndefined();
    restoreReadingPosition(history);
    expect(history.scrollTop).toBe(0);
    geometry(history);
    history.scrollTop = 1000;
    expect(captureReadingPosition(history)).toBeUndefined();
  });

  it("restores once, saves on scroll/unmount, and ignores filtered scrolls", () => {
    vi.useFakeTimers();
    const positions = new Map<string, ReadingPosition>([
      ["chat", { noteId: "n1", createdAt: 2, offset: -10 }],
    ]);
    let history: HTMLElement;
    function Workspace({ filter }: { filter: string }) {
      const ref = useRef<HTMLElement>(null);
      useHistoryPosition(ref, "chat", filter, positions);
      return <section ref={ref} data-testid="history" />;
    }
    const view = render(<Workspace filter="all" />);
    history = view.getByTestId("history");
    geometry(history);
    act(() => vi.advanceTimersByTime(20));
    expect(history.scrollTop).toBe(150);
    history.scrollTop = 270;
    history.dispatchEvent(new Event("scroll"));
    expect(positions.get("chat")?.noteId).toBe("n2");
    view.rerender(<Workspace filter="attachments" />);
    history.scrollTop = 0;
    history.dispatchEvent(new Event("scroll"));
    act(() => vi.advanceTimersByTime(20));
    expect(history.scrollTop).toBe(600);
    expect(positions.get("chat")?.noteId).toBe("n2");
    view.unmount();
    expect(positions.get("chat")?.noteId).toBe("n2");
    const second = render(<Workspace filter="all" />);
    history = second.getByTestId("history");
    geometry(history);
    act(() => vi.advanceTimersByTime(20));
    expect(history.scrollTop).toBe(270);
    history.scrollTop = 390;
    second.unmount();
    expect(positions.get("chat")?.noteId).toBe("n3");
  });

  it("repositions for each filter identity and restores All without saving filtered scrolls", () => {
    vi.useFakeTimers();
    vi.spyOn(Date, "now").mockReturnValue(3);
    const anchor = { noteId: "n1", createdAt: 2, offset: -10 };
    const positions = new Map<string, ReadingPosition>([["chat", anchor]]);
    function Workspace({ filter }: { filter: string }) {
      const ref = useRef<HTMLElement>(null);
      useHistoryPosition(ref, "chat", filter, positions);
      return <section ref={ref} data-testid="history" />;
    }
    const view = render(<Workspace filter="all" />);
    const history = view.getByTestId("history");
    geometry(history);
    act(() => vi.advanceTimersByTime(20));
    expect(history.scrollTop).toBe(150);
    view.rerender(<Workspace filter="attachments" />);
    history.scrollTop = 0;
    history.dispatchEvent(new Event("scroll"));
    act(() => vi.advanceTimersByTime(20));
    expect(history.scrollTop).toBe(280);
    history.scrollTop = 390;
    history.dispatchEvent(new Event("scroll"));
    expect(positions.get("chat")).toEqual(anchor);
    view.rerender(<Workspace filter="links" />);
    act(() => vi.advanceTimersByTime(20));
    expect(history.scrollTop).toBe(280);
    view.rerender(<Workspace filter="todo" />);
    history.scrollTop = 0;
    act(() => vi.advanceTimersByTime(20));
    expect(history.scrollTop).toBe(280);
    view.rerender(<Workspace filter="all" />);
    history.scrollTop = 0;
    history.dispatchEvent(new Event("scroll"));
    act(() => vi.advanceTimersByTime(20));
    expect(history.scrollTop).toBe(150);
    view.unmount();
  });

  it("captures All before its rows change and ignores transition-generated scroll events", () => {
    vi.useFakeTimers();
    vi.spyOn(Date, "now").mockReturnValue(3);
    const positions = new Map<string, ReadingPosition>();
    let beforeFilterChange: (filter: string) => void;
    function Workspace({ filter }: { filter: string }) {
      const ref = useRef<HTMLElement>(null);
      beforeFilterChange = useHistoryPosition(ref, "chat", filter, positions);
      return <section ref={ref} data-testid="history" />;
    }
    const view = render(<Workspace filter="all" />);
    const history = view.getByTestId("history");
    geometry(history);
    act(() => vi.advanceTimersByTime(20));
    // A final scroll need not have dispatched its asynchronous scroll event yet.
    history.scrollTop = 150;
    beforeFilterChange!("attachments");
    geometry(history, [99]);
    history.scrollTop = 0;
    history.dispatchEvent(new Event("scroll"));
    view.rerender(<Workspace filter="attachments" />);
    act(() => vi.advanceTimersByTime(20));
    expect(positions.get("chat")).toEqual({
      noteId: "n1",
      createdAt: 2,
      offset: -10,
    });
    beforeFilterChange!("all");
    view.rerender(<Workspace filter="all" />);
    geometry(history);
    history.dispatchEvent(new Event("scroll"));
    act(() => vi.advanceTimersByTime(20));
    expect(history.scrollTop).toBe(150);
    view.unmount();
  });

  it("preserves manual reading on same-filter clicks, clock ticks, and row refreshes", () => {
    vi.useFakeTimers();
    vi.spyOn(Date, "now").mockReturnValue(3);
    const positions = new Map<string, ReadingPosition>();
    let beforeFilterChange: (filter: string) => void;
    function Workspace() {
      const ref = useRef<HTMLElement>(null);
      beforeFilterChange = useHistoryPosition(ref, "chat", "links", positions);
      return <section ref={ref} data-testid="history" />;
    }
    const view = render(<Workspace />);
    const history = view.getByTestId("history");
    geometry(history);
    act(() => vi.advanceTimersByTime(20));
    expect(history.scrollTop).toBe(280);
    history.scrollTop = 75;
    beforeFilterChange!("links");
    vi.mocked(Date.now).mockReturnValue(99);
    geometry(history, [1, 2, 3]);
    view.rerender(<Workspace />);
    act(() => vi.advanceTimersByTime(20));
    expect(history.scrollTop).toBe(75);
    expect(positions.size).toBe(0);
    view.unmount();
  });

  it("cancels pending frames on rapid filter and project changes and unmount", () => {
    vi.useFakeTimers();
    vi.spyOn(Date, "now").mockReturnValue(3);
    const chatAnchor = { noteId: "n1", createdAt: 2, offset: -10 };
    const otherAnchor = { noteId: "n3", createdAt: 4, offset: -10 };
    const positions = new Map<string, ReadingPosition>([
      ["chat", chatAnchor],
      ["other", otherAnchor],
    ]);
    function Workspace({
      filter,
      project = "chat",
    }: {
      filter: string;
      project?: string;
    }) {
      const ref = useRef<HTMLElement>(null);
      useHistoryPosition(ref, project, filter, positions);
      return <section ref={ref} data-testid="history" />;
    }
    const view = render(<Workspace filter="all" />);
    const history = view.getByTestId("history");
    geometry(history);
    view.rerender(<Workspace filter="attachments" />);
    view.rerender(<Workspace filter="links" />);
    view.rerender(<Workspace filter="all" project="other" />);
    act(() => vi.advanceTimersByTime(20));
    expect(history.scrollTop).toBe(390);
    expect(positions.get("chat")).toEqual(chatAnchor);
    view.rerender(<Workspace filter="todo" project="other" />);
    view.unmount();
    history.scrollTop = 123;
    act(() => vi.advanceTimersByTime(20));
    expect(history.scrollTop).toBe(123);
    expect(positions.get("other")).toEqual(otherAnchor);
  });

  it("bounds a tall first-future preview to preserve current context", () => {
    const history = document.createElement("section");
    geometry(history);
    vi.mocked(history.children[3].getBoundingClientRect).mockImplementation(
      () =>
        ({
          top: 480 - history.scrollTop,
          bottom: 1480 - history.scrollTop,
          height: 1000,
        }) as DOMRect,
    );
    restoreReadingPosition(history, undefined, 3);
    expect(history.scrollTop).toBe(280);
  });
});
