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
  await expect(page.getByText("Willkommen, E2E Admin!")).toBeVisible();
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
  await expect(page.getByTestId("municipality-analysis-editor")).toContainText("Graz");
  await expect(page.locator(".react-flow__node-dataset")).toHaveCount(3);
  await expect(page.getByTestId("municipality-analysis-editor")).toContainText("Dienstleistungen");


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
  await expect(page.getByTestId("municipality-analysis-editor")).toContainText("Katasterfläche");

  await expect(page.getByTestId("municipality-analysis-editor").getByText("Gespeichert", { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(page.getByTestId("municipality-analysis-editor")).toBeVisible();
  await expect(page.locator(".react-flow__node-dataset")).toHaveCount(4);
  await expect(page.locator(".react-flow__node-operator")).toHaveCount(2);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
