import { expect, test, type Locator, type Page } from "@playwright/test";

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
  if (!signup.ok() && signup.status() !== 422 && signup.status() !== 403) {
    throw new Error(`Signup failed ${signup.status()}: ${await signup.text()}`);
  }
  if (signup.ok()) {
    await page.goto("/");
    await expect(page.getByText("Willkommen, E2E Admin!")).toBeVisible();
    return;
  }
  await page.goto("/");
  if (!page.url().endsWith("/login")) {
    await expect(page.getByText("Willkommen, E2E Admin!")).toBeVisible();
    return;
  }
  await page.locator("#username").fill("admin");
  await page.locator("#password").fill("super-secret-1");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.getByText("Willkommen, E2E Admin!")).toBeVisible();
}

async function expectWidth(locator: Locator, width: number) {
  await expect.poll(async () => Math.round((await locator.boundingBox())?.width ?? 0)).toBe(width);
}

test("desktop navigation rails expand independently, reset on reload, and survive focus mode", async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/wiki/inbox");

  const appSidebar = page.getByTestId("app-sidebar");
  const researchSidebar = page.getByTestId("research-sidebar");
  await expect(appSidebar).toBeVisible();
  await expect(researchSidebar).toBeVisible();
  await expectWidth(appSidebar, 64);
  await expectWidth(researchSidebar, 64);

  await expect(appSidebar.getByRole("link", { name: "Wiki" })).toBeVisible();
  await expect(researchSidebar.getByRole("link", { name: /Eingang/ })).toBeVisible();
  await expect(appSidebar.getByRole("button", { name: /E2E Admin/ })).toBeVisible();

  await page.getByRole("button", { name: "Hauptnavigation ausklappen" }).click();
  await expectWidth(appSidebar, 240);
  await expectWidth(researchSidebar, 64);

  await page.getByRole("button", { name: "Wissensnavigation ausklappen" }).click();
  await expectWidth(appSidebar, 240);
  await expectWidth(researchSidebar, 256);

  await page.getByRole("button", { name: "Hauptnavigation einklappen" }).click();
  await expectWidth(appSidebar, 64);
  await expectWidth(researchSidebar, 256);

  await page.getByRole("button", { name: "Wissensnavigation einklappen" }).click();
  await researchSidebar.getByRole("button", { name: "Seiten und Quellen durchsuchen…" }).click();
  await expectWidth(researchSidebar, 256);
  await expect(page.locator("#research-search-desktop")).toBeFocused();

  await researchSidebar.getByRole("link", { name: "Seiten", exact: true }).click();
  await expect(page).toHaveURL(/\/wiki\/pages$/);
  await expectWidth(researchSidebar, 256);

  await page.reload();
  await expectWidth(appSidebar, 64);
  await expectWidth(researchSidebar, 64);

  await page.getByRole("button", { name: "Hauptnavigation ausklappen" }).click();
  await expectWidth(appSidebar, 240);
  await researchSidebar.getByRole("button", { name: "Schnelle Notiz" }).click();
  await expect(page).toHaveURL(/\/wiki\/pages\/[^/]+$/);
  await page.getByRole("button", { name: "Fokusmodus", exact: true }).click();
  await expect(appSidebar).toHaveCount(0);
  await expect(researchSidebar).toHaveCount(0);

  await page.getByRole("button", { name: "Fokusmodus beenden" }).click();
  await expectWidth(page.getByTestId("app-sidebar"), 240);
  await expectWidth(page.getByTestId("research-sidebar"), 64);
});

test("mobile navigation uses full-width content with dismissible app and research sheets", async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/wiki/inbox");

  await expect(page.getByTestId("app-mobile-header")).toBeVisible();
  await expect(page.getByTestId("research-mobile-header")).toBeVisible();
  await expect(page.getByTestId("app-sidebar")).toBeHidden();
  await expect(page.getByTestId("research-sidebar")).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.getByRole("button", { name: "Hauptnavigation öffnen" }).click();
  const appSheet = page.getByTestId("app-navigation-sheet");
  await expect(appSheet).toBeVisible();
  await expect(appSheet.getByRole("link", { name: "Projekte" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(appSheet).not.toBeVisible();

  await page.keyboard.press("Control+k");
  const researchSheet = page.getByTestId("research-navigation-sheet");
  await expect(researchSheet).toBeVisible();
  await expect(page.locator("#research-search-mobile")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(researchSheet).not.toBeVisible();

  await page.getByRole("button", { name: "Wissensnavigation öffnen" }).click();
  await researchSheet.getByRole("link", { name: "Seiten", exact: true }).click();
  await expect(page).toHaveURL(/\/wiki\/pages$/);
  await expect(researchSheet).not.toBeVisible();

  await page.getByRole("button", { name: "Hauptnavigation öffnen" }).click();
  await appSheet.getByRole("link", { name: "Projekte" }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(appSheet).not.toBeVisible();
  await expect(page.getByTestId("research-mobile-header")).toHaveCount(0);
});
