import { test, expect, type Page } from "@playwright/test";

// Reuses the admin account created by accounting.spec.ts (workers: 1,
// files run in alphabetical order against the same database).

test.describe.configure({ mode: "serial" });

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#email").fill("admin@example.com");
  await page.locator("#password").fill("super-secret-1");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.getByText("Willkommen, E2E Admin!")).toBeVisible();
}

test("create a project with default kanban columns", async ({ page }) => {
  await login(page);

  await page.goto("/projects");
  await page.getByRole("button", { name: "Neues Projekt" }).click();
  await page.locator("#project-name").fill("Website Relaunch");
  await page.locator("#project-description").fill("Neue Firmenwebsite");
  await page.getByRole("button", { name: "Speichern" }).click();

  await expect(page.getByText("Website Relaunch")).toBeVisible();

  // Open the board: the three default columns exist.
  await page.getByRole("link", { name: /Website Relaunch/ }).click();
  await expect(page.locator('[data-column-name="Offen"]')).toBeVisible();
  await expect(page.locator('[data-column-name="In Arbeit"]')).toBeVisible();
  await expect(page.locator('[data-column-name="Erledigt"]')).toBeVisible();
});

test("create, move (via dialog) and complete a task", async ({ page }) => {
  await login(page);
  await page.goto("/projects");
  await page.getByRole("link", { name: /Website Relaunch/ }).click();

  // Create a task with assignee, due date and high priority.
  await page.getByRole("button", { name: "Neue Aufgabe" }).first().click();
  await page.locator("#task-title").fill("Landingpage bauen");
  await page.locator("#task-description").fill("Hero, Features, Kontakt");
  await page.locator("#task-assignee").click();
  await page.getByRole("option", { name: "E2E Admin" }).click();
  await page.locator("#task-due").fill("2026-07-31");
  await page.getByRole("button", { name: "Speichern" }).click();

  const openColumn = page.locator('[data-column-name="Offen"]');
  await expect(openColumn.getByText("Landingpage bauen")).toBeVisible();

  // The task shows on the dashboard under "Meine Aufgaben".
  await page.goto("/");
  await expect(page.getByText("Meine Aufgaben")).toBeVisible();
  await expect(page.getByText("Landingpage bauen")).toBeVisible();

  // Move it to "In Arbeit" via the dialog's column select.
  await page.goto("/projects");
  await page.getByRole("link", { name: /Website Relaunch/ }).click();
  await page.getByText("Landingpage bauen").click();
  await expect(page.getByText("Aufgabe bearbeiten")).toBeVisible();
  await page.locator("#task-column").click();
  await page.getByRole("option", { name: "In Arbeit" }).click();
  await page.getByRole("button", { name: "Speichern" }).click();

  await expect(
    page.locator('[data-column-name="In Arbeit"]').getByText("Landingpage bauen"),
  ).toBeVisible();
});

test("drag a task between columns", async ({ page }) => {
  await login(page);
  await page.goto("/projects");
  await page.getByRole("link", { name: /Website Relaunch/ }).click();

  const card = page
    .locator('[data-column-name="In Arbeit"]')
    .getByText("Landingpage bauen");
  await expect(card).toBeVisible();

  const target = page.locator('[data-column-name="Erledigt"]');
  const cardBox = (await card.boundingBox())!;
  const targetBox = (await target.boundingBox())!;

  // dnd-kit needs a small initial move to pass its activation constraint.
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(cardBox.x + cardBox.width / 2 + 15, cardBox.y + 15, { steps: 5 });
  await page.mouse.move(
    targetBox.x + targetBox.width / 2,
    targetBox.y + targetBox.height / 2,
    { steps: 15 },
  );
  await page.mouse.up();

  await expect(
    page.locator('[data-column-name="Erledigt"]').getByText("Landingpage bauen"),
  ).toBeVisible();

  // Persisted: still there after reload.
  await page.reload();
  await expect(
    page.locator('[data-column-name="Erledigt"]').getByText("Landingpage bauen"),
  ).toBeVisible();
});
