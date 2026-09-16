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
): Promise<{ id: string }> {
  const response = await request.post(`${url}/api/chats/${chatId}/notes`, {
    multipart: {
      body,
      ...(createdAt === undefined ? {} : { createdAt: String(createdAt) }),
    },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()) as { id: string };
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
  const timestampLayout = await page.evaluate(() => {
    const row = document.querySelector(".composer-timestamp-row")!;
    const label = row.querySelector("label")!;
    const input = row.querySelector("input")!;
    const rowBox = row.getBoundingClientRect();
    const labelBox = label.getBoundingClientRect();
    const inputBox = input.getBoundingClientRect();
    return {
      rowHeight: rowBox.height,
      inputHeight: inputBox.height,
      labelCenter: labelBox.top + labelBox.height / 2,
      inputCenter: inputBox.top + inputBox.height / 2,
    };
  });
  expect(timestampLayout.rowHeight).toBeLessThanOrEqual(46);
  expect(timestampLayout.inputHeight).toBeLessThanOrEqual(34);
  expect(timestampLayout.labelCenter).toBeCloseTo(
    timestampLayout.inputCenter,
    0,
  );
  await page.getByLabel("Message timestamp").fill("2026-08-30T10:15");
  await page.getByRole("button", { name: /Add note/ }).click();
  await expect(
    page
      .locator(".message-list")
      .getByText("Ship the smallest useful workflow."),
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
    page
      .locator(".message-list")
      .getByText("Ship the smallest useful workflow."),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("workspace.png"),
    fullPage: true,
  });
  expect([...unexpectedHosts]).toEqual([]);
});

test("pins projects and scans previews with Attention status", async ({
  page,
  request,
  localApp,
}, testInfo) => {
  const suffix = `${viewportName(testInfo.project.name)}-${Date.now()}`;
  const pinned = await createProject(request, localApp.url, {
    title: `Pinned ${suffix}`,
    accent: "coral",
  });
  const current = await createProject(request, localApp.url, {
    title: `Current alert ${suffix}`,
    accent: "ocean",
  });
  const earlier = await createProject(request, localApp.url, {
    title: `Earlier alert ${suffix}`,
    accent: "moss",
  });
  await addNote(
    request,
    localApp.url,
    pinned.id,
    "A deliberately long latest message preview that should remain on one line and end with a width-aware ellipsis in the compact project rail.",
  );
  const currentNote = await addNote(
    request,
    localApp.url,
    current.id,
    "Needs attention today",
  );
  const earlierNote = await addNote(
    request,
    localApp.url,
    earlier.id,
    "Needed attention earlier",
    Date.now() - 86_400_000,
  );
  expect(
    (
      await request.put(
        `${localApp.url}/api/chats/${current.id}/notes/${currentNote.id}/labels/attention`,
      )
    ).ok(),
  ).toBe(true);
  expect(
    (
      await request.put(
        `${localApp.url}/api/chats/${earlier.id}/notes/${earlierNote.id}/labels/attention`,
      )
    ).ok(),
  ).toBe(true);
  expect(
    (await request.put(`${localApp.url}/api/chats/${pinned.id}/pin`)).ok(),
  ).toBe(true);

  await page.goto(localApp.url);
  const pinnedSection = page.locator(".project-section", {
    hasText: "Pinned",
  });
  await expect(pinnedSection).toContainText(pinned.title);
  await expect(
    page.getByRole("button", { name: `Pin ${pinned.title}` }),
  ).toHaveAttribute("aria-pressed", "true");
  const pinnedControl = page.getByRole("button", {
    name: `Pin ${pinned.title}`,
  });
  await page.mouse.move(1, 1);
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  if (testInfo.project.name === "mobile-webkit") {
    await expect(pinnedControl).toHaveCSS("opacity", "1");
  } else {
    await expect(pinnedControl).toHaveCSS("opacity", "0");
    await pinnedControl.focus();
    await expect(pinnedControl).toHaveCSS("opacity", "1");
    await page.mouse.move(1, 1);
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await expect(pinnedControl).toHaveCSS("opacity", "0");
    await page
      .getByRole("button", { name: `Open ${pinned.title}` })
      .locator("..")
      .hover();
    await expect(pinnedControl).toHaveCSS("opacity", "1");
  }
  await expect(
    page.getByRole("button", { name: `Open ${current.title}` }).locator(".."),
  ).toHaveAttribute("data-attention-state", "today");
  await expect(
    page.getByRole("button", { name: `Open ${earlier.title}` }).locator(".."),
  ).toHaveAttribute("data-attention-state", "earlier");
  expect(
    await page
      .getByRole("button", { name: `Open ${pinned.title}` })
      .locator("small")
      .evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(true);

  const currentPin = page.getByRole("button", {
    name: `Pin ${current.title}`,
  });
  await currentPin.click();
  await expect(currentPin).toHaveAttribute("aria-pressed", "true");
  await expect(currentPin).toBeFocused();
  await expect(pinnedSection).toContainText(current.title);
  await currentPin.click();
  await expect(currentPin).toHaveAttribute("aria-pressed", "false");
  await expect(
    page.locator(".project-section", { hasText: "Projects" }),
  ).toContainText(current.title);

  await localApp.restart();
  await page.goto(localApp.url);
  await expect(
    page.getByRole("button", { name: `Pin ${pinned.title}` }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: `Pin ${current.title}` }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".project-dot, .project-arrow")).toHaveCount(0);

  await page.screenshot({
    path: testInfo.outputPath("project-sidebar.png"),
    fullPage: true,
  });
});

test("collapses long messages using the persisted project default", async ({
  page,
  request,
  localApp,
}, testInfo) => {
  const suffix = `${viewportName(testInfo.project.name)}-${Date.now()}`;
  const project = await createProject(request, localApp.url, {
    title: `Long messages ${suffix}`,
    accent: "ocean",
  });
  const body = [
    "## Weekly research summary",
    "[Visible reference](https://example.com/visible)",
    ...Array.from(
      { length: 18 },
      (_, index) =>
        `Paragraph ${index + 1}: the project history remains compact until the reader asks for the full context.`,
    ),
    "[Clipped reference](https://example.com/clipped)",
  ].join("\n\n");
  await addNote(request, localApp.url, project.id, body);

  await page.goto(localApp.url);
  await page.getByRole("button", { name: `Open ${project.title}` }).click();
  const showMore = page.getByRole("button", { name: "Show more" });
  const viewport = page.locator(".message-body-viewport");
  const visibleLink = page.getByRole("link", { name: "Visible reference" });
  const clippedLink = page.getByRole("link", { name: "Clipped reference" });
  await expect(showMore).toHaveAttribute("aria-expanded", "false");
  await expect(viewport).toHaveClass(/message-body-viewport--collapsed/);
  await expect(showMore).toHaveCSS("padding-left", "0px");
  await expect(showMore).toHaveCSS("border-radius", "0px");
  await showMore.hover();
  await expect(showMore).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(visibleLink).not.toHaveAttribute("tabindex", "-1");
  await expect(clippedLink).toHaveAttribute("tabindex", "-1");
  const collapsedHeight = await viewport.evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  expect(collapsedHeight).toBeCloseTo(192, 0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("long-message-collapsed.png"),
    fullPage: true,
  });

  await showMore.click();
  const showLess = page.getByRole("button", { name: "Show less" });
  await expect(showLess).toHaveAttribute("aria-expanded", "true");
  await expect(viewport).not.toHaveClass(/message-body-viewport--collapsed/);
  await expect(visibleLink).not.toHaveAttribute("tabindex", "-1");
  await expect(clippedLink).not.toHaveAttribute("tabindex", "-1");
  expect(
    await viewport.evaluate(
      (element) => element.getBoundingClientRect().height,
    ),
  ).toBeGreaterThan(collapsedHeight);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const collapseDefault = page.getByRole("checkbox", {
    name: "Collapse long messages by default",
  });
  await expect(collapseDefault).toBeChecked();
  await collapseDefault.uncheck();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("button", { name: "Show less" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );

  await localApp.restart();
  await page.goto(localApp.url);
  await page.getByRole("button", { name: `Open ${project.title}` }).click();
  await expect(page.getByRole("button", { name: "Show less" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await page.screenshot({
    path: testInfo.outputPath("long-message-expanded.png"),
    fullPage: true,
  });
});

test("keeps labels visible and attachments full width in wide messages", async ({
  page,
  request,
  localApp,
}, testInfo) => {
  const suffix = `${viewportName(testInfo.project.name)}-${Date.now()}`;
  const project = await createProject(request, localApp.url, {
    title: `Wide message layout ${suffix}`,
    accent: "ocean",
  });
  const body =
    "**Lorem Ipsum** is simply dummy text of the printing and typesetting industry. Lorem Ipsum has been the industry's standard dummy text ever since 1966, when designers at Letraset and James Mosley, the librarian at St Bride Printing Library in London, took a 1914 Cicero translation and scrambled it to make dummy text for Letraset's Body Type sheets. It has survived not only many decades, but also the leap into electronic typesetting, remaining essentially unchanged. It was popularised thanks to these sheets and more recently with desktop publishing software like Aldus PageMaker and Microsoft Word including versions of Lorem Ipsum.";

  await page.goto(localApp.url);
  await page.getByRole("button", { name: `Open ${project.title}` }).click();
  await page.getByLabel("Attach files").setInputFiles([
    {
      name: "research-notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("research notes"),
    },
    {
      name: "source-summary.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("source summary"),
    },
  ]);
  await page.getByLabel("Add a note").fill(body);
  await page.getByRole("button", { name: /Add note/ }).click();

  const message = page.locator(".message-row").last();
  await expect(message.locator(".attachment-card")).toHaveCount(2);
  await message.hover();
  await message.getByRole("button", { name: "Change labels" }).click();
  const popover = message.locator(".message-label-popover");
  await expect(popover).toBeVisible();
  await message
    .getByRole("checkbox", { name: "Todo" })
    .scrollIntoViewIfNeeded();

  const readGeometry = () =>
    message.evaluate((element) => {
      const history = element.closest(".history")!;
      const bubble = element.querySelector<HTMLElement>(".message-bubble")!;
      const attachment =
        element.querySelector<HTMLElement>(".attachment-list")!;
      const labelPopover = element.querySelector<HTMLElement>(
        ".message-label-popover",
      )!;
      const bubbleStyle = getComputedStyle(bubble);
      const box = (target: Element) => {
        const rect = target.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          width: rect.width,
        };
      };
      return {
        history: box(history),
        bubble: box(bubble),
        attachment: box(attachment),
        popover: box(labelPopover),
        bubblePaddingLeft: Number.parseFloat(bubbleStyle.paddingLeft),
        bubblePaddingRight: Number.parseFloat(bubbleStyle.paddingRight),
        documentFits: document.documentElement.scrollWidth <= window.innerWidth,
      };
    });
  const geometry = await readGeometry();

  if (testInfo.project.name === "desktop-chromium") {
    expect(geometry.attachment.width).toBeGreaterThan(460);
  }
  expect
    .soft(geometry.popover.left)
    .toBeGreaterThanOrEqual(geometry.history.left - 1);
  expect(geometry.popover.right).toBeLessThanOrEqual(
    geometry.history.right + 1,
  );
  expect
    .soft(
      Math.abs(
        geometry.attachment.left -
          (geometry.bubble.left + geometry.bubblePaddingLeft),
      ),
    )
    .toBeLessThanOrEqual(2);
  expect
    .soft(
      Math.abs(
        geometry.attachment.right -
          (geometry.bubble.right - geometry.bubblePaddingRight),
      ),
    )
    .toBeLessThanOrEqual(2);
  expect(geometry.documentFits).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("wide-message-layout.png"),
    fullPage: true,
  });
  if (testInfo.project.name === "desktop-chromium") {
    await page.setViewportSize({ width: 1024, height: 768 });
    const intermediateGeometry = await readGeometry();
    expect(intermediateGeometry.popover.left).toBeGreaterThanOrEqual(
      intermediateGeometry.history.left - 1,
    );
    expect(intermediateGeometry.popover.right).toBeLessThanOrEqual(
      intermediateGeometry.history.right + 1,
    );
    expect(
      Math.abs(
        intermediateGeometry.attachment.left -
          (intermediateGeometry.bubble.left +
            intermediateGeometry.bubblePaddingLeft),
      ),
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(
        intermediateGeometry.attachment.right -
          (intermediateGeometry.bubble.right -
            intermediateGeometry.bubblePaddingRight),
      ),
    ).toBeLessThanOrEqual(2);
    expect(intermediateGeometry.documentFits).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("wide-message-layout-1024.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 800, height: 768 });
    await message
      .getByRole("checkbox", { name: "Milestone" })
      .scrollIntoViewIfNeeded();
    const narrowDesktopGeometry = await readGeometry();
    expect(narrowDesktopGeometry.popover.left).toBeGreaterThanOrEqual(
      narrowDesktopGeometry.history.left - 1,
    );
    expect(narrowDesktopGeometry.popover.right).toBeLessThanOrEqual(
      narrowDesktopGeometry.history.right + 1,
    );
    expect(
      Math.abs(
        narrowDesktopGeometry.attachment.left -
          (narrowDesktopGeometry.bubble.left +
            narrowDesktopGeometry.bubblePaddingLeft),
      ),
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(
        narrowDesktopGeometry.attachment.right -
          (narrowDesktopGeometry.bubble.right -
            narrowDesktopGeometry.bubblePaddingRight),
      ),
    ).toBeLessThanOrEqual(2);
    expect(narrowDesktopGeometry.documentFits).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("wide-message-layout-800.png"),
      fullPage: true,
    });
  } else {
    await page.setViewportSize({ width: 320, height: 700 });
    await message
      .getByRole("checkbox", { name: "Milestone" })
      .scrollIntoViewIfNeeded();
    const minimumWidthGeometry = await readGeometry();
    expect(minimumWidthGeometry.popover.left).toBeGreaterThanOrEqual(
      minimumWidthGeometry.history.left - 1,
    );
    expect(minimumWidthGeometry.popover.right).toBeLessThanOrEqual(
      minimumWidthGeometry.history.right + 1,
    );
    expect(
      Math.abs(
        minimumWidthGeometry.attachment.left -
          (minimumWidthGeometry.bubble.left +
            minimumWidthGeometry.bubblePaddingLeft),
      ),
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(
        minimumWidthGeometry.attachment.right -
          (minimumWidthGeometry.bubble.right -
            minimumWidthGeometry.bubblePaddingRight),
      ),
    ).toBeLessThanOrEqual(2);
    expect(minimumWidthGeometry.documentFits).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("wide-message-layout-320.png"),
      fullPage: true,
    });
  }

  const deleteResponse = await request.delete(
    `${localApp.url}/api/chats/${project.id}`,
  );
  expect(deleteResponse.ok()).toBe(true);
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
  expect(geometry.composer.height).toBeLessThanOrEqual(116);
  expect(geometry.history.height).toBeGreaterThanOrEqual(628);
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
  await expect(composer).toHaveCSS("overflow-y", "hidden");
  await composer.fill("One\nTwo\nThree\nFour\nFive\nSix\nSeven\nEight\nNine");
  await expect(composer).toHaveCSS("overflow-y", "auto");
  const cappedHeight = await composer.evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  expect(cappedHeight).toBe(216);

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

test("attributes participant messages with the compact desktop sender control", async ({
  page,
  request,
  localApp,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium");

  const project = await createProject(request, localApp.url, {
    title: "Participant attribution",
    accent: "ocean",
  });
  await page.goto(localApp.url);
  await page.getByRole("button", { name: `Open ${project.title}` }).click();

  const senderToggle = page.getByRole("button", {
    name: "Show sender options. Current sender: You",
  });
  await senderToggle.click();
  const senderRow = page.getByRole("group", { name: "Message sender" });
  const senderInput = senderRow.getByRole("textbox", { name: "Sender name" });
  const senderGeometry = await page.evaluate(() => ({
    trigger: document
      .querySelector<HTMLButtonElement>(
        '.composer-icon-button[aria-label="Hide sender options. Current sender: You"]',
      )!
      .getBoundingClientRect().height,
    row: document
      .querySelector<HTMLElement>(".composer-sender-row")!
      .getBoundingClientRect().height,
  }));
  expect(senderGeometry.trigger).toBeLessThanOrEqual(36);
  expect(senderGeometry.row).toBeLessThanOrEqual(46);

  await senderInput.fill("Maya Chen");
  await page.getByLabel("Add a note").fill("Maya's first update");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(senderInput).toHaveValue("Maya Chen");
  await page.getByLabel("Add a note").fill("Maya's second update");
  await page.getByRole("button", { name: "Add note" }).click();

  await senderInput.fill("Omar Haddad");
  await page.getByLabel("Add a note").fill("Omar's update");
  await page.getByRole("button", { name: "Add note" }).click();

  const participantRows = page.locator(".message-row--participant");
  await expect(participantRows).toHaveCount(3);
  const participantPresentation = await page.evaluate(() => {
    const rows = [
      ...document.querySelectorAll<HTMLElement>(".message-row--participant"),
    ];
    return rows.map((row) => {
      const bubble = row.querySelector<HTMLElement>(".message-bubble")!;
      const sender = row.querySelector<HTMLElement>(".message-sender")!;
      const actions = row.querySelector<HTMLElement>(".message-actions")!;
      return {
        bubbleRight: bubble.getBoundingClientRect().right,
        actionLeft: actions.getBoundingClientRect().left,
        bubbleColor: getComputedStyle(bubble).backgroundColor,
        senderColor: getComputedStyle(sender).color,
      };
    });
  });
  expect(participantPresentation[0]!.actionLeft).toBeGreaterThanOrEqual(
    participantPresentation[0]!.bubbleRight,
  );
  expect(
    new Set(participantPresentation.map((item) => item.bubbleColor)),
  ).toEqual(new Set([participantPresentation[0]!.bubbleColor]));
  expect(participantPresentation[0]!.senderColor).toBe(
    participantPresentation[1]!.senderColor,
  );
  expect(participantPresentation[0]!.senderColor).not.toBe(
    participantPresentation[2]!.senderColor,
  );
  await page.screenshot({
    path: testInfo.outputPath("participant-attribution.png"),
    fullPage: true,
  });

  const firstMaya = participantRows.filter({ hasText: "Maya's first update" });
  await firstMaya.getByRole("button", { name: "Change labels" }).click();
  const todo = firstMaya.getByRole("checkbox", { name: "Todo" });
  await todo.click();
  await expect(todo).toBeChecked();
  await page.getByRole("button", { name: "Todo 1" }).click();
  await expect(firstMaya).toBeVisible();
  await expect(
    page.locator(".message-list").getByText("Omar's update"),
  ).toBeHidden();

  await firstMaya.getByRole("button", { name: "Edit message" }).click();
  await page.getByRole("button", { name: "You" }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(
    page.locator(".message-row--own", { hasText: "Maya's first update" }),
  ).toBeVisible();
  await expect(page.locator(".message-avatar")).toHaveCount(0);

  await page.getByRole("button", { name: /^All / }).click();
  await page.setViewportSize({ width: 800, height: 720 });
  await senderInput.fill("M".repeat(80));
  await page.getByLabel("Add a note").fill("Long sender name");
  await page.getByRole("button", { name: "Add note" }).click();
  const longSenderRow = page.locator(".message-row--participant", {
    hasText: "Long sender name",
  });
  const longSenderGeometry = await longSenderRow.evaluate((row) => {
    const bubble = row.querySelector<HTMLElement>(".message-bubble")!;
    const sender = row.querySelector<HTMLElement>(".message-sender")!;
    const bubbleRect = bubble.getBoundingClientRect();
    const senderRect = sender.getBoundingClientRect();
    return {
      bubbleLeft: bubbleRect.left,
      bubbleRight: bubbleRect.right,
      senderLeft: senderRect.left,
      senderRight: senderRect.right,
      senderClientWidth: sender.clientWidth,
      senderScrollWidth: sender.scrollWidth,
    };
  });
  expect(longSenderGeometry.senderLeft).toBeGreaterThanOrEqual(
    longSenderGeometry.bubbleLeft,
  );
  expect(longSenderGeometry.senderRight).toBeLessThanOrEqual(
    longSenderGeometry.bubbleRight,
  );
  expect(longSenderGeometry.senderScrollWidth).toBeLessThanOrEqual(
    longSenderGeometry.senderClientWidth,
  );

  await page.setViewportSize({ width: 640, height: 720 });
  const overflow = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(overflow.documentWidth).toBeLessThanOrEqual(overflow.viewportWidth);
});

test("formats Markdown selections in a compact, responsive composer strip", async ({
  page,
  request,
  localApp,
}, testInfo) => {
  const project = await createProject(request, localApp.url, {
    title: `Markdown assistance ${testInfo.project.name}`,
    accent: "iris",
  });

  await page.goto(localApp.url);
  await page.getByRole("button", { name: `Open ${project.title}` }).click();

  const composer = page.getByLabel("Add a note");
  await expect(
    page.getByRole("heading", { name: project.title }),
  ).toBeVisible();
  if (testInfo.project.name === "mobile-webkit") {
    await expect(
      page.getByRole("button", { name: "Back to projects" }),
    ).toBeFocused();
  }
  await composer.fill("Remember this");
  await composer.evaluate((element) => element.setSelectionRange(9, 13));

  const toggle = page.getByRole("button", {
    name: "Show Markdown assistance",
  });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();

  const tools = page.getByRole("group", { name: "Markdown assistance" });
  await expect(tools.getByRole("button")).toHaveCount(9);
  expect(
    await tools.evaluate((element) => element.getBoundingClientRect().height),
  ).toBeLessThanOrEqual(46);
  await page.screenshot({
    path: testInfo.outputPath("markdown-assistance-open.png"),
    fullPage: true,
  });

  await tools.getByRole("button", { name: /Bold/ }).click();
  await expect(composer).toHaveValue("Remember **this**");
  await expect(composer).toBeFocused();
  expect(
    await composer.evaluate((element) => [
      element.selectionStart,
      element.selectionEnd,
    ]),
  ).toEqual([11, 15]);

  if (testInfo.project.name === "desktop-chromium") {
    await composer.fill("one\ntwo");
    await composer.selectText();
    const primaryModifier = await page.evaluate(() =>
      /Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? "Meta" : "Control",
    );
    await composer.press(`${primaryModifier}+Shift+7`);
    await expect(composer).toHaveValue("1. one\n2. two");
  }

  await composer.fill("Quoted evidence");
  await composer.selectText();
  await tools.getByRole("button", { name: /Quote/ }).click();
  await tools.getByRole("button", { name: "Table" }).click();
  await page.getByRole("button", { name: /Add note/ }).click();

  await expect(page.locator(".message-bubble blockquote")).toContainText(
    "Quoted evidence",
  );
  await expect(page.locator(".message-bubble table")).toBeVisible();

  if (testInfo.project.name === "mobile-webkit") {
    await page.setViewportSize({ width: 320, height: 720 });
    await expect(
      page.getByRole("button", { name: /Edit message/ }),
    ).toBeVisible();
    await page.getByRole("button", { name: /Edit message/ }).click();
    await expect(
      page.getByRole("group", { name: "Markdown assistance" }),
    ).toBeVisible();
    const mobileMetrics = await page.evaluate(() => {
      const strip = document.querySelector(".markdown-tools-scroll")!;
      const composer = document.querySelector(".composer")!;
      const composerRect = composer.getBoundingClientRect();
      const controls = Array.from(
        document.querySelectorAll<HTMLElement>(
          ".composer-bar button:not([hidden])",
        ),
      );
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        stripClientWidth: strip.clientWidth,
        stripScrollWidth: strip.scrollWidth,
        overflowCue: getComputedStyle(
          document.querySelector(".markdown-tools-strip")!,
          "::after",
        ).content,
        controlsFit: controls.every((control) => {
          const rect = control.getBoundingClientRect();
          return (
            rect.left >= composerRect.left && rect.right <= composerRect.right
          );
        }),
      };
    });
    expect(mobileMetrics.documentWidth).toBeLessThanOrEqual(
      mobileMetrics.viewportWidth,
    );
    expect(mobileMetrics.stripScrollWidth).toBeGreaterThan(
      mobileMetrics.stripClientWidth,
    );
    expect(mobileMetrics.controlsFit).toBe(true);
    expect(mobileMetrics.overflowCue).toBe('"›"');
    await page.screenshot({
      path: testInfo.outputPath("markdown-assistance-320.png"),
      fullPage: true,
    });
  }
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
  const projectButton = page.getByRole("button", {
    name: `Open ${project.title}`,
  });
  await expect(projectButton.locator("small")).toHaveText("Already happened");
  await expect(projectButton.locator("small")).not.toHaveText(
    "Scheduled for tomorrow",
  );
  await projectButton.click();

  const futureBoundary = page.getByRole("separator", {
    name: "Future messages",
  });
  await expect(futureBoundary).toBeAttached();
  await expect(
    page.locator(".message-list").getByText("Scheduled for tomorrow"),
  ).toBeVisible();
  await expect(
    page.locator(".message-list").getByText("Already happened"),
  ).toBeVisible();
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
  await page.getByRole("button", { name: /Backups/ }).click();
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
  await page.getByRole("button", { name: /Backups/ }).click();
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
  // Workers reuse a database across tests. Keep a second, same-named file in
  // this backup so the restore assertion must select its own project's bytes.
  const unrelatedProject = await createProject(request, localApp.url, {
    title: `Other backup source ${suffix}`,
    accent: "moss",
  });
  const unrelatedNote = await request.post(
    `${localApp.url}/api/chats/${unrelatedProject.id}/notes`,
    {
      multipart: {
        body: "Unrelated attachment",
        files: {
          name: "bundled-roadmap.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("unrelated sidecar bytes"),
        },
      },
    },
  );
  expect(unrelatedNote.ok()).toBe(true);
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
  await expect(page.locator(".message-list").getByText("Revised")).toBeHidden();

  const bundledAttachmentPath = testInfo.outputPath("bundled-roadmap.txt");
  writeFileSync(bundledAttachmentPath, "bundle sidecar bytes");
  // Exercise export after a slow upload, when the composer still shows the file.
  await page.route(
    `**/api/chats/${exportedProject.id}/notes`,
    async (route) => {
      if (route.request().method() === "POST") {
        await new Promise((resolve) => setTimeout(resolve, 750));
      }
      await route.continue();
    },
  );
  await page.getByLabel("Attach files").setInputFiles(bundledAttachmentPath);
  await page.getByLabel("Add a note").fill("Bundled attachment");
  await page.getByRole("button", { name: /Add note/ }).click();
  await expect(
    page.locator(".message-list").getByText("bundled-roadmap.txt"),
  ).toBeVisible();

  if (testInfo.project.name === "mobile-webkit") {
    await page.getByRole("button", { name: "Back to projects" }).click();
  }
  await page.getByRole("button", { name: /Settings/ }).click();
  await page.getByRole("button", { name: /Backups/ }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export all" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(
    /threadstr-\d{4}-\d{2}-\d{2}\.on-track-backup/,
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
  await page.getByRole("button", { name: /Backups/ }).click();
  await page
    .getByLabel("Choose threadstr backup")
    .setInputFiles(backupPath ?? "");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("radio", { name: "Replace whole DB" }).check();
  await page.getByRole("button", { name: /Replace with selected/ }).click();
  await expect(page.getByRole("status")).toContainText("restored");
  await page.getByRole("button", { name: "Back to projects" }).click();

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
    const paths = activeDatabase
      .prepare(
        `SELECT attachment.storage_path
        FROM note_attachments attachment
        JOIN notes note ON note.id = attachment.note_id
        WHERE note.chat_id = ? AND attachment.filename = ?`,
      )
      .pluck()
      .all(exportedProject.id, "bundled-roadmap.txt") as string[];
    expect(paths).toHaveLength(1);
    const [storagePath] = paths;
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
  await expect(
    page.locator(".message-list").getByText("Plain status"),
  ).toBeVisible();

  await page.getByLabel("Attach files").setInputFiles(attachmentPath);
  await expect(page.getByText("roadmap.txt")).toBeVisible();
  await page.getByLabel("Add a note").fill("Roadmap context");
  await page.getByRole("button", { name: /Add note/ }).click();

  await expect(
    page.locator(".message-list").getByText("Roadmap context"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Files 1" })).toBeVisible();
  await page.getByRole("button", { name: "Files 1" }).click();
  await expect(
    page.locator(".message-list").getByText("Plain status"),
  ).toBeHidden();
  await expect(
    page.locator(".message-list").getByText("Roadmap context"),
  ).toBeVisible();

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
  await expect(
    page.locator(".message-list").getByText("Roadmap context"),
  ).toBeVisible();
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
  await expect(page.getByRole("heading", { name: projectTitle })).toBeVisible();
  if (testInfo.project.name === "mobile-webkit") {
    await expect(
      page.getByRole("button", { name: "Back to projects" }),
    ).toBeFocused();
  }
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
  await expect(pinLabel).toHaveCSS("border-top-width", "0px");
  await expect(attentionLabel).toHaveAttribute("aria-label", "Attention");
  await expect(attentionLabel).toHaveText("");
  await expect(attentionLabel).toHaveCSS("border-top-width", "0px");
  await expect(attentionLabel.locator(".attention-dot--today")).toBeVisible();
  await expect(
    message.locator('.message-label[data-label="risk"]'),
  ).toContainText("⚠️Risk");
  await expect(page.getByRole("button", { name: "Pin 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Attention 1" })).toContainText(
    "Alert",
  );
  await expect(page.getByRole("button", { name: "Risk 1" })).toBeVisible();
  await page.getByRole("button", { name: "Risk 1" }).click();
  await expect(
    page.locator(".message-list").getByText("Escalate the rollout risk"),
  ).toBeVisible();

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
  expect(railAfter.labelTop).toBeLessThan(railBefore.label.top);
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

test("opens near current work and restores each chat reading position", async ({
  page,
  request,
  localApp,
}, testInfo) => {
  const project = await createProject(request, localApp.url, {
    title: "Reading position",
    accent: "ocean",
  });
  const other = await createProject(request, localApp.url, {
    title: "Other reading",
    accent: "moss",
  });
  const now = Date.now();
  for (let index = 0; index < 20; index += 1) {
    await addNote(
      request,
      localApp.url,
      project.id,
      `Past context ${index}. ${index === 10 ? "Long context paragraph.\n\n".repeat(90) : "Earlier work context. ".repeat(8)}`,
      now - (20 - index) * 60_000,
    );
  }
  for (let index = 0; index < 8; index += 1) {
    await addNote(
      request,
      localApp.url,
      project.id,
      `Future task ${index}. ${"Next work context. ".repeat(4)}`,
      now + (index + 1) * 86_400_000,
    );
  }
  for (let index = 0; index < 15; index += 1) {
    await addNote(
      request,
      localApp.url,
      other.id,
      `Other past ${index}. ${"Context. ".repeat(20)}`,
      now - (15 - index) * 60_000,
    );
  }
  const goHome = async () => {
    if (testInfo.project.name === "mobile-webkit")
      await page.getByRole("button", { name: "Back to projects" }).click();
    else await page.getByRole("link", { name: "Home", exact: true }).click();
  };
  await page.goto(localApp.url);
  await page.getByRole("button", { name: `Open ${project.title}` }).click();
  const history = page.locator(".history");
  const initialGeometry = () =>
    history.evaluate((element) => {
      const rows = [...element.querySelectorAll<HTMLElement>(".message-row")];
      const first = rows
        .find((row) => row.textContent?.includes("Future task 0"))!
        .getBoundingClientRect();
      const second = rows
        .find((row) => row.textContent?.includes("Future task 1"))!
        .getBoundingClientRect();
      const lastPast = rows
        .find((row) => row.textContent?.includes("Past context 19"))!
        .getBoundingClientRect();
      const box = element.getBoundingClientRect();
      return {
        scrollTop: element.scrollTop,
        firstBottom: first.bottom,
        secondTop: second.top,
        pastBottom: lastPast.bottom,
        top: box.top,
        bottom: box.bottom,
      };
    });
  await expect
    .poll(async () => (await initialGeometry()).scrollTop)
    .toBeGreaterThan(300);
  const initial = await initialGeometry();
  expect(initial.firstBottom).toBeLessThanOrEqual(initial.bottom + 2);
  expect(initial.firstBottom).toBeGreaterThan(initial.top);
  expect(initial.secondTop).toBeGreaterThanOrEqual(initial.bottom - 2);
  expect(initial.pastBottom).toBeGreaterThan(initial.top);

  await history.evaluate(async (element) => {
    element.scrollTop = 310;
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  const remembered = await history.evaluate((element) => element.scrollTop);
  await goHome();
  await page.getByRole("button", { name: `Open ${other.title}` }).click();
  await expect
    .poll(() =>
      history.evaluate(
        (element) =>
          element.scrollHeight - element.clientHeight - element.scrollTop,
      ),
    )
    .toBeLessThan(2);
  await goHome();
  await page.getByRole("button", { name: `Open ${project.title}` }).click();
  await expect
    .poll(() => history.evaluate((element) => element.scrollTop))
    .toBeCloseTo(remembered, 0);

  await page.getByRole("button", { name: "Links 0", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "No links yet." }),
  ).toBeVisible();
  await goHome();
  await page.getByRole("button", { name: `Open ${project.title}` }).click();
  await expect
    .poll(() => history.evaluate((element) => element.scrollTop))
    .toBeCloseTo(remembered, 0);
  await page
    .getByLabel("Add a note")
    .fill("Typing must not move reading position");
  await expect
    .poll(() => history.evaluate((element) => element.scrollTop))
    .toBeCloseTo(remembered, 0);
  await page.getByLabel("Add a note").fill("");
  const longRow = page
    .locator(".message-row")
    .filter({ hasText: "Past context 10." });
  await longRow.getByRole("button", { name: "Show more" }).click();
  await history.evaluate(async (element) => {
    const row = [...element.querySelectorAll<HTMLElement>(".message-row")].find(
      (row) => row.textContent?.includes("Past context 10."),
    )!;
    element.scrollTop +=
      row.getBoundingClientRect().top -
      element.getBoundingClientRect().top +
      700;
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  await goHome();
  await page.getByRole("button", { name: `Open ${project.title}` }).click();
  await expect
    .poll(() =>
      longRow.evaluate(
        (row) =>
          row.getBoundingClientRect().bottom -
          row.closest(".history")!.getBoundingClientRect().top,
      ),
    )
    .toBeGreaterThan(0);
  await expect(
    longRow.getByRole("button", { name: "Show more" }),
  ).toBeVisible();
});

test("uses Home, quiet section disclosures, plain previews, and the Links filter", async ({
  page,
  request,
  localApp,
}, testInfo) => {
  const project = await createProject(request, localApp.url, {
    title: "Useful references",
    accent: "ocean",
  });
  await request.put(`${localApp.url}/api/chats/${project.id}/pin`);
  await addNote(request, localApp.url, project.id, "A plain note");
  await addNote(
    request,
    localApp.url,
    project.id,
    "### Header\n\n**bold text** [Guide](https://example.com)",
  );
  const other = await createProject(request, localApp.url, {
    title: "Other project",
    accent: "moss",
  });
  await page.goto(localApp.url);
  const pinned = page.getByRole("button", { name: "Pinned", exact: true });
  const projects = page.getByRole("button", { name: "Projects", exact: true });
  await expect(
    page
      .getByRole("button", { name: `Open ${project.title}` })
      .locator("small"),
  ).toHaveText("Header bold text Guide");
  if (testInfo.project.name === "desktop-chromium") {
    await page.getByRole("link", { name: "Home", exact: true }).hover();
    await expect(pinned.locator("svg")).toHaveCSS("opacity", "0");
    await pinned.hover();
    await expect(pinned.locator("svg")).toHaveCSS("opacity", "1");
  } else {
    await expect(pinned.locator("svg")).toHaveCSS("opacity", "1");
  }
  await pinned.focus();
  await page.keyboard.press("Enter");
  await expect(pinned).toHaveAttribute("aria-expanded", "false");
  await expect(pinned.locator("svg")).toHaveCSS(
    "transform",
    "matrix(0, -1, 1, 0, 0, 0)",
  );
  await expect(
    page.getByRole("button", { name: `Open ${project.title}` }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: `Open ${other.title}` }),
  ).toBeVisible();
  await projects.click();
  await expect(
    page.getByRole("button", { name: `Open ${other.title}` }),
  ).toHaveCount(0);
  await pinned.click();
  await expect(pinned.locator("svg")).toHaveCSS("transform", "none");
  await page.getByRole("button", { name: `Open ${project.title}` }).click();
  await page.getByRole("button", { name: "Links 1", exact: true }).click();
  await expect(page.locator(".history article")).toHaveCount(1);
  await expect(
    page.locator(".history").getByRole("link", { name: "Guide" }),
  ).toHaveAttribute("href", "https://example.com");
  const composer = page.getByLabel("Add a note");
  await composer.fill("One\nTwo\nThree\nFour\nFive\nSix\nSeven\nEight");
  await expect(composer).toHaveCSS("overflow-y", "hidden");
  const eight = await composer.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      actual: element.clientHeight,
      expected:
        parseFloat(style.lineHeight) * 8 +
        parseFloat(style.paddingTop) +
        parseFloat(style.paddingBottom),
    };
  });
  expect(eight.actual).toBeCloseTo(eight.expected, 0);
  await composer.fill("One\nTwo\nThree\nFour\nFive\nSix\nSeven\nEight\nNine");
  await expect(composer).toHaveCSS("overflow-y", "auto");
  expect(await composer.evaluate((element) => element.clientHeight)).toBe(
    eight.actual,
  );
  await composer.fill("");
  await page.screenshot({ path: testInfo.outputPath("navigation-polish.png") });
  if (testInfo.project.name === "mobile-webkit")
    await page.getByRole("button", { name: "Back to projects" }).click();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  if (testInfo.project.name === "desktop-chromium")
    await expect(
      page.getByRole("heading", { name: "Choose a project to continue." }),
    ).toBeVisible();
  await expect(projects).toHaveAttribute("aria-expanded", "false");
});

test("keeps keyboard focus when a project moves into a collapsed section", async ({
  page,
  request,
  localApp,
}) => {
  const pinned = await createProject(request, localApp.url, {
    title: "Pinned focus",
    accent: "ocean",
  });
  const project = await createProject(request, localApp.url, {
    title: "Moving focus",
    accent: "moss",
  });
  const response = await request.put(
    `${localApp.url}/api/chats/${pinned.id}/pin`,
  );
  expect(response.ok()).toBe(true);
  await page.goto(localApp.url);
  const pinnedHeader = page.getByRole("button", {
    name: "Pinned",
    exact: true,
  });
  const projectsHeader = page.getByRole("button", {
    name: "Projects",
    exact: true,
  });
  await pinnedHeader.click();
  await page
    .getByRole("button", { name: `Pin ${project.title}`, exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(pinnedHeader).toBeFocused();
  await projectsHeader.click();
  await pinnedHeader.click();
  await page
    .getByRole("button", { name: `Pin ${project.title}`, exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(projectsHeader).toBeFocused();
});

test("drops files into new and edited messages with a visible target", async ({
  page,
  request,
  localApp,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium");
  const project = await createProject(request, localApp.url, {
    title: "Dropped attachments",
    accent: "ocean",
  });
  await page.goto(localApp.url);
  await page.getByRole("button", { name: `Open ${project.title}` }).click();
  const composer = page.locator(".composer");
  await page.getByLabel("Add a note").fill("Keep this draft while dropping");

  const firstDrop = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(["original file"], "original.txt", { type: "text/plain" }),
    );
    return transfer;
  });
  await page
    .locator(".history")
    .dispatchEvent("dragenter", { dataTransfer: firstDrop });
  const addPrompt = page.getByText("Drop files here to attach", {
    exact: true,
  });
  await expect(addPrompt).toBeVisible();
  await composer.dispatchEvent("dragenter", { dataTransfer: firstDrop });
  await composer.dispatchEvent("dragover", { dataTransfer: firstDrop });
  await expect(addPrompt).toBeVisible();
  await composer.dispatchEvent("drop", { dataTransfer: firstDrop });
  await expect(addPrompt).toBeHidden();
  await expect(page.getByLabel("Add a note")).toHaveValue(
    "Keep this draft while dropping",
  );
  await expect(composer.locator(".pending-attachment")).toHaveCount(1);
  await expect(page.locator(".message-row")).toHaveCount(0);
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  const message = page.locator(".message-row");
  await expect(message.locator(".attachment-card")).toHaveCount(1);
  await message.getByRole("button", { name: "Edit message" }).click();
  const secondDrop = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(["added file"], "added.txt", { type: "text/plain" }),
    );
    return transfer;
  });
  await page
    .locator(".history")
    .dispatchEvent("dragenter", { dataTransfer: secondDrop });
  await expect(
    page.getByText("Drop files here to attach to this message", {
      exact: true,
    }),
  ).toBeVisible();
  await composer.dispatchEvent("dragover", { dataTransfer: secondDrop });
  await composer.dispatchEvent("drop", { dataTransfer: secondDrop });
  await expect(composer.locator(".pending-attachment")).toHaveCount(2);
  await expect(
    composer.getByText("original.txt", { exact: true }),
  ).toBeVisible();
  await expect(composer.getByText("added.txt", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Edit message" })).toHaveValue(
    "Keep this draft while dropping",
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(message.locator(".attachment-card")).toHaveCount(2);
  await page.reload();
  await page.getByRole("button", { name: `Open ${project.title}` }).click();
  await expect(
    message.getByRole("button", { name: "Open original.txt", exact: true }),
  ).toBeVisible();
  await expect(
    message.getByRole("button", { name: "Open added.txt", exact: true }),
  ).toBeVisible();
  await firstDrop.dispose();
  await secondDrop.dispose();
});

test("keeps full-width add and edit text above the composer toolbar", async ({
  page,
  request,
  localApp,
}, testInfo) => {
  const project = await createProject(request, localApp.url, {
    title: "Full width composer",
    accent: "ocean",
  });
  await addNote(request, localApp.url, project.id, "An editable message");
  await page.goto(localApp.url);
  await page.getByRole("button", { name: `Open ${project.title}` }).click();
  const widths =
    testInfo.project.name === "desktop-chromium"
      ? [1440, 1024, 800]
      : [390, 320];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    const textarea = page.locator("[data-composer-textarea]");
    const readLayout = () =>
      page.locator(".composer").evaluate((element) => {
        const field = element
          .querySelector("textarea")!
          .getBoundingClientRect();
        const bar = element
          .querySelector(".composer-bar")!
          .getBoundingClientRect();
        const tools = element
          .querySelector(".composer-tools")!
          .getBoundingClientRect();
        const shell = element.getBoundingClientRect();
        const buttons = [
          ...element.querySelectorAll(".composer-bar button"),
        ].map((button) => button.getBoundingClientRect());
        return {
          width: field.width,
          fieldBottom: field.bottom,
          barTop: bar.top,
          barLeft: bar.left,
          barRight: bar.right,
          fieldLeft: field.left,
          fieldRight: field.right,
          toolsLeft: tools.left,
          shellLeft: shell.left,
          shellRight: shell.right,
          buttonTops: buttons.map((box) => box.top),
          buttonRights: buttons.map((box) => box.right),
        };
      });
    await textarea.fill("One\nTwo\nThree\nFour\nFive\nSix\nSeven\nEight");
    await expect(textarea).toHaveCSS("overflow-y", "hidden");
    await expect
      .poll(() =>
        textarea.evaluate(
          (element) => element.scrollHeight <= element.clientHeight,
        ),
      )
      .toBe(true);
    const add = await readLayout();
    expect(add.barTop).toBeGreaterThanOrEqual(add.fieldBottom - 1);
    expect(add.fieldLeft).toBeCloseTo(add.barLeft, 0);
    expect(add.fieldRight).toBeCloseTo(add.barRight, 0);
    expect(add.toolsLeft).toBeGreaterThanOrEqual(add.barLeft);
    expect(add.toolsLeft - add.barLeft).toBeLessThanOrEqual(12);
    expect(Math.min(...add.buttonTops)).toBeGreaterThanOrEqual(
      add.fieldBottom - 1,
    );
    expect(Math.max(...add.buttonRights)).toBeLessThanOrEqual(add.shellRight);
    const height = await textarea.evaluate((element) => element.clientHeight);
    await textarea.fill("One\nTwo\nThree\nFour\nFive\nSix\nSeven\nEight\nNine");
    await expect(textarea).toHaveCSS("overflow-y", "auto");
    expect(await textarea.evaluate((element) => element.clientHeight)).toBe(
      height,
    );
    await textarea.fill("");
    await page
      .getByRole("button", { name: "Edit message", exact: true })
      .click();
    await textarea.fill("One\nTwo\nThree\nFour\nFive\nSix\nSeven\nEight");
    const edit = await readLayout();
    expect(edit.width).toBeCloseTo(add.width, 0);
    expect(edit.barTop).toBeGreaterThanOrEqual(edit.fieldBottom - 1);
    expect(Math.min(...edit.buttonTops)).toBeGreaterThanOrEqual(
      edit.fieldBottom - 1,
    );
    expect(Math.max(...edit.buttonRights)).toBeLessThanOrEqual(edit.shellRight);
    await expect(
      page.getByRole("button", { name: "Cancel", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`composer-edit-${width}.png`),
    });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
  }
});

test("restores All after filters and positions each filtered current-future boundary", async ({
  page,
  request,
  localApp,
}) => {
  const project = await createProject(request, localApp.url, {
    title: "Filter reading positions",
    accent: "ocean",
  });
  const now = Date.now();
  for (let index = 0; index < 32; index += 1) {
    const kind = index % 2 === 0 ? "File" : "Link";
    const future = index >= 24;
    const response = await request.post(
      `${localApp.url}/api/chats/${project.id}/notes`,
      {
        multipart: {
          body: `${kind} ${future ? "future" : "current"} ${index}. ${"Reading context. ".repeat(20)}${kind === "Link" ? " https://example.com" : ""}`,
          createdAt: String(
            future
              ? now + (index - 23) * 86_400_000
              : now - (24 - index) * 60_000,
          ),
          ...(kind === "File"
            ? {
                files: {
                  name: `context-${index}.txt`,
                  mimeType: "text/plain",
                  buffer: Buffer.from("context"),
                },
              }
            : {}),
        },
      },
    );
    expect(response.ok()).toBe(true);
  }
  await page.goto(localApp.url);
  await page.getByRole("button", { name: `Open ${project.title}` }).click();
  const history = page.locator(".history");
  await expect
    .poll(() => history.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(300);
  await history.evaluate(async (element) => {
    element.scrollTop = 310;
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  const remembered = await history.evaluate((element) => element.scrollTop);
  const assertBoundary = async (kind: string, firstIndex: number) => {
    await expect(page.locator(".message-row")).toHaveCount(16);
    const geometry = () =>
      history.evaluate(
        (element, input) => {
          const rows = [
            ...element.querySelectorAll<HTMLElement>(".message-row"),
          ];
          const rowBox = (text: string) =>
            rows
              .find((row) => row.textContent?.includes(text))!
              .getBoundingClientRect();
          const first = rowBox(`${input.kind} future ${input.firstIndex}.`);
          const second = rowBox(
            `${input.kind} future ${input.firstIndex + 2}.`,
          );
          const current = rowBox(
            `${input.kind} current ${input.firstIndex - 2}.`,
          );
          const viewport = element.getBoundingClientRect();
          return {
            top: element.scrollTop,
            firstTop: first.top,
            firstBottom: first.bottom,
            secondTop: second.top,
            currentBottom: current.bottom,
            viewportTop: viewport.top,
            viewportBottom: viewport.bottom,
          };
        },
        { kind, firstIndex },
      );
    await expect.poll(async () => (await geometry()).top).toBeGreaterThan(300);
    await expect
      .poll(
        async () =>
          (await geometry()).firstTop - (await geometry()).viewportBottom,
      )
      .toBeLessThan(0);
    const placed = await geometry();
    expect(placed.firstBottom).toBeGreaterThan(placed.viewportTop);
    expect(placed.secondTop).toBeGreaterThanOrEqual(placed.viewportBottom - 2);
    expect(placed.currentBottom).toBeGreaterThan(placed.viewportTop);
  };
  await page.getByRole("button", { name: "Files 16", exact: true }).click();
  await assertBoundary("File", 24);
  await history.evaluate((element) => {
    element.scrollTop = 110;
  });
  await page.getByRole("button", { name: "Links 16", exact: true }).click();
  await assertBoundary("Link", 25);
  await history.evaluate(async (element) => {
    element.scrollTop = 140;
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  await page.getByRole("button", { name: "Links 16", exact: true }).click();
  expect(await history.evaluate((element) => element.scrollTop)).toBeCloseTo(
    140,
    0,
  );
  await page.getByRole("button", { name: "All 32", exact: true }).click();
  await expect
    .poll(() => history.evaluate((element) => element.scrollTop))
    .toBeCloseTo(remembered, 0);
});

test("keeps expanded edit controls reachable at 200 percent reflow", async ({
  page,
  request,
  localApp,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium");
  const project = await createProject(request, localApp.url, {
    title: "Expanded composer reflow",
    accent: "ocean",
  });
  await addNote(request, localApp.url, project.id, "Keep editing available");
  await page.goto(localApp.url);
  await page.getByRole("button", { name: `Open ${project.title}` }).click();
  await page.getByRole("button", { name: "Edit message", exact: true }).click();
  await page.getByRole("button", { name: /Show sender options/ }).click();
  await page.getByRole("textbox", { name: "Sender name" }).fill("Alex Morgan");
  await page
    .getByRole("button", { name: "Choose timestamp", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Show Markdown assistance", exact: true })
    .click();
  await page.getByLabel("Attach files", { exact: true }).setInputFiles({
    name: "review-notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Keep this file while editing"),
  });
  const field = page.getByRole("textbox", {
    name: "Edit message",
    exact: true,
  });
  await field.fill("One\nTwo\nThree\nFour\nFive\nSix\nSeven\nEight\nNine");
  // 720 × 450 CSS pixels applies the reflow pressure of 1440 × 900 at 200%.
  await page.setViewportSize({ width: 720, height: 450 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const save = page.getByRole("button", { name: "Save", exact: true });
  const cancel = page.getByRole("button", { name: "Cancel", exact: true });
  await expect(save).toBeInViewport({ ratio: 1 });
  await expect(cancel).toBeInViewport({ ratio: 1 });
  const layout = await page.locator(".composer").evaluate((element) => ({
    right: element.getBoundingClientRect().right,
    bottom: element.getBoundingClientRect().bottom,
    width: window.innerWidth,
    height: window.innerHeight,
    documentWidth: document.documentElement.scrollWidth,
    top: element.getBoundingClientRect().top,
    historyBottom: document.querySelector(".history")!.getBoundingClientRect()
      .bottom,
  }));
  expect(layout.historyBottom).toBeLessThanOrEqual(layout.top);
  expect(layout.right).toBeLessThanOrEqual(layout.width);
  expect(layout.bottom).toBeLessThanOrEqual(layout.height);
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.width);
  await field.focus();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: /Hide sender options/ }),
  ).toBeFocused();
  for (
    let index = 0;
    index < 8 &&
    !(await save.evaluate((element) => element === document.activeElement));
    index += 1
  ) {
    await page.keyboard.press("Tab");
  }
  await expect(save).toBeFocused();
  await expect(save).toBeInViewport({ ratio: 1 });
  expect(
    await save.evaluate((element) =>
      parseFloat(getComputedStyle(element).outlineWidth),
    ),
  ).toBeGreaterThan(0);
  await page.getByRole("button", { name: /Hide sender options/ }).click();
  await page.locator(".composer-content").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await page.getByRole("button", { name: /Show sender options/ }).click();
  await expect(
    page.getByRole("textbox", { name: "Sender name" }),
  ).toBeInViewport({ ratio: 1 });
  for (const utility of [
    {
      hide: "Hide timestamp",
      show: "Choose timestamp",
      selector: ".composer-timestamp-row",
    },
    {
      hide: "Hide Markdown assistance",
      show: "Show Markdown assistance",
      selector: ".markdown-tools-strip",
    },
  ]) {
    await page.getByRole("button", { name: utility.hide, exact: true }).click();
    await page.locator(".composer-content").evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await page.getByRole("button", { name: utility.show, exact: true }).click();
    await expect(page.locator(utility.selector)).toBeInViewport({ ratio: 1 });
  }
  await expect(save).toBeInViewport({ ratio: 1 });
  await page.screenshot({
    path: testInfo.outputPath("composer-expanded-200-percent-reflow.png"),
  });
});

test("keeps bottom message labels above the trigger without scrolling history", async ({
  page,
  localApp,
  request,
}, testInfo) => {
  const project = await createProject(request, localApp.url, {
    title: "Popover placement",
    accent: "coral",
  });
  for (let i = 0; i < 16; i++)
    await addNote(request, localApp.url, project.id, `Message ${i}`);
  await page.goto(localApp.url);
  await page.getByRole("button", { name: "Open Popover placement" }).click();
  const history = page.locator(".history");
  await history.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  const trigger = page.getByRole("button", { name: "Change labels" }).last();
  const before = await history.evaluate((el) => el.scrollTop);
  await trigger.click();
  const popover = page.locator(".message-label-popover");
  await expect(popover).toBeVisible();
  const menuBox = (await popover.boundingBox())!;
  const triggerBox = (await trigger.boundingBox())!;
  const historyBox = (await history.boundingBox())!;
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(triggerBox.y);
  expect(menuBox.y).toBeGreaterThanOrEqual(historyBox.y);
  expect(await history.evaluate((el) => el.scrollTop)).toBeCloseTo(before, 0);
  await popover.getByRole("checkbox", { name: "Pin", exact: true }).click();
  await expect(
    popover.getByRole("checkbox", { name: "Pin", exact: true }),
  ).toBeChecked();
  await page.screenshot({ path: testInfo.outputPath("bottom-labels.png") });
  await trigger.press("Escape");
  await expect(popover).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await history.evaluate((el) => {
    el.scrollTop = 0;
  });
  const topTrigger = page
    .getByRole("button", { name: "Change labels" })
    .first();
  await topTrigger.click();
  const topMenu = (await popover.boundingBox())!;
  const topButton = (await topTrigger.boundingBox())!;
  expect(topMenu.y).toBeGreaterThanOrEqual(topButton.y + topButton.height);
  await page.setViewportSize({ width: 320, height: 740 });
  await expect
    .poll(async () => (await popover.boundingBox())!.x)
    .toBeGreaterThanOrEqual(0);
  await expect
    .poll(async () => {
      const box = (await popover.boundingBox())!;
      return box.x + box.width;
    })
    .toBeLessThanOrEqual(320);
});

test("keeps Home concise and remembers collapsed groups on reload", async ({
  page,
  localApp,
  request,
}, testInfo) => {
  await createProject(request, localApp.url, {
    title: "Home polish",
    accent: "coral",
  });
  await page.goto(localApp.url);
  if (testInfo.project.name === "desktop-chromium") {
    await expect(
      page.getByRole("heading", { name: "Choose a project to continue." }),
    ).toBeVisible();
    await expect(
      page.getByText("Select a project from the list or start new thread."),
    ).toBeVisible();
    const word = page.locator(".home-project-word");
    const wordBox = (await word.boundingBox())!;
    const decoration = (await word.locator(".empty-thread").boundingBox())!;
    expect(decoration.x + 18).toBeGreaterThan(wordBox.x);
    expect(decoration.x + 18).toBeLessThan(wordBox.x + wordBox.width);
  } else {
    // Mobile keeps the hero hidden and puts utilities beneath the project list.
    await page
      .getByRole("heading", { name: "App updates" })
      .scrollIntoViewIfNeeded();
    await expect(
      page.getByRole("heading", { name: "App updates" }),
    ).toBeVisible();
  }
  for (const text of [
    "Projects ready",
    "Get the latest improvements to threadstr.",
    "In-app reporting is on the way.",
  ])
    await expect(page.getByText(text, { exact: true })).toHaveCount(0);
  for (const name of ["User guide ↗", "Installation guide ↗"])
    await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("home-polish.png"),
    fullPage: true,
  });
  for (const name of ["Pinned", "Projects", "Archive", "Examples"])
    await page.getByRole("button", { name, exact: true }).click();
  await page.reload();
  for (const name of ["Pinned", "Projects", "Archive", "Examples"])
    await expect(
      page.getByRole("button", { name, exact: true }),
    ).toHaveAttribute("aria-expanded", "false");
});
