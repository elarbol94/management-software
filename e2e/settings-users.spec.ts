import { expect, test } from "@playwright/test";

test("admins create working accounts with the selected role; members cannot manage users", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const signup = await page.request.post("/api/auth/sign-up/email", {
    data: { name: "E2E Admin", username: "admin", email: "admin@example.com", password: "super-secret-1" },
  });
  if (!signup.ok()) {
    expect([403, 422]).toContain(signup.status());
    const login = await page.request.post("/api/auth/sign-in/username", {
      data: { username: "admin", password: "super-secret-1" },
    });
    expect(login.ok()).toBeTruthy();
  }
  await page.goto("/settings");
  await expect(page.getByRole("button", { name: "Benutzer anlegen" })).toBeVisible();
  const suffix = Date.now();
  for (const [role, label] of [["member", "Mitglied"], ["personnel", "Personal und Buchhaltung"], ["admin", "Administrator"]] as const) {
    const username = `colleague.${role}.${suffix}`;
    await page.getByRole("button", { name: "Benutzer anlegen" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name", { exact: true }).fill(`Colleague ${role}`);
    await dialog.getByLabel("Benutzername", { exact: true }).fill(username);
    await dialog.getByLabel("E-Mail", { exact: true }).fill(`${username}@example.com`);
    await dialog.getByLabel("Anfangspasswort").fill("colleague-password-123");
    if (role !== "member") {
      await dialog.getByRole("combobox").click();
      await page.getByRole("option", { name: label, exact: true }).click();
    }
    await dialog.getByRole("button", { name: "Erstellen", exact: true }).click();
    await expect(dialog).toBeHidden();

    const colleague = await browser.newContext();
    try {
      const login = await colleague.request.post("/api/auth/sign-in/username", {
        data: { username: username.toUpperCase(), password: "colleague-password-123" },
      });
      expect(login.ok(), await login.text()).toBeTruthy();
      expect((await login.json()).user.role).toBe(role);
      if (role !== "admin") {
        const forbidden = await colleague.request.post("/api/auth/admin/create-user", {
          data: { name: "Forbidden", email: `forbidden.${role}.${suffix}@example.com`, password: "password-123", role: "admin", data: { username: `forbidden.${role}.${suffix}` } },
        });
        expect(forbidden.status()).toBe(403);
        const colleaguePage = await colleague.newPage();
        await colleaguePage.goto("/settings/users");
        await expect(colleaguePage).toHaveURL(/\/settings\/profile$/);
        await expect(colleaguePage.getByRole("button", { name: "Benutzer anlegen" })).toHaveCount(0);
      }
    } finally {
      await colleague.close();
    }
  }
  await page.getByRole("link", { name: "Benutzer anzeigen" }).click();
  await expect(page.getByRole("row").filter({ hasText: `colleague.personnel.${suffix}` })).toContainText("Personal und Buchhaltung");
  // Duplicate names must keep the form open and preserve the entered data.
  await page.getByRole("button", { name: "Benutzer anlegen" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill("Duplicate");
  await dialog.getByLabel("Benutzername", { exact: true }).fill(`COLLEAGUE.MEMBER.${suffix}`);
  await dialog.getByLabel("E-Mail", { exact: true }).fill(`duplicate.${suffix}@example.com`);
  await dialog.getByLabel("Anfangspasswort").fill("colleague-password-123");
  await dialog.getByRole("button", { name: "Erstellen", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Dieser Benutzername wird bereits verwendet");
  await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue("Duplicate");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Benutzer anlegen" }).click();
  await expect(page.getByLabel("Anfangspasswort")).toHaveValue("");
});
