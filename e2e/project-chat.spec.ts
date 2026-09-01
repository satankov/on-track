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
): Promise<void> {
  const response = await request.post(`${url}/api/chats/${chatId}/notes`, {
    data: { body },
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
  await page.getByRole("button", { name: /Add note/ }).click();
  await expect(
    page.getByText("Ship the smallest useful workflow."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Customize project" }).click();
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
    const line = document.querySelector(".history .thread-line")!;
    const lastNode = [...document.querySelectorAll(".note-node")].at(-1)!;
    return {
      headerTop: chatHeader.getBoundingClientRect().top,
      composerBottom: composer.getBoundingClientRect().bottom,
      lineBottom: line.getBoundingClientRect().bottom,
      lastNodeBottom: lastNode.getBoundingClientRect().bottom,
    };
  });
  expect(workspaceAfter.headerTop).toBeCloseTo(workspaceBefore.header.top, 0);
  expect(workspaceAfter.composerBottom).toBeCloseTo(
    workspaceBefore.composer.bottom,
    0,
  );
  expect(workspaceAfter.lineBottom).toBeGreaterThanOrEqual(
    workspaceAfter.lastNodeBottom,
  );
});
