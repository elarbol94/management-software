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

  // The analysis landing page is the reference: every Kennzahl with its formula, no
  // analysis needed to read it.
  await page.goto("/municipalities/analysis");
  const catalog = page.getByTestId("kennzahl-catalog");
  await expect(catalog).toBeVisible({ timeout: 30_000 });
  // The formula must be readable in full, not cut off after the first terms.
  await expect(catalog.getByRole("button", { name: /Alterungsindex/ }))
    .toContainText("(65–79 (Ruhestand) · Personen + 80+ (Hochaltrigkeit) · Personen) ÷ (0–5 (Frühe Kindheit) · Personen + 6–14 (Schulalter) · Personen)) × 100");
  // A primary calculation is listed but cannot be opened as a graph.
  await expect(catalog.getByText("Primärberechnung", { exact: false }).first()).toBeVisible();

  // A Kennzahl is the same formula everywhere, so opening it needs no municipality.
  await catalog.getByRole("button", { name: /^Geburtenrate/ }).click();
  await expect(page).toHaveURL(/analysis=/, { timeout: 30_000 });

  // Geburtenrate is (Lebendgeborene ÷ Einwohnerzahl) × 1.000: three inputs, two operators.
  await expect(page.locator(".react-flow__node-dataset")).toHaveCount(3);
  await expect(page.locator(".react-flow__node-operator")).toHaveCount(2);
  const editor = page.getByTestId("municipality-analysis-editor");
  // Asserted on the nodes: the sidebar catalog lists every Ausgangsdatum by name, so both
  // labels are on screen whether or not the derivation reached the canvas.
  await expect(page.locator(".react-flow__node-dataset").filter({ hasText: "Lebendgeborene" })).toHaveCount(1);
  await expect(page.locator(".react-flow__node-dataset").filter({ hasText: "Einwohnerzahl" })).toHaveCount(1);

  // Without a municipality the structure is there but the values are not, and the graph
  // says so rather than showing empty charts.
  await expect(page.getByTestId("analysis-subject")).toHaveText("Keine Gemeinde gewählt");
  await expect(editor.getByText("Gemeinde wählen, um Werte zu sehen.").first()).toBeVisible();

  await editor.getByLabel("Gemeinde des Graphen").fill("Graz");
  await editor.getByRole("button", { name: /^Graz · 60101$/ }).click();
  await expect(page.getByTestId("analysis-subject")).toHaveText("Graz");
  await expect(editor.getByText("Gemeinde wählen, um Werte zu sehen.")).toHaveCount(0);

  // Saving reads the persisted graph, so reload to be sure nothing is still queued.
  await expect(editor.getByText("Gespeichert", { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(page.locator(".react-flow__node-operator")).toHaveCount(2);
  await page.getByRole("tab", { name: "Ergebnis" }).click();
  await page.getByRole("button", { name: "Als Kennzahl speichern" }).click();
  const saveDialog = page.getByTestId("save-kennzahl-dialog");
  await expect(saveDialog).toBeVisible();
  await saveDialog.getByLabel("Name der Kennzahl").fill("Meine Geburtenrate");
  await saveDialog.getByRole("button", { name: "Speichern" }).click();
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
