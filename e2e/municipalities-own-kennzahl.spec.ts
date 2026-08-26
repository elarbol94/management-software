import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ timeout: 180_000 });

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

/** The digits out of e.g. "12,3 je 1.000 Einwohner". */
const numberIn = (text: string | null) => text?.match(/-?\d+,\d+/)?.[0] ?? null;

test("a Kennzahl derivation can be inspected, saved and used on the map", async ({ page }) => {
  await page.route("https://mapsneu.wien.gv.at/**", (route) => route.abort());
  await login(page);
  await page.setViewportSize({ width: 1400, height: 950 });

  // The built-in Geburtenrate for Graz, as the map shows it today.
  await page.goto("/municipalities/overview?municipality=60101");
  await page.getByLabel("Datenart").selectOption("derived");
  await page.getByLabel("Kennzahl").selectOption("movement");
  await expect(page).toHaveURL(/metric=movement/);
  await page.getByLabel("Komponente").selectOption("birth-rate");
  const details = page.getByTestId("municipality-details");
  await expect(details.getByText("Geburtenrate", { exact: true })).toBeVisible();
  const builtIn = numberIn(
    await details.getByText("Geburtenrate", { exact: true })
      .locator("xpath=following-sibling::dd[1]").textContent(),
  );
  expect(builtIn).not.toBeNull();

  // Insert that Kennzahl's derivation into an analysis.
  await page.goto("/municipalities/analysis");
  await page.getByPlaceholder("z. B. Bevölkerungsvergleich").fill("Eigene Kennzahl");
  await page.getByRole("button", { name: "Erstellen" }).click();
  await expect(page).toHaveURL(/analysis=/);

  const catalog = page.getByTestId("kennzahl-catalog");
  await expect(catalog).toBeVisible({ timeout: 30_000 });
  await catalog.getByLabel("Gemeinde").fill("Graz");
  await catalog.getByRole("button", { name: /^Graz · 60101$/ }).click();
  await expect(page.getByTestId("kennzahl-catalog-municipality")).toHaveText("Graz");
  await catalog.getByRole("button", { name: "Geburtenrate" }).click();

  // Geburtenrate is (Lebendgeborene ÷ Einwohnerzahl) × 1.000: three inputs, two operators.
  await expect(page.locator(".react-flow__node-dataset")).toHaveCount(3);
  await expect(page.locator(".react-flow__node-operator")).toHaveCount(2);
  const editor = page.getByTestId("municipality-analysis-editor");
  await expect(editor).toContainText("Lebendgeborene");
  await expect(editor).toContainText("Einwohnerzahl");

  // Saving reads the persisted graph, so reload to be sure nothing is still queued.
  await expect(editor.getByText("Gespeichert", { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(page.locator(".react-flow__node-operator")).toHaveCount(2);
  page.once("dialog", (dialog) => dialog.accept("Meine Geburtenrate"));
  await page.getByRole("button", { name: "Als Kennzahl speichern" }).click();
  await expect(page.getByText(/Meine Geburtenrate/)).toBeVisible({ timeout: 30_000 });

  // It is now selectable on the map and reproduces the built-in number.
  await page.goto("/municipalities/overview?municipality=60101&dataKind=derived");
  await page.getByLabel("Kennzahl").selectOption("custom");
  await expect(page).toHaveURL(/metric=custom/);
  await expect(page.getByLabel("Eigene Kennzahl")).toHaveValue(/.+/);
  await expect(details.getByText("Meine Geburtenrate", { exact: true })).toBeVisible();
  const own = numberIn(
    await details.getByText("Meine Geburtenrate", { exact: true })
      .locator("xpath=following-sibling::dd[1]").textContent(),
  );
  expect(own).toBe(builtIn);
});
