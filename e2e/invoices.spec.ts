import { test, expect, type Page } from "@playwright/test";

// Runs after accounting.spec.ts (workers: 1, same database).

test.describe.configure({ mode: "serial" });

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#username").fill("admin");
  await page.locator("#password").fill("super-secret-1");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.getByText("Willkommen, E2E Admin!")).toBeVisible();
}

test("create a customer", async ({ page }) => {
  await login(page);
  await page.goto("/accounting/customers");

  await page.getByRole("button", { name: "Neuer Kunde" }).click();
  await page.locator("#customer-name").fill("ACME GmbH");
  await page.locator("#customer-address").fill("Hauptstraße 1\n1010 Wien");
  await page.locator("#customer-uid").fill("ATU99999999");
  await page.getByRole("button", { name: "Speichern" }).click();

  await expect(
    page.getByRole("cell", { name: "ACME GmbH", exact: true }),
  ).toBeVisible();
});

test("create an invoice with gapless number and per-rate totals", async ({ page }) => {
  await login(page);
  await page.goto("/accounting/invoices/new");

  await page.locator("#invoice-customer").click();
  await page.getByRole("option", { name: "ACME GmbH" }).click();

  await page.getByTestId("item-description-0").fill("Beratung Juli");
  await page.getByTestId("item-quantity-0").fill("2");
  await page.getByTestId("item-price-0").fill("500");

  // Live totals: 2 × 500 € = 1000 net, +20 % = 1200 gross.
  await expect(page.getByText("Gesamtbetrag: € 1.200,00")).toBeVisible();

  await page.getByRole("button", { name: "Speichern" }).click();

  // First invoice of 2026 → number 2026-0001, status draft.
  await expect(page.getByRole("heading", { name: "2026-0001" })).toBeVisible();
  await expect(page.getByText("Entwurf")).toBeVisible();
});

test("status flow draft → sent → paid books the income", async ({ page }) => {
  await login(page);
  await page.goto("/accounting/invoices");
  await page.getByRole("link", { name: "2026-0001" }).click();

  await page.getByRole("button", { name: "Als versendet markieren" }).click();
  await expect(page.getByText("Versendet")).toBeVisible();

  await page.getByRole("button", { name: "Als bezahlt markieren" }).click();
  await expect(page.getByText("Bezahlt")).toBeVisible();

  // Ledger now contains the automatically booked income entry.
  await page.goto("/accounting");
  const row = page.getByRole("row", { name: /Rechnung 2026-0001/ });
  await expect(row).toBeVisible();
  await expect(row).toContainText("€ 1.200,00");
  await expect(row).toContainText("ACME GmbH");
});

test("print view renders the § 11 UStG fields", async ({ page }) => {
  await login(page);
  await page.goto("/accounting/invoices");
  await page.getByRole("link", { name: "2026-0001" }).click();

  const href = await page
    .getByRole("button", { name: "Drucken / PDF" })
    .getAttribute("href");
  await page.goto(href!);

  await expect(page.getByText("Rechnung 2026-0001")).toBeVisible();
  await expect(page.getByText("ACME GmbH")).toBeVisible();
  await expect(page.getByText("ATU99999999")).toBeVisible();
  await expect(page.getByText("USt 20 %")).toBeVisible();
  await expect(page.getByText("€ 1.200,00")).toBeVisible();
});

test("canceled invoices keep their number; the next one continues the sequence", async ({ page }) => {
  await login(page);

  // Second invoice → 2026-0002, then cancel it.
  await page.goto("/accounting/invoices/new");
  await page.locator("#invoice-customer").click();
  await page.getByRole("option", { name: "ACME GmbH" }).click();
  await page.getByTestId("item-description-0").fill("Testposition");
  await page.getByTestId("item-price-0").fill("100");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("heading", { name: "2026-0002" })).toBeVisible();
  await page.getByRole("button", { name: "Stornieren" }).click();
  await expect(page.getByText("Storniert")).toBeVisible();

  // Third invoice → 2026-0003 (no gap, no reuse).
  await page.goto("/accounting/invoices/new");
  await page.locator("#invoice-customer").click();
  await page.getByRole("option", { name: "ACME GmbH" }).click();
  await page.getByTestId("item-description-0").fill("Noch eine Position");
  await page.getByTestId("item-price-0").fill("100");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("heading", { name: "2026-0003" })).toBeVisible();

  // The list shows all three.
  await page.goto("/accounting/invoices");
  await expect(page.getByRole("link", { name: "2026-0001" })).toBeVisible();
  await expect(page.getByRole("link", { name: "2026-0002" })).toBeVisible();
  await expect(page.getByRole("link", { name: "2026-0003" })).toBeVisible();
});
