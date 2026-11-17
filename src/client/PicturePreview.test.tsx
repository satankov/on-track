// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

import { PicturePreview } from "./PicturePreview.js";
import { PictureLoadQueue } from "./picture-load-queue.js";

afterEach(() => vi.unstubAllGlobals());

function simulateVisibility() {
  const near = new Map<Element, (visible: boolean) => void>();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(
        private callback: (entries: { isIntersecting: boolean }[]) => void,
      ) {}
      observe(element: Element) {
        near.set(element, (visible) =>
          this.callback([{ isIntersecting: visible }]),
        );
      }
      disconnect() {}
    },
  );
  return (element: Element, visible: boolean) =>
    act(() => near.get(element)!(visible));
}

it("waits for the reading viewport, releases departed queued pictures, and cancels a stale decode", async () => {
  const intersect = simulateVisibility();
  const queue = new PictureLoadQueue();
  const pics = ["a", "b", "c"].map((id) => (
    <PicturePreview key={id} filename={id} source={"/" + id} queue={queue} />
  ));
  const { rerender } = render(<section className="history">{pics}</section>);
  const buttons = screen.getAllByRole("button");
  const images = buttons.map((el) => el.querySelector("img")!);
  expect(images.every((img) => !img.hasAttribute("src"))).toBe(true);
  for (const el of buttons) intersect(el, true);
  expect(images.filter((el) => el.hasAttribute("src"))).toHaveLength(2);
  intersect(buttons[2], false);
  fireEvent.load(images[0]);
  expect(images[2]).not.toHaveAttribute("src");
  intersect(buttons[2], true);
  expect(images[2]).toHaveAttribute("src", "/c");

  let decoded!: () => void;
  images[1].decode = () =>
    new Promise((resolve) => {
      decoded = resolve;
    });
  fireEvent.load(images[1]);
  rerender(
    <section className="history">
      <PicturePreview
        key="replacement"
        filename="restored"
        source="/restored"
        queue={queue}
      />
    </section>,
  );
  // A queued observer notification and a decoder can finish after navigation.
  intersect(buttons[1], true);
  await act(async () => decoded());
  expect(images[1]).not.toHaveAttribute("src");
  const restored = screen.getByRole("button", { name: "View restored larger" });
  expect(restored).toBeDisabled();
  intersect(restored, true);
  expect(restored.querySelector("img")).toHaveAttribute("src", "/restored");
});

it("offers a fresh read after an error and keeps the dialog escapable if the full image fails", async () => {
  const user = userEvent.setup();
  const workspaceKeyDown = vi.fn();
  render(
    <div onKeyDown={workspaceKeyDown}>
      <PicturePreview
        filename="proof.jpg"
        source="/proof"
        queue={new PictureLoadQueue()}
      />
    </div>,
  );
  const image = screen
    .getByRole("button", { name: "View proof.jpg larger" })
    .querySelector("img")!;
  image.decode = vi
    .fn()
    .mockRejectedValueOnce(new Error())
    .mockResolvedValueOnce(undefined);
  await act(async () => {
    fireEvent.load(image);
  });
  await user.click(
    screen.getByRole("button", { name: "Retry preview of proof.jpg" }),
  );
  await act(async () => {
    fireEvent.load(image);
  });
  await user.click(
    screen.getByRole("button", { name: "View proof.jpg larger" }),
  );
  const dialog = screen.getByRole("dialog", { name: "proof.jpg" });
  fireEvent.error(within(dialog).getByRole("img"));
  expect(within(dialog).getByText("Image preview unavailable.")).toBeVisible();
  fireEvent.keyDown(within(dialog).getByRole("button", { name: "Close" }), {
    key: "Escape",
  });
  expect(workspaceKeyDown).not.toHaveBeenCalled();
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("bounds inline pixels for a camera photo while retaining the original for the full viewer", async () => {
  const user = userEvent.setup();
  const drawImage = vi.fn();
  const thumbnail = "data:image/png;base64,AQ==";
  const convert = vi
    .spyOn(HTMLCanvasElement.prototype, "toDataURL")
    .mockImplementation(function (this: HTMLCanvasElement) {
      expect([this.width, this.height]).toEqual([192, 128]);
      return thumbnail;
    });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => ({ drawImage }) as unknown as CanvasRenderingContext2D,
  );
  try {
    render(
      <PicturePreview
        filename="camera.jpg"
        source="/original"
        queue={new PictureLoadQueue()}
        compact
      />,
    );
    const button = screen.getByRole("button", {
      name: "View camera.jpg larger",
    });
    const image = button.querySelector("img")!;
    const width = vi.spyOn(image, "naturalWidth", "get").mockReturnValue(6000);
    const height = vi
      .spyOn(image, "naturalHeight", "get")
      .mockReturnValue(4000);
    fireEvent.load(image);
    expect(drawImage).toHaveBeenCalledWith(image, 0, 0, 192, 128);
    expect(convert).toHaveBeenCalledWith("image/png");
    expect(image).toHaveAttribute("src", thumbnail);
    width.mockReturnValue(192);
    height.mockReturnValue(128);
    fireEvent.load(image);
    await user.click(button);
    expect(within(screen.getByRole("dialog")).getByRole("img")).toHaveAttribute(
      "src",
      "/original",
    );
  } finally {
    vi.restoreAllMocks();
  }
});

it("releases unscaled pictures outside the viewport and reads them again on return", () => {
  const intersect = simulateVisibility();
  render(
    <PicturePreview
      filename="map.png"
      source="/map"
      queue={new PictureLoadQueue()}
    />,
  );
  const frame = screen.getByRole("button", { name: "View map.png larger" });
  const image = frame.querySelector("img")!;
  intersect(frame, true);
  fireEvent.load(image);
  expect(frame).toBeEnabled();
  intersect(frame, false);
  expect(image).not.toHaveAttribute("src");
  expect(frame).toBeDisabled();
  intersect(frame, true);
  expect(image).toHaveAttribute("src", "/map");
});

it("keeps a focused picture and its open viewer available when the history moves", async () => {
  const user = userEvent.setup();
  const intersect = simulateVisibility();
  render(
    <div className="attachment-card">
      <PicturePreview
        filename="panel.png"
        source="/panel"
        queue={new PictureLoadQueue()}
      />
    </div>,
  );
  const frame = screen.getByRole("button", { name: "View panel.png larger" });
  const image = frame.querySelector("img")!;
  intersect(frame, true);
  fireEvent.load(image);
  frame.focus();
  intersect(frame, false);
  expect(image).toHaveAttribute("src", "/panel");
  await user.click(frame);
  const dialog = screen.getByRole("dialog", { name: "panel.png" });
  within(dialog).getByRole("button", { name: "Close" }).focus();
  intersect(frame, false);
  expect(image).toHaveAttribute("src", "/panel");
  expect(dialog).toBeVisible();
});
