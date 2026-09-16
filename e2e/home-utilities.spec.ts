import { expect, test } from "./fixtures.js";

test("Home release checks are explicit, survive navigation and reserve future reports", async ({
  page,
  localApp,
}, testInfo) => {
  let checks = 0;
  const external: string[] = [];
  page.on("request", (request) => {
    if (!request.url().startsWith(localApp.url)) external.push(request.url());
  });
  await page.route("**/api/home/releases/check", async (route) => {
    checks++;
    expect(route.request().method()).toBe("POST");
    expect(route.request().postData()).toBe("{}");
    await route.fulfill({
      json: {
        checkedAt: Date.now(),
        status: "available",
        releases: [
          {
            version: "0.0.9",
            url: "https://github.com/satankov/on-track/releases/tag/v0.0.9",
          },
        ],
        update: {
          version: "0.0.9",
          kind: "managed",
          command: "thr update v0.0.9",
        },
      },
    });
  });
  await page.goto(localApp.url);
  await expect(
    page.getByRole("button", { name: "Check releases" }),
  ).toHaveCount(1);
  await expect(page.getByText("Report a bug — coming soon")).toBeVisible();
  expect(checks).toBe(0);
  await page.getByRole("button", { name: "Check releases" }).click();
  await expect(page.getByText("thr update v0.0.9")).toBeVisible();
  expect(checks).toBe(1);
  await page.getByRole("button", { name: "New project" }).click();
  const title = `Home ${testInfo.project.name}`;
  await page.getByLabel("Project name").fill(title);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByRole("button", { name: "Check again" })).toHaveCount(
    0,
  );
  if (testInfo.project.name === "mobile-webkit")
    await page.getByRole("button", { name: "Back to projects" }).click();
  else await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.getByText("thr update v0.0.9")).toBeVisible();
  expect(checks).toBe(1);
  await expect(page.getByRole("button", { name: /report a bug/i })).toHaveCount(
    0,
  );
  await page.route("**/api/home/releases/check", (route) =>
    route.fulfill({
      status: 503,
      json: {
        message: "Could not reach GitHub. Check your connection and try again.",
      },
    }),
  );
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(page.getByRole("alert")).toContainText("Could not reach GitHub");
  await expect(page.getByText("thr update v0.0.9")).toBeVisible();
  expect(external).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
