// @vitest-environment jsdom
import { render, screen, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { BackupSettingsWorkspace } from "./BackupSettingsWorkspace.js";
import { ImportOutcomeUnknownError } from "./api.js";
import type { BackupPreview } from "../domain/database-transfer.js";

const preview: BackupPreview = {
  digest: "a".repeat(64),
  projects: [
    {
      id: "one",
      title: "Duplicate",
      createdAt: 1,
      pinnedAt: 2,
      archivedAt: null,
      messageCount: 1,
      attachmentCount: 1,
    },
    {
      id: "two",
      title: "Duplicate",
      createdAt: 2,
      pinnedAt: null,
      archivedAt: 3,
      messageCount: 0,
      attachmentCount: 0,
    },
  ],
};
const file = () => new File(["test"], "test.on-track-backup");
function props() {
  return {
    projects: [],
    onExport: vi.fn().mockResolvedValue(undefined),
    onPreview: vi.fn().mockResolvedValue(preview),
    onImport: vi.fn().mockResolvedValue({ importedCount: 1, renames: [] }),
    unavailable: false,
  };
}
it("keeps duplicate-title choices independent and disables an empty selection", async () => {
  const user = userEvent.setup();
  const p = props();
  render(<BackupSettingsWorkspace {...p} />);
  await user.upload(screen.getByLabelText("Choose threadstr backup"), file());
  const group = await screen.findByRole("group", {
    name: "Projects to import",
  });
  await user.click(within(group).getByRole("button", { name: "Clear" }));
  expect(
    screen.getByRole("button", { name: "Merge selected (0)" }),
  ).toBeDisabled();
  await user.click(within(group).getAllByRole("checkbox")[1]);
  await user.click(screen.getByRole("button", { name: "Merge selected (1)" }));
  expect(p.onImport).toHaveBeenCalledWith(expect.any(File), {
    mode: "merge",
    selection: ["two"],
    digest: preview.digest,
  });
  expect(
    screen.getByRole("button", { name: "Merge selected (1)" }),
  ).toBeDisabled();
});
it("ignores stale preview errors after a newer file succeeds", async () => {
  const user = userEvent.setup();
  const p = props();
  let reject!: (reason: Error) => void;
  p.onPreview.mockImplementationOnce(
    () =>
      new Promise((_, rejectPromise) => {
        reject = rejectPromise;
      }),
  );
  render(<BackupSettingsWorkspace {...p} />);
  await user.upload(screen.getByLabelText("Choose threadstr backup"), file());
  await user.upload(
    screen.getByLabelText("Choose threadstr backup"),
    new File(["other"], "other.on-track-backup"),
  );
  expect(
    await screen.findByRole("group", { name: "Projects to import" }),
  ).toBeVisible();
  await act(async () => reject(new Error("old failure")));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(
    screen.getByRole("button", { name: "Merge selected (2)" }),
  ).toBeEnabled();
});
it("allows retry after preview errors and prevents retry of an unknown commit outcome", async () => {
  const user = userEvent.setup();
  const p = props();
  p.onPreview.mockRejectedValueOnce(new Error("Invalid backup"));
  p.onImport.mockRejectedValue(new ImportOutcomeUnknownError());
  render(<BackupSettingsWorkspace {...p} />);
  await user.upload(screen.getByLabelText("Choose threadstr backup"), file());
  expect(await screen.findByRole("alert")).toHaveTextContent("Invalid backup");
  await user.click(screen.getByRole("button", { name: "Check backup again" }));
  await user.click(
    await screen.findByRole("button", { name: "Merge selected (2)" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Refresh and check your projects",
  );
  expect(
    screen.getByRole("button", { name: "Merge selected (2)" }),
  ).toBeDisabled();
});
it("allows an originally empty backup but never treats cleared selection as empty replacement", async () => {
  const user = userEvent.setup();
  const p = props();
  p.onPreview.mockResolvedValue({ digest: preview.digest, projects: [] });
  p.onImport.mockResolvedValue({ importedCount: 0, renames: [] });
  render(<BackupSettingsWorkspace {...p} />);
  await user.upload(screen.getByLabelText("Choose threadstr backup"), file());
  await user.click(
    await screen.findByRole("button", { name: "Merge selected (0)" }),
  );
  expect(p.onImport).toHaveBeenCalledWith(expect.any(File), {
    mode: "merge",
    selection: "all",
    digest: preview.digest,
  });
});
