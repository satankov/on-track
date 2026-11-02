import { expect, test } from "./fixtures.js";

test("restores database preferences before React, after clearing storage and restarting", async ({
  page,
  browser,
  request,
  localApp,
}) => {
  await page.goto(localApp.url);
  await page.getByRole("button", { name: /Settings/ }).click();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.getByRole("radio", { name: /^Dark / }).check();
  await expect
    .poll(
      async () =>
        (await (await request.get(`${localApp.url}/api/preferences`)).json())
          .theme,
    )
    .toBe("dark");
  await page.getByRole("button", { name: "General", exact: true }).click();
  await page.getByRole("checkbox", { name: "Show Examples" }).uncheck();
  await page
    .getByRole("button", { name: "Back to projects", exact: true })
    .click();
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await request.get(`${localApp.url}/api/preferences`)).json())
          .collapsedSections.Projects,
    )
    .toBe(true);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await localApp.restart();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(
    page.getByRole("button", { name: "Projects", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.getByRole("button", { name: "Open example 🇳🇱 Trip to Amsterdam" }),
  ).toHaveCount(0);

  const fresh = await browser.newContext();
  try {
    const beforeReact = await fresh.newPage();
    // Block React's bundle to prove the database theme is applied pre-mount.
    await beforeReact.route("**/assets/*.js", (route) => route.abort());
    await beforeReact.addInitScript(() =>
      localStorage.setItem("on-track-theme", "light"),
    );
    const response = await beforeReact.goto(localApp.url);
    expect(response!.ok()).toBe(true);
    await expect(beforeReact.locator("#root")).toBeEmpty();
    await expect(beforeReact.locator("html")).toHaveAttribute(
      "data-theme",
      "dark",
    );
    expect(
      (
        await request.get(`${localApp.url}/api/preferences/bootstrap.js`)
      ).headers()["cache-control"],
    ).toBe("no-store");
  } finally {
    await fresh.close();
  }
  await request.patch(`${localApp.url}/api/preferences`, {
    data: { theme: "neutral" },
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator("html")).toHaveAttribute("data-theme", "neutral");
});

test("creates five compact custom labels, combines filters and retains disabled assignments", async ({
  page,
  request,
  localApp,
  isMobile,
}, testInfo) => {
  const created = await request.post(`${localApp.url}/api/chats`, {
    data: { title: "Compact labels", accent: "ocean" },
  });
  const project = await created.json();
  await page.goto(localApp.url);
  await page
    .getByRole("button", { name: "Open Compact labels", exact: true })
    .click();
  const initialFilters = page.getByRole("navigation", {
    name: "History filters",
  });
  await expect(initialFilters.getByRole("checkbox")).toHaveCount(0);
  await expect(initialFilters.locator(".history-filter-help")).toContainText(
    "⌘/Ctrl + multiple",
  );
  const hintGap = await initialFilters.evaluate((nav) => {
    const last = nav.querySelector(".history-filter-inner button:last-child")!;
    return (
      nav.querySelector(".history-filter-help")!.getBoundingClientRect().top -
      last.getBoundingClientRect().bottom
    );
  });
  expect(hintGap).toBeGreaterThanOrEqual(0);
  expect(hintGap).toBeLessThanOrEqual(12);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Label name 1" })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("labels-empty-row.png") });
  const names = ["Review", "Critical", "Someday", "Ready", "WWWWWWWW"];
  for (const [index, name] of names.entries()) {
    await page
      .getByRole("textbox", { name: `Label name ${index + 1}` })
      .fill(name);
    if (index === 0)
      await page.getByRole("textbox", { name: "Label symbol 1" }).fill("🧑🏽‍💻");
  }
  await expect(
    page.getByRole("button", { name: "Add label", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Label name 6" })).toHaveCount(
    0,
  );
  const reviewHandle = page.getByRole("button", {
    name: "Reorder Review",
    exact: true,
  });
  const milestoneHandle = page.getByRole("button", {
    name: "Reorder Milestone",
    exact: true,
  });
  if (!isMobile) {
    await page.setViewportSize({ width: 1024, height: 600 });
    const first = page.getByRole("button", {
      name: "Reorder Todo",
      exact: true,
    });
    await first.scrollIntoViewIfNeeded();
    const scroller = page.getByRole("main", { name: "Edit project" });
    const before = await scroller.evaluate((element) => element.scrollTop);
    const origin = (await first.boundingBox())!;
    await page.mouse.move(
      origin.x + origin.width / 2,
      origin.y + origin.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(origin.x + origin.width / 2, 590, { steps: 6 });
    await expect
      .poll(() => scroller.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(before + 40);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(first).toHaveAttribute("aria-pressed", "false");
    await expect(
      page.getByRole("button", { name: /^Reorder / }).first(),
    ).toHaveAttribute("aria-label", "Reorder Todo");
    await page.setViewportSize({ width: 1440, height: 900 });
    await first.scrollIntoViewIfNeeded();
    const nearEdge = (await first.boundingBox())!;
    await page.mouse.move(
      nearEdge.x + nearEdge.width / 2,
      nearEdge.y + nearEdge.height - 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      nearEdge.x + nearEdge.width / 2,
      nearEdge.y + nearEdge.height + 8,
    );
    await page.mouse.up();
    await expect(
      page.getByRole("button", { name: /^Reorder / }).first(),
    ).toHaveAttribute("aria-label", "Reorder Todo");
  }
  if (isMobile) {
    await reviewHandle.tap();
    await expect(reviewHandle).toHaveAttribute("aria-pressed", "true");
    await milestoneHandle.tap();
  } else {
    await reviewHandle.scrollIntoViewIfNeeded();
    const from = (await reviewHandle.boundingBox())!;
    const to = (await milestoneHandle.boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
      steps: 8,
    });
    const moved = (await reviewHandle.boundingBox())!;
    expect(Math.abs(moved.y - to.y)).toBeLessThan(3);
    await page.screenshot({ path: testInfo.outputPath("labels-dragging.png") });
    await page.mouse.up();
  }
  await expect(reviewHandle).toHaveAttribute("aria-pressed", "false");
  for (const theme of ["light", "neutral", "dark"]) {
    await request.patch(`${localApp.url}/api/preferences`, { data: { theme } });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page
      .getByRole("textbox", { name: "Label name 1" })
      .scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`labels-edit-${theme}.png`),
    });
  }
  if (!isMobile) {
    for (const size of [
      { width: 1024, height: 768 },
      { width: 720, height: 450 },
    ]) {
      await page.setViewportSize(size);
      await page
        .getByRole("textbox", { name: "Label name 1" })
        .scrollIntoViewIfNeeded();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`labels-edit-${size.width}.png`),
      });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Edit", exact: true }),
  ).toBeVisible();
  const detail = await (
    await request.get(`${localApp.url}/api/chats/${project.id}`)
  ).json();
  const custom = detail.labelDefinitions.find(
    (label: { name: string }) => label.name === "Review",
  );
  expect(custom.position).toBe(6);
  const notes: string[] = [];
  for (const body of [
    "Both https://example.com",
    "Link https://example.org",
    "Pinned plain",
  ]) {
    const note = await (
      await request.post(`${localApp.url}/api/chats/${project.id}/notes`, {
        multipart: { body },
      })
    ).json();
    notes.push(note.id);
  }
  for (const id of [notes[0], notes[2]])
    await request.put(
      `${localApp.url}/api/chats/${project.id}/notes/${id}/labels/pin`,
    );
  await request.put(
    `${localApp.url}/api/chats/${project.id}/notes/${notes[0]}/labels/${custom.id}`,
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const filters = page.getByRole("navigation", { name: "History filters" });
  const links = filters.getByRole("button", { name: "Links 2", exact: true });
  const pin = filters.getByRole("button", { name: "Pin 2", exact: true });
  await links.click();
  if (isMobile) {
    await pin.tap();
  } else {
    const apple = await page.evaluate(() =>
      /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent),
    );
    await pin.focus();
    await pin.press(`${apple ? "Meta" : "Control"}+Enter`);
  }
  await expect(links).toHaveAttribute("aria-pressed", "true");
  await expect(pin).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("article")).toContainText("Both");
  for (const theme of ["light", "neutral", "dark"]) {
    await request.patch(`${localApp.url}/api/preferences`, { data: { theme } });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`combined-filters-${theme}.png`),
    });
  }
  if (!isMobile) {
    await page.setViewportSize({ width: 1024, height: 600 });
    await filters
      .getByRole("button", { name: "WWWWWWWW 0", exact: true })
      .scrollIntoViewIfNeeded();
    await expect(filters.locator(".history-filter-help")).toBeInViewport({
      ratio: 1,
    });
    await expect(
      page.getByRole("textbox", { name: "Add a note" }),
    ).toBeInViewport({ ratio: 1 });
    await page.screenshot({
      path: testInfo.outputPath("filters-short-desktop.png"),
    });
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  await filters.getByRole("button", { name: "All 3", exact: true }).click();
  await filters.getByRole("button", { name: "Review 1", exact: true }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("textbox", { name: "Label name 1" }).fill("Checked");
  await page
    .getByRole("checkbox", { name: "Enable Checked", exact: true })
    .uncheck();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    filters.getByRole("button", { name: "All 3", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(filters.getByRole("button", { name: /Checked/ })).toHaveCount(0);
  await expect(
    page.getByRole("article").filter({ hasText: "Both" }),
  ).toContainText("Checked");
  await localApp.restart();
  await page.reload();
  await page
    .getByRole("button", { name: "Open Compact labels", exact: true })
    .click();
  await expect(
    page.getByRole("article").filter({ hasText: "Both" }),
  ).toContainText("Checked");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const remove = page.getByRole("button", {
    name: "Delete Checked",
    exact: true,
  });
  await remove.scrollIntoViewIfNeeded();
  const removeBounds = (await remove.boundingBox())!;
  const enabledBounds = (await page
    .getByRole("checkbox", { name: "Enable Checked", exact: true })
    .boundingBox())!;
  expect(removeBounds.x).toBeGreaterThan(enabledBounds.x + enabledBounds.width);
  await remove.click();
  await expect(
    page.getByRole("button", { name: "Reorder Checked" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("article").filter({ hasText: "Both" }),
  ).not.toContainText("Checked");
});

test("keeps desktop filters independent of composer growth and matches shortcut typography", async ({
  page,
  request,
  localApp,
  isMobile,
}, testInfo) => {
  test.skip(
    isMobile,
    "Desktop vertical rail; mobile keeps horizontal filters.",
  );
  await page.setViewportSize({ width: 1024, height: 768 });
  const project = await (
    await request.post(`${localApp.url}/api/chats`, {
      data: { title: "Independent filters", accent: "ocean" },
    })
  ).json();
  await request.patch(`${localApp.url}/api/chats/${project.id}`, {
    data: {
      enabledLabels: ["todo", "decision", "open-question", "risk", "milestone"],
    },
  });
  await page.goto(localApp.url);
  await page
    .getByRole("button", { name: "Open Independent filters", exact: true })
    .click();
  const filters = page.getByRole("navigation", { name: "History filters" });
  const input = page.getByRole("textbox", { name: "Add a note" });
  const before = (await filters.boundingBox())!;
  await input.fill("One\nTwo\nThree\nFour\nFive\nSix\nSeven\nEight");
  const after = (await filters.boundingBox())!;
  expect(after.height).toBeCloseTo(before.height, 0);
  expect(after.y + after.height).toBe(768);
  const list = filters.locator(".history-filter-inner");
  expect(
    await list.evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
  ).toBe(true);
  await expect(
    filters.getByRole("button", { name: "Milestone 0", exact: true }),
  ).toBeInViewport({ ratio: 1 });
  const composerBounds = (await page.locator(".composer-wrap").boundingBox())!;
  expect(after.x + after.width).toBeLessThanOrEqual(composerBounds.x);
  const font = (el: Element) => {
    const css = getComputedStyle(el);
    return [
      css.fontFamily,
      css.fontSize,
      css.fontWeight,
      css.fontStyle,
      css.lineHeight,
      css.color,
      css.letterSpacing,
    ];
  };
  expect(await filters.locator(".history-filter-help").evaluate(font)).toEqual(
    await page.locator(".composer-shortcut").evaluate(font),
  );
  await page.screenshot({
    path: testInfo.outputPath("filters-expanded-composer.png"),
  });
  await page
    .getByRole("button", { name: "Search messages", exact: true })
    .click();
  expect((await filters.boundingBox())!.height).toBeCloseTo(before.height, 0);
  await page.screenshot({
    path: testInfo.outputPath("filters-expanded-search.png"),
  });
  await page
    .getByRole("searchbox", { name: "Search messages", exact: true })
    .press("Escape");
  const current = await (
    await request.get(`${localApp.url}/api/chats/${project.id}`)
  ).json();
  await request.patch(`${localApp.url}/api/chats/${project.id}`, {
    data: {
      labelConfiguration: {
        revision: current.labelConfigurationRevision,
        labels: [
          ...current.labelDefinitions.map(
            ({
              id,
              name,
              symbol,
              enabled,
            }: {
              id: string;
              name: string;
              symbol: string | null;
              enabled: boolean;
            }) => ({ id, name, symbol, enabled }),
          ),
          ...Array.from({ length: 5 }, (_, i) => ({
            name: `Custom${i}`,
            symbol: null,
            enabled: true,
          })),
        ],
      },
    },
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.setViewportSize({ width: 1024, height: 600 });
  await expect(
    filters.getByRole("button", { name: "Custom4 0", exact: true }),
  ).toBeVisible();
  expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(
    true,
  );
  await filters
    .getByRole("button", { name: "Custom4 0", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    filters.getByRole("button", { name: "Custom4 0", exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await expect(filters.locator(".history-filter-help")).toBeInViewport({
    ratio: 1,
  });
  await page.screenshot({
    path: testInfo.outputPath("filters-short-overflow.png"),
  });
});

test("validates inline, aligns rows and saves cleared custom labels without losing messages", async ({
  page,
  request,
  localApp,
  isMobile,
}, testInfo) => {
  const project = await (
    await request.post(`${localApp.url}/api/chats`, {
      data: { title: "Label editing", accent: "ocean" },
    })
  ).json();
  await page.goto(localApp.url);
  await page
    .getByRole("button", { name: "Open Label editing", exact: true })
    .click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const labelName = page.getByRole("textbox", {
    name: "Label name 1",
    exact: true,
  });
  const symbol = page.getByRole("textbox", {
    name: "Label symbol 1",
    exact: true,
  });
  await expect(labelName).toHaveAttribute("placeholder", "Label name");
  await labelName.fill("123456789");
  await expect(labelName).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("alert")).toContainText(
    "Use 1–8 visible characters",
  );
  await page.screenshot({
    path: testInfo.outputPath("labels-inline-error.png"),
  });
  await labelName.fill("Review");
  await symbol.fill("ab");
  await expect(symbol).toHaveAttribute("aria-invalid", "true");
  await symbol.fill("✓");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "Label name 2", exact: true })
    .fill("Ready");
  const dimensions = await page
    .locator(".project-label-edit-row")
    .evaluateAll((rows) =>
      rows.map((row) => {
        const fields = row.querySelector(".project-label-edit-fields")!;
        const name = fields.querySelector(".custom-label-name")!;
        const symbol = fields.querySelector(".custom-label-symbol")!;
        const rect = row.getBoundingClientRect();
        return {
          height: rect.height,
          width: rect.width,
          nameX: name.getBoundingClientRect().x,
          symbolX: symbol.getBoundingClientRect().x,
          symbolWidth: symbol.getBoundingClientRect().width,
        };
      }),
    );
  for (const row of dimensions) expect(row).toEqual(dimensions[0]);
  for (const theme of ["light", "neutral", "dark"]) {
    await request.patch(`${localApp.url}/api/preferences`, { data: { theme } });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await labelName.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`labels-aligned-${theme}.png`),
    });
  }
  if (!isMobile) {
    await page.setViewportSize({ width: 320, height: 720 });
    await expect(labelName).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("labels-320.png") });
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Edit", exact: true }),
  ).toBeVisible();
  const detail = await (
    await request.get(`${localApp.url}/api/chats/${project.id}`)
  ).json();
  const review = detail.labelDefinitions.find(
    (label: { name: string }) => label.name === "Review",
  );
  const note = await (
    await request.post(`${localApp.url}/api/chats/${project.id}/notes`, {
      multipart: { body: "Keep this message" },
    })
  ).json();
  for (const id of [review.id, "pin"])
    await request.put(
      `${localApp.url}/api/chats/${project.id}/notes/${note.id}/labels/${id}`,
    );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("article")).toContainText("Review");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await symbol.fill("");
  await labelName.fill("");
  await expect(labelName).toHaveValue("Ready");
  await labelName.fill("");
  await expect(page.getByRole("textbox", { name: /^Label name/ })).toHaveCount(
    1,
  );
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("article")).toContainText("Keep this message");
  await expect(page.getByRole("article")).not.toContainText("Review");
  await expect(
    page
      .getByRole("navigation", { name: "History filters" })
      .getByRole("button", { name: /Review/ }),
  ).toHaveCount(0);
  const after = await (
    await request.get(`${localApp.url}/api/chats/${project.id}`)
  ).json();
  expect(after.labelDefinitions).toHaveLength(7);
  expect(after.notes[0].labels).toEqual(["pin"]);
  await page.reload();
  await page
    .getByRole("button", { name: "Open Label editing", exact: true })
    .click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("textbox", { name: /^Label name/ })).toHaveCount(
    1,
  );
  await expect(labelName).toHaveValue("");
});
