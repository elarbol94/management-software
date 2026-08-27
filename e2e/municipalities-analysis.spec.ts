import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ timeout: 240_000 });

async function login(page: Page) {
  const signup = await page.request.post("/api/auth/sign-up/email", {
    data: {
      name: "E2E Admin",
      username: "admin",
      displayUsername: "admin",
      email: "admin" + String.fromCharCode(64) + "example.com",
      password: "super-secret-1",
    },
  });
  if (!signup.ok() && signup.status() !== 422 && signup.status() !== 403) throw new Error(`Signup failed ${signup.status()}: ${await signup.text()}`);
  if (!signup.ok()) {
    await page.goto("/login");
    await page.locator("#username").fill("admin");
    await page.locator("#password").fill("super-secret-1");
    await page.getByRole("button", { name: "Anmelden" }).click();
  }
  await page.goto("/");
  // The first page after signing in may still be compiling, so this is not a 5s wait.
  await expect(page.getByText("Willkommen, E2E Admin!")).toBeVisible({ timeout: 30_000 });
}

test("municipality subpages route and transfer a dataset into a saved analysis", async ({ page }) => {
  await page.route("https://mapsneu.wien.gv.at/**", (route) => route.abort());
  await login(page);

  await page.goto("/municipalities");
  await expect(page).toHaveURL(/\/municipalities\/overview/, { timeout: 30_000 });
  await expect(page.getByRole("link", { name: "Überblick" })).toHaveAttribute("aria-current", "page");

  await page.getByRole("link", { name: "Analyse" }).click();
  await expect(page).toHaveURL(/\/municipalities\/analysis/);
  await expect(page.getByTestId("municipality-analysis-landing")).toBeVisible();
  await page.getByPlaceholder("z. B. Bevölkerungsvergleich").fill("Graz und Wien");
  await page.getByRole("button", { name: "Erstellen" }).click();
  await expect(page).toHaveURL(/analysis=/);
  await expect(page.getByTestId("municipality-analysis-editor")).toBeVisible();

  await page.goto("/municipalities/overview");
  await page.getByRole("combobox", { name: "Gemeinde suchen" }).fill("Graz");
  await page.getByRole("option").filter({ hasText: "60101" }).click();
  const chart = page.getByTestId("municipality-metric-chart");
  await expect(chart).toBeVisible();
  await chart.locator("[draggable=true]").dragTo(page.getByTestId("municipality-analysis-drop-target"));
  const picker = page.getByTestId("municipality-analysis-picker");
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: /Graz und Wien/ }).first().click();

  await expect(page).toHaveURL(/\/municipalities\/overview/);

  await page.getByLabel("Kennzahl").selectOption("age");
  await expect(page).toHaveURL(/metric=age/);
  await page.getByTestId("municipality-metric-chart").getByRole("button", { name: "Zur Analyse hinzufügen" }).click();
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: /Graz und Wien/ }).first().click();
  await expect(page).toHaveURL(/\/municipalities\/overview/);

  await page.getByLabel("Kennzahl").selectOption("costs");
  await expect(page).toHaveURL(/metric=costs/);
  await page.getByLabel("Aufgabenbereich").selectOption("8");
  await expect(page).toHaveURL(/costCategory=8/);
  await page.getByTestId("municipality-metric-chart").getByRole("button", { name: "Zur Analyse hinzufügen" }).click();
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: /Graz und Wien/ }).first().click();
  await expect(page).toHaveURL(/\/municipalities\/overview/);

  await page.getByRole("link", { name: "Analyse" }).click();
  await expect(page).toHaveURL(/\/municipalities\/analysis/);
  // Asserted on the nodes, not the editor: the sidebar catalog lists every Ausgangsdatum
  // by name, so "Dienstleistungen" is on screen whether or not it reached the canvas.
  await expect(page.locator(".react-flow__node-dataset").first()).toContainText("Graz");
  await expect(page.locator(".react-flow__node-dataset")).toHaveCount(3);
  await expect(page.locator(".react-flow__node-dataset").filter({ hasText: "Dienstleistungen" })).toHaveCount(1);
  await page.getByRole("tab", { name: "Bausteine" }).click();
  await page.getByRole("button", { name: "Operator Addieren hinzufügen" }).click();
  await page.getByRole("link", { name: "Überblick" }).click();
  await expect(page).toHaveURL(/\/municipalities\/overview/);

  await page.getByRole("combobox", { name: "Gemeinde suchen" }).fill("Graz");
  await page.getByRole("option").filter({ hasText: "60101" }).click();
  await page.getByLabel("Datenart").selectOption("derived");
  await page.getByLabel("Kennzahl").selectOption("population");
  await expect(page).not.toHaveURL(/metric=/);
  await page.getByLabel("Ansicht").selectOption("density");
  await expect(page).toHaveURL(/populationView=density/);
  await page.getByTestId("municipality-metric-chart").getByRole("button", { name: "Zur Analyse hinzufügen" }).click();
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: /Graz und Wien/ }).first().click();

  await page.getByRole("link", { name: "Analyse" }).click();
  // Bevölkerungsdichte is a Kennzahl, so it arrives as its derivation: the Einwohnerzahl
  // node already on the canvas is reused, Katasterfläche is added, and they meet in a ÷.
  await expect(page.locator(".react-flow__node-dataset")).toHaveCount(4);
  await expect(page.locator(".react-flow__node-operator")).toHaveCount(2);
  await expect(page.locator(".react-flow__node-dataset").filter({ hasText: "Katasterfläche" })).toHaveCount(1);

  await expect(page.getByTestId("municipality-analysis-editor").getByText("Gespeichert", { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(page.getByTestId("municipality-analysis-editor")).toBeVisible();
  await expect(page.locator(".react-flow__node-dataset")).toHaveCount(4);
  await expect(page.locator(".react-flow__node-operator")).toHaveCount(2);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("a constant and a time shift keep the number typed into them", async ({ page }) => {
  await page.route("https://mapsneu.wien.gv.at/**", (route) => route.abort());
  await login(page);

  await page.goto("/municipalities/analysis");
  await page.getByPlaceholder("z. B. Bevölkerungsvergleich").fill("Konstanten");
  await page.getByRole("button", { name: "Erstellen" }).click();
  await expect(page.getByTestId("municipality-analysis-editor")).toBeVisible();

  await page.getByRole("tab", { name: "Bausteine" }).click();
  await expect(page.getByRole("button", { name: "Konstante hinzufügen" })).toBeVisible();
  await page.getByRole("button", { name: "Konstante hinzufügen" }).click();
  const value = page.getByLabel("Wert der Konstante");
  await value.fill("2000");
  await value.blur();

  await page.getByRole("button", { name: "Operator Zeitversatz hinzufügen" }).click();
  const years = page.getByLabel("Um wie viele Jahre zurück");
  await years.fill("99");
  await years.blur();
  // Out-of-range entries settle on the nearest usable value instead of being rejected.
  await expect(years).toHaveValue("20");
  // A shift reads input A only, so it offers one target handle rather than two.
  await expect(page.locator(".react-flow__node-operator .react-flow__handle-left")).toHaveCount(1);

  await expect(page.getByTestId("municipality-analysis-editor").getByText("Gespeichert", { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(page.getByLabel("Wert der Konstante")).toHaveValue("2000");
  await expect(page.getByLabel("Um wie viele Jahre zurück")).toHaveValue("20");
});

test("studio aliases, dimensions, notes, quick add, layout, and panels persist", async ({ page }) => {
  await page.route("https://mapsneu.wien.gv.at/**", (route) => route.abort());
  await login(page);

  await page.goto("/municipalities/analysis");
  await page.getByPlaceholder("z. B. Bevölkerungsvergleich").fill("Studio Werkzeuge");
  await page.getByRole("button", { name: "Erstellen" }).click();
  await expect(page.getByTestId("municipality-analysis-editor")).toBeVisible();

  await page.keyboard.press("ControlOrMeta+KeyK");
  await expect(page.getByTestId("analysis-quick-add")).toBeVisible();
  await page.getByPlaceholder("Bausteine durchsuchen").fill("Notiz");
  await page.getByPlaceholder("Bausteine durchsuchen").press("Enter");
  const note = page.locator(".react-flow__node-annotation");
  await expect(note).toHaveCount(1);
  await page.getByLabel("Notiztext").fill("Annahme für die Auswertung");
  await page.getByLabel("Notiztext").blur();
  await expect(page.getByRole("button", { name: "Blau" })).toBeVisible();
  await page.getByRole("button", { name: "Blau" }).click();
  await page.getByLabel("Breite").fill("320");
  await page.getByLabel("Breite").blur();
  await page.getByLabel("Höhe").fill("220");
  await page.getByLabel("Höhe").blur();
  await expect.poll(() => note.evaluate((element) => Math.round(Number.parseFloat(getComputedStyle(element).width)))).toBe(320);
  await expect.poll(() => note.evaluate((element) => Math.round(Number.parseFloat(getComputedStyle(element).height)))).toBe(220);

  await page.getByRole("tab", { name: "Bausteine" }).click();
  await page.getByRole("button", { name: "Operator Dividieren hinzufügen" }).click();
  const operator = page.locator(".react-flow__node-operator");
  await expect(operator).toHaveCount(1);
  await operator.getByRole("button", { name: "Dividieren" }).dblclick();
  const inlineTitle = operator.getByRole("textbox", { name: "Dividieren" });
  await inlineTitle.fill("Pro-Kopf-Quote");
  await inlineTitle.press("Enter");
  await expect(operator).toContainText("Pro-Kopf-Quote");
  await expect(operator).toContainText("Dividieren");
  await page.getByRole("tab", { name: "Ergebnis" }).click();
  await expect(page.getByRole("tabpanel", { name: "Ergebnis" }).getByRole("heading", { name: "Pro-Kopf-Quote" })).toBeVisible();
  await page.getByRole("tab", { name: "Eigenschaften" }).click();

  await page.getByLabel("Breite").fill("360");
  await page.getByLabel("Breite").blur();
  await page.getByLabel("Höhe").fill("240");
  await page.getByLabel("Höhe").blur();
  await expect.poll(() => operator.evaluate((element) => Math.round(Number.parseFloat(getComputedStyle(element).width)))).toBe(360);
  await expect.poll(() => operator.evaluate((element) => Math.round(Number.parseFloat(getComputedStyle(element).height)))).toBe(240);

  const noteBeforeLayout = await note.evaluate((element) => (element as HTMLElement).style.transform);
  await page.getByRole("button", { name: "Automatisch anordnen" }).click();
  await expect.poll(() => note.evaluate((element) => (element as HTMLElement).style.transform)).toBe(noteBeforeLayout);
  await page.getByRole("button", { name: "Rückgängig" }).click();
  await expect(page.getByRole("button", { name: "Wiederholen" })).toBeEnabled();
  await page.getByRole("button", { name: "Wiederholen" }).click();

  await note.focus();
  await note.press("Enter");
  await expect(page.getByRole("button", { name: "Baustein löschen" })).toBeVisible();
  await page.getByRole("button", { name: "Baustein löschen" }).click();
  await expect(note).toHaveCount(0);
  await page.getByRole("button", { name: "Rückgängig" }).click();
  await expect(note).toHaveCount(1);

  await page.getByRole("button", { name: "Bibliothek einklappen" }).click();
  await expect(page.getByRole("button", { name: "Bibliothek öffnen" })).toBeVisible();
  await page.getByRole("button", { name: "Inspektor einklappen" }).click();
  await expect(page.getByRole("button", { name: "Inspektor öffnen" })).toBeVisible();

  await expect(page.getByTestId("municipality-analysis-editor").getByText("Gespeichert", { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(page.locator(".react-flow__node-operator")).toContainText("Pro-Kopf-Quote");
  await expect(page.locator(".react-flow__node-operator")).toContainText("Dividieren");
  await expect(page.locator(".react-flow__node-annotation")).toContainText("Annahme für die Auswertung");
  await expect.poll(() => page.locator(".react-flow__node-operator").evaluate((element) => Math.round(Number.parseFloat(getComputedStyle(element).width)))).toBe(360);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Bibliothek" }).click();
  await expect(page.getByRole("dialog").getByText("Bibliothek", { exact: true })).toBeVisible();
});
