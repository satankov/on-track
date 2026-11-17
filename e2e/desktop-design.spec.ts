import { expect, test } from "./fixtures.js";

test.beforeEach(({ browserName }, testInfo) => {
  void browserName;
  test.skip(testInfo.project.name !== "desktop-chromium");
});

test("keeps every Appearance choice inside a constrained desktop workspace", async ({
  page,
  localApp,
}, testInfo) => {
  await page.setViewportSize({ width: 800, height: 768 });
  await page.goto(localApp.url);
  await page.getByRole("button", { name: /Settings/ }).click();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  for (const theme of ["Light", "Neutral", "Dark"]) {
    const choice = page.getByRole("radio", { name: new RegExp(`^${theme} `) });
    await expect(choice).toBeInViewport({ ratio: 1 });
    const card = page.locator(".theme-option").filter({ has: choice });
    const bounds = await card.boundingBox();
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(800);
    await choice.check();
    await page.screenshot({
      path: testInfo.outputPath(`appearance-${theme.toLowerCase()}-800.png`),
    });
  }
});

test("keeps text entry borderless and primary actions visible in every theme", async ({
  page,
  request,
  localApp,
}) => {
  await request.post(`${localApp.url}/api/chats`, {
    data: { title: "Workspace controls", accent: "ocean-gradient" },
  });
  await page.goto(localApp.url);
  await page.getByRole("button", { name: "Open Workspace controls" }).click();
  await page.mouse.move(0, 0);
  const header = page.locator(".chat-header");
  const composer = page.locator(".composer");
  const draft = page.getByRole("textbox", { name: "Add a note" });

  await expect(page.getByText("Local only", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Settings", exact: true }),
  ).toBeVisible();
  for (const [selector, edge] of [
    [".project-rail", "right"],
    [".rail-header", "bottom"],
    [".project-rail footer", "top"],
    [".chat-header", "bottom"],
  ] as const) {
    await expect(page.locator(selector)).toHaveCSS(
      `border-${edge}-width`,
      "0px",
    );
  }
  for (const selector of [
    ".new-project-button",
    ".settings-icon-button",
    ".edit-project-button",
    ".new-subthread-button",
  ]) {
    const button = page.locator(selector);
    await expect(button).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(button).toHaveCSS("border-top-width", "0px");
  }
  for (const theme of ["light", "neutral", "dark"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await expect(header).toHaveCSS(
      "background-color",
      await page
        .locator(".history")
        .evaluate((el) => getComputedStyle(el).backgroundColor),
    );
    await draft.fill("Visible send action");
    await expect(draft).toBeFocused();
    for (const field of [composer, draft]) {
      await expect(field).toHaveCSS("outline-style", "none");
      await expect(field).toHaveCSS("border-top-width", "0px");
      await expect(field).toHaveCSS("box-shadow", "none");
    }
    const send = page.locator(".send-button");
    await expect(send).toBeEnabled();
    await expect(send).toHaveCSS("background-image", /linear-gradient/);
    await expect(send).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(send).toHaveCSS("color", "rgb(255, 255, 255)");
    await page
      .getByRole("button", { name: "Search messages", exact: true })
      .click();
    const search = page.getByRole("searchbox", { name: "Search messages" });
    await expect(search).toBeFocused();
    for (const field of [page.locator(".project-search-field"), search]) {
      await expect(field).toHaveCSS("outline-style", "none");
      await expect(field).toHaveCSS("border-top-width", "0px");
      await expect(field).toHaveCSS("box-shadow", "none");
    }
    await page.keyboard.press("Escape");
  }
  await page.getByRole("button", { name: "New project", exact: true }).click();
  const title = page.getByLabel("Project name", { exact: true });
  await expect(title).toBeFocused();
  const picker = page.getByRole("group", { name: "Accent", exact: true });
  const radios = picker.getByRole("radio");
  await expect(radios).toHaveCount(12);
  const names = [
    "Coral",
    "Amber",
    "Moss",
    "Ocean",
    "Iris",
    "Slate",
    "Guava",
    "Honey",
    "Jade",
    "Lagoon",
    "Orchid",
    "Periwinkle",
  ];
  for (const [index, name] of names.entries()) {
    await expect(radios.nth(index)).toHaveAccessibleName(name);
    await expect(picker.locator(".accent-swatch").nth(index)).toHaveCSS(
      "background-image",
      index < 6 ? "none" : /linear-gradient/,
    );
  }
  await radios.nth(5).check();
  await radios.nth(5).press("ArrowRight");
  await expect(radios.nth(6)).toBeChecked();
  await expect(picker.locator(".accent-selection-name")).toHaveText("Guava");
  await expect(title).toHaveCSS("outline-style", "none");
  await expect(title).toHaveCSS("border-top-width", "0px");
  await title.fill("A second project");
  const create = page.getByRole("button", {
    name: "Create project",
    exact: true,
  });
  await expect(create).toBeEnabled();
  await expect(create).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(create).toHaveCSS("color", "rgb(255, 255, 255)");
  await page.emulateMedia({ forcedColors: "active" });
  await expect(picker.locator(".accent-swatch").nth(6)).toHaveCSS(
    "background-image",
    "none",
  );
  await expect(title).toHaveCSS("outline-style", "none");
  await expect(title).toHaveCSS("border-top-width", "0px");
});

test("centers Create project in the entire desktop viewport", async ({
  page,
  localApp,
}, testInfo) => {
  await page.goto(localApp.url);
  await page.getByRole("button", { name: "New project", exact: true }).click();
  const bounds = await page.locator(".project-dialog").boundingBox();
  expect(Math.abs(bounds!.x + bounds!.width / 2 - 720)).toBeLessThan(1);
  expect(Math.abs(bounds!.y + bounds!.height / 2 - 450)).toBeLessThan(1);
  await page.screenshot({ path: testInfo.outputPath("create-desktop.png") });
});

test("returns keyboard focus to the Create opener after Escape and Cancel", async ({
  page,
  localApp,
}) => {
  await page.goto(localApp.url);
  const opener = page.getByRole("button", { name: "New project", exact: true });
  await opener.focus();
  await opener.press("Enter");
  await expect(page.getByLabel("Project name", { exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
  await opener.press("Enter");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(opener).toBeFocused();
});

test("scrolls wide tables locally without compressing their words", async ({
  page,
  request,
  localApp,
}, testInfo) => {
  const created = await request.post(`${localApp.url}/api/chats`, {
    data: { title: "Desktop table", accent: "ocean" },
  });
  const project = (await created.json()) as { id: string };
  await request.post(`${localApp.url}/api/chats/${project.id}/notes`, {
    multipart: {
      body: "| Schedule | Owner | Status | Deliverable | Deadline | Budget | Dependency | Decision |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| October planning | Maya | In progress | Research summary | Wednesday | 1200 euros | Customer interview | Proceed after review |",
    },
  });
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto(localApp.url);
  await page
    .getByRole("button", { name: "Open Desktop table", exact: true })
    .click();
  const table = page.getByRole("region", {
    name: "Scrollable table",
    exact: true,
  });
  await expect(table).toBeVisible();
  expect(await table.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
    true,
  );
  await table.focus();
  await table.press("ArrowRight");
  await expect
    .poll(() => table.evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("table-1024.png") });
});

test("keeps clipped table scroll regions out of keyboard navigation until expanded", async ({
  page,
  request,
  localApp,
}) => {
  const created = await request.post(`${localApp.url}/api/chats`, {
    data: { title: "Collapsed desktop table", accent: "ocean" },
  });
  const project = (await created.json()) as { id: string };
  await request.post(`${localApp.url}/api/chats/${project.id}/notes`, {
    multipart: {
      body: `${"A planning paragraph.\n\n".repeat(18)}| Topic | Decision |\n| --- | --- |\n| Delivery | Ready |`,
    },
  });
  await page.goto(localApp.url);
  await page
    .getByRole("button", { name: "Open Collapsed desktop table", exact: true })
    .click();
  const table = page.getByRole("region", {
    name: "Scrollable table",
    exact: true,
  });
  await expect(table).toHaveAttribute("tabindex", "-1");
  await page.getByRole("button", { name: "Show more", exact: true }).click();
  await expect(table).toHaveAttribute("tabindex", "0");
  await page.getByRole("button", { name: "Show less", exact: true }).click();
  await expect(table).toHaveAttribute("tabindex", "-1");
});

test("uses the visible file-picker button as the only attachment tab stop", async ({
  page,
  request,
  localApp,
}) => {
  await request.post(`${localApp.url}/api/chats`, {
    data: { title: "Desktop keyboard", accent: "ocean" },
  });
  await page.goto(localApp.url);
  await page
    .getByRole("button", { name: "Open Desktop keyboard", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Show Markdown assistance", exact: true })
    .focus();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Open file picker", exact: true }),
  ).toBeFocused();
});

test("shows complete attachment explanations in a desktop message", async ({
  page,
  request,
  localApp,
}, testInfo) => {
  const created = await request.post(`${localApp.url}/api/chats`, {
    data: { title: "Desktop attachment", accent: "ocean" },
  });
  const project = (await created.json()) as { id: string };
  await request.post(`${localApp.url}/api/chats/${project.id}/notes`, {
    multipart: {
      body: "",
      files: {
        name: "installer-audit.exe",
        mimeType: "text/plain",
        buffer: Buffer.from("inert fixture"),
      },
    },
  });
  await page.setViewportSize({ width: 800, height: 768 });
  await page.goto(localApp.url);
  await page
    .getByRole("button", { name: "Open Desktop attachment", exact: true })
    .click();
  const reason = page.getByText("Opening is blocked for this file type.");
  await expect(reason).toBeVisible();
  expect(
    await reason.evaluate(
      (el) =>
        el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "Open installer-audit.exe", exact: true }),
  ).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath("attachment-800.png") });
});

test("preserves a visible label-popup boundary in forced colors", async ({
  page,
  request,
  localApp,
}, testInfo) => {
  const created = await request.post(`${localApp.url}/api/chats`, {
    data: { title: "Desktop high contrast", accent: "ocean" },
  });
  const project = (await created.json()) as { id: string };
  await request.post(`${localApp.url}/api/chats/${project.id}/notes`, {
    multipart: { body: "A decision to label" },
  });
  await page.goto(localApp.url);
  await page
    .getByRole("button", { name: "Open Desktop high contrast", exact: true })
    .click();
  await page.emulateMedia({ forcedColors: "active" });
  await page
    .getByRole("button", { name: "Change labels", exact: true })
    .click();
  const popup = page.locator(".message-label-popover");
  expect(
    await popup.evaluate((el) => {
      const style = getComputedStyle(el);
      return (
        (parseFloat(style.borderTopWidth) > 0 &&
          style.borderTopStyle !== "none") ||
        (parseFloat(style.outlineWidth) > 0 && style.outlineStyle !== "none")
      );
    }),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("labels-forced-colors.png"),
  });
});

test("keeps export progress and retry feedback next to its action while an import is prepared", async ({
  page,
  request,
  localApp,
}, testInfo) => {
  await request.post(`${localApp.url}/api/chats`, {
    data: { title: "Desktop backup feedback", accent: "ocean" },
  });
  await page.goto(localApp.url);
  await page.getByRole("button", { name: /Settings/ }).click();
  await page.getByRole("button", { name: "Backups", exact: true }).click();
  const exports = page.getByRole("region", { name: "Export projects" });
  const imports = page.getByRole("region", { name: "Import projects" });
  const downloadPromise = page.waitForEvent("download");
  await exports
    .getByRole("button", { name: "Export all", exact: true })
    .click();
  const backup = await (await downloadPromise).path();
  await page.getByLabel("Choose threadstr backup").setInputFiles(backup!);
  await expect(imports.getByRole("status")).toContainText("Backup checked.");
  let failExport!: () => void;
  const releaseExport = new Promise<void>((resolve) => {
    failExport = resolve;
  });
  await page.route("**/api/database/export", async (route) => {
    await releaseExport;
    await route.fulfill({ status: 500, body: "Export unavailable" });
  });
  await exports
    .getByRole("button", { name: "Export all", exact: true })
    .click();
  await expect(
    exports.getByRole("button", { name: "Exporting…", exact: true }),
  ).toBeDisabled();
  await expect(exports.getByRole("status")).toBeInViewport();
  failExport();
  const error = exports.getByRole("alert");
  await expect(error).toContainText("The database could not be exported.");
  await expect(error).toBeInViewport();
  const actionBounds = await exports
    .getByRole("button", { name: "Export all", exact: true })
    .boundingBox();
  const errorBounds = await error.boundingBox();
  expect(
    errorBounds!.y - (actionBounds!.y + actionBounds!.height),
  ).toBeLessThan(32);
  await page.screenshot({
    path: testInfo.outputPath("backup-export-error-desktop.png"),
  });
  await expect(
    imports.getByRole("group", { name: "Projects to import" }),
  ).toBeVisible();
  await page.unroute("**/api/database/export");
  const retryDownload = page.waitForEvent("download");
  await exports
    .getByRole("button", { name: "Export all", exact: true })
    .click();
  await retryDownload;
  await expect(exports.getByRole("status")).toHaveText(
    "Backup export is ready.",
  );
  await expect(error).toHaveCount(0);
});
