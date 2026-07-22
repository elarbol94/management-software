import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

async function login(page: Page) {
  let response = await page.request.post("/api/auth/sign-in/username", { data: { username: "admin", password: "super-secret-1" } });
  if (!response.ok()) {
    const signup = await page.request.post("/api/auth/sign-up/email", {
      data: { name: "E2E Admin", username: "admin", displayUsername: "admin", email: "admin@example.com", password: "super-secret-1" },
    });
    if (!signup.ok()) throw new Error(`Could not bootstrap E2E account (${signup.status()}): ${await signup.text()}`);
    response = signup;
  }
  expect(response.ok()).toBe(true);
  await page.goto("/wiki/inbox");
  await expect(page.getByRole("button", { name: "Schnelle Notiz" }).last()).toBeVisible();
}

test("inline images accept whole-image comments and keep their anchor after reload", async ({ page }) => {
  await login(page);
  await quickNote(page, "Image Comments", "An image follows.");
  await page.getByTestId("wiki-inline-image-input").setInputFiles({
    name: "diagram.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
  });

  const image = page.locator("figure[data-commentable-image]");
  await expect(image).toBeVisible();
  await image.click();
  await page.getByRole("button", { name: "Ganzes Bild kommentieren" }).click();
  const dialog = page.getByRole("dialog", { name: "Bild kommentieren" });
  await dialog.getByPlaceholder("Kommentar oder @Name-Erwähnung schreiben…").fill("Diagramm prüfen");
  await dialog.getByRole("button", { name: "Kommentieren", exact: true }).click();

  await expect(page.getByTestId("comment-anchor-overlay").getByRole("button", { name: "Open comment" })).toBeVisible();
  await expect(page.getByTestId("comment-rail")).toContainText("Diagramm prüfen");
  await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await expect(page.locator("figure[data-commentable-image]")).toBeVisible();
  await expect(page.getByTestId("comment-anchor-overlay").getByRole("button", { name: "Open comment" })).toBeVisible();
});

async function quickNote(page: Page, title: string, body: string) {
  await page.goto("/wiki/inbox");
  await page.getByRole("button", { name: "Schnelle Notiz" }).last().click();
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.type(title);
  await page.keyboard.press("Enter");
  await page.keyboard.type(body);
  await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.reload();
}

test("selection comments stay beside their anchors and support replies and resolution", async ({ page }) => {
  await login(page);
  await quickNote(page, "Comment Rail", "A nearby text anchor");
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("ControlOrMeta+Shift+ArrowLeft");
  await page.getByRole("button", { name: "Auswahl kommentieren" }).click();
  const commentDialog = page.getByRole("dialog", { name: "Auswahl kommentieren" });
  await commentDialog.getByPlaceholder("Kommentar oder @Name-Erwähnung schreiben…").fill("Bitte genauer erklären");
  await commentDialog.getByRole("button", { name: "Kommentieren", exact: true }).click();

  const anchor = editor.locator("mark[data-comment-thread]");
  await expect(anchor).toHaveCount(1);
  const threadId = await anchor.getAttribute("data-comment-thread");
  expect(threadId).toBeTruthy();
  const card = page.getByTestId(`comment-card-${threadId}`);
  await expect(card).toContainText("Bitte genauer erklären");
  await expect(page.getByTestId("comment-connectors").locator(`path[data-comment-thread='${threadId}']`)).toHaveCount(1);

  await anchor.click();
  await expect(anchor).toHaveClass(/is-active/);
  await page.getByTestId(`comment-reply-${threadId}`).fill("Das ist jetzt präzisiert.");
  await card.getByRole("button", { name: "Antworten" }).click();
  await expect(card).toContainText("Das ist jetzt präzisiert.");

  await card.getByRole("button", { name: "Erledigen" }).click();
  await expect(card).toHaveCount(0);
  await page.getByTestId("comment-filter-resolved").click();
  const resolvedCard = page.getByTestId(`comment-card-${threadId}`);
  await expect(resolvedCard).toContainText("Erledigt");
  await resolvedCard.click();
  await resolvedCard.getByRole("button", { name: "Wieder öffnen" }).click();
  await expect(page.getByTestId(`comment-card-${threadId}`)).toContainText("Offen");
});

test("general comments lead the rail and mobile slash comments open the sheet", async ({ page }) => {
  await login(page);
  await quickNote(page, "General Comments", "Page-level context");
  const rail = page.getByTestId("comment-rail");
  await rail.getByTestId("page-comment-input").fill("Allgemeiner Hinweis");
  await rail.getByRole("button", { name: "Kommentieren" }).click();
  await expect(rail).toContainText("Allgemeiner Hinweis");
  await expect(rail.getByText("Allgemeiner Kommentar").first()).toBeVisible();

  await page.setViewportSize({ width: 800, height: 900 });
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/kommentar");
  await page.keyboard.press("Enter");
  const sheet = page.getByTestId("comment-sheet");
  await expect(sheet.getByRole("heading", { name: "Kommentare", exact: true })).toBeVisible();
  await expect(sheet.getByTestId("mobile-page-comment-input")).toBeFocused();
});

test("metadata version changes do not cause repeated conflicts and older revisions restore visibly", async ({ page }) => {
  await login(page);
  await quickNote(page, "Revision Restore", "Original version");

  await page.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "In Arbeit" }).click();

  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" Newer version");
  await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Bearbeitungskonflikt", { exact: true })).toHaveCount(0);

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Wiederherstellen", exact: true }).first().click();
  await expect(page.locator(".ProseMirror")).toContainText("Original version");
  await expect(page.locator(".ProseMirror")).not.toContainText("Newer version");
  await expect(page.getByText("Bearbeitungskonflikt", { exact: true })).toHaveCount(0);
});
