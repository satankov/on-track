import type { Locator } from "@playwright/test";
import { expect, test } from "./fixtures.js";

// Reconstruct the painted background rectangle from the browser's computed CSS.
async function expectSharedField(bubbles: Locator) {
  await expect
    .poll(() =>
      bubbles.evaluateAll((elements) => {
        if (!elements.length) return Infinity;
        const boxes = elements.map((el) => el.getBoundingClientRect());
        const left = Math.min(...boxes.map((box) => box.left));
        const top = Math.min(...boxes.map((box) => box.top));
        const right = Math.max(...boxes.map((box) => box.right));
        const bottom = Math.max(...boxes.map((box) => box.bottom));
        function length(value: string, basis: number) {
          if (value.endsWith("%")) return (parseFloat(value) * basis) / 100;
          if (value.endsWith("px")) return parseFloat(value);
          return basis;
        }
        return Math.max(
          ...elements.map((el, i) => {
            const box = boxes[i];
            const style = getComputedStyle(el);
            const [w, h] = style.backgroundSize.split(" ");
            const width = length(w, box.width);
            const height = length(h ?? "auto", box.height);
            const x =
              box.left + length(style.backgroundPositionX, box.width - width);
            const y =
              box.top + length(style.backgroundPositionY, box.height - height);
            return Math.max(
              Math.abs(x - left),
              Math.abs(y - top),
              Math.abs(x + width - right),
              Math.abs(y + height - bottom),
            );
          }),
        );
      }),
    )
    .toBeLessThan(0.5);
}

test("outgoing bubbles share one gradient through scrolling, reflow and search", async ({
  page,
  request,
  localApp,
}, testInfo) => {
  const response = await request.post(`${localApp.url}/api/chats`, {
    data: { title: "Synth session", accent: "ocean-gradient" },
  });
  expect(response.ok()).toBe(true);
  const { id } = await response.json();
  const notes = [
    "Take 3 has the better intro.",
    "I kept the room tone before the first note.",
    "Can we give the bass one more bar?",
    "One more bar works.",
    "The bass comes in at 0:24 now.",
    "Saved as “Night Drive · mix 04”.",
  ];
  const day = new Date(2026, 10, 15, 10, 12).getTime();
  for (const [i, body] of notes.entries()) {
    const note = await request.post(`${localApp.url}/api/chats/${id}/notes`, {
      multipart: {
        body,
        createdAt: String(day + (i > 2 ? 86400000 : 0) + i * 120000),
        ...(i === 2 ? { sender: "Maya" } : {}),
      },
    });
    expect(note.ok()).toBe(true);
  }
  const subthread = await request.post(
    `${localApp.url}/api/chats/${id}/subthreads`,
    { data: { title: "Mix notes" } },
  );
  expect(subthread.ok()).toBe(true);
  const child = await subthread.json();
  for (const body of ["The mix is quieter.", "The kick still comes through."]) {
    const note = await request.post(
      `${localApp.url}/api/chats/${child.id}/notes`,
      { multipart: { body } },
    );
    expect(note.ok()).toBe(true);
  }
  await page.goto(localApp.url);
  await page.getByRole("button", { name: "Open Synth session" }).click();
  const own = page.locator(".message-row--own .message-bubble");
  await expect(own).toHaveCount(5);
  await expectSharedField(own);
  await expect(own.first()).toHaveCSS("background-image", /165deg/);
  await expect(
    page.locator(".message-row--participant .message-bubble"),
  ).toHaveCSS("background-image", "none");
  await page.screenshot({ path: testInfo.outputPath("shared-lagoon.png") });
  const firstRow = page.locator(".message-row--own").first();
  await firstRow.getByRole("button", { name: "More message actions" }).click();
  await firstRow.getByRole("menuitem", { name: "Select messages" }).click();
  await own.nth(2).click({ modifiers: ["Shift"] });
  await expect(page.locator(".message-row input:checked")).toHaveCount(4);
  await expectSharedField(own);
  await page
    .getByRole("group", { name: "Selected message actions" })
    .getByRole("button", { name: "Cancel" })
    .click();
  await expectSharedField(own);
  const draft = page.getByLabel("Add a note", { exact: true });
  await draft.fill(
    "Session notes.\n\n" + "Mix detail for mastering.\n\n".repeat(20),
  );
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  await expect(own).toHaveCount(6);
  await expectSharedField(own);
  await own.last().getByRole("button", { name: "Show more" }).click();
  await expectSharedField(own);
  await page.setViewportSize({ width: 780, height: 450 });
  await page.locator(".history").evaluate((el) => {
    el.scrollTop = 0;
  });
  await expectSharedField(own);
  await page.locator(".history").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expectSharedField(own);
  expect(
    await page.locator(".history").evaluate((el) => el.scrollTop),
  ).toBeGreaterThan(0);
  await page.evaluate(() => {
    document.documentElement.style.zoom = "1.25";
  });
  await expectSharedField(own);
  await page.evaluate(() => {
    document.documentElement.style.zoom = "";
  });
  await page
    .getByRole("button", { name: "Search messages", exact: true })
    .click();
  await page.getByRole("searchbox").fill("the");
  await expect(own).toHaveCount(3);
  await expectSharedField(own);
  await page.getByRole("checkbox", { name: "Project", exact: true }).check();
  const group = (name: string) =>
    page
      .getByRole("region", { name, exact: true })
      .locator(".project-search-result:not([data-participant])");
  const results = group("Synth session");
  await expect(results).toHaveCount(3);
  await expectSharedField(results);
  await expect(group("Mix notes")).toHaveCount(2);
  await expectSharedField(group("Mix notes"));
  await expect(
    page.locator(".project-search-result[data-participant]"),
  ).toHaveCSS("background-image", "none");
});
