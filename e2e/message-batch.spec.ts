import type { Page } from "@playwright/test";
import type { ChatDetail, Note } from "../src/domain/types.js";
import { expect, test } from "./fixtures.js";

async function selectPair(page: Page, first: string, second: string) {
  const row = page.locator(".message-row").filter({ hasText: first });
  await row.getByRole("button", { name: "More message actions" }).click();
  await row.getByRole("menuitem", { name: "Select messages" }).click();
  await page
    .locator(".message-row")
    .filter({ hasText: second })
    .getByRole("checkbox")
    .check();
}

test("copies, moves and deletes a selection with all labels and the source draft intact", async ({
  localApp,
  page,
  request,
}, testInfo) => {
  const base = localApp.url + "/api/chats";
  const title = "Message transfer";
  const project = await request.post(base, {
    data: { title, accent: "ocean" },
  });
  const source: ChatDetail = await project.json();
  const sourcePath = `${base}/${source.id}`;
  const child = await (
    await request.post(`${sourcePath}/subthreads`, {
      data: { title: "Launch" },
    })
  ).json();
  const delivery = await (
    await request.post(base, {
      data: { title: "Delivery notes", accent: "iris" },
    })
  ).json();

  // Creating the label after the child exists leaves both destinations without it.
  const configured = await request.patch(sourcePath, {
    data: {
      labelConfiguration: {
        revision: source.labelConfigurationRevision,
        labels: [
          ...source.labelDefinitions!.map(({ id, name, symbol, enabled }) => ({
            id,
            name,
            symbol,
            enabled,
          })),
          { name: "Review", symbol: "📎", enabled: true },
        ],
      },
    },
  });
  expect(configured.ok()).toBe(true);
  const updated: ChatDetail = await configured.json();
  const custom = updated.labelDefinitions!.find((l) => l.name === "Review")!;
  const messages = ["Checklist signed off", "Open the waitlist"];
  const original: Note[] = [];
  for (const [i, body] of messages.entries()) {
    const response = await request.post(`${sourcePath}/notes`, {
      multipart: {
        body,
        createdAt: String(1700000000000 + i),
        ...(i === 0
          ? {
              sender: "Maya",
              files: {
                name: "checklist.txt",
                mimeType: "text/plain",
                buffer: Buffer.from("Approval checklist"),
              },
            }
          : {}),
      },
    });
    expect(response.ok()).toBe(true);
    original.push(await response.json());
  }
  const applied = await request.put(
    `${sourcePath}/notes/${original[0].id}/labels/${custom.id}`,
  );
  expect(applied.ok()).toBe(true);

  await page.goto(localApp.url);
  await page
    .getByRole("button", { name: "Open " + title, exact: true })
    .click();
  const draft = page.getByLabel("Add a note", { exact: true });
  await draft.fill("Unsent source draft");
  if (testInfo.project.name === "mobile-webkit")
    await page.setViewportSize({ width: 320, height: 740 });
  await selectPair(page, messages[0], messages[1]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("message-selection.png") });
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  await button("Copy").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await button("Back to messages").click();
  await expect(page.locator(".message-row input:checked")).toHaveCount(2);
  await button("Copy").click();
  await page
    .getByRole("searchbox", { name: "Find a thread or subthread" })
    .fill("Launch");
  await button(title + " / Launch").click();
  await page.screenshot({ path: testInfo.outputPath("copy-workspace.png") });
  await button("Copy 2 messages").click();
  await expect(draft).toHaveValue("Unsent source draft");
  await expect(page.locator(".message-row")).toHaveCount(2);
  await button("Open destination").click();
  const copied = page.locator(".message-row").filter({ hasText: messages[0] });
  await expect(copied).toContainText("Maya");
  await expect(copied).toContainText("Review");
  await expect(copied).toContainText("📎");
  await expect(copied).toContainText("checklist.txt");

  await selectPair(page, messages[0], messages[1]);
  await button("Move").click();
  await button("Delivery notes").click();
  await button("Move 2 messages").click();
  await expect(page.locator(".message-row")).toHaveCount(0);
  await button("Open destination").click();
  await expect(copied).toContainText("📎");
  const read = async (id: string): Promise<ChatDetail> =>
    (await request.get(base + "/" + id)).json();
  const moved = (await read(delivery.id)).notes;
  expect(moved.map((n) => n.body)).toEqual(messages);
  expect(moved.map((n) => n.createdAt)).toEqual(
    original.map((n) => n.createdAt),
  );
  expect(moved[0].attachments![0].id).not.toBe(original[0].attachments![0].id);
  expect((await read(child.id)).notes).toEqual([]);

  await selectPair(page, messages[0], messages[1]);
  await button("Delete").click();
  await button("Delete 2 messages").click();
  await expect(page.locator(".message-row")).toHaveCount(0);
  const sourceNotes = (await read(source.id)).notes;
  expect(sourceNotes[0].labels).toContain(custom.id);
  expect(sourceNotes[0].attachments![0].status).toBe("available");
});

test("selects a range or all messages and keeps the transfer controls visible while browsing destinations", async ({
  localApp,
  page,
  request,
}, testInfo) => {
  const base = localApp.url + "/api/chats";
  async function create(title: string, parent?: string): Promise<ChatDetail> {
    const path = parent ? `${base}/${parent}/subthreads` : base;
    const response = await request.post(path, {
      data: parent ? { title } : { title, accent: "ocean" },
    });
    expect(response.ok()).toBe(true);
    return response.json();
  }
  const source = await create("Range selection");
  const destination = await create("Delivery calendar");
  for (let i = 1; i <= 18; i++) await create(`Milestone ${i}`, destination.id);
  const retiredChild = await create("Retired work", destination.id);
  const retiredRoot = await create("Archived planning");
  await create("Hidden by parent", retiredRoot.id);
  for (const chat of [retiredChild, retiredRoot])
    expect((await request.put(`${base}/${chat.id}/archive`)).ok()).toBe(true);
  for (let i = 1; i <= 6; i++) {
    const response = await request.post(`${base}/${source.id}/notes`, {
      multipart: {
        body: `Planning note ${i}`,
        createdAt: String(1700000000000 + i),
      },
    });
    expect(response.ok()).toBe(true);
  }

  const mobile = testInfo.project.name === "mobile-webkit";
  await page.setViewportSize(
    mobile ? { width: 320, height: 600 } : { width: 1024, height: 540 },
  );
  await page.goto(localApp.url);
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  await button("Open Range selection").click();
  const rows = page.locator(".message-row");
  await rows
    .first()
    .getByRole("button", { name: "More message actions" })
    .click();
  const firstAction = page.getByRole("menuitem").first();
  await expect(firstAction).toHaveText("Select messages");
  await firstAction.click();
  const fifth = rows.nth(4).getByRole("checkbox");
  if (mobile) {
    await fifth.focus();
    await fifth.press("Shift+Space");
  } else await fifth.click({ modifiers: ["Shift"] });
  await expect(rows.locator("input:checked")).toHaveCount(5);
  await button("Select all").click();
  await expect(rows.locator("input:checked")).toHaveCount(6);
  await button("Move").click();
  const picker = page.getByRole("main", { name: "Move messages" });
  const list = picker.getByRole("region", {
    name: "Destination conversations",
  });
  const project = picker.getByRole("button", {
    name: "Delivery calendar",
    exact: true,
  });
  await expect(list.getByText("Main", { exact: true })).toHaveCount(0);
  await expect(list.getByText("Milestone 18", { exact: true })).toHaveCount(0);
  await expect(
    list.getByText("Archived planning", { exact: true }),
  ).toHaveCount(0);
  await project.click();
  await expect(project).toHaveAttribute("aria-expanded", "true");
  if (!mobile) {
    await page.emulateMedia({ forcedColors: "active" });
    const visibleSelectionMark = await project.evaluate((button) => {
      const marker = getComputedStyle(button.parentElement!, "::before");
      return (
        marker.borderInlineStartStyle === "solid" &&
        marker.borderInlineStartColor !==
          getComputedStyle(button).backgroundColor
      );
    });
    expect(visibleSelectionMark).toBe(true);
    await page.emulateMedia({ forcedColors: "none" });
  }
  await expect(list.getByText("Retired work", { exact: true })).toHaveCount(0);
  const title = picker.getByRole("heading", { name: "Move 6 messages" });
  const search = picker.getByRole("searchbox");
  const submit = picker.getByRole("button", { name: "Move 6 messages" });
  const bounds = async () =>
    Promise.all([title, search, submit].map((el) => el.boundingBox()));
  const before = await bounds();
  await list.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect
    .poll(() => list.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  expect(await bounds()).toEqual(before);
  for (const control of [title, search, submit])
    await expect(control).toBeInViewport({ ratio: 1 });
  await page.screenshot({
    path: testInfo.outputPath("expanded-destination-list.png"),
  });
  await submit.click();
  await expect(rows).toHaveCount(0);
  const stored: ChatDetail = await (
    await request.get(`${base}/${destination.id}`)
  ).json();
  expect(stored.notes).toHaveLength(6);
});
