import { test, expect, type Page } from "@playwright/test";

// Runs after accounting.spec.ts (workers: 1, same database) — the admin
// account already exists.

test.describe.configure({ mode: "serial" });

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#email").fill("admin@example.com");
  await page.locator("#password").fill("super-secret-1");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.getByText("Willkommen, E2E Admin!")).toBeVisible();
}

test("create the first page and write autosaved content", async ({ page }) => {
  await login(page);
  await page.goto("/wiki");

  await expect(page.getByText("Noch keine Seiten im Wiki.")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept("Onboarding"));
  await page.getByRole("button", { name: "Erste Seite anlegen" }).click();

  await expect(page).toHaveURL(/\/wiki\/onboarding/);
  await expect(page.getByRole("heading", { name: "Onboarding" })).toBeVisible();

  await page.locator(".ProseMirror").click();
  await page.keyboard.type("Willkommen im Team! Erste Schritte für neue Kollegen.");
  await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible({
    timeout: 10_000,
  });

  await page.reload();
  await expect(
    page.getByText("Willkommen im Team! Erste Schritte für neue Kollegen."),
  ).toBeVisible();
});

test("internal links create backlinks", async ({ page }) => {
  await login(page);
  await page.goto("/wiki");

  // Create a second page.
  page.once("dialog", (dialog) => dialog.accept("IT-Setup"));
  await page.getByRole("button", { name: "Neue Seite" }).click();
  await expect(page).toHaveURL(/\/wiki\/it-setup/);

  // Write some text, then insert a link to "Onboarding" via the page picker.
  await page.locator(".ProseMirror").click();
  await page.keyboard.type("Laptop einrichten. Siehe auch: ");
  await page.getByRole("button", { name: "Seite verlinken" }).click();
  await page.getByRole("button", { name: "Onboarding" }).click();
  await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible({
    timeout: 10_000,
  });

  // The Onboarding page now shows IT-Setup as a backlink.
  await page.getByRole("link", { name: "Onboarding" }).first().click();
  await expect(page.getByText("Verweise auf diese Seite")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "IT-Setup" }).nth(1),
  ).toBeVisible();
});

test("full-text search finds pages by content", async ({ page }) => {
  await login(page);
  await page.goto("/wiki");

  await page.getByPlaceholder("Wiki durchsuchen…").fill("Laptop");
  const result = page.getByRole("link", { name: /IT-Setup/ }).first();
  await expect(result).toBeVisible();
});

test("subpages appear nested in the tree", async ({ page }) => {
  await login(page);
  await page.goto("/wiki/onboarding");

  // Add a subpage under Onboarding via the tree row menu.
  const treeRow = page
    .locator("nav div")
    .filter({ hasText: /^Onboarding$/ })
    .first();
  await treeRow.hover();
  await treeRow.getByRole("button").last().click();
  page.once("dialog", (dialog) => dialog.accept("Erster Arbeitstag"));
  await page.getByRole("menuitem", { name: "Unterseite anlegen" }).click();

  await expect(page).toHaveURL(/\/wiki\/erster-arbeitstag/);
  await expect(
    page.getByRole("heading", { name: "Erster Arbeitstag" }),
  ).toBeVisible();
});
