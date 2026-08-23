import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ timeout: 120_000 });

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
  if (signup.ok()) {
    await page.goto("/");
    await expect(page.getByText("Willkommen, E2E Admin!")).toBeVisible();
    return;
  }
  await page.goto("/login");
  await page.locator("#username").fill("admin");
  await page.locator("#password").fill("super-secret-1");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.getByText("Willkommen, E2E Admin!")).toBeVisible();
}

test("municipality map works with local geometry when basemap tiles are unavailable", async ({ page }) => {
  await page.route("https://mapsneu.wien.gv.at/**", (route) => route.abort());
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.getByRole("button", { name: "Hauptnavigation öffnen" }).click();
  const municipalityNavigation = page
    .getByTestId("app-navigation-sheet")
    .getByRole("button", { name: "Gemeinden", exact: true });
  await expect(municipalityNavigation).toBeVisible();
  await page.goto("/municipalities/overview");
  await page.setViewportSize({ width: 1280, height: 900 });

  await expect(page.getByRole("heading", { name: "Gemeinden", exact: true })).toBeVisible();
  await expect(page.getByTestId("municipalities-workspace")).toBeVisible();
  await expect(page.getByTestId("municipality-map")).toBeVisible();
  await expect(page.getByText("2.092 amtliche Gemeinden")).toBeVisible();
  await expect(page.getByTestId("population-legend").getByText("Einwohnerzahl")).toBeVisible();
  const populationYear = page.getByRole("slider", { name: "Jahr" });
  await expect(populationYear).toHaveValue("2025");

  const search = page.getByRole("combobox", { name: "Gemeinde suchen" });
  await search.fill("Graz");
  await page.getByRole("option").filter({ hasText: "60101" }).click();
  await expect(page).toHaveURL(/municipality=60101/);
  await expect(page.getByTestId("municipality-details").getByRole("heading", { name: "Graz" })).toBeVisible();
  await expect(page.getByText("60101", { exact: true })).toBeVisible();
  await expect(page.getByTestId("municipality-details").getByText("305.314", { exact: true })).toBeVisible();
  await expect(page.getByTestId("municipality-details").getByText("Ø jährliche Änderung seit 2002", { exact: true })).toBeVisible();
  const metricChart = page.getByTestId("municipality-metric-chart");
  await expect(metricChart).toBeVisible();
  await expect(metricChart.getByRole("img", { name: "Einwohnerentwicklung in Graz" })).toBeVisible();
  await metricChart.getByRole("button", { name: "Diagramm minimieren" }).click();
  await expect(metricChart.getByRole("button", { name: "Diagramm einblenden" })).toBeVisible();
  await metricChart.getByRole("button", { name: "Diagramm einblenden" }).click();
  await populationYear.focus();
  await populationYear.press("Home");
  await expect(page).toHaveURL(/populationYear=2002/);
  await expect(page.getByTestId("municipality-details").getByText("232.930", { exact: true })).toBeVisible();
  await expect(page.getByTestId("population-legend").getByText("Stand 1. Jänner 2002")).toBeVisible();
  await metricChart.getByTestId("municipality-metric-chart-point-2015").hover();
  await expect(metricChart.getByTestId("municipality-metric-chart-tooltip")).toHaveText("2015: 274.207 Personen");

  await page.reload();
  await expect(page).toHaveURL(/municipality=60101/);
  await expect(page.getByTestId("municipality-details").getByRole("heading", { name: "Graz" })).toBeVisible();

  await page.getByRole("button", { name: "Ganz Österreich" }).click();
  await expect(page).not.toHaveURL(/municipality=/);
  await expect(page.getByRole("heading", { name: "Gemeinde auswählen" })).toBeVisible();
});

test("population structure views are compact, sourced and shareable", async ({ page }) => {
  await page.route("https://mapsneu.wien.gv.at/**", (route) => route.abort());
  await login(page);
  await page.goto("/municipalities/overview");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("combobox", { name: "Gemeinde suchen" }).fill("Mörtschach");
  await page.getByRole("option").filter({ hasText: "20622" }).click();

  const view = page.getByLabel("Ansicht");
  await view.selectOption("density");
  await expect(page.getByTestId("population-definition")).toContainText("geteilt durch die Gemeindefläche");
  await expect(page.getByTestId("municipality-details").getByText("Gemeindefläche", { exact: true })).toBeVisible();

  await view.selectOption("foreign-share");
  await expect(page).toHaveURL(/populationView=foreign-share/);
  await expect(page.getByRole("slider", { name: "Jahr" })).toHaveValue("2024");
  await expect(page.getByTestId("population-definition")).toContainText("ohne österreichische Staatsangehörigkeit");
  await expect(page.getByTestId("municipality-details").getByText("4,4 %", { exact: true })).toBeVisible();
  const chart = page.getByTestId("municipality-metric-chart");
  await chart.getByTestId("municipality-metric-chart-point-2024").hover();
  await expect(chart.getByTestId("municipality-metric-chart-tooltip")).toHaveText("2024: 4,4 %");

  await view.selectOption("foreign-persons");
  await expect(page.getByTestId("population-definition")).toContainText("näherungsweise berechnet");
  await expect(page.getByTestId("municipality-details").getByText("36 Personen", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Ansicht")).toHaveValue("foreign-persons");
});

test("municipality workspace stays within the mobile viewport", async ({ page }) => {
  await page.route("https://mapsneu.wien.gv.at/**", (route) => route.abort());
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/municipalities/overview");
  const map = page.getByTestId("municipality-map");
  await expect(map).toBeVisible();
  await expect.poll(async () => Math.round((await map.boundingBox())?.height ?? 0)).toBeGreaterThan(600);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.getByRole("button", { name: "Darstellung" }).click();
  const displaySheet = page.getByRole("dialog", { name: "Darstellung" });
  await expect(displaySheet).toBeVisible();
  await expect(displaySheet.getByLabel("Kennzahl")).toHaveValue("population");
  await expect(displaySheet.getByRole("slider", { name: "Jahr" })).toHaveValue("2025");
  await displaySheet.getByRole("button", { name: "Schließen" }).click();

  await page.getByRole("button", { name: "Legende" }).click();
  const legendSheet = page.getByRole("dialog", { name: "Legende" });
  await expect(legendSheet.getByText("Einwohnerzahl")).toBeVisible();
  await legendSheet.getByRole("button", { name: "Schließen" }).click();

  await page.getByRole("combobox", { name: "Gemeinde suchen" }).fill("Wien");
  await page.getByRole("option").filter({ hasText: "90001" }).click();
  await expect(page).toHaveURL(/municipality=90001/);
  await page.getByRole("button", { name: /Wien.*Details/ }).click();
  const detailsSheet = page.getByRole("dialog", { name: "Wien" });
  await expect(detailsSheet.getByTestId("mobile-municipality-details")).toBeVisible();
  await expect(detailsSheet.getByRole("definition").filter({ hasText: "2.028.289" })).toBeVisible();
  await expect(detailsSheet.getByRole("img", { name: "Einwohnerentwicklung in Wien" })).toBeVisible();
});
