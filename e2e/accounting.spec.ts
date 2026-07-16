import { test, expect } from "@playwright/test";

// Runs against a fresh database (see global-setup.ts): the first visit to
// /login shows the initial-setup form, which creates the admin account.

test.describe.configure({ mode: "serial" });

test("initial setup creates the admin account", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByText("Erste Einrichtung")).toBeVisible();

  await page.locator("#name").fill("E2E Admin");
  await page.locator("#email").fill("admin@example.com");
  await page.locator("#password").fill("super-secret-1");
  await page.getByRole("button", { name: "Administratorkonto erstellen" }).click();

  await expect(page.getByText("Willkommen, E2E Admin!")).toBeVisible();
});

test("create an entry and see it in ledger, report and CSV", async ({ page }) => {
  // Sign in (session cookies are not shared between tests).
  await page.goto("/login");
  await page.locator("#email").fill("admin@example.com");
  await page.locator("#password").fill("super-secret-1");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.getByText("Willkommen, E2E Admin!")).toBeVisible();

  await page.goto("/accounting");
  await page.getByRole("button", { name: "Neuer Eintrag" }).click();

  await page.locator("#entry-date").fill("2026-07-10");
  await page.locator("#entry-description").fill("Playwright Hosting");
  await page.locator("#entry-counterparty").fill("Test GmbH");

  await page.locator("#entry-category").click();
  await page.getByRole("option", { name: "Software & Hosting" }).click();

  await page.locator("#entry-amount").fill("120");
  // Live VAT breakdown appears (120 gross @ 20% = 100 net + 20 VAT).
  await expect(page.getByText("Netto: € 100,00")).toBeVisible();

  // Attach a receipt (PDF) before saving.
  await page.locator('input[type="file"]').setInputFiles({
    name: "beleg.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n%%EOF\n"),
  });
  await expect(page.getByText("beleg.pdf")).toBeVisible();

  await page.getByRole("button", { name: "Speichern" }).click();

  // Row appears in the ledger with negative (expense) amounts.
  const row = page.getByRole("row", { name: /Playwright Hosting/ });
  await expect(row).toBeVisible();
  await expect(row).toContainText("-€ 120,00");
  await expect(row).toContainText("Test GmbH");

  // Report shows the entry in July.
  await page.goto("/accounting/report?year=2026");
  const july = page.getByRole("row", { name: /Juli/ });
  await expect(july).toContainText("€ 120,00");

  // CSV export contains the entry, German-formatted.
  const response = await page.request.get("/api/accounting/export?year=2026");
  expect(response.status()).toBe(200);
  const csv = await response.text();
  expect(csv).toContain("Playwright Hosting");
  expect(csv).toContain("10.07.2026;Ausgabe;Playwright Hosting;Test GmbH");
  expect(csv).toContain("100,00;20;20,00;120,00");
});

test("edit and delete the entry", async ({ page }) => {
  await page.goto("/login");
  await page.locator("#email").fill("admin@example.com");
  await page.locator("#password").fill("super-secret-1");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.getByText("Willkommen, E2E Admin!")).toBeVisible();

  await page.goto("/accounting");
  await page.getByRole("row", { name: /Playwright Hosting/ }).click();
  await expect(page.getByText("Eintrag bearbeiten")).toBeVisible();

  // The receipt uploaded on creation is listed and downloadable.
  const receiptLink = page.getByRole("link", { name: "beleg.pdf" });
  await expect(receiptLink).toBeVisible();
  const href = await receiptLink.getAttribute("href");
  const download = await page.request.get(href!);
  expect(download.status()).toBe(200);
  expect(download.headers()["content-type"]).toBe("application/pdf");

  await page.locator("#entry-description").fill("Playwright Hosting (edited)");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(
    page.getByRole("row", { name: /Playwright Hosting \(edited\)/ }),
  ).toBeVisible();

  await page.getByRole("row", { name: /Playwright Hosting \(edited\)/ }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Eintrag löschen" }).click();
  await expect(page.getByText("Noch keine Einträge in diesem Zeitraum.")).toBeVisible();
});

test("language switcher changes the UI to English and back", async ({ page }) => {
  await page.goto("/login");
  await page.locator("#email").fill("admin@example.com");
  await page.locator("#password").fill("super-secret-1");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.getByText("Willkommen, E2E Admin!")).toBeVisible();

  // Open the user menu and switch to English.
  await page.getByText("admin@example.com").first().click();
  await page.getByText("Sprache").hover();
  await page.getByRole("menuitem", { name: "Englisch" }).click();
  await expect(page.getByText("Welcome, E2E Admin!")).toBeVisible();

  // Sidebar is translated too.
  await expect(page.getByRole("link", { name: "Accounting" })).toBeVisible();

  // And back to German (cookie persists across reloads).
  await page.getByText("admin@example.com").first().click();
  await page.getByText("Language").hover();
  await page.getByRole("menuitem", { name: "German" }).click();
  await expect(page.getByText("Willkommen, E2E Admin!")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Willkommen, E2E Admin!")).toBeVisible();
});
