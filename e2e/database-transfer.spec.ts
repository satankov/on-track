import { test, expect } from "./fixtures.js";

test("selects exported projects, merges independent copies, and replaces with selected projects", async ({
  page,
  request,
  localApp,
}, testInfo) => {
  await localApp.restart();
  const suffix = Date.now();
  const names = [
    `Transfer A ${suffix}`,
    `Transfer B ${suffix}`,
    `Excluded ${suffix}`,
  ];
  for (const title of names)
    expect(
      (
        await request.post(`${localApp.url}/api/chats`, {
          data: { title, accent: "ocean" },
        })
      ).ok(),
    ).toBe(true);
  await page.goto(localApp.url);
  await page.getByRole("button", { name: /Settings/ }).click();
  await page.getByRole("button", { name: /Backups/ }).click();
  const exports = page.getByRole("group", { name: "Projects to export" });
  await exports.getByRole("button", { name: "Clear", exact: true }).click();
  await exports.getByRole("checkbox", { name: new RegExp(names[0]) }).check();
  await exports.getByRole("checkbox", { name: new RegExp(names[1]) }).check();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export selected (2)" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).toBeTruthy();
  await page.getByLabel("Choose On Track backup").setInputFiles(path!);
  const imports = page.getByRole("group", { name: "Projects to import" });
  await expect(imports.getByRole("checkbox")).toHaveCount(2);
  await expect(
    page.getByRole("radio", { name: "Merge DB", exact: true }),
  ).toBeChecked();
  await imports.getByRole("checkbox", { name: new RegExp(names[1]) }).uncheck();
  await page.screenshot({
    path: testInfo.outputPath("backup-selection.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Merge selected (1)" }).click();
  await expect(page.getByRole("status")).toContainText("1 projects imported");
  await expect(page.locator(".backup-renames")).toContainText(
    `${names[0]} → ${names[0]}_`,
  );
  const merged = await request.get(`${localApp.url}/api/chats`);
  const projects = (await merged.json()) as Array<{ title: string }>;
  expect(
    projects.filter((project) => project.title.startsWith(names[0])),
  ).toHaveLength(2);
  expect(projects.some((project) => project.title === names[2])).toBe(true);
  await page.getByLabel("Choose On Track backup").setInputFiles([]);
  await page.getByLabel("Choose On Track backup").setInputFiles(path!);
  await imports.getByRole("checkbox", { name: new RegExp(names[0]) }).uncheck();
  await page.getByRole("radio", { name: "Replace whole DB" }).check();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await page
    .getByRole("button", { name: "Replace with selected (1)" })
    .scrollIntoViewIfNeeded();
  const panelBounds = await page.locator(".backup-panel").last().boundingBox();
  expect(panelBounds).toBeTruthy();
  expect(panelBounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  const bounds = await page
    .getByRole("button", { name: "Replace with selected (1)" })
    .boundingBox();
  expect(bounds).toBeTruthy();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
    page.viewportSize()!.width + 1,
  );
  await page.screenshot({
    path: testInfo.outputPath("backup-replace-zoom.png"),
    fullPage: true,
  });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "";
  });
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("ALL current projects");
    await dialog.accept();
  });
  await page.getByRole("button", { name: "Replace with selected (1)" }).click();
  await expect(page.getByRole("status")).toContainText("1 projects restored");
  await localApp.restart();
  await page.goto(localApp.url);
  await expect(
    page.getByRole("button", { name: `Open ${names[1]}` }),
  ).toBeVisible();
  const current = await (await request.get(`${localApp.url}/api/chats`)).json();
  expect(current).toEqual([expect.objectContaining({ title: names[1] })]);
});
