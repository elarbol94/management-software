import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ timeout: 120_000 });

async function login(page: Page) {
  const signup = await page.request.post("/api/auth/sign-up/email", {
    data: {
      name: "E2E Admin",
      username: "admin",
      displayUsername: "admin",
      email: "admin@example.com",
      password: "super-secret-1",
    },
  });
  if (!signup.ok() && signup.status() !== 422 && signup.status() !== 403)
    throw new Error(`Signup failed ${signup.status()}: ${await signup.text()}`);
  if (signup.ok()) {
    await page.goto("/");
    return;
  }
  await page.goto("/login");
  await page.locator("#username").fill("admin");
  await page.locator("#password").fill("super-secret-1");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.waitForURL("/");
}

test("population movement is compact, shareable and charted", async ({
  page,
}) => {
  await page.route("https://mapsneu.wien.gv.at/**", (route) => route.abort());
  await login(page);
  await page.goto("/municipalities");
  await page.setViewportSize({ width: 1280, height: 900 });

  await page
    .getByRole("combobox", { name: "Gemeinde suchen" })
    .fill("Mörtschach");
  await page.getByRole("option").filter({ hasText: "20622" }).click();
  await page.getByLabel("Kennzahl").selectOption("movement");
  await expect(page).toHaveURL(/metric=movement/);
  await expect(page.getByLabel("Komponente")).toHaveValue("population-change");

  const year = page.getByRole("slider", { name: "Jahr" });
  await year.fill("2013");
  const details = page.getByTestId("municipality-details");
  await expect(details.getByText("2 Personen", { exact: true })).toBeVisible();
  await expect(
    details.getByText("Kalenderjahr 2013", { exact: true }),
  ).toBeVisible();
  await expect(
    details.getByText("Statistische Korrektur", { exact: true }),
  ).toBeVisible();

  await page.getByLabel("Komponente").selectOption("birth-balance-rate");
  await expect(page).toHaveURL(/movementMetric=birth-balance-rate/);
  await expect(
    details.getByText("2,5 je 1.000 Einwohner", { exact: true }),
  ).toBeVisible();
  const chart = page.getByTestId("municipality-metric-chart");
  await chart.getByTestId("municipality-metric-chart-point-2013").hover();
  await expect(
    chart.getByTestId("municipality-metric-chart-tooltip"),
  ).toHaveText("2013: 2,5 je 1.000 Einwohner");

  await page.reload();
  await expect(page.getByLabel("Kennzahl")).toHaveValue("movement");
  await expect(page.getByLabel("Komponente")).toHaveValue("birth-balance-rate");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
});
