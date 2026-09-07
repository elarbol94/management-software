import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 1000 } });
async function action(page: Page, name: string) {
  await page.getByRole("button", { name: "Aktionen", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}
async function pathPanel(page: Page) {
  const button = page.getByRole("button", { name: "Weg", exact: true });
  if (await button.getAttribute("aria-expanded") !== "true") await button.click();
}


/**
 * Golden-path coverage for the wiki presentation mode: create from a template, edit the
 * canvas, add a path step, then present and confirm the presenter-notes popup follows
 * along. No edge cases here on purpose -- this is the one flow every other test assumes
 * works.
 */

async function login(page: Page) {
  // The shared admin account every other spec uses. `src/lib/auth.ts` forbids public signup
  // once any user exists, so a spec-local account 403s in any run where another spec
  // bootstrapped the admin first -- sign in if it is already there, bootstrap it if not.
  const credentials = { username: "admin", password: "super-secret-1" };
  let response = await page.request.post("/api/auth/sign-in/username", { data: credentials });
  // The auth route can 404 for a moment while the dev server compiles it (see
  // calendar.spec.ts), so retry the sign-in/bootstrap pair rather than either half alone.
  for (let attempt = 0; !response.ok() && attempt < 3; attempt += 1) {
    if (attempt > 0) await page.waitForTimeout(500);
    response = await page.request.post("/api/auth/sign-up/email", {
      data: {
        name: "E2E Admin",
        username: "admin",
        displayUsername: "admin",
        email: "admin@example.com",
        password: "super-secret-1",
      },
    });
    if (!response.ok()) {
      response = await page.request.post("/api/auth/sign-in/username", { data: credentials });
    }
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
  await page.getByRole("button", { name: "Neu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Leer oder aus Vorlage", exact: true }).click();
  await page.getByRole("textbox", { name: "Titel der Präsentation" }).fill(title);
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
  await pathPanel(page);
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
  await page.getByRole("button", { name: "Neu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Leer oder aus Vorlage", exact: true }).click();
  await page.getByRole("textbox", { name: "Titel der Präsentation" }).fill(title);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Pitch", exact: true }).click();
  await page.waitForURL(/\/wiki\/presentations\/[^/]+$/, { timeout: 30_000 });
  await expect(page.getByRole("textbox", { name: "Titel der Präsentation" })).toHaveValue(title);
  // A rendered breadcrumb can appear before hydration and the initial edit lease.
  await expect(page.getByRole("button", { name: "Text", exact: true })).toBeEnabled();
}

test("mobile editing exposes the path and saves a focused title before presenting", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await openNewPitchEditor(page, `E2E Mobile ${Date.now()}`);
  await page.getByRole("button", { name: "Text", exact: true }).click();
  await page.getByRole("textbox", { name: "Text", exact: true }).fill("Mobile stop");
  await page.getByRole("button", { name: "Seitenbereich schließen" }).click();
  await pathPanel(page);
  const panel = page.getByRole("dialog");
  await panel.getByRole("button", { name: "Auswahl als Station" }).click();
  await expect(panel.getByRole("button", { name: "Mobile stop", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Seitenbereich schließen" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("mobile-editor.png"), fullPage: true });
  const editorUrl = page.url();
  const title = `Renamed on mobile ${Date.now()}`;
  await page.getByRole("textbox", { name: "Titel der Präsentation" }).fill(title);
  await page.getByRole("link", { name: "Präsentieren", exact: true }).click();
  const player = page.getByTestId("presentation-player");
  await expect(player.getByRole("status")).toHaveText("1 / 5");
  const exit = player.getByRole("button", { name: "Präsentation beenden" });
  await expect(exit).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("mobile-player.png"), fullPage: true });
  await exit.click();
  await page.waitForURL(editorUrl);
  await expect(page.getByRole("textbox", { name: "Titel der Präsentation" })).toHaveValue(title);
});

test("rotation keeps an element in place and Save commits the currently focused field", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await login(page);
  await openNewPitchEditor(page, `E2E Geometry ${Date.now()}`);
  const node = page.getByTestId("rf__node-pitch-title");
  await node.click();
  const before = await node.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  });
  const rotation = page.getByLabel("Drehung (Grad)");
  await rotation.fill("30");
  await rotation.press("Tab");
  const after = await node.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  });
  expect(after.x).toBeCloseTo(before.x, 0);
  expect(after.y).toBeCloseTo(before.y, 0);
  const text = "Saved directly from the focused property field";
  await page.getByRole("textbox", { name: "Text", exact: true }).fill(text);
  await action(page, "Speichern");
  await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("desktop-editor.png"), fullPage: true });
  await page.reload();
  await expect(page.getByTestId("rf__node-pitch-title")).toContainText(text);
});

test("restoring history drains pending edits and cannot be overwritten by autosave", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  const title = `E2E Restore ${Date.now()}`;
  await openNewPitchEditor(page, title);
  await page.getByTestId("rf__node-pitch-title").click();
  const content = page.getByRole("textbox", { name: "Text", exact: true });
  await content.fill("First edit");
  await action(page, "Speichern");
  await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible();
  await content.fill("Pending edit immediately before restoring");
  await action(page, "Versionen");
  const restore = page.getByRole("button", { name: "Wiederherstellen", exact: true }).first();
  await expect(restore).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await restore.click();
  await expect(page.getByTestId("rf__node-pitch-title")).toContainText("Your Pitch");
  await expect(page.getByRole("button", { name: "Rückgängig" })).toBeDisabled();
  await page.waitForTimeout(2_000);
  await page.reload();
  await expect(page.getByTestId("rf__node-pitch-title")).toContainText("Your Pitch");
});

test("PDF notes are opt-in and keyboard activation advances exactly one stop", async ({ page, context }) => {
  test.setTimeout(120_000);
  await login(page);
  await openNewPitchEditor(page, `E2E Print ${Date.now()}`);
  await pathPanel(page);
  await page.getByRole("button", { name: "Your Pitch", exact: true }).click();
  const notes = "Private presenter notes should not appear in the audience PDF";
  await page.getByRole("textbox", { name: "Sprechernotizen" }).fill(notes);
  const popupPromise = context.waitForEvent("page");
  await action(page, "PDF-Export");
  const print = await popupPromise;
  await expect(print.getByTestId("presentation-print")).toBeVisible();
  await expect(print.getByText(notes, { exact: true })).toHaveCount(0);
  await print.getByRole("link", { name: "Sprechernotizen einschließen" }).click();
  await expect(print.getByText(notes, { exact: true })).toBeVisible();
  await print.close();
  await page.getByRole("link", { name: "Präsentieren", exact: true }).click();
  const player = page.getByTestId("presentation-player");
  const next = player.getByRole("button", { name: "Nächste Station" });
  await next.focus();
  await next.press("Space");
  await expect(player.getByRole("status")).toHaveText("2 / 4");
  await player.getByRole("button", { name: "Präsentation beenden" }).click();
});

test("a tab that loses its lease disables all editing controls", async ({ page, context }) => {
  test.setTimeout(120_000);
  await login(page);
  await openNewPitchEditor(page, `E2E Locked ${Date.now()}`);
  await page.getByTestId("rf__node-pitch-title").click();
  const second = await context.newPage();
  await second.goto(page.url());
  await expect(second.getByRole("button", { name: "Text", exact: true })).toBeEnabled();
  await expect(page.getByRole("textbox", { name: "Titel der Präsentation" })).toBeDisabled({ timeout: 30_000 });
  await expect(page.getByRole("textbox", { name: "Text", exact: true })).toBeDisabled();
  await pathPanel(page);
  await expect(page.getByRole("button", { name: "Auswahl als Station" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Element löschen" })).toBeDisabled();
  await action(page, "Wiedergabeeinstellungen");
  await expect(page.getByLabel("Standard-Stationsdauer (s)")).toBeDisabled();
  await second.getByTestId("presentation-editor").getByRole("link", { name: "Präsentationen", exact: true }).click();
  await second.close();
});

test("browser Back preserves an edit made during the autosave debounce", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  const title = `E2E Back ${Date.now()}`;
  await openNewPitchEditor(page, title);
  // Reopen from the list so Back tests an existing deck's navigation, independently of
  // the server action that created it and invalidated the initial list route.
  await page.getByTestId("presentation-editor").getByRole("link", { name: "Präsentationen", exact: true }).click();
  await expect(page.getByRole("button", { name: "Neu", exact: true })).toBeEnabled();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link", { name: title, exact: false }).click();
  await page.getByTestId("rf__node-pitch-title").click();
  const text = "Last edit before browser Back";
  await page.getByRole("textbox", { name: "Text", exact: true }).fill(text);
  await page.getByRole("textbox", { name: "Text", exact: true }).blur();
  page.once("dialog", (dialog) => dialog.accept());
  const saved = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().includes("/api/wiki/presentations/"), { timeout: 30_000 });
  await page.goBack();
  await expect(page).toHaveURL(/\/wiki\/presentations$/);
  expect((await saved).ok()).toBe(true);
  await page.getByRole("link", { name: title, exact: false }).click();
  await expect(page.getByTestId("presentation-editor")).toBeVisible();
  // A reload distinguishes durable storage from Activity's preserved client state.
  await page.reload();
  await expect(page.getByTestId("rf__node-pitch-title")).toContainText(text);
});

test("panel inputs: a playback duration is typed digit by digit and clamped only on commit", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  await openNewPitchEditor(page, `E2E Panel Duration ${Date.now()}`);

  await action(page, "Wiedergabeeinstellungen");
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

  await page.getByRole("button", { name: "Neu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Leer oder aus Vorlage", exact: true }).click();
  await page.getByRole("textbox", { name: "Titel der Präsentation" }).fill(title);
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
  await page.getByRole("button", { name: "Neu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Leer oder aus Vorlage", exact: true }).click();
  await page.getByRole("textbox", { name: "Titel der Präsentation" }).fill(title);
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
  await page.getByRole("button", { name: "Neu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Leer oder aus Vorlage", exact: true }).click();
  await page.getByRole("textbox", { name: "Titel der Präsentation" }).fill(title);
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
  // CODE_ALPHABET from src/modules/wiki/lib/live-session.ts, spelled out rather than
  // imported: it is module-private, and the spec should not lean on `@/` alias resolution.
  expect(code).toMatch(/^[ABCDEFGHJKMNPQRTUVWXYZ2346789]{6}$/);

  // 3. A follower in a second tab of the same signed-in context.
  const follower = await context.newPage();
  await follower.goto(`/wiki/presentations/follow/${code}`);
  const badge = follower.getByTestId("presentation-player").getByRole("status");
  await expect(badge).toHaveText(/^Folgt/, { timeout: 30_000 });

  // The follower belongs to the live session, not to local keyboard/camera commands or
  // another presenter window broadcasting in this browser.
  await player.getByRole("button", { name: "Nächste Station" }).click();
  await expect.poll(async () => (await page.request.get(`/api/wiki/presentations/live/${code}`)).json().then((position) => position.stepIndex)).toBe(1);
  await follower.waitForTimeout(2_500);
  const viewport = follower.locator(".react-flow__viewport");
  const position = await viewport.getAttribute("style");
  const presentationId = new URL(page.url()).pathname.split("/")[3];
  await follower.evaluate((id) => {
    const channel = new BroadcastChannel(`wiki-presentation-presenter:${id}`);
    channel.postMessage({ type: "goto", index: 3 });
    channel.close();
  }, presentationId);
  await follower.keyboard.press("ArrowRight");
  await follower.keyboard.press("+");
  await follower.mouse.move(300, 200);
  await follower.mouse.wheel(0, -200);
  await follower.waitForTimeout(300);
  await expect(viewport).toHaveAttribute("style", position ?? "");

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
