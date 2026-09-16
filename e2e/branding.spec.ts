import { expect, test } from "./fixtures.js";

for (const theme of ["light", "neutral", "dark"] as const) {
  test(`threadstr identity preserves ${theme} preferences and responsive navigation`, async ({
    page,
    localApp,
  }, testInfo) => {
    await page.addInitScript((savedTheme) => {
      localStorage.setItem("on-track-theme", savedTheme);
      localStorage.setItem("on-track-show-examples", "false");
    }, theme);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(localApp.url);
    await expect(page).toHaveTitle("threadstr");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(
      page.getByRole("button", { name: "Open example 🇳🇱 Trip to Amsterdam" }),
    ).toHaveCount(0);
    const home = page.getByRole("link", { name: "Home", exact: true });
    const logo = home.locator(
      theme !== "light" ? ".brand-wordmark--dark" : ".brand-wordmark--light",
    );
    for (const width of [1440, 960, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(home).toBeVisible();
      await expect(logo).toBeVisible();
      await expect(logo).toHaveJSProperty("complete", true);
      expect(
        await logo.evaluate((image: HTMLImageElement) => image.naturalWidth),
      ).toBeGreaterThan(0);
      expect((await logo.boundingBox())!.width).toBeCloseTo(115.2, 1);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await home.focus();
      await expect(home).toBeFocused();
      await expect(home).not.toHaveCSS("outline-style", "none");
      await home.press("Enter");
      await page.screenshot({
        path: testInfo.outputPath(`${theme}-${width}.png`),
      });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator("html").evaluate((element) => {
      element.style.zoom = "2";
    });
    await expect(home).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`${theme}-200-percent.png`),
    });
    await page.locator("html").evaluate((element) => {
      element.style.zoom = "";
    });
    await page.getByRole("button", { name: /Settings/ }).click();
    await page.getByRole("button", { name: /Backups/ }).click();
    await expect(page.getByLabel("Choose threadstr backup")).toHaveAttribute(
      "accept",
      ".on-track-backup,application/vnd.on-track.backup+sqlite",
    );
  });
}

test("forced colors keeps a readable Home wordmark", async ({
  page,
  localApp,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Forced-colors emulation requires Chromium.",
  );
  await page.emulateMedia({ forcedColors: "active" });
  await page.goto(localApp.url);
  const home = page.getByRole("link", { name: "Home", exact: true });
  await expect(home.locator(".brand-fallback")).toBeVisible();
  await expect(home.locator(".brand-fallback")).toHaveText("threadstr");
  await expect(home.locator(".brand-wordmark--light")).toBeHidden();
  await home.focus();
  await expect(home).not.toHaveCSS("outline-style", "none");
});
