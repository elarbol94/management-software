import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ timeout: 120_000 });

async function login(page: Page) {
  const signup = await page.request.post("/api/auth/sign-up/email", {
    data: {
      name: "E2E Admin", username: "admin", displayUsername: "admin",
      email: "admin@example.com", password: "super-secret-1",
    },
  });
  if (!signup.ok() && signup.status() !== 422 && signup.status() !== 403)
    throw new Error(`Signup failed ${signup.status()}: ${await signup.text()}`);
  if (!signup.ok()) {
    await page.goto("/login");
    await page.locator("#username").fill("admin");
    await page.locator("#password").fill("super-secret-1");
    await page.getByRole("button", { name: "Anmelden" }).click();
  }
  await page.goto("/");
  await expect(page.getByText("Willkommen, E2E Admin!")).toBeVisible();
}

test("cost overview is shareable, sourced, gap-safe and charted", async ({ page }) => {
  await page.route("https://mapsneu.wien.gv.at/**", (route) => route.abort());
  await login(page);
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.goto("/municipalities/analysis");
  await page.getByPlaceholder("z. B. Bevölkerungsvergleich").fill("Kosten Graz");
  await page.getByRole("button", { name: "Erstellen" }).click();
  await expect(page).toHaveURL(/analysis=/);
  await page.goto("/municipalities/overview");
  await expect(page).toHaveURL(/\/municipalities\/overview/);

  await page.getByRole("combobox", { name: "Gemeinde suchen" }).fill("Graz");
  await page.getByRole("option").filter({ hasText: "60101" }).click();
  await page.getByLabel("Kennzahl").selectOption("costs");
  await expect(page).toHaveURL(/metric=costs/);
  await expect(page.getByRole("slider", { name: "Jahr" })).toHaveValue("2024");
  await expect(page.getByLabel("Aufgabenbereich")).toHaveValue("0");
  await expect(page.getByTestId("population-legend")).toContainText("Rechnungsabschluss 2024");

  const details = page.getByTestId("municipality-details");
  await expect(details.getByText("27,3 %", { exact: true })).toBeVisible();
  await expect(details.getByText("437.272.427,93 €", { exact: true })).toBeVisible();
  await expect(details.getByText("1.603.472.734,22 €", { exact: true })).toBeVisible();
  await expect(details).toContainText("Statistik Austria via OffenerHaushalt.at");

  await page.getByLabel("Aufgabenbereich").selectOption("8");
  await expect(page).toHaveURL(/costCategory=8/);
  await expect(details.getByText("10,1 %", { exact: true })).toBeVisible();
  const year = page.getByRole("slider", { name: "Jahr" });
  await year.fill("2010");
  await expect(page).toHaveURL(/populationYear=2010/);
  await expect(details.getByText("18,0 %", { exact: true })).toBeVisible();
  const chart = page.getByTestId("municipality-metric-chart");
  await chart.getByTestId("municipality-metric-chart-point-2024").hover();
  await expect(chart.getByTestId("municipality-metric-chart-tooltip")).toHaveText("2024: 10,1 %");

  const display = page.getByLabel("Darstellung");
  await expect(display).toHaveValue("share");
  await display.selectOption("per-capita");
  await expect(page).toHaveURL(/costMeasure=per-capita/);
  await expect(page.getByTestId("cost-definition")).toContainText("Bevölkerung desselben Jahres");
  await expect(details.getByText("Nominal je Einwohner", { exact: true }).locator("xpath=following-sibling::dd[1]")).not.toHaveText("—");

  await display.selectOption("real-per-capita");
  await expect(page.getByTestId("cost-definition")).toContainText("Preise von 2024");
  await expect(details).toContainText("verketteten Verbraucherpreisindex");

  await display.selectOption("peer-deviation");
  await expect(page).toHaveURL(/costMeasure=peer-deviation/);
  await expect(page.getByTestId("cost-definition")).toContainText("weniger als fünf Vergleichsgemeinden");
  await expect(chart.getByTestId("municipality-metric-chart-zero-line")).toBeAttached();
  await expect(chart.getByTestId("municipality-metric-chart-zero-line")).toHaveAttribute("stroke", "currentColor");
  await display.selectOption("share");
  await expect(page).not.toHaveURL(/costMeasure=/);
  await page.reload();
  await expect(page.getByLabel("Kennzahl")).toHaveValue("costs");
  await expect(page.getByLabel("Aufgabenbereich")).toHaveValue("8");
  await expect(year).toHaveValue("2010");
  await expect(display).toHaveValue("share");

  await year.fill("2024");
  await page.getByRole("combobox", { name: "Gemeinde suchen" }).fill("Oggau am Neusiedler See");
  await page.getByRole("option").filter({ hasText: "10310" }).click();
  const totalValue = details.getByText("Gesamtauszahlungen", { exact: true }).locator("xpath=following-sibling::dd[1]");
  await expect(totalValue).toHaveText("—");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("combobox", { name: "Gemeinde suchen" }).fill("Graz");
  await page.getByRole("option").filter({ hasText: "60101" }).click();
  await chart.getByRole("button", { name: "Zur Analyse hinzufügen" }).click();
  const picker = page.getByTestId("municipality-analysis-picker");
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: /Kosten Graz/ }).first().click();
  await expect(page).toHaveURL(/\/municipalities\/overview/);
  await page.getByRole("link", { name: "Analyse" }).click();
  await expect(page.locator(".react-flow__node-dataset")).toHaveCount(1);
  await expect(page.getByTestId("municipality-analysis-editor")).toContainText("Kostenübersicht · Dienstleistungen");
});
