import { test, expect, type Page } from "@playwright/test";

// Reuses the admin account created by accounting.spec.ts (workers: 1,
// files run in alphabetical order against the same database).

test.describe.configure({ mode: "serial" });

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#username").fill("admin");
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
  await page.locator("#task-start").fill("2026-07-27");
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

test("show scheduled Kanban work in the portfolio Gantt", async ({ page }) => {
  await login(page);
  await page.goto("/projects");

  await expect(page.getByTestId("portfolio-gantt")).toBeVisible();
  await expect(page.locator('[data-row-kind="phase"]')).toHaveCount(0);
  await expect(page.getByText("Allgemein", { exact: true })).toHaveCount(0);
  const row = page.locator('[data-row-kind="task"]').filter({
    hasText: "Landingpage bauen",
  });
  await expect(row).toBeVisible();
  await expect(row).toContainText("100%");
  await expect(
    row.getByRole("button", {
      name: "Landingpage bauen, 2026-07-27 – 2026-07-31",
    }),
  ).toBeVisible();
});

test("preview moving the project and its complete task tree", async ({ page }) => {
  await login(page);
  await page.goto("/projects");

  const projectRow = page.locator('[data-row-kind="project"]').filter({
    hasText: "Website Relaunch",
  });
  const projectBar = projectRow.getByRole("button", {
    name: /Website Relaunch, 2026-07-27 – 2026-07-31/,
  });
  const box = (await projectBar.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 32, box.y + box.height / 2, {
    steps: 8,
  });
  await page.mouse.up();

  const preview = page.getByRole("dialog", {
    name: "Terminänderungen bestätigen",
  });
  await expect(preview).toContainText("Website Relaunch");
  await expect(preview).toContainText("Landingpage bauen");
  await preview.getByRole("button", { name: "Abbrechen" }).click();
  await expect(preview).not.toBeVisible();

  await page.reload();
  await expect(
    projectRow.getByRole("button", {
      name: "Website Relaunch, 2026-07-27 – 2026-07-31",
    }),
  ).toBeVisible();
});

test("create and expand a scheduled subtask in Kanban and Gantt", async ({
  page,
}) => {
  await login(page);
  await page.goto("/projects");
  await page.getByRole("link", { name: /Website Relaunch/ }).click();

  const openColumn = page.locator('[data-column-name="Offen"]');
  await openColumn.getByRole("button", { name: "Neue Aufgabe" }).click();
  await page.locator("#task-title").fill("Release vorbereiten");
  await page.getByRole("button", { name: "Speichern" }).click();

  const parentCard = page.locator(
    '[data-task-title="Release vorbereiten"]',
  );
  await expect(parentCard).toBeVisible();
  await parentCard
    .getByRole("button", { name: "Unteraufgabe hinzufügen" })
    .click();

  const subtaskDialog = page.getByRole("dialog");
  await expect(
    subtaskDialog.getByRole("heading", { name: "Unteraufgabe hinzufügen" }),
  ).toBeVisible();
  await subtaskDialog.locator("#task-title").fill("API integrieren");
  await subtaskDialog.locator("#task-start").fill("2026-08-03");
  await subtaskDialog.locator("#task-due").fill("2026-08-07");
  await subtaskDialog.getByRole("button", { name: "Speichern" }).click();

  await expect(parentCard).toContainText("0 von 1 erledigt");
  await parentCard
    .getByRole("button", { name: "Unteraufgaben ein- oder ausklappen" })
    .click();
  await expect(
    parentCard.locator('[data-subtask-title="API integrieren"]'),
  ).toBeVisible();
  const childRow = parentCard.locator('[data-subtask-title="API integrieren"]');
  await childRow
    .getByRole("button", { name: "Unteraufgabe hinzufügen" })
    .click();
  await subtaskDialog.locator("#task-title").fill("Vertragstests schreiben");
  await subtaskDialog.locator("#task-start").fill("2026-08-04");
  await subtaskDialog.locator("#task-due").fill("2026-08-06");
  await subtaskDialog.getByRole("button", { name: "Speichern" }).click();
  await expect(
    parentCard.locator('[data-subtask-title="Vertragstests schreiben"]'),
  ).toBeVisible();

  await page.reload();
  const persistedParent = page.locator(
    '[data-task-title="Release vorbereiten"]',
  );
  await expect(persistedParent).toContainText("0 von 1 erledigt");

  await page.goto("/projects");
  const parentRow = page.locator('[data-row-kind="task"]').filter({
    hasText: "Release vorbereiten",
  });
  await expect(parentRow).toBeVisible();
  await parentRow
    .getByRole("button", { name: "Aufgabe ein- oder ausklappen" })
    .click();
  const childTimelineRow = page.locator('[data-row-kind="subtask"]').filter({
    hasText: "API integrieren",
  });
  await expect(childTimelineRow).toBeVisible();
  await childTimelineRow
    .getByRole("button", { name: "Aufgabe ein- oder ausklappen" })
    .click();
  await expect(
    page.locator('[data-row-kind="subtask"]').filter({
      hasText: "Vertragstests schreiben",
    }),
  ).toBeVisible();
});
