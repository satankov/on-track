import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "./fixtures.js";

test("examples can be explored, copied, edited, backed up and hidden", async ({
  page,
  request,
  localApp,
}, testInfo) => {
  await page.goto(localApp.url);
  await page
    .getByRole("button", { name: "Open example 🇳🇱 Trip to Amsterdam" })
    .click();
  await expect(
    page.getByText("Read-only example.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Add a note", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".history")).toHaveJSProperty("scrollTop", 0);

  const composer = page.locator(".composer");
  await expect(
    page
      .locator(".chat-header")
      .getByRole("button", { name: "Create editable copy" }),
  ).toBeVisible();
  await expect(
    page
      .locator(".chat-header")
      .getByRole("button", { name: "Edit", exact: true }),
  ).toHaveCount(0);
  await expect(composer.getByText(/Read-only example/)).toBeVisible();
  const inputBox = await page
    .getByRole("textbox", { name: "Add a note", exact: true })
    .boundingBox();
  if (testInfo.project.name === "mobile-webkit")
    await page.touchscreen.tap(
      inputBox!.x + 15,
      inputBox!.y + inputBox!.height / 2,
    );
  else
    await page.mouse.click(
      inputBox!.x + 15,
      inputBox!.y + inputBox!.height / 2,
    );
  await expect(composer).toHaveAttribute("data-readonly-highlight", "true");
  await expect(composer).not.toHaveCSS("box-shadow", "none");
  await page.waitForTimeout(550);
  await expect(composer).toHaveAttribute("data-readonly-highlight", "true");
  await expect(composer).not.toHaveAttribute("data-readonly-highlight", "true");
  const buttonBox = await composer
    .getByRole("button", { name: "Add note", exact: true })
    .boundingBox();
  if (testInfo.project.name === "mobile-webkit")
    await page.touchscreen.tap(
      buttonBox!.x + buttonBox!.width / 2,
      buttonBox!.y + buttonBox!.height / 2,
    );
  else
    await page.mouse.click(
      buttonBox!.x + buttonBox!.width / 2,
      buttonBox!.y + buttonBox!.height / 2,
    );
  await expect(composer).toHaveAttribute("data-readonly-highlight", "true");
  await page.screenshot({
    path: testInfo.outputPath("examples-composer-glow.png"),
    fullPage: true,
  });
  const open = page.getByRole("button", {
    name: "Open packing-list.txt",
    exact: true,
  });
  await expect(open).toHaveAttribute("aria-disabled", "true");
  await page.getByRole("button", { name: "Files 2", exact: true }).click();
  await expect(composer).not.toHaveAttribute("data-readonly-highlight", "true");
  for (const name of [
    "Edit message",
    "Delete message",
    "Change labels",
    "Open packing-list.txt",
  ]) {
    const action = page.getByRole("button", { name, exact: true }).first();
    await action.focus();
    await page.keyboard.press("Enter");
    await expect(composer).toHaveAttribute("data-readonly-highlight", "true");
    await expect(composer).not.toHaveAttribute(
      "data-readonly-highlight",
      "true",
    );
  }
  expect(localApp.nativeActionReceipts()).toHaveLength(0);
  for (const theme of ["light", "neutral", "dark"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
      document.documentElement.style.colorScheme =
        value === "light" ? "light" : "dark";
    }, theme);
    await page.waitForTimeout(200);
    await page.screenshot({
      path: testInfo.outputPath(`examples-${theme}.png`),
      fullPage: true,
    });
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  if (testInfo.project.name === "desktop-chromium") {
    await page.setViewportSize({ width: 960, height: 900 });
    await page.screenshot({
      path: testInfo.outputPath("examples-medium.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => (document.documentElement.style.zoom = "2"));
    await page.screenshot({
      path: testInfo.outputPath("examples-zoom.png"),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const filename = await page
      .locator(".attachment-copy strong")
      .first()
      .boundingBox();
    expect(filename!.width).toBeGreaterThan(90);
    await page.evaluate(() => (document.documentElement.style.zoom = ""));
    await page.emulateMedia({
      forcedColors: "active",
      reducedMotion: "reduce",
    });
    await page.getByRole("button", { name: "Create editable copy" }).focus();
    await page.screenshot({
      path: testInfo.outputPath("examples-forced-colors.png"),
      fullPage: true,
    });
    await page.emulateMedia({ forcedColors: "none" });
  }
  await page.getByRole("button", { name: "Create editable copy" }).click();
  await expect(
    page.getByRole("heading", {
      name: "🇳🇱 Trip to Amsterdam (copy)",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "🇳🇱 Trip to Amsterdam (copy)",
      exact: true,
    }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Files 2", exact: true }).click();
  await open.click();
  await expect.poll(() => localApp.nativeActionReceipts().length).toBe(1);
  const receipt = localApp.nativeActionReceipts()[0];
  expect(readFileSync(receipt.path, "utf8")).toContain(
    "AMSTERDAM — PACKING LIST",
  );
  writeFileSync(receipt.path, "My own packing list\n");
  const chats = await (await request.get(`${localApp.url}/api/chats`)).json();
  const copied = chats.find(
    (chat: { title: string }) => chat.title === "🇳🇱 Trip to Amsterdam (copy)",
  );
  const backup = await request.post(`${localApp.url}/api/database/export`, {
    data: { selection: [copied.id] },
  });
  expect(backup.ok()).toBe(true);
  const body = await backup.body();
  if (testInfo.project.name === "desktop-chromium")
    await page.getByRole("link", { name: "Home" }).click();
  else
    await page
      .getByRole("button", { name: "Back to projects", exact: true })
      .click();
  await page.getByRole("button", { name: "Settings. Local only." }).click();
  await expect(
    page.getByRole("heading", { name: "General", exact: true }),
  ).toBeVisible();
  await page.getByRole("checkbox", { name: "Show examples" }).uncheck();
  await page.screenshot({
    path: testInfo.outputPath("examples-general.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Back to projects", exact: true })
    .click();
  await localApp.restart();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Examples", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Open 🇳🇱 Trip to Amsterdam (copy)",
      exact: true,
    }),
  ).toBeVisible();
  // Replace with the saved user copy. Catalog originals never enter the backup.
  const restored = await request.put(`${localApp.url}/api/database/import`, {
    headers: { "Content-Type": "application/vnd.on-track.backup+sqlite" },
    data: body,
  });
  expect(restored.ok()).toBe(true);
  const restoredChats = await (
    await request.get(`${localApp.url}/api/chats`)
  ).json();
  expect(restoredChats).toHaveLength(1);
  await page.getByRole("button", { name: "Settings. Local only." }).click();
  await page.getByRole("checkbox", { name: "Show examples" }).check();
  await page
    .getByRole("button", { name: "Back to projects", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open example 🇳🇱 Trip to Amsterdam" })
    .click();
  await expect(
    page.getByRole("heading", { name: "🇳🇱 Trip to Amsterdam", exact: true }),
  ).toBeVisible();
  // Copy again after database replacement, exercising current connection ownership.
  await page.getByRole("button", { name: "Create editable copy" }).click();
  await expect(
    page.getByRole("heading", {
      name: "🇳🇱 Trip to Amsterdam (copy 2)",
      exact: true,
    }),
  ).toBeVisible();
});

test("Amsterdam story renders rich content and future plans", async ({
  page,
  localApp,
}, testInfo) => {
  await page.clock.setFixedTime(new Date("2026-09-16T12:00:00Z"));
  await page.goto(localApp.url);
  await page
    .getByRole("button", { name: "Open example 🇳🇱 Trip to Amsterdam" })
    .click();
  const itinerary = page.locator(".message-row", {
    hasText: "Three days, with breathing room",
  });
  await itinerary.getByRole("button", { name: "Show more" }).click();
  await expect(
    itinerary.getByText("If plans change", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("amsterdam-itinerary.png"),
    fullPage: true,
  });
  await itinerary.getByRole("button", { name: "Show less" }).click();
  const boundary = page.getByRole("separator", { name: "Future messages" });
  await boundary.scrollIntoViewIfNeeded();
  await expect(boundary).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("amsterdam-future.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Links 1", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Amsterdam city guide" }),
  ).toHaveAttribute("href", "https://www.iamsterdam.com/en");
  await page.getByRole("button", { name: "Files 2", exact: true }).click();
  await expect(page.locator(".message-row")).toHaveCount(2);
  await expect(page.locator(".attachment-copy strong")).toHaveCount(3);
  await page.screenshot({
    path: testInfo.outputPath("amsterdam-files.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
