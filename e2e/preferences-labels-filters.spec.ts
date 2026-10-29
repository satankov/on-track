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
});

test("combines built-in filters with keyboard modifiers and touch toggles", async ({
  page,
  request,
  localApp,
  isMobile,
}) => {
  const project = await (
    await request.post(`${localApp.url}/api/chats`, {
      data: { title: "Combined filters", accent: "ocean" },
    })
  ).json();
  const notes: string[] = [];
  for (const body of [
    "Both https://example.com",
    "Link https://example.org",
    "Pinned plain",
  ]) {
    notes.push(
      (
        await (
          await request.post(`${localApp.url}/api/chats/${project.id}/notes`, {
            multipart: { body },
          })
        ).json()
      ).id,
    );
  }
  for (const id of [notes[0], notes[2]])
    await request.put(
      `${localApp.url}/api/chats/${project.id}/notes/${id}/labels/pin`,
    );
  await page.goto(localApp.url);
  await page
    .getByRole("button", { name: "Open Combined filters", exact: true })
    .click();
  const filters = page.getByRole("navigation", { name: "History filters" });
  const links = filters.getByRole("button", { name: "Links 2", exact: true });
  const pin = filters.getByRole("button", { name: "Pin 2", exact: true });
  await links.click();
  if (isMobile) await pin.tap();
  else {
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
  await filters.getByRole("button", { name: "All 3", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(3);
});
