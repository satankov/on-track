import { expect, test } from "./fixtures.js";

test("keeps Question editable and its message tags intact across themes and reflow", async ({
  page,
  request,
  localApp,
}, testInfo) => {
  const title = "Release planning and a longer project name";
  const created = await request.post(`${localApp.url}/api/chats`, {
    data: { title, accent: "ocean" },
  });
  expect(created.ok()).toBe(true);
  const project = (await created.json()) as { id: string };
  const desktop = testInfo.project.name === "desktop-chromium";
  await page.setViewportSize(
    desktop ? { width: 1440, height: 900 } : { width: 390, height: 844 },
  );
  await page.goto(localApp.url);
  await page
    .getByRole("button", { name: `Open ${title}`, exact: true })
    .click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("checkbox", { name: "Question", exact: true }).check();
  await page.getByRole("button", { name: "Save changes" }).click();
  await page
    .getByLabel("Add a note", { exact: true })
    .fill("Which milestone needs a decision?");
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  const message = page
    .locator(".message-row")
    .filter({ hasText: "Which milestone needs a decision?" });
  await message.getByRole("button", { name: "Change labels" }).click();
  for (const name of ["Question", "Attention"]) {
    const checkbox = message.getByRole("checkbox", { name, exact: true });
    await checkbox.click();
    await expect(checkbox).toBeChecked();
  }
  await page.keyboard.press("Escape");
  await expect(
    message.locator('.message-label[data-label="open-question"]'),
  ).toHaveText("Question");

  const persisted = await (
    await request.get(`${localApp.url}/api/chats/${project.id}`)
  ).json();
  expect(
    persisted.labelDefinitions.find(
      (label: { id: string }) => label.id === "open-question",
    ),
  ).toMatchObject({ name: "Open question", enabled: true });
  expect(persisted.notes[0].labels).toContain("open-question");

  for (const theme of ["light", "neutral", "dark"]) {
    const preferences = await request.patch(`${localApp.url}/api/preferences`, {
      data: { theme },
    });
    expect(preferences.ok()).toBe(true);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    if (desktop)
      await page.screenshot({ path: testInfo.outputPath(`home-${theme}.png`) });
    await page
      .getByRole("button", { name: `Open ${title}`, exact: true })
      .click();
    await expect(
      message.locator('.message-label[data-label="open-question"]'),
    ).toHaveText("Question");
    await page.getByRole("button", { name: /^Show sender options/ }).click();
    await page.getByRole("textbox", { name: "Sender name" }).fill("Maya");
    await page.screenshot({ path: testInfo.outputPath(`sender-${theme}.png`) });
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const back = page.getByRole("button", {
      name: "Back to project",
      exact: true,
    });
    await expect(
      page.getByRole("textbox", { name: "Project name", exact: true }),
    ).toBeFocused();
    if (desktop) {
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Shift+Tab");
      await expect(back).toBeFocused();
    }
    await expect(back.locator("svg")).toHaveCount(1);
    await expect(
      page.getByRole("checkbox", { name: "Question", exact: true }),
    ).toBeChecked();
    await page.screenshot({ path: testInfo.outputPath(`edit-${theme}.png`) });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (desktop) await back.press("Enter");
    else await back.tap();
    await expect(page.getByLabel("Add a note", { exact: true })).toBeVisible();
  }

  if (desktop) {
    for (const width of [1024, 720, 320]) {
      await page.setViewportSize({ width, height: 768 });
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      const back = page.getByRole("button", {
        name: "Back to project",
        exact: true,
      });
      await expect(back).toBeInViewport();
      await expect(
        page.getByRole("button", { name: "Save changes" }),
      ).toBeInViewport();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`edit-reflow-${width}.png`),
        fullPage: true,
      });
      await back.click();
    }
    await page.emulateMedia({
      forcedColors: "active",
      reducedMotion: "reduce",
    });
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "Project name", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(
      page.getByRole("button", { name: "Back to project", exact: true }),
    ).toBeFocused();
    await page.screenshot({
      path: testInfo.outputPath("edit-forced-colors.png"),
    });
  }
});
