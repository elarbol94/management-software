import { test, expect, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#email").fill("admin@example.com");
  await page.locator("#password").fill("super-secret-1");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.getByText("Willkommen, E2E Admin!")).toBeVisible();
}

async function quickNote(page: Page, title: string, body: string) {
  await page.goto("/wiki/inbox");
  await page.getByRole("button", { name: "Schnelle Notiz" }).last().click();
  await expect(page).toHaveURL(/\/wiki\/pages\/unbenannte-notiz/);
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.type(title);
  await page.keyboard.press("Enter");
  await page.keyboard.type(body);
  await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await expect(page.getByRole("button", { name: title })).toBeVisible();
}

test("capture an inbox note and retain autosaved content", async ({ page }) => {
  await login(page);
  await quickNote(page, "Onboarding", "Willkommen im Team! Erste Schritte für neue Kollegen.");
  await expect(page.getByText("Willkommen im Team! Erste Schritte für neue Kollegen.")).toBeVisible();
});

test("internal links create backlinks and unified search finds content", async ({ page }) => {
  await login(page);
  await quickNote(page, "IT-Setup", "Laptop einrichten. Siehe auch: ");
  await page.locator(".ProseMirror").click();
  await page.getByRole("button", { name: "Seite verlinken" }).click();
  await page.getByRole("button", { name: "Onboarding" }).click();
  await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("link", { name: "Onboarding" }).first().click();
  await expect(page.getByText("Verweise auf diese Seite")).toBeVisible();
  await expect(page.getByRole("link", { name: "IT-Setup" }).last()).toBeVisible();
  await page.getByPlaceholder("Seiten und Quellen durchsuchen…").fill("Laptop");
  await expect(page.getByRole("link", { name: /IT-Setup/ }).first()).toBeVisible();
});

test("create a source, cite it, and render the bibliography", async ({ page }) => {
  await login(page);
  await page.goto("/wiki/sources");
  await page.getByRole("button", { name: "Neue Quelle" }).click();
  await page.getByLabel("Titel").fill("Knowledge Systems");
  await page.getByLabel("Mitwirkende").fill("Smith, Jane");
  await page.getByLabel("Erscheinungsdatum").fill("2026");
  await page.getByRole("button", { name: "Quelle anlegen" }).click();
  await expect(page).toHaveURL(/\/wiki\/sources\//);
  await expect(page.getByRole("heading", { name: "Knowledge Systems" })).toBeVisible();
  await page.getByRole("link", { name: "Onboarding" }).first().click();
  await page.locator(".ProseMirror").click();
  await page.getByRole("button", { name: "Zitat einfügen" }).click();
  await page.getByRole("button", { name: /Knowledge Systems/ }).click();
  await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Literaturverzeichnis" })).toBeVisible();
  await expect(page.getByText(/Smith, J\. \(2026\).*Knowledge Systems/)).toBeVisible();
});

test("subpages remain nested and deletion is recoverable", async ({ page }) => {
  await login(page);
  await page.goto("/wiki/pages");
  await page.getByRole("link", { name: "Onboarding" }).last().click();
  page.once("dialog", (dialog) => dialog.accept("Erster Arbeitstag"));
  await page.getByRole("button", { name: "Unterseite anlegen" }).click();
  await expect(page).toHaveURL(/\/wiki\/pages\/erster-arbeitstag/);
  page.once("dialog", (dialog) => dialog.accept("Tag Eins"));
  await page.getByRole("button", { name: "Erster Arbeitstag" }).click();
  await expect(page.getByRole("button", { name: "Tag Eins" })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Seite löschen" }).click();
  await expect(page).toHaveURL(/\/wiki\/inbox/);
  await page.goto("/wiki/trash");
  await expect(page.getByText("Tag Eins")).toBeVisible();
  await page.getByRole("button", { name: "Wiederherstellen" }).click();
  await expect(page.getByText("Tag Eins")).toHaveCount(0);
});
