import { expect, test } from "./fixtures.js";

test("reopens an unsent message and its files after restart, then sends it once", async ({
  page,
  request,
  localApp,
}, testInfo) => {
  const title = "Unfinished handover";
  const chat = await (
    await request.post(`${localApp.url}/api/chats`, {
      data: { title, accent: "moss" },
    })
  ).json();
  await page.goto(localApp.url);
  const open = page.getByRole("button", { name: `Open ${title}`, exact: true });
  await open.click();
  const composer = page.getByLabel("Add a note", { exact: true });
  const body = "  First line\nA second line  ";
  await composer.fill(body);
  await page.getByRole("button", { name: /Show sender options/ }).click();
  await page.getByLabel("Sender name").fill("Maya");
  await page.getByRole("button", { name: "Choose timestamp" }).click();
  await page.getByLabel("Message timestamp").fill("2026-11-18T09:15");
  await page.getByLabel("Attach files").setInputFiles([
    {
      name: "agenda.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("First attachment"),
    },
    {
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Second attachment"),
    },
  ]);
  await expect(page.getByText("Draft saved", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("draft-saved.png") });
  await localApp.restart();
  await page.reload();
  await open.click();
  await expect(composer).toHaveValue(body);
  await expect(page.getByLabel("Sender name")).toHaveValue("Maya");
  await expect(page.getByLabel("Message timestamp")).toHaveValue(
    "2026-11-18T09:15",
  );
  await expect(page.locator(".pending-attachment strong")).toHaveText([
    "agenda.txt",
    "notes.txt",
  ]);
  await expect(page.locator(".history [data-note-id]")).toHaveCount(0);
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  await expect(composer).toHaveValue("");
  const row = page.locator(".history [data-note-id]");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("First line");
  await expect(row).toContainText("agenda.txt");
  await expect(row).toContainText("notes.txt");
  const detail = await (
    await request.get(`${localApp.url}/api/chats/${chat.id}`)
  ).json();
  expect(detail.notes[0].sender).toBe("Maya");
  expect(
    detail.notes[0].attachments.map(
      (file: { filename: string }) => file.filename,
    ),
  ).toEqual(["agenda.txt", "notes.txt"]);
  await page.reload();
  await open.click();
  await expect(composer).toHaveValue("");
  await expect(page.locator(".pending-attachment")).toHaveCount(0);
});
