import { expect, test } from "./fixtures.js";

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
