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
  await page.goto("/login");
  await page.locator("#username").fill("admin");
  await page.locator("#password").fill("super-secret-1");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.getByText("Willkommen, E2E Admin!")).toBeVisible();
}

async function expectWidth(locator: Locator, width: number) {
  await expect.poll(async () => Math.round((await locator.boundingBox())?.width ?? 0)).toBe(width);
}

test("desktop navigation rails expand on hover, collapse on leave, and survive focus mode", async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/wiki/inbox");

  await expect(page.getByTestId("app-sidebar")).toHaveCount(1);
  await expect(page.getByTestId("research-sidebar")).toHaveCount(1);
  const appSidebar = page.getByTestId("app-sidebar").filter({ visible: true });
  const researchSidebar = page
    .getByTestId("research-sidebar")
    .filter({ visible: true });
  await expect(appSidebar).toBeVisible();
  await expect(researchSidebar).toBeVisible();
  await expectWidth(appSidebar, 56);
  await expectWidth(researchSidebar, 56);

  await expect(appSidebar.getByRole("link", { name: "Wiki" })).toBeVisible();
  await expect(appSidebar.getByRole("link", { name: "Kalender" })).toBeVisible();
  await expect(researchSidebar.getByRole("link", { name: /Eingang/ })).toBeVisible();
  await expect(appSidebar.getByRole("button", { name: /E2E Admin/ })).toBeVisible();

  await appSidebar.hover();
  await expectWidth(appSidebar, 240);
  await page.locator("[data-app-main]").hover();
  await expectWidth(appSidebar, 56);

  await researchSidebar.hover();
  await expectWidth(appSidebar, 56);
  await expectWidth(researchSidebar, 256);
  await page.locator("[data-app-main]").hover();
  await expectWidth(researchSidebar, 56);
  const desktopResearchSearch = researchSidebar.getByRole("textbox", {
    name: "Dokumente und Quellen durchsuchen…",
  });
  await desktopResearchSearch.click();
  await expectWidth(researchSidebar, 256);
  await expect(desktopResearchSearch).toBeFocused();

  await researchSidebar.getByRole("link", { name: "Dokumente", exact: true }).click();
  await expect(page).toHaveURL(/\/wiki\/pages$/);
  await expect(page.getByTestId("research-sidebar")).toHaveCount(1);
  await expectWidth(researchSidebar, 256);

  await appSidebar.hover();
  await expectWidth(appSidebar, 240);
  await page.locator("[data-app-main]").hover();
  await expectWidth(appSidebar, 56);
  await researchSidebar.hover();
  await expectWidth(researchSidebar, 256);
  await researchSidebar.getByRole("button", { name: "Schnelle Notiz" }).click();
  await expect(page).toHaveURL(/\/wiki\/pages\/[^/]+$/);
  await page.getByRole("button", { name: "Fokusmodus", exact: true }).click();
  await expect(appSidebar).toHaveCount(0);
  await expect(researchSidebar).toHaveCount(0);

  await page.getByRole("button", { name: "Fokusmodus beenden" }).click();
  await expectWidth(appSidebar, 56);
  await expectWidth(researchSidebar, 56);
});

test("mobile navigation uses full-width content with dismissible app and research sheets", async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/wiki/inbox");

  await expect(page.getByTestId("app-sidebar")).toHaveCount(1);
  await expect(page.getByTestId("research-sidebar")).toHaveCount(1);
  await expect(page.getByTestId("app-mobile-header")).toBeVisible();
  await expect(page.getByTestId("research-mobile-header")).toBeVisible();
  await expect(
    page.getByTestId("app-sidebar").filter({ visible: true }),
  ).toHaveCount(0);
  await expect(
    page.getByTestId("research-sidebar").filter({ visible: true }),
  ).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.getByRole("button", { name: "Hauptnavigation öffnen" }).click();
  const appSheet = page.getByTestId("app-navigation-sheet");
  await expect(appSheet).toBeVisible();
  await expect(appSheet.getByRole("link", { name: "Projekte" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(appSheet).not.toBeVisible();

  await page.keyboard.press("Control+k");
  const workspaceSearch = page.getByRole("dialog", {
    name: "Arbeitsbereich durchsuchen",
  });
  await expect(workspaceSearch).toBeVisible();
  await expect(
    workspaceSearch.getByPlaceholder(
      "Projekte, Aufgaben, Wiki und Quellen durchsuchen…",
    ),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(workspaceSearch).not.toBeVisible();

  await page.getByRole("button", { name: "Wissensnavigation öffnen" }).click();
  const researchSheet = page.getByTestId("research-navigation-sheet");
  await expect(researchSheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(researchSheet).not.toBeVisible();

  await page.getByRole("button", { name: "Wissensnavigation öffnen" }).click();
  await researchSheet.getByRole("link", { name: "Dokumente", exact: true }).click();
  await expect(page).toHaveURL(/\/wiki\/pages$/);
  await expect(researchSheet).not.toBeVisible();

  await page.getByRole("button", { name: "Hauptnavigation öffnen" }).click();
  await appSheet.getByRole("link", { name: "Projekte" }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(appSheet).not.toBeVisible();
  await expect(page.getByTestId("research-mobile-header")).toBeHidden();
});
