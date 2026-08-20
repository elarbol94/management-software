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
  await page.goto("/municipalities");
  await page.setViewportSize({ width: 1280, height: 900 });

  await expect(page.getByRole("heading", { name: "Gemeinden", exact: true })).toBeVisible();
  await expect(page.getByTestId("municipalities-workspace")).toBeVisible();
  await expect(page.getByTestId("municipality-map")).toBeVisible();
  await expect(page.getByText("2.092 amtliche Gemeinden")).toBeVisible();
  await expect(page.getByTestId("population-legend").getByText("Einwohnerzahl")).toBeVisible();

  const search = page.getByRole("combobox", { name: "Gemeinde suchen" });
  await search.fill("Graz");
  await page.getByRole("option").filter({ hasText: "60101" }).click();
  await expect(page).toHaveURL(/municipality=60101/);
  await expect(page.getByTestId("municipality-details").getByRole("heading", { name: "Graz" })).toBeVisible();
  await expect(page.getByText("60101", { exact: true })).toBeVisible();
  await expect(page.getByTestId("municipality-details").getByText("305.314", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(/municipality=60101/);
  await expect(page.getByTestId("municipality-details").getByRole("heading", { name: "Graz" })).toBeVisible();
  await expect(page.getByTestId("municipality-map")).toHaveAttribute("data-map-ready", "true");
  const canvas = page.locator(".maplibregl-canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Map canvas has no bounds");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator(".municipality-hover-popup")).toBeVisible();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page).toHaveURL(/municipality=60101/);

  await page.getByRole("button", { name: "Ganz Österreich" }).click();
  await expect(page).not.toHaveURL(/municipality=/);
  await expect(page.getByRole("heading", { name: "Gemeinde auswählen" })).toBeVisible();
});

test("municipality workspace stays within the mobile viewport", async ({ page }) => {
  await page.route("https://mapsneu.wien.gv.at/**", (route) => route.abort());
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/municipalities");
  await expect(page.getByTestId("municipality-map")).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("combobox", { name: "Gemeinde suchen" }).fill("Wien");
  await page.getByRole("option").filter({ hasText: "90001" }).click();
  await expect(page).toHaveURL(/municipality=90001/);
  await expect(page.getByTestId("municipality-details").getByRole("heading", { name: "Wien" })).toBeVisible();
});
