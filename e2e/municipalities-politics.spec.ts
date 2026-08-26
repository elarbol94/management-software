import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ timeout: 120_000 });

async function login(page: Page) {
  const signup = await page.request.post("/api/auth/sign-up/email", {
    data: { name: "E2E Admin", username: "admin", displayUsername: "admin", email: "admin@example.com", password: "super-secret-1" },
  });
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

test("politics map, URL state, complete current profiles and historical gaps remain usable without basemap tiles", async ({ page }) => {
  await page.route("https://mapsneu.wien.gv.at/**", (route) => route.abort());
  await login(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/municipalities/overview?metric=politics&politicsYear=2022&municipality=10101");

  await expect(page.getByLabel("Kennzahl")).toHaveValue("politics");
  const view = page.getByLabel("Politikansicht");
  await expect(view).toHaveValue("leading-list");
  await expect(page.getByTestId("population-legend")).toContainText("ÖVP");

  await page.getByLabel("Datenart").selectOption("derived");
  await view.selectOption("party-share");
  await page.getByLabel("Partei").selectOption("spoe");
  await expect(page).toHaveURL(/politicsView=party-share/);
  await expect(page).toHaveURL(/politicsParty=spoe/);

  await view.selectOption("turnout");
  await expect(page).toHaveURL(/politicsView=turnout/);
  await page.getByRole("slider", { name: "Jahr" }).fill("2021");
  await expect(page).toHaveURL(/politicsYear=2021/);

  await page.getByLabel("Datenart").selectOption("base");
  await view.selectOption("leading-list");
  await expect(page).not.toHaveURL(/politicsView=/);
  await page.getByRole("slider", { name: "Jahr" }).fill("2022");
  await expect(page).toHaveURL(/politicsYear=2022/);
  const details = page.getByTestId("municipality-details");
  const politics = details.getByTestId("municipality-politics-panel");
  await expect(politics).toContainText("Thomas STEINER");
  await expect(politics).toContainText("ÖVP");
  await politics.getByText("Wahlchronik seit 2000").click();
  await expect(politics).toContainText("Direkte Bürgermeisterwahl");
  await expect(politics).toContainText("Wahlgang 1");

  await page.reload();
  await expect(page.getByLabel("Kennzahl")).toHaveValue("politics");
  await expect(page.getByLabel("Politikansicht")).toHaveValue("leading-list");
  await expect(page.getByRole("slider", { name: "Jahr" })).toHaveValue("2022");

  const search = page.getByRole("combobox", { name: "Gemeinde suchen" });
  await search.fill("Klagenfurt");
  await page.getByRole("option").filter({ hasText: "20101" }).click();
  await expect(details.getByTestId("municipality-politics-panel")).toContainText("Land Kärnten");
  await expect(details.getByTestId("municipality-politics-panel")).toContainText("SPÖ15 Mandate");
  await expect(page.getByTestId("municipality-map")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Darstellung" }).click();
  const display = page.getByRole("dialog", { name: "Darstellung" });
  await expect(display.getByLabel("Kennzahl")).toHaveValue("politics");
  const year = display.getByRole("slider", { name: "Jahr" });
  await year.focus();
  await year.press("Home");
  await expect(page).toHaveURL(/politicsYear=2000/);
  await expect(page.getByTestId("population-legend")).toContainText("Keine Daten");
  await display.getByRole("button", { name: "Schließen" }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
