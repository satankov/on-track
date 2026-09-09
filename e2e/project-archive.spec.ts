import { expect, test } from "./fixtures.js";

test("archive settings and sidebar restoration preserve projects across restart and backup", async ({
  page,
  request,
  localApp,
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
  await page.getByRole("button", { name: "Open Completed launch" }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Project name").fill("Unsaved title");
  await page
    .getByRole("button", { name: "Archive project", exact: true })
    .click();
  const restoreSettings = page.getByRole("button", {
    name: "Restore project",
    exact: true,
  });
  await expect(restoreSettings).toBeEnabled();
  await expect(restoreSettings).toBeFocused();
  await expect(page.getByLabel("Project name")).toHaveValue("Unsaved title");
  for (const theme of ["light", "neutral", "dark"]) {
    await page.evaluate(
      (value) => (document.documentElement.dataset.theme = value),
      theme,
    );
    await page.waitForTimeout(250);
    await page.screenshot({
      path: testInfo.outputPath(`archive-settings-${theme}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  if (testInfo.project.name === "desktop-chromium") {
    await page.emulateMedia({
      reducedMotion: "reduce",
      forcedColors: "active",
    });
    await expect(restoreSettings).toHaveCSS("transition-duration", "0s");
    await restoreSettings.focus();
    await page.screenshot({
      path: testInfo.outputPath("archive-forced-colors.png"),
      fullPage: true,
    });
    await page.emulateMedia({ forcedColors: "none" });
    await page.setViewportSize({ width: 960, height: 900 });
    await page
      .getByLabel("Project name")
      .fill(
        "A long project title that must stay usable when the settings actions wrap",
      );
    await page.screenshot({
      path: testInfo.outputPath("archive-settings-medium.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => (document.documentElement.style.zoom = "2"));
    await restoreSettings.scrollIntoViewIfNeeded();
    const box = await restoreSettings.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(1440);
    const panel = await page.locator(".settings-panel").boundingBox();
    for (const action of await page
      .locator(".project-edit-actions button")
      .all()) {
      const actionBox = await action.boundingBox();
      expect(actionBox!.x + actionBox!.width).toBeLessThanOrEqual(
        panel!.x + panel!.width,
      );
    }
    await page.screenshot({
      path: testInfo.outputPath("archive-settings-200-percent.png"),
      fullPage: true,
    });
    await page.evaluate(() => (document.documentElement.style.zoom = ""));
  }
  await restoreSettings.click();
  await expect(
    page.getByRole("button", { name: "Archive project", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Archive project", exact: true })
    .click();
  await expect(restoreSettings).toBeEnabled();
  await page
    .getByRole("button", { name: "Back to project", exact: true })
    .click();
  await expect(
    page
      .locator(".message-list")
      .getByText("Keep the launch decisions.", { exact: true }),
  ).toBeVisible();

  const backup = await request.get(`${localApp.url}/api/database/export`);
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
  const restoreRow = page.getByRole("button", {
    name: "Restore Completed launch from archive",
  });
  await expect(restoreRow).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Pin Completed launch" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(restoreRow).toBeHidden();
  await page
    .getByRole("button", { name: "Archive", exact: true })
    .press("Enter");
  await restoreRow.focus();
  await page.screenshot({
    path: testInfo.outputPath("archive-rail.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await restoreRow.focus();
  await restoreRow.press("Enter");
  await expect(
    page.getByRole("button", { name: "Archive", exact: true }),
  ).toContainText("00");
  await expect(
    page.getByRole("button", { name: "Projects", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Projects", exact: true })
    .press("Enter");
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
