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

async function openProjectBoard(page: Page, projectName: string) {
  const projectRow = page.locator('[data-row-kind="project"]').filter({
    hasText: projectName,
  });
  await projectRow
    .getByRole("button", { name: `Aktionen für ${projectName}` })
    .click();
  await page.getByRole("menuitem", { name: "Kanban-Board öffnen" }).click();
  await expect(page).toHaveURL(/\/projects\/[^/?#]+(?:[?#].*)?$/);
  const openColumn = page.locator('[data-column-name="Offen"]');
  await expect(openColumn).toHaveCount(1);
  await expect(openColumn).toBeVisible();
}

test("create a project with default kanban columns", async ({ page }) => {
  await login(page);

  await page.goto("/projects");
  await page.getByRole("button", { name: "Neues Projekt" }).click();
  await page.locator("#portfolio-project-name").fill("Website Relaunch");
  await page.locator("#portfolio-project-description").fill("Neue Firmenwebsite");
  await page.getByRole("button", { name: "Speichern" }).click();

  await expect(page.getByText("Website Relaunch")).toBeVisible();

  // Open the board: the three default columns exist.
  await openProjectBoard(page, "Website Relaunch");
  await expect(page.locator('[data-column-name="Offen"]')).toBeVisible();
  await expect(page.locator('[data-column-name="In Arbeit"]')).toBeVisible();
  await expect(page.locator('[data-column-name="Erledigt"]')).toBeVisible();
});

test("create, move (via dialog) and complete a task", async ({ page }) => {
  await login(page);
  await page.goto("/projects");
  await openProjectBoard(page, "Website Relaunch");

  // Create a task with assignee, due date and high priority.
  await page.getByRole("button", { name: "Neue Aufgabe" }).first().click();
  const taskDialog = page.getByRole("dialog");
  await expect(taskDialog).toBeVisible();
  await taskDialog.locator("#task-title").fill("Landingpage bauen");
  await taskDialog.locator("#task-description").fill("Hero, Features, Kontakt");
  await taskDialog.locator("#task-assignee").click();
  await page.getByRole("option", { name: "E2E Admin" }).click();
  await taskDialog.locator("#task-start").fill("2026-07-27");
  await taskDialog.locator("#task-due").fill("2026-07-31");
  await taskDialog.getByRole("button", { name: "Speichern" }).click();

  const openColumn = page.locator('[data-column-name="Offen"]');
  await expect(openColumn.getByText("Landingpage bauen")).toBeVisible();

  // The dashboard deliberately contains project-independent work only.
  // Project tasks remain in their Kanban and portfolio views.
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Aufgaben", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Projektunabhängige Aufgaben aus Wiki, Quellen, PDFs und der restlichen Software.",
    ),
  ).toBeVisible();
  await expect(page.getByText("Landingpage bauen")).toHaveCount(0);

  // Move it to "In Arbeit" via the dialog's column select.
  await page.goto("/projects");
  await openProjectBoard(page, "Website Relaunch");
  await page
    .locator('[data-column-name="Offen"]')
    .getByRole("button", { name: "Landingpage bauen", exact: true })
    .click();
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
  await openProjectBoard(page, "Website Relaunch");

  const card = page
    .locator('[data-column-name="In Arbeit"]')
    .locator('[data-task-title="Landingpage bauen"]');
  await expect(card).toBeVisible();

  const target = page.locator('[data-column-name="Erledigt"]');
  const cardBox = (await card.boundingBox())!;
  const targetBox = (await target.boundingBox())!;

  // dnd-kit needs a small initial move to pass its activation constraint.
  const dragStart = {
    x: cardBox.x + 12,
    y: cardBox.y + cardBox.height / 2,
  };
  await page.mouse.move(dragStart.x, dragStart.y);
  await page.mouse.down();
  await page.mouse.move(dragStart.x + 15, dragStart.y + 15, { steps: 5 });
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

test("move the project tree on drop and restore it with undo", async ({ page }) => {
  await login(page);
  await page.goto("/projects");

  const projectRow = page.locator('[data-row-kind="project"]').filter({
    hasText: "Website Relaunch",
  });
  const projectBar = projectRow.getByRole("button", {
    name: /^Website Relaunch, /,
  });
  const box = (await projectBar.boundingBox())!;
  const start = {
    clientX: box.x + box.width / 2,
    clientY: box.y + box.height / 2,
    pointerId: 1,
    pointerType: "mouse",
    buttons: 1,
  };
  await projectBar.dispatchEvent("pointerdown", start);
  await projectBar.dispatchEvent("pointermove", {
    ...start,
    clientX: start.clientX + 32,
  });
  await projectBar.dispatchEvent("pointerup", {
    ...start,
    clientX: start.clientX + 32,
    buttons: 0,
  });

  // The drop commits on its own — no confirmation step.
  await expect(page.getByText("Terminplan aktualisiert")).toBeVisible();
  await expect(
    projectRow.getByRole("button", {
      name: "Website Relaunch, 2026-07-27 – 2026-07-31",
    }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Rückgängig" }).click();
  await expect(page.getByText("Terminplan wiederhergestellt")).toBeVisible();

  await page.reload();
  await expect(
    projectRow.getByRole("button", {
      name: "Website Relaunch, 2026-07-27 – 2026-07-31",
    }),
  ).toBeVisible();
});

test("indent a task and expose its parent as a schedule container", async ({ page }) => {
  await login(page);
  await page.goto("/projects");
  await openProjectBoard(page, "Website Relaunch");

  const openColumn = page.locator('[data-column-name="Offen"]');
  await openColumn.getByRole("button", { name: "Neue Aufgabe" }).click();
  await page.locator("#task-title").fill("Landingpage prüfen");
  await page.getByRole("button", { name: "Speichern" }).click();
  const childCard = openColumn
    .locator('[data-task-title="Landingpage prüfen"]')
    .last();
  await expect(childCard).toBeVisible();
  const childTaskId = await childCard.getAttribute("data-task-id");
  expect(childTaskId).toBeTruthy();

  await page.goto("/projects");

  const gantt = page.getByTestId("portfolio-gantt");
  const target = gantt.locator(
    `[data-row-kind="task"][data-task-id="${childTaskId}"]`,
  );
  await expect(target).toBeVisible();

  await target
    .getByRole("button", { name: "Aktionen für Landingpage prüfen" })
    .click();
  const documentTimeOrigin = await page.evaluate(() => performance.timeOrigin);
  await page.getByRole("menuitem", { name: "Einrücken" }).click();
  await page.waitForFunction(
    (previousTimeOrigin) => performance.timeOrigin !== previousTimeOrigin,
    documentTimeOrigin,
  );

  // The hard refresh preserves the selected task, scroll position, and the
  // expanded parent, so the moved row stays in context.
  const parent = page
    .getByTestId("portfolio-gantt")
    .locator('[data-row-kind="task"]')
    .filter({ hasText: "Landingpage bauen" });
  const refreshedGantt = page.getByTestId("portfolio-gantt");
  const refreshedChild = refreshedGantt.locator(
    `[data-row-kind="subtask"][data-task-id="${childTaskId}"]`,
  );
  await expect(refreshedChild).toBeVisible();
  await expect(refreshedChild).toHaveAttribute("aria-selected", "true");

  const bracket = parent.locator("[data-summary-bracket]");
  await expect(bracket).toBeVisible();
  const startHandle = parent.getByRole("button", {
    name: "Startdatum ändern: Landingpage bauen",
  });
  const endHandle = parent.getByRole("button", {
    name: "Enddatum ändern: Landingpage bauen",
  });
  await expect(startHandle).toBeAttached();
  await expect(endHandle).toBeAttached();

  const [startBox, endBox] = await Promise.all([
    startHandle.boundingBox(),
    endHandle.boundingBox(),
  ]);
  expect(startBox).not.toBeNull();
  expect(endBox).not.toBeNull();
  expect(startBox!.x + startBox!.width).toBeLessThanOrEqual(endBox!.x);

  const originalRange = await bracket.getAttribute("aria-label");
  expect(originalRange).toBeTruthy();
  await endHandle.focus();
  await endHandle.press("ArrowRight");
  await expect.poll(() => bracket.getAttribute("aria-label")).not.toBe(originalRange);
  const resizedRange = await bracket.getAttribute("aria-label");

  await page.reload();
  const persistedBracket = page
    .getByTestId("portfolio-gantt")
    .locator('[data-row-kind="task"]')
    .filter({ hasText: "Landingpage bauen" })
    .locator("[data-summary-bracket]");
  await expect(persistedBracket).toHaveAttribute("aria-label", resizedRange!);
});

test("create and expand a scheduled subtask in Kanban and Gantt", async ({
  page,
}) => {
  await login(page);
  await page.goto("/projects");
  await openProjectBoard(page, "Website Relaunch");

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
    .getByRole("button", { name: "Unteraufgaben ein- oder ausklappen" })
    .click();
  const childTimelineRow = page.locator('[data-row-kind="subtask"]').filter({
    hasText: "API integrieren",
  });
  await expect(childTimelineRow).toBeVisible();
  await childTimelineRow
    .getByRole("button", { name: "Unteraufgaben ein- oder ausklappen" })
    .click();
  await expect(
    page.locator('[data-row-kind="subtask"]').filter({
      hasText: "Vertragstests schreiben",
    }),
  ).toBeVisible();
});

test("focus a task subtree and exit through portfolio history", async ({ page }) => {
  await login(page);
  await page.goto("/projects");

  const taskRow = page.locator('[data-row-kind="task"]').filter({
    hasText: "Release vorbereiten",
  });
  await expect(taskRow).toBeVisible();
  await taskRow
    .getByRole("button", { name: "Aktionen für Release vorbereiten" })
    .click();
  await page.getByRole("menuitem", { name: "Auf Aufgabe fokussieren" }).click();

  await expect(page).toHaveURL(/\/projects\?focus=[^&]+$/);
  const focusUrl = page.url();
  const focusRail = page.getByTestId("gantt-focus-rail");
  await expect(focusRail).toBeVisible();
  await expect(focusRail).toContainText("Release vorbereiten");
  await expect(page.getByTestId("schedule-inspector-dock")).toBeVisible();
  await expect(page.locator('[data-row-kind="project"]')).toHaveCount(0);

  await focusRail
    .getByRole("button", { name: "Fokusansicht verlassen" })
    .click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByTestId("gantt-focus-rail")).toHaveCount(0);
  await expect(taskRow).toBeVisible();

  // A copied/shared focus URL opens the same immersive subtree directly.
  await page.goto(focusUrl);
  await expect(page.getByTestId("gantt-focus-rail")).toContainText(
    "Release vorbereiten",
  );
  await page
    .getByTestId("gantt-focus-rail")
    .getByRole("button", { name: "Fokusansicht verlassen" })
    .click();
  await expect(page).toHaveURL(/\/projects$/);
});
