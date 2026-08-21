import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ timeout: 120_000 });

async function login(page: Page) {
  const signup = await page.request.post("/api/auth/sign-up/email", { data: { name: "E2E Admin", username: "admin", displayUsername: "admin", email: "admin@example.com", password: "super-secret-1" } });
  if (!signup.ok() && signup.status() !== 422 && signup.status() !== 403) throw new Error(`Signup failed ${signup.status()}: ${await signup.text()}`);
  if (signup.ok()) {
    await page.goto("/");
  } else {
    await page.goto("/login");
    await page.locator("#username").fill("admin");
    await page.locator("#password").fill("super-secret-1");
    await page.getByRole("button", { name: "Anmelden" }).click();
  }
  await expect(page.getByText("Willkommen, E2E Admin!")).toBeVisible({ timeout: 30_000 });
}

test("age structure state, details and chart are shareable and interactive", async ({ page }) => {
  await page.route("https://mapsneu.wien.gv.at/**", (route) => route.abort());
  await login(page); await page.goto("/municipalities/overview"); await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("combobox", { name: "Gemeinde suchen" }).fill("Mörtschach");
  await page.getByRole("option").filter({ hasText: "20622" }).click();
  await page.getByLabel("Kennzahl").selectOption("age");
  await expect(page).toHaveURL(/metric=age/);
  await expect(page.getByLabel("Ansicht")).toHaveValue("0-5");
  await expect(page.getByRole("button", { name: "Anteil", exact: true })).toHaveAttribute("aria-pressed", "true");
  const year = page.getByRole("slider", { name: "Jahr" });
  await year.fill("2013");
  await expect(page).toHaveURL(/populationYear=2013/);
  const details = page.getByTestId("municipality-details");
  await expect(details.getByText("796", { exact: true })).toBeVisible();
  await expect(details.getByText("40 Personen", { exact: true })).toBeVisible();
  await expect(details.getByText("5,0 %", { exact: true })).toBeVisible();
  const chart = page.getByTestId("municipality-metric-chart");
  await chart.getByTestId("municipality-metric-chart-point-2013").hover();
  await expect(chart.getByTestId("municipality-metric-chart-tooltip")).toHaveText("2013: 5,0 %");

  await page.getByLabel("Ansicht").selectOption("65-79");
  await page.getByRole("button", { name: "Personen", exact: true }).click();
  await page.getByRole("button", { name: "Frauen", exact: true }).click();
  await expect(page).toHaveURL(/ageGroup=65-79/);
  await expect(page).toHaveURL(/ageMeasure=persons/);
  await expect(page).toHaveURL(/sex=female/);
  await expect(details.getByText("55 Personen", { exact: true })).toBeVisible();
  await chart.getByTestId("municipality-metric-chart-point-2013").hover();
  await expect(chart.getByTestId("municipality-metric-chart-tooltip")).toHaveText("2013: 55 Personen");

  await page.reload();
  await expect(page.getByLabel("Ansicht")).toHaveValue("65-79");
  await expect(page.getByRole("button", { name: "Frauen", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(details.getByText("55 Personen", { exact: true })).toBeVisible({ timeout: 15_000 });

  await page.getByLabel("Ansicht").selectOption("old-age-dependency");
  await expect(page).toHaveURL(/ageIndicator=old-age-dependency/);
  await expect(page.getByTestId("indicator-definition")).toContainText("je 100 Personen von 15 bis 64");
  await expect(page.getByRole("button", { name: "Anteil", exact: true })).toHaveCount(0);
  await expect(details.getByText("21,8 je 100 Personen", { exact: true })).toBeVisible();
  await chart.getByTestId("municipality-metric-chart-point-2013").hover();
  await expect(chart.getByTestId("municipality-metric-chart-tooltip")).toHaveText("2013: 21,8 je 100 Personen");
  await page.reload();
  await expect(page.getByLabel("Ansicht")).toHaveValue("old-age-dependency");

  await page.getByLabel("Ansicht").selectOption("average-age");
  await expect(page.getByTestId("indicator-definition")).toContainText("Arithmetisches Mittel");
  await expect(details.getByText("39,7 Jahre", { exact: true })).toBeVisible();
  await chart.getByTestId("municipality-metric-chart-point-2013").hover();
  await expect(chart.getByTestId("municipality-metric-chart-tooltip")).toHaveText("2013: 39,7 Jahre");

  await page.getByLabel("Ansicht").selectOption("women-share");
  await expect(details.getByText("49,9 %", { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
