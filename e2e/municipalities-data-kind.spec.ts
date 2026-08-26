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

const optionValues = (page: Page, label: string) =>
  page.getByLabel(label, { exact: true }).locator("option").evaluateAll(
    (options) => options.map((option) => (option as HTMLOptionElement).value),
  );

test("Datenart splits source data from metrics across the other two dropdowns", async ({ page }) => {
  await page.route("https://mapsneu.wien.gv.at/**", (route) => route.abort());
  await login(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/municipalities/overview");

  // Ausgangsdaten: raw counts only, no density and no shares.
  await expect(page.getByLabel("Datenart")).toHaveValue("base");
  expect(await optionValues(page, "Ansicht")).toEqual(["count", "foreign-persons", "structure-population"]);

  await page.getByLabel("Datenart").selectOption("derived");
  await expect(page).toHaveURL(/dataKind=derived/);
  await expect(page.getByLabel("Ansicht")).toHaveValue("density");
  expect(await optionValues(page, "Ansicht")).toEqual(["density", "foreign-share"]);

  // The digital inventory has nothing computed to show, so its category disappears.
  expect(await optionValues(page, "Kennzahl")).not.toContain("digital");
  await page.getByLabel("Datenart").selectOption("base");
  await expect(page).not.toHaveURL(/dataKind=/);
  await expect(page.getByLabel("Ansicht")).toHaveValue("count");
  expect(await optionValues(page, "Kennzahl")).toContain("digital");

  // Age: person counts are Ausgangsdaten, shares and indicators are Kennzahlen.
  await page.getByLabel("Kennzahl").selectOption("age");
  await expect(page).toHaveURL(/metric=age/);
  const baseAgeViews = await optionValues(page, "Ansicht");
  expect(baseAgeViews).toContain("0-5");
  expect(baseAgeViews).not.toContain("aging-index");

  await page.getByLabel("Datenart").selectOption("derived");
  await expect(page).toHaveURL(/dataKind=derived/);
  const derivedAgeViews = await optionValues(page, "Ansicht");
  expect(derivedAgeViews).toContain("0-5");
  expect(derivedAgeViews).toContain("aging-index");

  // Switching Datenart keeps the category but resets the view to that Datenart's first.
  await expect(page).toHaveURL(/metric=age/);
  await expect(page.getByLabel("Ansicht")).toHaveValue("0-5");

  // Costs: euro amounts are Ausgangsdaten, share and per-capita are Kennzahlen.
  await page.getByLabel("Kennzahl").selectOption("costs");
  await expect(page).toHaveURL(/metric=costs/);
  expect(await optionValues(page, "Darstellung")).toEqual(["share", "per-capita", "real-per-capita", "peer-deviation"]);
  await page.getByLabel("Datenart").selectOption("base");
  await expect(page.getByLabel("Darstellung")).toHaveValue("absolute");
  expect(await optionValues(page, "Darstellung")).toEqual(["absolute"]);
  // The summary column is only offered where it means something.
  expect(await optionValues(page, "Aufgabenbereich")).toContain("total");
});
