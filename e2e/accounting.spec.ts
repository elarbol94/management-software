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
  const signupResponsePromise = page.waitForResponse((response) => response.url().includes("/api/auth/sign-up"));
  await page.getByRole("button", { name: "Administratorkonto erstellen" }).click();
  const signupResponse = await signupResponsePromise;
  expect(signupResponse.ok(), await signupResponse.text()).toBe(true);

  await expect(page.getByText("Willkommen, E2E Admin!")).toBeVisible({ timeout: 30_000 });
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
  await page.getByRole("button", { name: /Software & Hosting/ }).click();

  await page.locator("#entry-date").fill("2026-07-10");
  await page.locator("#entry-description").fill("Playwright Hosting");
  await page.locator("#entry-counterparty").fill("Test GmbH");

  await page.locator('input[id^="line-amount-"]').fill("120");
  // Live VAT breakdown appears (120 gross @ 20% = 100 net + 20 VAT).
  await expect(page.getByText("Netto: € 100,00")).toBeVisible();

  // Attach a receipt (PDF) before saving.
  await page.locator('input[type="file"]').setInputFiles({
    name: "beleg.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n%%EOF\n"),
  });
  await expect(page.getByText("beleg.pdf")).toBeVisible();

  await page.getByRole("button", { name: "Buchung finalisieren" }).click();

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

test("plan a category and compare it with actual journal entries", async ({ page }) => {
  await page.goto("/login");
  await page.locator("#email").fill("admin@example.com");
  await page.locator("#password").fill("super-secret-1");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.getByText("Willkommen, E2E Admin!")).toBeVisible();

  await page.goto("/accounting/planning?year=2026");
  await expect(page.getByRole("heading", { name: "Planung 2026" })).toBeVisible();

  const julyPlan = page.getByLabel(/Software & Hosting.*Jul$/i);
  await julyPlan.fill("100");
  await page.getByRole("button", { name: "Planung speichern" }).click();
  await expect(page.getByText("Gespeichert")).toBeVisible();

  const row = page.getByRole("row", { name: /Software & Hosting/ });
  await expect(row).toContainText("€ 100,00");
  await expect(row).toContainText("€ 120,00");
  await expect(row).toContainText("€ 20,00");

  await page.reload();
  await expect(page.getByLabel(/Software & Hosting.*Jul$/i)).toHaveValue("100,00");
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
  await page.getByRole("button", { name: "Buchung finalisieren" }).click();
  await expect(
    page.getByRole("row", { name: /Playwright Hosting \(edited\)/ }),
  ).toBeVisible();

  await page.getByRole("row", { name: /Playwright Hosting \(edited\)/ }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Buchung stornieren" }).click();
  await expect(page.getByText("Noch keine Einträge in diesem Zeitraum.")).toBeVisible();
});

test("calculate, save, and duplicate automatic personnel costs", async ({ page }) => {
  await page.goto("/login");
  await page.locator("#email").fill("admin@example.com");
  await page.locator("#password").fill("super-secret-1");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.getByText("Willkommen, E2E Admin!")).toBeVisible();

  await page.goto("/accounting/bookings?year=2026&month=7");
  await page.getByRole("button", { name: "Neuer Eintrag" }).click();
  await page.getByRole("button", { name: /Personalkosten/ }).click();

  await page.locator("#entry-date").fill("2026-07-31");
  await page.locator("#entry-description").fill("Lohnverrechnung Juli");
  await page.locator("#employee-name").fill("Max Muster");
  await page.locator("#personnel-number").fill("P-001");
  await page.locator("#payroll-month").fill("2026-07");
  await page.locator("#grossSalary").fill("2700");

  await page.locator("#employment-type").click();
  await page.getByRole("option", { name: "Lehrling" }).click();
  await page.locator("#employment-type").click();
  await page.getByRole("option", { name: "Angestellte/r" }).click();
  await page.getByRole("button", { name: "Manuell überschreiben" }).click();
  await expect(page.locator("#payroll-override-reason")).toBeVisible();
  await page.getByRole("button", { name: "Automatisch" }).click();

  await page.locator("#warning-reason").fill("Lohnabrechnung wird nachgereicht.");

  await expect(page.getByText("€ 2.002,03")).toBeVisible();
  await expect(page.getByText("€ 3.497,85")).toHaveCount(2);
  await page.getByRole("button", { name: "Buchung finalisieren" }).click();

  const row = page.getByRole("row", { name: /Lohnverrechnung Juli/ });
  await expect(row).toBeVisible();
  await expect(row).toContainText("-€ 3.497,85");
  await row.getByRole("button", { name: "Buchungsdetails ein- oder ausblenden" }).click();
  await expect(page.getByText("ÖGK")).toBeVisible();
  await expect(page.getByText("Finanzamt")).toBeVisible();
  await expect(page.getByText("Vorsorgekasse")).toBeVisible();

  await row.click();
  await page.getByRole("button", { name: "Für Folgemonat duplizieren" }).click();
  await expect(page.locator("#entry-date")).toHaveValue("2026-08-31");
  await expect(page.locator("#payroll-month")).toHaveValue("2026-08");
  await page.locator("#entry-description").fill("Lohnverrechnung August");
  await page.locator("#warning-reason").fill("Lohnabrechnung wird nachgereicht.");
  await page.getByRole("button", { name: "Buchung finalisieren" }).click();
  await page.goto("/accounting/bookings?year=2026&month=8");
  await expect(page.getByRole("row", { name: /Lohnverrechnung August/ })).toBeVisible();
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
