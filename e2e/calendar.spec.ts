import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

async function login(page: Page) {
  const signupData = {
    name: "E2E Admin",
    username: "admin",
    displayUsername: "admin",
    email: "admin" + String.fromCharCode(64) + "example.com",
    password: "super-secret-1",
  };
  let signup = await page.request.post("/api/auth/sign-up/email", {
    data: signupData,
  });
  for (let attempt = 0; signup.status() === 404 && attempt < 2; attempt += 1) {
    await page.waitForTimeout(500);
    signup = await page.request.post("/api/auth/sign-up/email", {
      data: signupData,
    });
  }
  if (!signup.ok() && signup.status() !== 422 && signup.status() !== 403) {
    throw new Error(`Signup failed ${signup.status()}: ${await signup.text()}`);
  }
  if (!signup.ok()) {
    await page.goto("/login");
    await page.locator("#username").fill("admin");
    await page.locator("#password").fill("super-secret-1");
    const signIn = page.getByRole("button", { name: "Anmelden" });
    await expect(signIn).toBeEnabled({ timeout: 15_000 });
    await signIn.click();
  } else {
    await page.goto("/");
  }
  await expect(page.getByText("Willkommen, E2E Admin!")).toBeVisible();
}

test("calendar rail entry opens the Flow week and creates a timed event", async ({
  page,
}) => {
  await login(page);
  await page.setViewportSize({ width: 1440, height: 1000 });

  const appSidebar = page.getByTestId("app-sidebar");
  await appSidebar.hover();
  await expect
    .poll(
      async () => Math.round((await appSidebar.boundingBox())?.width ?? 0),
      { timeout: 10_000 },
    )
    .toBe(240);
  await appSidebar.getByRole("link", { name: "Kalender" }).click();
  await expect(page).toHaveURL(/\/calendar/);
  await expect(
    page.getByRole("heading", { name: "Flow-Kalender" }),
  ).toBeVisible();
  await expect(page.getByText("Auslastung").first()).toBeVisible();

  await page.getByRole("button", { name: "Neuer Termin" }).click();
  await page.getByPlaceholder("Was findet statt?").fill("Weekly operations");
  await page.locator('input[type="date"]').fill("2026-07-29");
  const times = page.locator('input[type="time"]');
  await expect(times).toHaveCount(2);
  await times.nth(0).fill("10:00");
  await times.nth(1).fill("11:00");
  await page.getByRole("button", { name: "Termin speichern" }).click();

  await expect(page.getByText("Weekly operations")).toBeVisible();
});

test("global new-event shortcut opens and clears the calendar dialog state", async ({
  page,
}) => {
  await login(page);
  await page.setViewportSize({ width: 1440, height: 1000 });

  const appSidebar = page.getByTestId("app-sidebar");
  await appSidebar.hover();
  await expect
    .poll(async () => Math.round((await appSidebar.boundingBox())?.width ?? 0))
    .toBe(240);
  await appSidebar.getByRole("link", { name: "Termin" }).click();

  await expect(page).toHaveURL(/\/calendar\?.*new=event/);
  await expect(page.getByRole("dialog", { name: "Neuer Termin" })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page).not.toHaveURL(/new=event/);
});

test("calendar exposes month, agenda, and team views through URL state", async ({
  page,
}) => {
  await login(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/calendar?date=2026-07-29&view=week");

  await page.getByRole("button", { name: "Monat" }).click();
  await expect(page).toHaveURL(/view=month/);
  await page.getByRole("button", { name: "Agenda" }).click();
  await expect(page).toHaveURL(/view=agenda/);
  await page.getByRole("button", { name: "Team" }).click();
  await expect(page).toHaveURL(/view=team/);
  await expect(page.getByText("E2E Admin").last()).toBeVisible();
});
