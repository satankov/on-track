import type { APIRequestContext, Page } from "@playwright/test";
import type { Chat, ChatDetail, Note } from "../src/domain/types.js";
import { expect, test } from "./fixtures.js";

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "Subthread design targets desktop.",
  );
  await page.setViewportSize({ width: 1440, height: 900 });
});

async function createProject(
  request: APIRequestContext,
  url: string,
  title: string,
): Promise<Chat> {
  const response = await request.post(`${url}/api/chats`, {
    data: { title, accent: "ocean" },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

async function addNote(
  request: APIRequestContext,
  url: string,
  chatId: string,
  body: string,
): Promise<Note> {
  const response = await request.post(`${url}/api/chats/${chatId}/notes`, {
    multipart: { body },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

async function createSubthread(
  request: APIRequestContext,
  url: string,
  chatId: string,
  title: string,
  sourceNoteId?: string,
): Promise<Chat> {
  const response = await request.post(`${url}/api/chats/${chatId}/subthreads`, {
    data: { title, ...(sourceNoteId ? { sourceNoteId } : {}) },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

async function submitSubthread(page: Page, title: string) {
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Subthread name")).toBeFocused();
  await dialog.getByLabel("Subthread name").fill(title);
  await dialog
    .getByRole("button", { name: "Create subthread", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".chat-heading h1")).toContainText(title);
}

test("keeps child rows compact and full width with one centered Attention and pin slot", async ({
  page,
  request,
  localApp,
}, testInfo) => {
  const root = await createProject(request, localApp.url, "Compact sidebar");
  const child = await createSubthread(
    request,
    localApp.url,
    root.id,
    "Navigation ideas",
  );
  const note = await addNote(
    request,
    localApp.url,
    child.id,
    "Review navigation",
  );
  expect(
    (
      await request.put(
        `${localApp.url}/api/chats/${child.id}/notes/${note.id}/labels/attention`,
      )
    ).ok(),
  ).toBe(true);
  await page.goto(localApp.url);
  const parent = page.getByRole("button", {
    name: `Open ${root.title}`,
    exact: true,
  });
  await parent.click();
  const open = page.getByRole("button", {
    name: `Open ${child.title}`,
    exact: true,
  });
  const row = open.locator("..");
  const pin = row.getByRole("button", {
    name: `Pin ${child.title}`,
    exact: true,
  });
  const dot = row.locator(".project-attention-dot");
  await page.mouse.move(600, 10);
  await parent.blur();
  const parentBox = (await parent.boundingBox())!;
  const rowBox = (await row.boundingBox())!;
  expect(rowBox.height).toBeLessThanOrEqual(44);
  expect(rowBox.x).toBe(parentBox.x);
  expect(rowBox.width).toBe(parentBox.width);
  expect(rowBox.y - (parentBox.y + parentBox.height)).toBeLessThanOrEqual(1);
  expect(
    Number(
      await open
        .locator("strong")
        .evaluate((el) => getComputedStyle(el).fontWeight),
    ),
  ).toBeLessThan(600);
  const dotBox = (await dot.boundingBox())!;
  const pinBox = (await pin.boundingBox())!;
  expect(
    Math.abs(dotBox.y + dotBox.height / 2 - (rowBox.y + rowBox.height / 2)),
  ).toBeLessThan(1);
  expect(
    Math.abs(dotBox.x + dotBox.width / 2 - (pinBox.x + pinBox.width / 2)),
  ).toBeLessThan(1);
  await expect(dot).toHaveCSS("opacity", "1");
  await expect(pin).toHaveCSS("opacity", "0");
  // Hover the indented gutter: it belongs to the same full-width row.
  await row.hover({ position: { x: 5, y: rowBox.height / 2 } });
  await expect(pin).toHaveCSS("opacity", "1");
  await expect(dot).toHaveCSS("opacity", "0");
  await page.mouse.move(600, 10);
  await pin.focus();
  await expect(dot).toHaveCSS("opacity", "0");
  await pin.press("Enter");
  await expect(pin).toHaveAttribute("aria-pressed", "true");
  await pin.press("Enter");
  await expect(pin).toHaveAttribute("aria-pressed", "false");
  await pin.blur();
  await expect(dot).toHaveCSS("opacity", "1");
  for (const theme of ["light", "neutral", "dark"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await page.screenshot({
      path: testInfo.outputPath(`compact-sidebar-${theme}.png`),
    });
  }
});

test("creates empty subthreads, follows origins and keeps sibling settings and drafts independent", async ({
  page,
  request,
  localApp,
}, testInfo) => {
  const root = await createProject(request, localApp.url, "Subthread design");
  const mainNote = await addNote(
    request,
    localApp.url,
    root.id,
    "Keep the navigation simple.",
  );
  await page.goto(localApp.url);
  await page
    .getByRole("button", { name: `Open ${root.title}`, exact: true })
    .click();
  const composer = page.getByLabel("Add a note", { exact: true });
  await composer.fill("Main draft stays here");
  const newThread = page.getByRole("button", {
    name: "New subthread",
    exact: true,
  });
  await newThread.click();
  await page.getByRole("dialog").press("Escape");
  await expect(newThread).toBeFocused();
  await newThread.click();
  await submitSubthread(page, "Navigation ideas");
  await expect(
    page.getByText("Independent subthread", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".message-row")).toHaveCount(0);
  await expect(composer).toHaveValue("");
  await composer.fill("Side navigation only.");
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  const source = page
    .locator(".message-row")
    .filter({ hasText: "Side navigation only." });
  await source.hover();
  expect(
    await source
      .locator(".message-actions button")
      .evaluateAll((buttons) =>
        buttons.map((button) => button.getAttribute("aria-label")),
      ),
  ).toEqual([
    "Change labels",
    "Continue in subthread",
    "Copy message",
    "Edit message",
    "Delete message",
  ]);
  await source
    .getByRole("button", { name: "Continue in subthread", exact: true })
    .click();
  await submitSubthread(page, "Menu variants");
  await expect(page.locator(".message-row")).toHaveCount(0);
  const origin = page
    .locator(".thread-origin")
    .filter({ hasText: "Subthread from" });
  await expect(origin).toContainText("Navigation ideas");
  await origin
    .getByRole("button", { name: "Navigation ideas", exact: true })
    .click();
  await expect(source).toBeFocused();
  await expect(page.locator(".thread-continuation")).toContainText(
    "Menu variants",
  );

  const projectResponse = await request.get(
    `${localApp.url}/api/chats/${root.id}/project`,
  );
  const project = (await projectResponse.json()) as ChatDetail[];
  const navigation = project.find((chat) => chat.title === "Navigation ideas")!;
  const variants = project.find((chat) => chat.title === "Menu variants")!;
  expect(navigation.projectId).toBe(root.id);
  expect(variants.projectId).toBe(root.id);
  expect(variants.origin).toEqual({
    sourceChatId: navigation.id,
    sourceNoteId: navigation.notes[0].id,
    sourceNoteCreatedAt: navigation.notes[0].createdAt,
    sourceNotePositionId: navigation.notes[0].id,
  });

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByLabel("Subthread name", { exact: true })).toHaveValue(
    "Navigation ideas",
  );
  await expect(page.getByRole("radio")).toHaveCount(0);
  await page
    .getByRole("checkbox", {
      name: "Collapse long messages by default",
      exact: true,
    })
    .uncheck();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  const rootAfter = (await (
    await request.get(`${localApp.url}/api/chats/${root.id}`)
  ).json()) as ChatDetail;
  expect(rootAfter.collapseLongMessages).toBe(true);
  await page
    .getByRole("button", { name: `Open ${root.title}`, exact: true })
    .click();
  await expect(composer).toHaveValue("Main draft stays here");
  await expect(
    page.locator(`.message-row[data-note-id="${mainNote.id}"]`),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open Menu variants", exact: true })
    .click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const deleteButton = page.getByRole("button", {
    name: "Delete subthread",
    exact: true,
  });
  await deleteButton.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("subthread-edit-delete.png"),
  });
  page.once("dialog", (dialog) => dialog.dismiss());
  await deleteButton.click();
  await expect(deleteButton).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await deleteButton.click();
  await expect(
    page.getByRole("button", { name: "Open Menu variants", exact: true }),
  ).toHaveCount(0);
  expect(
    (await request.get(`${localApp.url}/api/chats/${navigation.id}`)).ok(),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Open Navigation ideas", exact: true })
    .click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByRole("button", { name: "Archive subthread", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Restore Navigation ideas from archive",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Restore subthread", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Archive subthread", exact: true }),
  ).toBeVisible();
});

test("shows five flat children and searches the complete project from a continued subthread", async ({
  page,
  request,
  localApp,
}, testInfo) => {
  // The worker shares a server across tests; isolate this backup round trip
  // from transfer rate limits consumed by earlier journeys.
  await localApp.restart();
  const rootTitle =
    "Website redesign with a very long project title for the next launch milestone";
  const childTitle =
    "Navigation ideas with an equally long subthread title for the design review";
  const root = await createProject(request, localApp.url, rootTitle);
  const rootNote = await addNote(
    request,
    localApp.url,
    root.id,
    "Entry plan agreed in Main.",
  );
  const first = await createSubthread(
    request,
    localApp.url,
    root.id,
    childTitle,
    rootNote.id,
  );
  const firstNote = await addNote(
    request,
    localApp.url,
    first.id,
    "Entry plan trial in navigation.",
  );
  await request.put(`${localApp.url}/api/chats/${first.id}/pin`);
  const children = [first];
  for (let index = 1; index < 5; index++)
    children.push(
      await createSubthread(
        request,
        localApp.url,
        root.id,
        `Client feedback ${index}`,
      ),
    );
  const continued = await createSubthread(
    request,
    localApp.url,
    first.id,
    "Pricing experiment",
    firstNote.id,
  );
  children.push(continued);
  await addNote(
    request,
    localApp.url,
    continued.id,
    "Entry plan pricing test.",
  );
  const archived = await createSubthread(
    request,
    localApp.url,
    root.id,
    "Archived feedback",
  );
  await addNote(
    request,
    localApp.url,
    archived.id,
    "Entry plan accepted last month.",
  );
  await request.put(`${localApp.url}/api/chats/${archived.id}/archive`);
  const unrelated = await createProject(
    request,
    localApp.url,
    "Unrelated launch checklist",
  );
  await addNote(
    request,
    localApp.url,
    unrelated.id,
    "Entry plan should stay outside this search.",
  );
  await page.goto(localApp.url);
  const rootRow = page.getByRole("button", {
    name: `Open ${rootTitle}`,
    exact: true,
  });
  await rootRow.click();
  await expect(rootRow.locator("svg")).toHaveCount(0);
  await expect(
    page.locator("#rail-items-Projects .project-row--subthread"),
  ).toHaveCount(5);
  await rootRow.click();
  await expect(
    page.locator("#rail-items-Projects .project-row--subthread"),
  ).toHaveCount(0);
  await expect(page.locator(".chat-heading h1")).toHaveText(rootTitle);
  await rootRow.click();
  await page
    .getByRole("button", { name: "Show all subthreads", exact: true })
    .click();
  const rows = page.locator("#rail-items-Projects .project-row--subthread");
  await expect(rows).toHaveCount(6);
  await expect(rows.first()).toContainText(childTitle);
  await page
    .getByRole("button", { name: "Open Pricing experiment", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Search messages", exact: true })
    .click();
  const search = page.getByRole("searchbox", { name: "Search messages" });
  await search.fill("entry plan");
  await expect(page.getByLabel("Matching messages")).toHaveText("1");
  await page.getByRole("checkbox", { name: "Project", exact: true }).check();
  await expect(page.getByLabel("Matching messages")).toHaveText("4");
  await expect(page.locator(".project-search-result")).toHaveCount(4);
  await expect(page.locator(".project-search-results")).toContainText(
    "Archived feedback",
  );
  await expect(page.locator(".project-search-results")).not.toContainText(
    unrelated.title,
  );
  const mainResult = page.locator(
    `.project-search-result[data-chat-id="${root.id}"]`,
  );
  await mainResult
    .getByRole("button", { name: "Open message in history", exact: true })
    .click();
  await expect(
    page.locator(`.message-row[data-note-id="${rootNote.id}"]`),
  ).toBeFocused();
  await expect(search).toHaveCount(0);

  await page
    .getByRole("button", { name: `Open ${childTitle}`, exact: true })
    .click();
  await page.setViewportSize({ width: 1024, height: 768 });
  const heading = page.locator(".chat-heading");
  const parent = heading.getByRole("button", { name: rootTitle, exact: true });
  await expect(parent).toHaveAttribute("title", rootTitle);
  await expect(
    heading.locator(`.conversation-title[title="${childTitle}"]`),
  ).toBeVisible();
  for (const title of [
    parent,
    heading.locator(`.conversation-title[title="${childTitle}"]`),
  ]) {
    expect(
      await title.evaluate((element) => ({
        clipped: element.scrollWidth > element.clientWidth,
        ellipsis: getComputedStyle(element).textOverflow,
        width: element.clientWidth,
      })),
    ).toMatchObject({ clipped: true, ellipsis: "ellipsis" });
  }
  await expect(
    page.getByRole("button", { name: "New subthread", exact: true }),
  ).toBeInViewport();
  await expect(
    page.getByRole("button", { name: "Edit", exact: true }),
  ).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  for (const theme of ["light", "neutral", "dark"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await page.screenshot({
      path: testInfo.outputPath(`subthreads-1024-${theme}.png`),
    });
  }

  const deletedSource = await request.delete(
    `${localApp.url}/api/chats/${root.id}/notes/${rootNote.id}`,
  );
  expect(deletedSource.ok()).toBe(true);
  await page.reload();
  await page
    .getByRole("button", { name: `Open ${rootTitle}`, exact: true })
    .click();
  await page
    .getByRole("button", { name: `Open ${childTitle}`, exact: true })
    .click();
  await expect(page.locator(".thread-origin").first()).toContainText(
    "Original message deleted",
  );
  await expect(
    page
      .locator(".thread-origin")
      .first()
      .getByRole("button", { name: rootTitle, exact: true }),
  ).toBeVisible();

  const backup = await request.post(`${localApp.url}/api/database/export`, {
    data: { selection: [root.id] },
  });
  expect(backup.status()).toBe(200);
  const bytes = await backup.body();
  await request.delete(`${localApp.url}/api/chats/${root.id}`);
  const restored = await request.put(`${localApp.url}/api/database/import`, {
    data: bytes,
    headers: { "Content-Type": "application/vnd.on-track.backup+sqlite" },
  });
  expect(restored.ok(), await restored.text()).toBe(true);
  await localApp.restart();
  const preserved = (await (
    await request.get(`${localApp.url}/api/chats/${continued.id}/project`)
  ).json()) as ChatDetail[];
  expect(preserved).toHaveLength(8);
  expect(preserved.find((chat) => chat.id === continued.id)?.origin).toEqual({
    sourceChatId: first.id,
    sourceNoteId: firstNote.id,
    sourceNoteCreatedAt: firstNote.createdAt,
    sourceNotePositionId: firstNote.id,
  });
  expect(preserved.some((chat) => chat.id === unrelated.id)).toBe(false);
});

test("keeps continuation links at a deleted source date and navigates back after reload", async ({
  page,
  request,
  localApp,
}) => {
  const root = await createProject(request, localApp.url, "History anchors");
  const date = new Date(2024, 2, 10, 12).getTime();
  const notes: Note[] = [];
  for (const [body, createdAt] of [
    ["Before", date - 86400000],
    ["Source to delete", date],
    ["After", date + 86400000],
  ] as const) {
    const response = await request.post(
      `${localApp.url}/api/chats/${root.id}/notes`,
      { multipart: { body, createdAt: String(createdAt) } },
    );
    expect(response.ok()).toBe(true);
    notes.push(await response.json());
  }
  const child = await createSubthread(
    request,
    localApp.url,
    root.id,
    "Persistent topic",
    notes[1].id,
  );
  await page.goto(localApp.url);
  await page
    .getByRole("button", { name: "Open History anchors", exact: true })
    .click();
  page.on("dialog", (dialog) => dialog.accept());
  const source = page.locator(`[data-note-id="${notes[1].id}"]`);
  await source.hover();
  await source
    .getByRole("button", { name: "Delete message", exact: true })
    .click();
  const marker = page.locator(`[data-note-id="continuation:${child.id}"]`);
  await expect(marker).toContainText("Continued in Persistent topic");
  await expect(source).toHaveCount(0);
  await expect(marker).toHaveAttribute("data-created-at", String(date));
  await expect(page.locator(".message-day")).toHaveCount(3);
  expect(
    await page
      .locator(".history [data-note-id]")
      .evaluateAll((rows) =>
        rows.map((row) => (row as HTMLElement).dataset.noteId),
      ),
  ).toEqual([notes[0].id, `continuation:${child.id}`, notes[2].id]);
  await marker
    .getByRole("button", { name: "Persistent topic", exact: true })
    .click();
  await page
    .locator(".thread-origin")
    .getByRole("button", { name: "History anchors", exact: true })
    .click();
  await expect(marker).toBeFocused();
  await page.reload();
  await page
    .getByRole("button", { name: "Open History anchors", exact: true })
    .click();
  await expect(marker).toBeVisible();
  // A source-only history still contains the marker after all messages are gone.
  for (const note of [notes[0], notes[2]]) {
    expect(
      (
        await request.delete(
          `${localApp.url}/api/chats/${root.id}/notes/${note.id}`,
        )
      ).ok(),
    ).toBe(true);
  }
  await page.reload();
  await page
    .getByRole("button", { name: "Open History anchors", exact: true })
    .click();
  await expect(marker).toBeVisible();
  await expect(
    page.getByText("What is worth remembering?", { exact: true }),
  ).toHaveCount(0);
  await marker
    .getByRole("button", { name: "Persistent topic", exact: true })
    .click();
  await page
    .locator(".thread-origin")
    .getByRole("button", { name: "History anchors", exact: true })
    .click();
  await expect(marker).toBeFocused();
});
