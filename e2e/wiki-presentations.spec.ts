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

  // "Problem" now fills the view, so a click mid-screen lands on that frame node rather
  // than on empty canvas. Clicking the frame we are already looking inside must advance
  // like an empty-canvas click, not re-frame it -- decks whose every node is enclosed by
  // a frame would otherwise lose click-to-advance completely.
  await player.locator('[data-testid="rf__node-pitch-problem"]').click();
  await expect(status).toHaveText("3 / 5");

  const fullscreenToggle = player.getByRole("button", { name: "Vollbild" });
  await fullscreenToggle.click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  await fullscreenToggle.click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);

  // Walk to the last stop -- the one we just added -- before opening presenter notes.
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
 * The editor's side panel starts where the golden path's step 1 ends: a fresh Pitch
 * presentation open in the editor.
 */
async function openNewPitchEditor(page: Page, title: string) {
  await page.getByRole("textbox", { name: "Titel der Präsentation" }).fill(title);
  await page.getByRole("button", { name: "Neu", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Pitch", exact: true }).click();
  await page.waitForURL(/\/wiki\/presentations\/[^/]+$/, { timeout: 30_000 });
  await expect(page.getByRole("textbox", { name: "Titel der Präsentation" })).toHaveValue(title);
}

test("panel inputs: a playback duration is typed digit by digit and clamped only on commit", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  await openNewPitchEditor(page, `E2E Panel Duration ${Date.now()}`);

  await page.getByRole("button", { name: "Wiedergabeeinstellungen" }).click();
  const duration = page.getByLabel("Standard-Stationsdauer (s)");
  await expect(duration).toBeVisible();

  // Typed rather than pasted, because the bug was per-keystroke: the "0" of "0.8" was
  // clamped to the minimum "0.5" and the rest typed onto the end of it.
  await duration.selectText();
  await duration.pressSequentially("0.8");
  await expect(duration).toHaveValue("0.8");
  await duration.press("Tab");
  await expect(duration).toHaveValue("0.8");

  // Below the schema's minimum: clamped once, when the entry is finished.
  await duration.fill("0.4");
  await duration.press("Tab");
  await expect(duration).toHaveValue("0.5");

  // An empty field is not a duration, so the stored one stays.
  await duration.fill("");
  await duration.press("Tab");
  await expect(duration).toHaveValue("0.5");

  const camera = page.getByLabel("Kamera-Übergang (s)");
  await camera.selectText();
  await camera.pressSequentially("2.5");
  await expect(camera).toHaveValue("2.5");
  await camera.press("Tab");
  await expect(camera).toHaveValue("2.5");
});

test("panel inputs: undo puts the canvas value back into the side panel", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  await openNewPitchEditor(page, `E2E Panel Undo ${Date.now()}`);

  // The Pitch template's title element, selected on the canvas so the panel edits it.
  const titleNode = page.locator('[data-testid="rf__node-pitch-title"]');
  await expect(titleNode).toBeVisible();
  await titleNode.click();
  const contentField = page.getByRole("textbox", { name: "Text", exact: true });
  await expect(contentField).toHaveValue("Your Pitch");

  await contentField.fill("Changed title");
  await contentField.blur();
  await expect(titleNode).toContainText("Changed title");

  const undo = page.getByRole("button", { name: "Rückgängig" });
  await undo.click();
  await expect(titleNode).toContainText("Your Pitch");
  // The panel used to keep showing the undone text, and re-applied it on the next blur.
  await expect(contentField).toHaveValue("Your Pitch");

  await contentField.click();
  await contentField.blur();
  await expect(contentField).toHaveValue("Your Pitch");
  await expect(titleNode).toContainText("Your Pitch");
  // Leaving a field alone is not an edit, so there is still nothing left to undo.
  await expect(undo).toBeDisabled();
});


/**
 * Regression: "Präsentieren" is a client-side navigation that used to unmount the editor
 * mid-autosave-debounce, so an edit made in the last ~1.2s never reached the database and
 * the player -- which is server-rendered from it -- simply did not have it.
 */
test("presenting flushes the pending autosave instead of losing the last edit", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);

  const title = `E2E Autosave ${Date.now()}`;

  await page.getByRole("textbox", { name: "Titel der Präsentation" }).fill(title);
  await page.getByRole("button", { name: "Neu", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Pitch", exact: true }).click();
  await page.waitForURL(/\/wiki\/presentations\/[^/]+$/, { timeout: 30_000 });
  await expect(page.getByRole("textbox", { name: "Titel der Präsentation" })).toHaveValue(title);

  // The point of the test: no wait for "Gespeichert" between the edit and the navigation.
  const lateText = "Late edit that must survive presenting";
  await page.getByRole("button", { name: "Text", exact: true }).click();
  const contentField = page.getByRole("textbox", { name: "Text", exact: true });
  await expect(contentField).toBeVisible();
  await contentField.fill(lateText);
  await contentField.blur();
  await page.getByRole("link", { name: "Präsentieren", exact: true }).click();

  await page.waitForURL(/\/wiki\/presentations\/[^/]+\/present$/, { timeout: 30_000 });
  await expect(page.getByTestId("presentation-player").getByText(lateText)).toBeVisible({ timeout: 30_000 });
});


/**
 * A reload mints a new editor session while the previous page load's lease is still warm.
 * The author must get their own lease back at once instead of watching a banner name them
 * as the blocking editor for the next sixty seconds. Editing after the reload is what
 * proves it: while the stale lease still counts as foreign the autosave is refused, so
 * "Gespeichert" never arrives.
 */
test("reloading the editor reclaims the author's own lease so edits still save", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);

  const title = `E2E Reload ${Date.now()}`;
  await page.getByRole("textbox", { name: "Titel der Präsentation" }).fill(title);
  await page.getByRole("button", { name: "Neu", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Pitch", exact: true }).click();
  await page.waitForURL(/\/wiki\/presentations\/[^/]+$/, { timeout: 30_000 });
  await expect(page.getByRole("textbox", { name: "Titel der Präsentation" })).toHaveValue(title);

  await page.reload();
  await expect(page.getByRole("textbox", { name: "Titel der Präsentation" })).toHaveValue(title, { timeout: 30_000 });

  // The edit has to survive the round trip, not just render: a lease still held by the
  // previous page load blocks the autosave and leaves the save state on "Fehler".
  await page.getByRole("button", { name: "Text", exact: true }).click();
  const contentField = page.getByRole("textbox", { name: "Text", exact: true });
  await expect(contentField).toBeVisible();
  await contentField.fill(`Edited after reload ${Date.now()}`);
  await contentField.blur();
  await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible({ timeout: 15_000 });

  // The claim has certainly resolved by now, so an absent banner means an absent lock.
  await expect(page.getByText("bearbeitet diese Präsentation gerade")).toHaveCount(0);
});
