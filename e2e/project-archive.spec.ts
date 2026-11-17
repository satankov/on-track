import { expect, test } from "./fixtures.js";

test("rail archive and restore preserve projects across restart and backup", async ({
  page,
  request,
  localApp,
  isMobile,
}, testInfo) => {
  const response = await request.post(`${localApp.url}/api/chats`, {
    data: { title: "Completed launch", accent: "ocean" },
  });
  const chat = (await response.json()) as { id: string };
  await request.post(`${localApp.url}/api/chats/${chat.id}/notes`, {
    multipart: { body: "Keep the launch decisions.", sender: "Maya" },
  });
  await request.put(`${localApp.url}/api/chats/${chat.id}/pin`);
  await page.goto(localApp.url);
  const openRow = page.getByRole("button", {
    name: "Open Completed launch",
    exact: true,
  });
  const disclosure = page.getByRole("button", {
    name: "Shortcuts for Completed launch",
  });
  const archiveRow = page.getByRole("button", {
    name: "Archive Completed launch",
    exact: true,
  });
  const restoreRow = page.getByRole("button", {
    name: "Restore Completed launch from archive",
  });
  async function revealShortcuts() {
    if (isMobile) {
      if ((await disclosure.getAttribute("aria-expanded")) !== "true")
        await disclosure.tap();
    } else {
      await openRow.hover();
    }
  }

  await revealShortcuts();
  await archiveRow.click();
  const archiveSection = page.getByRole("region", {
    name: "Archive",
    exact: true,
  });
  await expect(
    archiveSection.getByRole("button", { name: "Open Completed launch" }),
  ).toBeVisible();
  await revealShortcuts();
  for (const theme of ["light", "neutral", "dark"]) {
    await page.evaluate(
      (value) => (document.documentElement.dataset.theme = value),
      theme,
    );
    await expect(restoreRow).toBeInViewport();
    await page.screenshot({
      path: testInfo.outputPath(`archive-rail-${theme}.png`),
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  if (!isMobile) {
    await page.emulateMedia({
      forcedColors: "active",
      reducedMotion: "reduce",
    });
    await restoreRow.focus();
    await expect(restoreRow).toHaveCSS("transition-duration", "0s");
    await page.screenshot({
      path: testInfo.outputPath("archive-forced-colors.png"),
    });
    await page.emulateMedia({ forcedColors: "none" });
  }

  const backup = await request.post(`${localApp.url}/api/database/export`, {
    data: { selection: "all" },
  });
  expect(backup.ok()).toBe(true);
  const bytes = await backup.body();
  await request.delete(`${localApp.url}/api/chats/${chat.id}/archive`);
  const restored = await request.put(`${localApp.url}/api/database/import`, {
    data: bytes,
    headers: { "Content-Type": "application/vnd.on-track.backup+sqlite" },
  });
  expect(restored.ok(), await restored.text()).toBe(true);
  await localApp.restart();
  await page.goto(localApp.url);
  await revealShortcuts();
  await expect(restoreRow).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Pin Completed launch" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(restoreRow).toBeHidden();
  await page
    .getByRole("button", { name: "Archive", exact: true })
    .press("Enter");
  await revealShortcuts();
  await restoreRow.focus();
  await page.screenshot({
    path: testInfo.outputPath("archive-rail.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await revealShortcuts();
  await restoreRow.focus();
  await restoreRow.press("Enter");
  await expect(restoreRow).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Archive", exact: true }),
  ).toHaveText("Archive");
  await expect(
    page.getByRole("button", { name: "Projects", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Projects", exact: true })
    .press("Enter");
  await revealShortcuts();
  await expect(
    page.getByRole("button", { name: "Pin Completed launch" }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Open Completed launch" }).click();
  await expect(
    page
      .locator(".message-list")
      .getByText("Keep the launch decisions.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Maya", { exact: true })).toBeVisible();
});
