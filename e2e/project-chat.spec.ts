import type { APIRequestContext } from "@playwright/test";

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
    data: { body, ...(createdAt === undefined ? {} : { createdAt }) },
  });
  expect(response.ok()).toBe(true);
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
      actionsTop: actions.getBoundingClientRect().top,
      bubbleBottom: bubble.getBoundingClientRect().bottom,
      editRight: editButton.getBoundingClientRect().right,
      composerRight: composer.getBoundingClientRect().right,
    };
  });
  expect(messageLayout.actionsTop).toBeGreaterThanOrEqual(
    messageLayout.bubbleBottom,
  );
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

  if (testInfo.project.name === "mobile-webkit") {
    await page.getByRole("button", { name: "Back to projects" }).click();
  }
  await page.getByRole("button", { name: /Settings/ }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export database" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(
    /on-track-\d{4}-\d{2}-\d{2}\.sqlite/,
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
    .getByLabel("Choose database backup")
    .setInputFiles(backupPath ?? "");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Import database" }).click();

  await expect(
    page.getByRole("button", { name: `Open ${exportedProject.title}` }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: `Open ${extraProject.title}` }),
  ).toHaveCount(0);
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
