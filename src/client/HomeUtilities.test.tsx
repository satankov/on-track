// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { HomeUtilities } from "./HomeUtilities.js";
import { useHomeUpdates } from "./useHomeUpdates.js";
import type { ApiClient } from "./api.js";
function Harness({
  api,
}: {
  api: Pick<ApiClient, "homeInfo" | "checkReleases">;
}) {
  const updates = useHomeUpdates(api);
  return <HomeUtilities updates={updates} />;
}
const result = {
  checkedAt: 1000,
  status: "available" as const,
  releases: [
    {
      version: "0.0.9",
      url: "https://github.com/satankov/on-track/releases/tag/v0.0.9",
    },
  ],
  update: {
    version: "0.0.9",
    kind: "managed" as const,
    command: "thr update v0.0.9",
    exactCommand: "'/app/bin/thr' update v0.0.9",
  },
};
function api() {
  return {
    homeInfo: vi
      .fn()
      .mockResolvedValue({ version: "0.0.8", installation: "managed" }),
    checkReleases: vi.fn().mockResolvedValue(result),
  };
}
it("requires a click, displays inline commands, copies and reserves report space", async () => {
  const user = userEvent.setup();
  const mock = api();
  render(<Harness api={mock} />);
  await screen.findByText("Installed v0.0.8");
  fireEvent.focus(window);
  expect(mock.checkReleases).not.toHaveBeenCalled();
  expect(screen.getByText("Report a bug — coming soon")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Check releases" }));
  await screen.findByText("thr update v0.0.9");
  expect(mock.checkReleases).toHaveBeenCalledTimes(1);
  const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  await user.click(screen.getByRole("button", { name: "Copy" }));
  expect(write).toHaveBeenCalledWith("thr update v0.0.9");
  expect(await screen.findByText("Command copied.")).toBeVisible();
  await user.click(screen.getByText("Command for this installation"));
  await user.click(screen.getByRole("button", { name: "Copy exact command" }));
  expect(write).toHaveBeenLastCalledWith("'/app/bin/thr' update v0.0.9");
});
it("displays clipboard failure with selectable text", async () => {
  const user = userEvent.setup();
  render(<Harness api={api()} />);
  await user.click(screen.getByRole("button", { name: "Check releases" }));
  await screen.findByText("thr update v0.0.9");
  vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(Error());
  await user.click(screen.getByRole("button", { name: "Copy" }));
  expect(await screen.findByText(/Could not copy/)).toBeVisible();
});
it("retains prior results on error and permits retry", async () => {
  const user = userEvent.setup();
  const mock = api();
  render(<Harness api={mock} />);
  await user.click(screen.getByRole("button", { name: "Check releases" }));
  await screen.findByText("thr update v0.0.9");
  mock.checkReleases.mockRejectedValueOnce(Error("Could not reach GitHub."));
  await user.click(screen.getByRole("button", { name: "Check again" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not reach GitHub.",
  );
  expect(screen.getByText("thr update v0.0.9")).toBeVisible();
});
it("shows manual guidance and safely handles unavailable local info", async () => {
  const mock = api();
  mock.homeInfo.mockRejectedValue(Error());
  mock.checkReleases.mockResolvedValue({
    ...result,
    status: "manual",
    update: { version: "0.0.9", kind: "manual", command: "npm run quickstart" },
  });
  render(<Harness api={mock} />);
  fireEvent.click(screen.getByRole("button", { name: "Check releases" }));
  expect(await screen.findByText(/Export a backup/)).toBeVisible();
  expect(screen.getByText("npm run quickstart")).toBeVisible();
  await waitFor(() =>
    expect(screen.getByText(/Installed version unavailable/)).toBeVisible(),
  );
});
it("locks concurrent checks and renders empty results", async () => {
  const mock = api();
  let resolve!: (value: unknown) => void;
  mock.checkReleases.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  render(<Harness api={mock} />);
  fireEvent.click(screen.getByRole("button", { name: "Check releases" }));
  expect(screen.getByRole("button", { name: "Checking…" })).toBeDisabled();
  resolve({ status: "empty", checkedAt: 1000, releases: [] });
  expect(
    await screen.findByText("No supported published releases were found."),
  ).toBeVisible();
  expect(mock.checkReleases).toHaveBeenCalledTimes(1);
});
