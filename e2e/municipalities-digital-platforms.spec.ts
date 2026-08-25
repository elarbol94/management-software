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

test("provider landscape is categorical, shareable and responsive", async ({ page }) => {
  await page.route("https://mapsneu.wien.gv.at/**", (route) => route.abort());
  await login(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/municipalities/overview?metric=digital&digitalView=providers&municipality=10402");

  await expect(page.getByLabel("Kennzahl")).toHaveValue("digital");
  await expect(page.getByLabel("Ansicht")).toHaveValue("providers");
  await expect(page).toHaveURL(/digitalView=providers/);
  const legend = page.getByTestId("population-legend");
  await expect(legend).toContainText("GEM2GO");
  await expect(legend).toContainText("CITIES");
  await expect(legend).toContainText("Mehrere Plattformen");
  await expect(page.getByTestId("municipality-details")).toContainText(
    "Mehrere Plattformen · GEM2GO, CITIES",
  );

  await page.goto("/municipalities/overview?metric=digital&digitalView=providers&municipality=90001");
  await expect(page.getByTestId("municipality-details")).toContainText("Keine vergleichbare App");
  await page.reload();
  await expect(page.getByLabel("Ansicht")).toHaveValue("providers");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Darstellung" }).click();
  const display = page.getByRole("dialog", { name: "Darstellung" });
  await expect(display.getByLabel("Kennzahl")).toHaveValue("digital");
  await expect(display.getByLabel("Ansicht")).toHaveValue("providers");
  await display.getByRole("button", { name: "Schließen" }).click();

  await page.getByRole("button", { name: "Legende" }).click();
  const mobileLegend = page.getByTestId("mobile-population-legend");
  await expect(mobileLegend).toContainText("Lokale/eigene App");
  await expect(mobileLegend).toContainText("Mehrere Plattformen");
  await expect.poll(() =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
});
