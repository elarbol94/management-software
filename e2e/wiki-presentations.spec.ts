import { expect, test, type Page } from "@playwright/test";

/**
 * Golden-path coverage for the wiki presentation mode: create from a template, edit the
 * canvas, add a path step, then present and confirm the presenter-notes popup follows
 * along. No edge cases here on purpose -- this is the one flow every other test assumes
 * works.
 */

async function login(page: Page) {
  let response = await page.request.post("/api/auth/sign-in/username", {
    data: { username: "presentation-e2e", password: "super-secret-1" },
  });
  if (!response.ok()) {
    response = await page.request.post("/api/auth/sign-up/email", {
      data: {
        name: "Presentation E2E",
        username: "presentation-e2e",
        displayUsername: "presentation-e2e",
        email: "presentation-e2e@example.com",
        password: "super-secret-1",
      },
    });
  }
  expect(response.ok()).toBe(true);
  await page.goto("/wiki/presentations");
  await expect(page.getByRole("heading", { name: "Präsentationen", exact: true })).toBeVisible();
}

test("create from a template, edit an element, add a step, then present and check presenter notes", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  await login(page);

  const title = `E2E Pitch ${Date.now()}`;

  // 1. Create a presentation from the "Pitch" template.
  await page.getByRole("textbox", { name: "Titel der Präsentation" }).fill(title);
  await page.getByRole("button", { name: "Neu", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Pitch", exact: true }).click();
  await page.waitForURL(/\/wiki\/presentations\/[^/]+$/, { timeout: 30_000 });
  await expect(page.getByRole("textbox", { name: "Titel der Präsentation" })).toHaveValue(title);

  // 2. Add and edit a new element.
  const stepText = "Custom stop added by E2E test";
  await page.getByRole("button", { name: "Text", exact: true }).click();
  const contentField = page.getByRole("textbox", { name: "Text", exact: true });
  await expect(contentField).toBeVisible();
  await contentField.fill(stepText);
  await contentField.blur();

  // 3. Add it as a path step, then attach speaker notes to it.
  await page.getByRole("button", { name: "Auswahl als Station" }).click();
  const newStepRow = page.getByRole("button", { name: stepText, exact: true });
  await expect(newStepRow).toBeVisible();
  await newStepRow.click();
  const notesText = "Speaker notes for the E2E stop";
  const notesField = page.getByRole("textbox", { name: "Sprechernotizen" });
  await notesField.fill(notesText);
  await notesField.blur();
  await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible({ timeout: 15_000 });

  // 4. Enter present mode; the template's 4 stops plus our new one make 5.
  await page.getByRole("link", { name: "Präsentieren", exact: true }).click();
  await page.waitForURL(/\/wiki\/presentations\/[^/]+\/present$/, { timeout: 30_000 });
  // The overlay sits on top of the still-mounted app shell, so control lookups are scoped
  // to it -- the app sidebar has its own "Übersicht" (dashboard) nav entry underneath.
  const player = page.getByTestId("presentation-player");
  const status = player.getByText(/^\d+ \/ \d+$/);
  await expect(status).toHaveText("1 / 5");

  const next = player.getByRole("button", { name: "Nächste Station" });
  const previous = player.getByRole("button", { name: "Vorherige Station" });
  await expect(previous).toBeDisabled();

  await next.click();
  await expect(status).toHaveText("2 / 5");
  await next.click();
  await expect(status).toHaveText("3 / 5");
  await previous.click();
  await expect(status).toHaveText("2 / 5");

  await player.getByRole("button", { name: "Übersicht" }).click();
  await expect(status).toHaveText("2 / 5");

  const fullscreenToggle = player.getByRole("button", { name: "Vollbild" });
  await fullscreenToggle.click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  await fullscreenToggle.click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);

  // Walk to the last stop -- the one we just added -- before opening presenter notes.
  await next.click();
  await next.click();
  await next.click();
  await expect(status).toHaveText("5 / 5");
  await expect(next).toBeDisabled();

  // 5. The presenter-notes popup should reflect this exact stop.
  const popupPromise = context.waitForEvent("page");
  await player.getByRole("button", { name: "Präsentationsansicht öffnen" }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  await expect(popup.getByText(title)).toBeVisible({ timeout: 30_000 });
  // The BroadcastChannel round trip needs the popup's own bundle hydrated first, which on
  // a cold dev-server compile can take longer than the current step count alone.
  await expect(popup.getByText("5 / 5")).toBeVisible({ timeout: 30_000 });
  await expect(popup.getByRole("heading", { name: stepText })).toBeVisible();
  await expect(popup.getByText(notesText)).toBeVisible();
  await expect(popup.getByText("Dies ist die letzte Station")).toBeVisible();
  await popup.close();

  await player.getByRole("button", { name: "Präsentation beenden" }).click();
  await page.waitForURL(/\/wiki\/presentations\/[^/]+$/, { timeout: 30_000 });
});
