// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useSendFeedback, type SendFeedback } from "./send-feedback.js";
function Harness({
  feedback,
  visible = true,
}: {
  feedback?: SendFeedback;
  visible?: boolean;
}) {
  const composer = useRef<HTMLDivElement>(null),
    history = useRef<HTMLElement>(null);
  useSendFeedback(composer, history, feedback);
  return (
    <>
      <section ref={history}>
        {visible && <article data-note-id="new" />}
      </section>
      <div ref={composer} className="composer" />
    </>
  );
}
afterEach(() => vi.useRealTimers());
it("restarts accepted sends, animates only persisted visible notes, and expires without replay", () => {
  vi.useFakeTimers();
  const view = render(<Harness />);
  const composer = view.container.querySelector(".composer")!;
  const feedback = { projectId: "p", attempt: 1 };
  view.rerender(<Harness feedback={feedback} />);
  expect(composer).toHaveAttribute("data-send-feedback");
  expect(view.container.querySelector(".message-row--arriving")).toBeNull();
  view.rerender(<Harness feedback={{ ...feedback, noteId: "new" }} />);
  expect(view.container.querySelector("article")).toHaveClass(
    "message-row--arriving",
  );
  act(() => vi.advanceTimersByTime(220));
  expect(view.container.querySelector("article")).not.toHaveClass(
    "message-row--arriving",
  );
  view.rerender(
    <Harness feedback={{ ...feedback, noteId: "new" }} visible={false} />,
  );
  view.rerender(<Harness feedback={{ ...feedback, noteId: "new" }} />);
  expect(view.container.querySelector("article")).not.toHaveClass(
    "message-row--arriving",
  );
  act(() => vi.advanceTimersByTime(500));
  expect(composer).not.toHaveAttribute("data-send-feedback");
  view.rerender(<Harness feedback={{ ...feedback, attempt: 2 }} />);
  expect(composer).toHaveAttribute("data-send-feedback");
  view.unmount();
  act(() => vi.runAllTimers());
});
it("does not replay feedback when reopening a project or revealing a filtered note", () => {
  const feedback = { projectId: "p", attempt: 1, noteId: "new" };
  const view = render(<Harness feedback={feedback} visible={false} />);
  view.rerender(<Harness feedback={feedback} />);
  expect(
    view.container.querySelector("[data-send-feedback],.message-row--arriving"),
  ).toBeNull();
});
