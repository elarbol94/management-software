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

  // 3b. A second element deliberately left off the path, to exercise the click-to-jump
  // "free look" case once presenting: clicking it must fly the camera there without
  // touching the step index. Its id is minted client-side, so it is read back off the
  // node's own data-testid rather than hard-coded.
  const freeText = "Free element not on the path";
  await page.getByRole("button", { name: "Text", exact: true }).click();
  await contentField.fill(freeText);
  await contentField.blur();
  const freeNode = page.locator(".react-flow__node", { hasText: freeText });
  await expect(freeNode).toBeVisible();
  const freeElementId = (await freeNode.getAttribute("data-testid"))?.replace("rf__node-", "");
  expect(freeElementId).toBeTruthy();
  // "Präsentieren" below is a client-side navigation that unmounts the editor without
  // flushing the autosave debounce, so this edit must actually be persisted first or
  // /present (server-rendered from the DB) simply won't have the free element.
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

  // Click-to-jump. The overview above put every element in view, which the checks below
  // rely on: clicking the "Ask" frame (a step target) must move the player there through
  // the normal setIndex path, same as Next/Previous; re-opening the overview between clicks
  // keeps the next target reachable once the camera has flown in tight on the previous one.
  await player.locator('[data-testid="rf__node-pitch-ask"]').click();
  await expect(status).toHaveText("4 / 5");

  // The free element is not a step target, so clicking it only flies the camera there --
  // the status must stay put.
  await player.getByRole("button", { name: "Übersicht" }).click();
  await player.locator(`[data-testid="rf__node-${freeElementId}"]`).click();
  await expect(status).toHaveText("4 / 5");

  // Regression: a free-look click must not leave a gesture snap-back armed behind it, or
  // the camera flies back to the current step on its own ~900ms later with no further
  // gesture involved. Give the click's own fly-to time to settle, then confirm the camera
  // is still exactly where it landed well past that snap-back delay.
  const viewport = player.locator(".react-flow__viewport");
  await page.waitForTimeout(1_000);
  const transformAfterClick = await viewport.getAttribute("style");
  await page.waitForTimeout(1_500);
  await expect(viewport).toHaveAttribute("style", transformAfterClick ?? "");

  // Back to "Problem" so the walk below starts from the same step it always did.
  await player.getByRole("button", { name: "Übersicht" }).click();
  await player.locator('[data-testid="rf__node-pitch-problem"]').click();
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

/**
 * Leaving a live session, from both ends. A follower needs a way out that does not depend
 * on a keyboard and never lands them in the editor, and a presenter walking out of the
 * player has to take the session with them instead of leaving followers frozen on the last
 * stop until the staleness window closes.
 */
test("a follower leaves a live session from the badge, and the presenter exiting the player ends it", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  await login(page);

  const title = `E2E Live ${Date.now()}`;

  // 1. A presentation to broadcast, same as the golden path's first step.
  await page.getByRole("textbox", { name: "Titel der Präsentation" }).fill(title);
  await page.getByRole("button", { name: "Neu", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Pitch", exact: true }).click();
  await page.waitForURL(/\/wiki\/presentations\/[^/]+$/, { timeout: 30_000 });
  await expect(page.getByRole("textbox", { name: "Titel der Präsentation" })).toHaveValue(title);

  // 2. Present it and start the live session; the code is shown on the copy-link chip.
  await page.getByRole("link", { name: "Präsentieren", exact: true }).click();
  await page.waitForURL(/\/wiki\/presentations\/[^/]+\/present$/, { timeout: 30_000 });
  const player = page.getByTestId("presentation-player");
  await player.getByRole("button", { name: "Live-Sitzung starten" }).click();
  const codeChip = player.getByTitle("Follow-Link kopieren");
  await expect(codeChip).toBeVisible({ timeout: 30_000 });
  const code = (await codeChip.innerText()).trim();
  expect(code).toMatch(/^[A-Z2-9]{6}$/);

  // 3. A follower in a second tab of the same signed-in context.
  const follower = await context.newPage();
  await follower.goto(`/wiki/presentations/follow/${code}`);
  const badge = follower.getByTestId("presentation-player").getByRole("status");
  await expect(badge).toHaveText(/^Folgt/, { timeout: 30_000 });

  // 4. The badge's own exit goes to the join screen -- never to the editor, which a
  // follower has no business in and may not even be able to open.
  await follower.getByRole("link", { name: "Verlassen" }).click();
  await follower.waitForURL(/\/wiki\/presentations\/follow$/, { timeout: 30_000 });
  await follower.close();

  // 5. The presenter leaving the player ends the session, so a follower's next poll gets a
  // 404 and reads "beendet" instead of a frozen live position for the next 45 seconds.
  await player.getByRole("button", { name: "Präsentation beenden" }).click();
  await page.waitForURL(/\/wiki\/presentations\/[^/]+$/, { timeout: 30_000 });
  await expect
    .poll(async () => (await page.request.get(`/api/wiki/presentations/live/${code}`)).status(), { timeout: 20_000 })
    .toBe(404);
});
