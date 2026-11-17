// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { MessageExportWorkspace } from "./MessageExportWorkspace.js";
import { formatMessageExport, type ExportDocument } from "./message-export.js";
import type { ExportSource } from "./message-export-source.js";

const message = {
  body: "Decision",
  createdAt: 1,
  sender: null,
  attachmentCount: 0,
  labels: ["Review"],
};
const source: ExportSource = { titles: ["Source"], messages: [message] };

it("retries a failed download using the visible excerpt and releases its URL", async ({
  onTestFinished,
}) => {
  const createObjectURL = vi
    .fn()
    .mockImplementationOnce(() => {
      throw new Error("no object URL");
    })
    .mockReturnValue("blob:excerpt");
  const revokeObjectURL = vi.fn();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    },
  );
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  onTestFinished(() => {
    vi.unstubAllGlobals();
    click.mockRestore();
  });
  render(
    <MessageExportWorkspace
      source={source}
      onBack={() => {}}
      backIcon="Back"
    />,
  );
  await screen.findByLabelText("Exact export text");
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Include message labels" }),
  );
  const preview = await screen.findByLabelText("Exact export text");
  expect(preview).toHaveTextContent("Notebook owner · Review");
  const button = screen.getByRole("button", { name: "Download .md" });
  fireEvent.click(button);
  expect(screen.getByText(/Couldn’t start the download/)).toBeVisible();
  expect(click).not.toHaveBeenCalled();
  fireEvent.click(button);
  const blob: Blob = createObjectURL.mock.calls[1][0];
  expect(await blob.text()).toBe(preview.textContent);
  expect(blob.type).toBe("text/markdown;charset=utf-8");
  expect(click).toHaveBeenCalledOnce();
  expect(document.querySelector('a[href="blob:excerpt"]')).toBeNull();
  await waitFor(
    () => expect(revokeObjectURL).toHaveBeenCalledWith("blob:excerpt"),
    { timeout: 2000 },
  );
});

it("discards an obsolete worker and recovers from a formatting failure", async ({
  onTestFinished,
}) => {
  class TestWorker {
    static jobs: TestWorker[] = [];
    terminate = vi.fn();
    postMessage = vi.fn();
    onmessage?: (event: { data: ExportDocument }) => void;
    onerror?: (event: Event) => void;
    constructor() {
      TestWorker.jobs.push(this);
    }
  }
  vi.stubGlobal("Worker", TestWorker);
  onTestFinished(() => {
    vi.unstubAllGlobals();
  });
  const many = {
    ...source,
    messages: Array.from({ length: 40 }, () => message),
  };
  const ui = render(
    <MessageExportWorkspace source={many} onBack={() => {}} backIcon="Back" />,
  );
  const [first] = TestWorker.jobs;
  expect(screen.getByRole("button", { name: "Copy text" })).toBeDisabled();
  fireEvent.click(screen.getByRole("radio", { name: /Plain text/ }));
  expect(first.terminate).toHaveBeenCalled();
  const doc = formatMessageExport(many, {
    format: "txt",
    includeLabels: false,
    timeZone: "UTC",
  });
  act(() => first.onmessage?.({ data: doc }));
  expect(screen.queryByLabelText("Exact export text")).toBeNull();
  act(() => TestWorker.jobs[1].onerror?.(new Event("error")));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Couldn’t prepare the export",
  );
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  const retry = TestWorker.jobs[2];
  expect(retry.postMessage).toHaveBeenCalledOnce();
  act(() => retry.onmessage?.({ data: doc }));
  expect(screen.getByLabelText("Exact export text").textContent).toBe(doc.text);
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Include message labels" }),
  );
  const last = TestWorker.jobs[3];
  ui.unmount();
  expect(last.terminate).toHaveBeenCalled();
});
