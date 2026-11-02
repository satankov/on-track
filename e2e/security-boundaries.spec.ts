import { expect, test } from "./fixtures.js";

test("unsupported attachments retain Show in Folder without enabling native Open", async ({
  page,
  request,
  localApp,
}) => {
  const created = await request.post(`${localApp.url}/api/chats`, {
    data: { title: "Attachment safety", accent: "ocean" },
  });
  const project = (await created.json()) as { id: string };
  await request.post(`${localApp.url}/api/chats/${project.id}/notes`, {
    multipart: {
      body: "Keep this file without launching its handler.",
      files: {
        name: "profile.terminal",
        mimeType: "text/plain",
        buffer: Buffer.from("inert test fixture"),
      },
    },
  });
  await page.goto(localApp.url);
  await page
    .getByRole("button", { name: "Open Attachment safety", exact: true })
    .click();
  const open = page.getByRole("button", {
    name: "Open profile.terminal",
    exact: true,
  });
  await expect(open).toBeDisabled();
  await expect(
    page.getByText("Opening is blocked for this file type."),
  ).toBeVisible();
  const reveal = page.getByRole("button", {
    name: "Show profile.terminal in Folder",
    exact: true,
  });
  await expect(reveal).toBeEnabled();
  const offset = localApp.nativeActionReceipts().length;
  await reveal.focus();
  await expect(reveal).toBeFocused();
  await reveal.press("Enter");
  await expect
    .poll(() =>
      localApp
        .nativeActionReceipts()
        .slice(offset)
        .map((receipt) => receipt.action),
    )
    .toEqual(["reveal"]);
  expect(
    await page
      .locator(".attachment-card")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
});

test("browser export uses explicit POST and a navigation cannot download data", async ({
  page,
  localApp,
}) => {
  await page.goto(localApp.url);
  const result = await page.evaluate(async () => {
    const response = await fetch("/api/database/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ selection: "all" }),
    });
    return {
      status: response.status,
      type: response.headers.get("content-type"),
      size: (await response.blob()).size,
    };
  });
  expect(result.status).toBe(200);
  expect(result.type).toContain("application/vnd.on-track.backup+sqlite");
  expect(result.size).toBeGreaterThan(0);
  const navigation = await page.goto(`${localApp.url}/api/database/export`);
  expect(navigation?.headers()["content-disposition"]).toBeUndefined();
  expect(navigation?.headers()["content-type"]).not.toContain("backup+sqlite");
});
