import type { APIRequestContext } from "@playwright/test";
import { readFileSync, realpathSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import Database from "better-sqlite3";

import { expect, test } from "./fixtures.js";

type Box = {
  top: number;
  bottom: number;
  height: number;
  left: number;
  right: number;
  width: number;
};

type ScrollMetrics = {
  clientHeight: number;
  scrollHeight: number;
  top: number;
  bottom: number;
};

type AttachmentRow = {
  chatId: string;
  id: string;
  noteId: string;
  storagePath: string;
  byteSize: number;
  modifiedAt: number;
};

function viewportName(testName: string): string {
  return testName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
}

async function createProject(
  request: APIRequestContext,
  url: string,
  input: { title: string; accent: string },
): Promise<{ id: string; title: string }> {
  const response = await request.post(`${url}/api/chats`, { data: input });
  expect(response.ok()).toBe(true);
  return (await response.json()) as { id: string; title: string };
}

async function addNote(
  request: APIRequestContext,
  url: string,
  chatId: string,
  body: string,
  createdAt?: number,
): Promise<void> {
  const response = await request.post(`${url}/api/chats/${chatId}/notes`, {
    multipart: {
      body,
      ...(createdAt === undefined ? {} : { createdAt: String(createdAt) }),
    },
  });
  expect(response.ok()).toBe(true);
}

function readAttachmentRow(
  dataDirectory: string,
  projectTitle: string,
  filename: string,
): AttachmentRow {
  const database = new Database(join(dataDirectory, "on-track.sqlite"), {
    readonly: true,
    fileMustExist: true,
  });
  try {
    const row = database
      .prepare(
        `SELECT attachment.id,
                chat.id AS chatId,
                attachment.note_id AS noteId,
                attachment.storage_path AS storagePath,
                attachment.byte_size AS byteSize,
                attachment.modified_at AS modifiedAt
           FROM note_attachments attachment
           JOIN notes note ON note.id = attachment.note_id
           JOIN chats chat ON chat.id = note.chat_id
          WHERE chat.title = ? AND attachment.filename = ?
          ORDER BY attachment.rowid DESC
          LIMIT 1`,
      )
      .get(projectTitle, filename) as AttachmentRow | undefined;
    if (!row) throw new Error(`Attachment ${filename} was not persisted.`);
    return row;
  } finally {
    database.close();
  }
}

test("creates, customizes, records, and reopens a private project thread", async ({
  page,
  localApp,
}, testInfo) => {
  const unexpectedHosts = new Set<string>();
  page.on("request", (request) => {
    const host = new URL(request.url()).hostname;
    if (host !== "127.0.0.1" && host !== "localhost") unexpectedHosts.add(host);
  });

  const suffix = `${testInfo.project.name}-${Date.now()}`;
  const projectName = `Launch ${suffix}`;
  const renamedProject = `Delivery ${suffix}`;
  const note = "Decision\nShip the smallest useful workflow.";

  await page.goto(localApp.url);
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByLabel("Project name").fill(projectName);
  await page.getByRole("radio", { name: "Ocean" }).check();
  await page.getByRole("button", { name: "Create project" }).click();

  await expect(page.getByRole("heading", { name: projectName })).toBeVisible();
  if (testInfo.project.name === "mobile-webkit") {
    await expect(
      page.getByRole("button", { name: "Back to projects" }),
    ).toBeFocused();
  }
  await page.getByLabel("Add a note").fill(note);
  await page.getByRole("button", { name: "Choose timestamp" }).click();
  await page.getByLabel("Message timestamp").fill("2026-08-30T10:15");
  await page.getByRole("button", { name: /Add note/ }).click();
  await expect(
    page.getByText("Ship the smallest useful workflow."),
  ).toBeVisible();
  await expect(page.getByText("August 30, 2026")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".message-bubble").first()).toBeVisible();

  const messageLayout = await page.evaluate(() => {
    const bubble = document.querySelector(".message-bubble")!;
    const actions = document.querySelector(".message-actions")!;
    const editButton = document.querySelector(".edit-project-button")!;
    const composer = document.querySelector(".composer")!;
    return {
      bubbleRight: bubble.getBoundingClientRect().right,
      bubbleLeft: bubble.getBoundingClientRect().left,
      actionsTop: actions.getBoundingClientRect().top,
      actionsRight: actions.getBoundingClientRect().right,
      bubbleBottom: bubble.getBoundingClientRect().bottom,
      editRight: editButton.getBoundingClientRect().right,
      composerRight: composer.getBoundingClientRect().right,
    };
  });
  if (testInfo.project.name === "mobile-webkit") {
    expect(messageLayout.actionsTop).toBeGreaterThanOrEqual(
      messageLayout.bubbleBottom,
    );
  } else {
    expect(messageLayout.actionsRight).toBeLessThanOrEqual(
      messageLayout.bubbleLeft,
    );
  }
  expect(messageLayout.bubbleRight).toBeCloseTo(messageLayout.composerRight, 0);
  expect(messageLayout.editRight).toBeCloseTo(messageLayout.composerRight, 0);

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Project name").fill(renamedProject);
  await page.getByRole("radio", { name: "Iris" }).check();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByRole("heading", { name: renamedProject }),
  ).toBeVisible();

  const previousPid = localApp.pid();
  await localApp.restart();
  expect(localApp.pid()).not.toBe(previousPid);
  await page.goto(localApp.url);
  const projectButton = page.getByRole("button", {
    name: `Open ${renamedProject}`,
  });
  await projectButton.click();
  if (testInfo.project.name === "mobile-webkit") {
    const backButton = page.getByRole("button", { name: "Back to projects" });
    await expect(backButton).toBeFocused();
    await backButton.click();
    await expect(projectButton).toBeFocused();
    await projectButton.click();
    await expect(backButton).toBeFocused();
  }
  await expect(
    page.getByRole("heading", { name: renamedProject }),
  ).toBeVisible();
  await expect(
    page.getByText("Ship the smallest useful workflow."),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("workspace.png"),
    fullPage: true,
  });
  expect([...unexpectedHosts]).toEqual([]);
});

test("uses compact desktop chrome and an auto-growing composer", async ({
  page,
  request,
  localApp,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium");

  const project = await createProject(request, localApp.url, {
    title: "Desktop visual density",
    accent: "ocean",
  });
  await addNote(request, localApp.url, project.id, "A representative note.");

  await page.goto(localApp.url);
  await page.getByRole("button", { name: `Open ${project.title}` }).click();
  await expect(page.locator(".composer-wrap")).toBeVisible();

  const geometry = await page.evaluate(() => {
    const box = (selector: string): Box => {
      const rect = document.querySelector(selector)!.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        width: rect.width,
      };
    };
    return {
      header: box(".chat-header"),
      filters: box(".history-filter"),
      history: box(".history"),
      composer: box(".composer-wrap"),
    };
  });

  expect(geometry.header.height).toBeLessThanOrEqual(64);
  expect(geometry.composer.height).toBeLessThanOrEqual(72);
  expect(geometry.history.height).toBeGreaterThanOrEqual(672);
  expect(geometry.filters.top).toBeCloseTo(geometry.history.top, 0);
  expect(geometry.filters.bottom).toBeCloseTo(geometry.history.bottom, 0);
  expect(geometry.filters.right).toBeLessThanOrEqual(geometry.history.left + 1);

  const composer = page.getByLabel("Add a note");
  await composer.fill("One line");
  const oneLineHeight = await composer.evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  await composer.fill("One\nTwo\nThree\nFour\nFive");
  const multilineHeight = await composer.evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  expect(multilineHeight).toBeGreaterThan(oneLineHeight);

  await composer.fill("One\nTwo\nThree\nFour\nFive\nSix\nSeven\nEight");
  await expect(composer).toHaveCSS("overflow-y", "auto");
  const cappedHeight = await composer.evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  expect(cappedHeight).toBeLessThanOrEqual(144);

  await composer.fill("");
  const clearedHeight = await composer.evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  expect(clearedHeight).toBeCloseTo(oneLineHeight, 0);

  await page.setViewportSize({ width: 1920, height: 900 });
  const wideAlignment = await page.evaluate(() => {
    const right = (selector: string) =>
      document.querySelector(selector)!.getBoundingClientRect().right;
    return {
      bubble: right(".message-bubble"),
      edit: right(".edit-project-button"),
      composer: right(".composer"),
    };
  });
  expect(wideAlignment.bubble).toBeCloseTo(wideAlignment.composer, 0);
  expect(wideAlignment.edit).toBeCloseTo(wideAlignment.composer, 0);

  await composer.fill(
    "This note remains on one line in a wide workspace but should wrap after the desktop window becomes narrower.",
  );
  const wideComposerHeight = await composer.evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect
    .poll(() =>
      composer.evaluate((element) => element.getBoundingClientRect().height),
    )
    .toBeGreaterThan(wideComposerHeight);
});

test("shows future messages in a silent full-width fade", async ({
  page,
  request,
  localApp,
}, testInfo) => {
  const now = Date.now();
  const project = await createProject(request, localApp.url, {
    title: `Future boundary ${testInfo.project.name}`,
    accent: "ocean",
  });
  await addNote(
    request,
    localApp.url,
    project.id,
    "Already happened",
    now - 86_400_000,
  );
  await addNote(
    request,
    localApp.url,
    project.id,
    "Scheduled for tomorrow",
    now + 86_400_000,
  );

  await page.goto(localApp.url);
  await page.getByRole("button", { name: `Open ${project.title}` }).click();

  const futureBoundary = page.getByRole("separator", {
    name: "Future messages",
  });
  await expect(futureBoundary).toBeAttached();
  await expect(page.getByText("Scheduled for tomorrow")).toBeVisible();
  await expect(page.getByText("Already happened")).toBeVisible();
  await expect(page.getByText("Future messages")).toHaveCount(0);

  const geometry = await page.evaluate(() => {
    const history = document.querySelector(".history")!;
    const future = document.querySelector(".future-message-boundary-surface")!;
    const historyBox = history.getBoundingClientRect();
    const futureBox = future.getBoundingClientRect();
    const style = getComputedStyle(future);
    return {
      historyLeft: historyBox.left,
      historyRight: historyBox.right,
      futureLeft: futureBox.left,
      futureRight: futureBox.right,
      borderRadius: style.borderRadius,
      borderTopStyle: style.borderTopStyle,
      backgroundImage: style.backgroundImage,
      historyOverflowX: getComputedStyle(history).overflowX,
    };
  });
  expect(geometry.futureLeft).toBeLessThanOrEqual(geometry.historyLeft);
  expect(geometry.futureRight).toBeGreaterThanOrEqual(geometry.historyRight);
  expect(geometry.borderRadius).toBe("0px");
  expect(geometry.borderTopStyle).toBe("solid");
  expect(geometry.backgroundImage).toContain("linear-gradient");
  expect(geometry.historyOverflowX).toBe("hidden");

  const shortFeedScroll = await page.locator(".history").evaluate((history) => {
    const element = history as HTMLElement;
    element.style.height = "300px";
    element.style.minHeight = "300px";
    element.style.maxHeight = "300px";
    const overflow = element.scrollHeight - element.clientHeight;
    element.scrollTop = element.scrollHeight;
    const historyBottom = element.getBoundingClientRect().bottom;
    const messageRows = element.querySelectorAll(".message-row");
    const lastMessageBottom =
      messageRows[messageRows.length - 1].getBoundingClientRect().bottom;
    const trailingGap = historyBottom - lastMessageBottom;
    element.style.removeProperty("height");
    element.style.removeProperty("min-height");
    element.style.removeProperty("max-height");
    element.scrollTop = 0;
    return { overflow, trailingGap };
  });
  expect(
    shortFeedScroll.overflow === 0 || shortFeedScroll.trailingGap <= 37,
  ).toBe(true);

  const pastMessage = page.locator(".message-row", {
    hasText: "Already happened",
  });
  await pastMessage.getByRole("button", { name: "Change labels" }).click();
  const todoCheckbox = pastMessage.getByRole("checkbox", { name: "Todo" });
  await expect(todoCheckbox).toBeVisible();
  await todoCheckbox.scrollIntoViewIfNeeded();
  const popoverIsTopmost = await todoCheckbox.evaluate((checkbox) => {
    const box = checkbox.getBoundingClientRect();
    const topmost = document.elementFromPoint(
      box.left + box.width / 2,
      box.top + box.height / 2,
    );
    return (
      checkbox.closest(".message-label-popover")?.contains(topmost) ?? false
    );
  });
  expect(popoverIsTopmost).toBe(true);
  await todoCheckbox.click();
  await expect(todoCheckbox).toBeChecked();
  await pastMessage.getByRole("button", { name: "Change labels" }).click();

  await page.emulateMedia({ forcedColors: "active" });
  const forcedColorsBoundary = await page
    .locator(".future-message-boundary-surface")
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        borderTopStyle: style.borderTopStyle,
        borderTopWidth: style.borderTopWidth,
      };
    });
  expect(forcedColorsBoundary.borderTopStyle).toBe("solid");
  expect(forcedColorsBoundary.borderTopWidth).toBe("1px");
  await page.emulateMedia({ forcedColors: "none" });

  await page.screenshot({
    path: testInfo.outputPath("future-message-boundary.png"),
    fullPage: true,
  });
});

test("switches and persists appearance themes from visual previews", async ({
  page,
  request,
  localApp,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium");

  const project = await createProject(request, localApp.url, {
    title: "Theme review project",
    accent: "ocean",
  });
  await addNote(
    request,
    localApp.url,
    project.id,
    "**Decision**\n\nKeep the reading surface quiet in every theme.",
  );

  await page.goto(localApp.url);
  await page.getByRole("button", { name: `Open ${project.title}` }).click();
  await page.getByRole("button", { name: /Settings/ }).click();
  await expect(
    page.getByRole("heading", { name: "Backup settings" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Appearance/ }).click();

  const previews = page.getByTestId("theme-preview");
  await expect(previews).toHaveCount(3);
  const previewBox = await previews.first().boundingBox();
  expect(previewBox?.width).toBeGreaterThan(220);
  expect(previewBox?.height).toBeGreaterThan(120);
  await expect(page.getByRole("radio", { name: /Light/ })).toBeChecked();

  await page.getByRole("radio", { name: /Neutral/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "neutral");
  await expect(page.getByRole("radio", { name: /Neutral/ })).toBeChecked();
  expect(
    await page.locator('meta[name="theme-color"]').getAttribute("content"),
  ).toBe("#30343a");

  await page.getByRole("button", { name: "Back to projects" }).click();
  await expect(
    page.getByRole("heading", { name: project.title }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "neutral");

  await page.getByRole("button", { name: /Settings/ }).click();
  await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();
  await page.getByRole("radio", { name: /Dark/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.getByRole("button", { name: /Settings/ }).click();
  await page.getByRole("button", { name: /Appearance/ }).click();
  await expect(page.getByRole("radio", { name: /Dark/ })).toBeChecked();

  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 1920, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    const overflow = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }));
    expect(overflow.documentWidth).toBeLessThanOrEqual(overflow.viewportWidth);
  }

  // A 640 CSS-pixel viewport exercises the same reflow pressure as a
  // 1280-pixel desktop window viewed at 200% zoom.
  await page.setViewportSize({ width: 640, height: 720 });
  await expect(page.getByRole("button", { name: /Appearance/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Backups/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Dark/ })).toBeVisible();
  const zoomedOverflow = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(zoomedOverflow.documentWidth).toBeLessThanOrEqual(
    zoomedOverflow.viewportWidth,
  );

  await page.getByRole("radio", { name: /Light/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("manages markdown messages and database backups from the UI", async ({
  page,
  request,
  localApp,
}, testInfo) => {
  const suffix = `${viewportName(testInfo.project.name)}-${Date.now()}`;
  const exportedProject = await createProject(request, localApp.url, {
    title: `Backup source ${suffix}`,
    accent: "ocean",
  });
  await addNote(
    request,
    localApp.url,
    exportedProject.id,
    "**Decision**\n\nKeep the export restorable.",
  );

  await page.goto(localApp.url);
  await page
    .getByRole("button", { name: `Open ${exportedProject.title}` })
    .click();
  await expect(
    page.locator(".message-body strong", { hasText: "Decision" }),
  ).toBeVisible();

  const note = page.locator(".message-row").first();
  await note.getByRole("button", { name: "Edit message" }).click();
  await page
    .getByRole("textbox", { name: "Edit message" })
    .fill("Revised **decision**");
  await expect(page.getByLabel("Message timestamp")).toBeHidden();
  await page.getByRole("button", { name: "Choose timestamp" }).click();
  await page.getByLabel("Message timestamp").fill("2026-08-29T09:00");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(
    page.locator(".message-body strong", { hasText: "decision" }),
  ).toBeVisible();
  await expect(page.getByText("August 29, 2026")).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await note.getByRole("button", { name: "Delete message" }).click();
  await expect(page.getByText("Revised")).toBeHidden();

  const bundledAttachmentPath = testInfo.outputPath("bundled-roadmap.txt");
  writeFileSync(bundledAttachmentPath, "bundle sidecar bytes");
  await page.getByLabel("Attach files").setInputFiles(bundledAttachmentPath);
  await page.getByLabel("Add a note").fill("Bundled attachment");
  await page.getByRole("button", { name: /Add note/ }).click();
  await expect(page.getByText("bundled-roadmap.txt")).toBeVisible();

  if (testInfo.project.name === "mobile-webkit") {
    await page.getByRole("button", { name: "Back to projects" }).click();
  }
  await page.getByRole("button", { name: /Settings/ }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export backup" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(
    /on-track-\d{4}-\d{2}-\d{2}\.on-track-backup/,
  );
  const backupPath = await download.path();
  expect(backupPath).toBeTruthy();

  const extraProject = await createProject(request, localApp.url, {
    title: `Import should remove ${suffix}`,
    accent: "moss",
  });
  await page.getByRole("button", { name: "Back to projects" }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: `Open ${extraProject.title}` }),
  ).toBeVisible();

  await page.getByRole("button", { name: /Settings/ }).click();
  await page
    .getByLabel("Choose On Track backup")
    .setInputFiles(backupPath ?? "");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Restore backup" }).click();

  await expect(
    page.getByRole("button", { name: `Open ${exportedProject.title}` }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: `Open ${extraProject.title}` }),
  ).toHaveCount(0);

  await page
    .getByRole("button", { name: `Open ${exportedProject.title}` })
    .click();
  await expect(page.getByText("bundled-roadmap.txt")).toBeVisible();

  const activeDatabase = new Database(
    join(localApp.dataDirectory, "on-track.sqlite"),
    { readonly: true, fileMustExist: true },
  );
  try {
    expect(
      activeDatabase
        .prepare("SELECT name FROM pragma_table_info('note_attachments')")
        .pluck()
        .all(),
    ).not.toContain("content");
    const storagePath = activeDatabase
      .prepare("SELECT storage_path FROM note_attachments LIMIT 1")
      .pluck()
      .get() as string;
    expect(storagePath).toMatch(/^attachments\/v1\/restore-/);
    expect(
      readFileSync(join(localApp.dataDirectory, storagePath), "utf8"),
    ).toBe("bundle sidecar bytes");
  } finally {
    activeDatabase.close();
  }
});

test("adds an attachment message and filters history by files", async ({
  page,
  localApp,
}, testInfo) => {
  const suffix = `${viewportName(testInfo.project.name)}-${Date.now()}`;
  const projectTitle = `Attachments ${suffix}`;
  const attachmentPath = testInfo.outputPath("roadmap.txt");
  writeFileSync(attachmentPath, "roadmap bytes");

  await page.goto(localApp.url);
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByLabel("Project name").fill(projectTitle);
  await page.getByRole("button", { name: "Create project" }).click();

  await expect(page.getByRole("heading", { name: projectTitle })).toBeVisible();
  if (testInfo.project.name === "mobile-webkit") {
    await expect(
      page.getByRole("button", { name: "Back to projects" }),
    ).toBeFocused();
  }
  await page.getByLabel("Add a note").fill("Plain status");
  await page.getByRole("button", { name: /Add note/ }).click();
  await expect(page.getByText("Plain status")).toBeVisible();

  await page.getByLabel("Attach files").setInputFiles(attachmentPath);
  await expect(page.getByText("roadmap.txt")).toBeVisible();
  await page.getByLabel("Add a note").fill("Roadmap context");
  await page.getByRole("button", { name: /Add note/ }).click();

  await expect(page.getByText("Roadmap context")).toBeVisible();
  await expect(page.getByRole("button", { name: "Files 1" })).toBeVisible();
  await page.getByRole("button", { name: "Files 1" }).click();
  await expect(page.getByText("Plain status")).toBeHidden();
  await expect(page.getByText("Roadmap context")).toBeVisible();

  await expect(
    page.getByRole("button", { name: "Open roadmap.txt" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Show roadmap.txt in Folder" }),
  ).toBeVisible();
  const nativeActionReceiptOffset = localApp.nativeActionReceipts().length;
  const attachmentCard = page.locator(".attachment-card");
  await expect(attachmentCard).toHaveCount(1);
  expect(
    await attachmentCard.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);

  const beforeEdit = readAttachmentRow(
    localApp.dataDirectory,
    projectTitle,
    "roadmap.txt",
  );
  expect(beforeEdit.storagePath).toMatch(
    /^attachments\/v1\/[^/]+\/[^/]+\/roadmap\.txt$/,
  );
  const managedPath = realpathSync(
    join(localApp.dataDirectory, beforeEdit.storagePath),
  );
  const containingDirectory = realpathSync(dirname(managedPath));

  await page.getByRole("button", { name: "Open roadmap.txt" }).click();
  await expect
    .poll(() =>
      localApp.nativeActionReceipts().slice(nativeActionReceiptOffset),
    )
    .toEqual([{ action: "open", path: managedPath }]);
  await page
    .getByRole("button", { name: "Show roadmap.txt in Folder" })
    .click();
  await expect
    .poll(() =>
      localApp.nativeActionReceipts().slice(nativeActionReceiptOffset),
    )
    .toEqual([
      { action: "open", path: managedPath },
      {
        action: "reveal",
        path: managedPath,
        containingDirectory,
      },
    ]);

  const editedContent = "externally edited roadmap bytes";
  const editedByteSize = Buffer.byteLength(editedContent);
  const editedTime = new Date(
    Math.max(Date.now() + 5_000, beforeEdit.modifiedAt + 5_000),
  );
  writeFileSync(managedPath, editedContent);
  utimesSync(managedPath, editedTime, editedTime);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));

  await expect(attachmentCard.locator("small")).toContainText(
    `${editedByteSize} B`,
  );
  await expect
    .poll(
      () =>
        readAttachmentRow(localApp.dataDirectory, projectTitle, "roadmap.txt")
          .byteSize,
    )
    .toBe(editedByteSize);
  const afterFocus = readAttachmentRow(
    localApp.dataDirectory,
    projectTitle,
    "roadmap.txt",
  );
  expect(afterFocus.id).toBe(beforeEdit.id);
  expect(afterFocus.noteId).toBe(beforeEdit.noteId);
  expect(afterFocus.storagePath).toBe(beforeEdit.storagePath);
  expect(afterFocus.modifiedAt).toBeGreaterThan(beforeEdit.modifiedAt);
  expect(readFileSync(managedPath, "utf8")).toBe(editedContent);
  const afterFocusResponse = await page.request.get(
    `${localApp.url}/api/chats/${encodeURIComponent(afterFocus.chatId)}`,
  );
  expect(afterFocusResponse.ok()).toBe(true);
  const afterFocusDetail = (await afterFocusResponse.json()) as {
    notes: Array<{
      attachments?: Array<{
        id: string;
        byteSize: number;
        modifiedAt: number;
        status: string;
      }>;
    }>;
  };
  expect(
    afterFocusDetail.notes
      .flatMap((note) => note.attachments ?? [])
      .find((attachment) => attachment.id === afterFocus.id),
  ).toMatchObject({
    id: beforeEdit.id,
    byteSize: editedByteSize,
    modifiedAt: afterFocus.modifiedAt,
    status: "available",
  });

  await localApp.restart();
  await page.goto(localApp.url);
  await page.getByRole("button", { name: `Open ${projectTitle}` }).click();
  await expect(page.getByText("Roadmap context")).toBeVisible();
  await expect(page.getByText("roadmap.txt")).toBeVisible();
  await expect(page.locator(".attachment-card small")).toContainText(
    `${editedByteSize} B`,
  );
  expect(
    readAttachmentRow(localApp.dataDirectory, projectTitle, "roadmap.txt"),
  ).toEqual(afterFocus);
  expect(readFileSync(managedPath, "utf8")).toBe(editedContent);
  await expect(
    page.getByRole("button", { name: "Open roadmap.txt" }),
  ).toBeEnabled();
  expect(
    localApp.nativeActionReceipts().slice(nativeActionReceiptOffset),
  ).toHaveLength(2);
});

test("configures, applies, filters, and retains project message labels", async ({
  page,
  localApp,
}, testInfo) => {
  const suffix = `${viewportName(testInfo.project.name)}-${Date.now()}`;
  const projectTitle = `Labels ${suffix}`;

  await page.goto(localApp.url);
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByLabel("Project name").fill(projectTitle);
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByLabel("Add a note").fill("Escalate the rollout risk");
  await page.getByRole("button", { name: /Add note/ }).click();

  await expect(page.getByRole("button", { name: "Todo 0" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Milestone 0" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Risk/ })).toHaveCount(0);
  const filesFilter = page.getByRole("button", { name: "Files 0" });
  await expect(filesFilter.locator(".history-filter-icon svg")).toBeVisible();
  await expect(filesFilter.locator(".history-filter-count")).toHaveText("0");

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(
    page.getByRole("group", { name: "Project labels" }),
  ).toBeVisible();
  await page.getByRole("checkbox", { name: "Risk" }).check();
  await page.getByRole("button", { name: "Save changes" }).click();

  const message = page.locator(".message-row").first();
  await message.getByRole("button", { name: "Change labels" }).click();
  await message.getByRole("checkbox", { name: "Pin" }).click();
  await expect(message.getByRole("checkbox", { name: "Pin" })).toBeChecked();
  await message.getByRole("checkbox", { name: "Attention" }).click();
  await expect(
    message.getByRole("checkbox", { name: "Attention" }),
  ).toBeChecked();
  await message.getByRole("checkbox", { name: "Risk" }).click();
  await expect(message.getByRole("checkbox", { name: "Risk" })).toBeChecked();
  const pinLabel = message.locator('.message-label[data-label="pin"]');
  const attentionLabel = message.locator(
    '.message-label[data-label="attention"]',
  );
  await expect(pinLabel).toBeVisible();
  await expect(pinLabel).toHaveAttribute("aria-label", "Pin");
  await expect(pinLabel).toHaveText("");
  await expect(attentionLabel).toHaveAttribute("aria-label", "Attention");
  await expect(attentionLabel).toHaveText("🔴");
  await expect(
    message.locator('.message-label[data-label="risk"]'),
  ).toContainText("⚠️Risk");
  await expect(page.getByRole("button", { name: "Pin 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Attention 1" })).toContainText(
    "Alert",
  );
  await expect(page.getByRole("button", { name: "Risk 1" })).toBeVisible();
  await page.getByRole("button", { name: "Risk 1" }).click();
  await expect(page.getByText("Escalate the rollout risk")).toBeVisible();

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("checkbox", { name: "Risk" }).uncheck();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("button", { name: /Risk/ })).toHaveCount(0);
  await expect(
    message.locator('.message-label[data-label="risk"]'),
  ).toBeVisible();
  await message.getByRole("button", { name: "Change labels" }).click();
  await expect(
    message.getByRole("checkbox", { name: "Risk (inactive)" }),
  ).toBeChecked();

  await localApp.restart();
  await page.goto(localApp.url);
  await page.getByRole("button", { name: `Open ${projectTitle}` }).click();
  await expect(page.getByRole("button", { name: "Pin 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Risk/ })).toHaveCount(0);
  await expect(page.locator('.message-label[data-label="risk"]')).toBeVisible();
  await page.getByRole("button", { name: "Change labels" }).click();
  await expect(
    page.getByRole("checkbox", { name: "Risk (inactive)" }),
  ).toBeChecked();
  await page.mouse.move(1, 1);
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await expect(page.locator(".message-actions").first()).toHaveCSS(
    "opacity",
    "1",
  );
  await page.screenshot({
    path: testInfo.outputPath("labels-workspace.png"),
    fullPage: true,
  });
});

test("keeps project and note collections inside their own scroll panes", async ({
  page,
  request,
  localApp,
}, testInfo) => {
  const compact = testInfo.project.name === "mobile-webkit";
  await page.setViewportSize(
    compact ? { width: 390, height: 560 } : { width: 1440, height: 620 },
  );

  const suffix = `${viewportName(testInfo.project.name)}-${Date.now()}`;
  let targetProject = { id: "", title: "" };
  for (let index = 1; index <= 18; index += 1) {
    const project = await createProject(page.request, localApp.url, {
      title: `Overflow ${suffix} ${String(index).padStart(2, "0")}`,
      accent: index % 2 === 0 ? "ocean" : "moss",
    });
    if (index === 18) targetProject = project;
  }
  for (let index = 1; index <= 24; index += 1) {
    await addNote(
      request,
      localApp.url,
      targetProject.id,
      `Long scrolling note ${index}. ${"This note is intentionally long enough to occupy vertical space. ".repeat(2)}`,
    );
  }

  await page.goto(localApp.url);
  await expect(
    page.getByRole("heading", { name: "Choose a project to continue." }),
  ).toBeVisible({ visible: !compact });

  const railBefore = await page.evaluate(() => {
    const railHeader = document.querySelector(".rail-header")!;
    const sectionLabel = document.querySelector(".rail-section-label")!;
    const list = document.querySelector(".project-list")!;
    const footer = document.querySelector(".local-footnote")!;
    const toBox = (element: Element): Box => {
      const rect = element.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        width: rect.width,
      };
    };
    const toScroll = (element: Element): ScrollMetrics => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      top: element.getBoundingClientRect().top,
      bottom: element.getBoundingClientRect().bottom,
    });
    return {
      viewportHeight: window.innerHeight,
      documentHeight: document.documentElement.scrollHeight,
      bodyHeight: document.body.scrollHeight,
      header: toBox(railHeader),
      label: toBox(sectionLabel),
      list: toScroll(list),
      footer: toBox(footer),
    };
  });
  expect(railBefore.list.scrollHeight).toBeGreaterThan(
    railBefore.list.clientHeight,
  );
  expect(railBefore.documentHeight).toBeLessThanOrEqual(
    railBefore.viewportHeight + 2,
  );
  expect(railBefore.bodyHeight).toBeLessThanOrEqual(
    railBefore.viewportHeight + 2,
  );
  expect(railBefore.header.top).toBeGreaterThanOrEqual(0);
  expect(railBefore.footer.bottom).toBeLessThanOrEqual(
    railBefore.viewportHeight + 1,
  );

  const railAfter = await page.evaluate(() => {
    const list = document.querySelector(".project-list")!;
    list.scrollTop = list.scrollHeight;
    const railHeader = document.querySelector(".rail-header")!;
    const sectionLabel = document.querySelector(".rail-section-label")!;
    const footer = document.querySelector(".local-footnote")!;
    return {
      headerTop: railHeader.getBoundingClientRect().top,
      labelTop: sectionLabel.getBoundingClientRect().top,
      footerBottom: footer.getBoundingClientRect().bottom,
    };
  });
  expect(railAfter.headerTop).toBeCloseTo(railBefore.header.top, 0);
  expect(railAfter.labelTop).toBeCloseTo(railBefore.label.top, 0);
  expect(railAfter.footerBottom).toBeCloseTo(railBefore.footer.bottom, 0);

  await page
    .getByRole("button", { name: `Open ${targetProject.title}` })
    .click();
  await expect(
    page.getByRole("heading", { name: targetProject.title }),
  ).toBeVisible();

  const workspaceBefore = await page.evaluate(() => {
    const chatHeader = document.querySelector(".chat-header")!;
    const history = document.querySelector(".history")!;
    const composer = document.querySelector(".composer-wrap")!;
    const toBox = (element: Element): Box => {
      const rect = element.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        width: rect.width,
      };
    };
    const toScroll = (element: Element): ScrollMetrics => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      top: element.getBoundingClientRect().top,
      bottom: element.getBoundingClientRect().bottom,
    });
    return {
      viewportHeight: window.innerHeight,
      documentHeight: document.documentElement.scrollHeight,
      bodyHeight: document.body.scrollHeight,
      header: toBox(chatHeader),
      history: toScroll(history),
      composer: toBox(composer),
    };
  });
  expect(workspaceBefore.history.scrollHeight).toBeGreaterThan(
    workspaceBefore.history.clientHeight,
  );
  expect(workspaceBefore.documentHeight).toBeLessThanOrEqual(
    workspaceBefore.viewportHeight + 2,
  );
  expect(workspaceBefore.bodyHeight).toBeLessThanOrEqual(
    workspaceBefore.viewportHeight + 2,
  );
  expect(workspaceBefore.header.top).toBeGreaterThanOrEqual(0);
  expect(workspaceBefore.composer.bottom).toBeLessThanOrEqual(
    workspaceBefore.viewportHeight + 1,
  );

  const workspaceAfter = await page.evaluate(() => {
    const history = document.querySelector(".history")!;
    history.scrollTop = history.scrollHeight;
    const chatHeader = document.querySelector(".chat-header")!;
    const composer = document.querySelector(".composer-wrap")!;
    const lastMessage = [...document.querySelectorAll(".message-row")].at(-1)!;
    return {
      headerTop: chatHeader.getBoundingClientRect().top,
      composerBottom: composer.getBoundingClientRect().bottom,
      historyBottom: history.getBoundingClientRect().bottom,
      lastMessageBottom: lastMessage.getBoundingClientRect().bottom,
    };
  });
  expect(workspaceAfter.headerTop).toBeCloseTo(workspaceBefore.header.top, 0);
  expect(workspaceAfter.composerBottom).toBeCloseTo(
    workspaceBefore.composer.bottom,
    0,
  );
  expect(workspaceAfter.lastMessageBottom).toBeLessThanOrEqual(
    workspaceAfter.historyBottom + 1,
  );
});
