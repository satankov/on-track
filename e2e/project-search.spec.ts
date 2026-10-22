import { expect, test } from "./fixtures.js";

test("search remains usable in read-only examples at narrow widths and 200 percent zoom", async ({
  page,
  localApp,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(localApp.url);
  await page
    .getByRole("button", { name: "Open example 🇳🇱 Trip to Amsterdam" })
    .click();
  const toggle = page.getByRole("button", {
    name: "Search messages",
    exact: true,
  });
  await expect(toggle).toBeInViewport();
  await toggle.click();
  const input = page.getByRole("searchbox");
  await input.fill("museum");
  const context = page
    .getByRole("button", { name: "Open message in history" })
    .first();
  await expect(context).toBeVisible();
  await expect(page.getByLabel("Add a note", { exact: true })).toBeDisabled();
  await expect(page.locator(".composer")).not.toHaveAttribute(
    "data-readonly-highlight",
    "true",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("search-example-320.png"),
  });
  await context.click();
  await expect(input).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await toggle.click();
  await expect(input).toHaveValue("museum");
  await expect(context).toBeVisible();
  await expect(input).toBeInViewport();
  expect((await input.boundingBox())!.width).toBeGreaterThan(300);
  await expect(
    page.getByRole("button", { name: "Create editable copy", exact: true }),
  ).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("search-example-zoom.png"),
  });
});

test("searches locally with a compact field, restores reading positions and opens original context", async ({
  page,
  request,
  localApp,
}, testInfo) => {
  const response = await request.post(`${localApp.url}/api/chats`, {
    data: { title: "Search notebook", accent: "ocean" },
  });
  const chat = await response.json();
  const ids: string[] = [];
  for (let i = 0; i < 24; i++) {
    const note = await request.post(
      `${localApp.url}/api/chats/${chat.id}/notes`,
      {
        multipart: {
          body:
            i === 5
              ? "**Hotel budget**: reserve a quiet room.\n\n" +
                "A useful planning detail.\n\n".repeat(24)
              : i === 10
                ? "Hotel shortlist fits our budget."
                : `Planning entry ${i}: museum tickets and train times.`,
          createdAt: String(Date.now() - 100000 + i),
          ...(i === 10 ? { sender: "Maya" } : {}),
        },
      },
    );
    ids.push((await note.json()).id);
  }
  await page.goto(localApp.url);
  await page.getByRole("button", { name: "Open Search notebook" }).click();
  await expect(page.locator(".message-row")).toHaveCount(24);
  const history = page.locator(".history");
  await history.evaluate((el) => {
    el.scrollTop = 500;
  });
  const position = await history.evaluate((el) => el.scrollTop);
  const draft = page.getByLabel("Add a note");
  await draft.fill("Preserve this draft");
  const toggle = page.getByRole("button", {
    name: "Search messages",
    exact: true,
  });
  await expect(toggle).toHaveText("");
  await toggle.click();
  const search = page.getByRole("searchbox", { name: "Search messages" });
  await expect(search).toBeFocused();
  const requests: string[] = [];
  page.on("request", (req) => requests.push(req.url()));
  await search.fill("HOTEL budg");
  await expect(page.locator(".message-row")).toHaveCount(2);
  await expect(page.getByLabel("Matching messages")).toHaveText("2");
  await expect(page.locator(".message-body mark")).toHaveCount(4);
  const composerBox = (await page.locator(".composer").boundingBox())!;
  for (const side of ["own", "participant"]) {
    const row = page.locator(`.message-row--${side}`).first();
    const bubble = (await row.locator(".message-bubble").boundingBox())!;
    const action = (await row
      .locator(".message-history-button")
      .boundingBox())!;
    if (side === "own")
      expect(action.x).toBeGreaterThan(bubble.x + bubble.width);
    else expect(action.x + action.width).toBeLessThan(bubble.x);
    expect(action.x).toBeGreaterThanOrEqual(composerBox.x - 1);
    expect(action.x + action.width).toBeLessThanOrEqual(
      composerBox.x + composerBox.width + 1,
    );
  }
  await expect(page.locator(".project-search-field")).toHaveCSS(
    "outline-width",
    "1px",
  );
  await expect(page.locator(".project-search-field")).toHaveCSS(
    "border-radius",
    "12px",
  );
  await draft.focus();
  await expect(page.locator(".composer")).toHaveCSS("outline-width", "0px");
  await expect(page.locator(".composer")).toHaveCSS("border-top-width", "1px");
  await search.focus();
  if (testInfo.project.name === "mobile-webkit") {
    const contextBox = await page
      .getByRole("button", { name: "Open message in history" })
      .first()
      .boundingBox();
    expect(contextBox!.width).toBeGreaterThanOrEqual(44);
    expect(contextBox!.height).toBeGreaterThanOrEqual(44);
  }
  await expect(history).toHaveJSProperty("scrollTop", 0);
  expect(requests).toEqual([]);
  const box = await page.locator(".project-search").boundingBox();
  const field = await search.boundingBox();
  expect(box!.height).toBeLessThanOrEqual(field!.height + 10);
  expect(
    await search.evaluate((el) => getComputedStyle(el).borderTopWidth),
  ).toBe("0px");
  await expect(
    page.getByText("Search this project", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("MATCH", { exact: true })).toHaveCount(0);
  for (const theme of ["light", "neutral", "dark"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await page.screenshot({ path: testInfo.outputPath(`search-${theme}.png`) });
  }
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
  });
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(page.locator(".message-row")).toHaveCount(24);
  await expect
    .poll(() => history.evaluate((el) => el.scrollTop))
    .toBeCloseTo(position, 0);
  await expect(search).toBeFocused();
  await search.fill("hotel budget");
  await expect(page.locator(".message-row")).toHaveCount(2);
  await page.getByRole("button", { name: "Files 0" }).click();
  await expect(
    page.getByRole("heading", { name: "No matching messages" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Search all messages" }).click();
  await expect(page.locator(".message-row")).toHaveCount(2);
  const target = page.locator(`[data-note-id="${ids[10]}"]`);
  await target.getByRole("button", { name: "Open message in history" }).click();
  await expect(search).toHaveCount(0);
  await expect(page.locator(".message-row")).toHaveCount(24);
  await expect(target).toBeFocused();
  await expect(target).toBeInViewport();
  await expect(draft).toHaveValue("Preserve this draft");
  await toggle.click();
  await expect(search).toHaveValue("hotel budget");
  await search.fill("zzzzzz");
  await expect(
    page.getByRole("heading", { name: "No matching messages" }),
  ).toBeVisible();
  await search.press("Escape");
  await expect(toggle).toBeFocused();
  await expect(search).toHaveCount(0);
  await page.getByRole("button", { name: /Show sender options/ }).click();
  const sender = page.getByRole("textbox", { name: "Sender name" });
  await sender.focus();
  await expect(sender).toHaveCSS("outline-width", "1px");
  await page.getByRole("button", { name: /Hide sender options/ }).click();
  await page
    .getByRole("button", { name: "Choose timestamp", exact: true })
    .click();
  const timestamp = page.getByLabel("Message timestamp");
  await timestamp.focus();
  await expect(timestamp).toHaveCSS("outline-width", "1px");
  await page
    .getByRole("button", { name: "Hide timestamp", exact: true })
    .click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
