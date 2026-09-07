import { expect, test, type Page } from "@playwright/test";

test.use({ actionTimeout: 25_000, viewport: { width: 1440, height: 1000 } });
test.describe.configure({ timeout: 240_000 });

async function login(page: Page) {
  let response = await page.request.post("/api/auth/sign-in/username", { data: { username: "admin", password: "super-secret-1" } });
  if (!response.ok()) response = await page.request.post("/api/auth/sign-in/username", { data: { username: "reliable-editor", password: "super-secret-1" } });
  if (!response.ok()) response = await page.request.post("/api/auth/sign-up/email", { data: { username: "admin", password: "super-secret-1", name: "E2E Admin", email: "admin@example.com" } });
  expect(response.ok()).toBe(true);
}
async function tool(page: Page, name: string) {
  await page.getByRole("button", { name: "Werkzeuge", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}
async function closePanel(page: Page) {
  await page.getByRole("button", { name: "Seitenbereich schließen", exact: true }).click();
}
async function screenshot(page: Page, name: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });
}

test("document tools share one panel and retain drafts at desktop, tablet, and phone sizes", async ({ page }) => {
  await login(page);
  await page.goto("/wiki/pages");
  await page.getByRole("button", { name: "Neu", exact: true }).click();
  await page.waitForURL(/\/wiki\/pages\/.+/, { timeout: 90_000 });
  const editor = page.locator(".ProseMirror");
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await editor.fill("A quiet workspace keeps the document at the centre.");
  await expect(page.getByTestId("document-save-status")).toHaveText("Gespeichert");
  await expect(page.locator("[data-workspace-panel]:visible")).toHaveCount(0);
  await editor.press("ControlOrMeta+Home");
  await editor.press("Shift+ArrowRight");
  await tool(page, "Dokumentgliederung");
  await closePanel(page);
  await tool(page, "Details");
  await closePanel(page);
  await page.getByTestId("document-toolbar").getByRole("button", { name: "Fett", exact: true }).click();
  await expect(editor.locator("strong")).toHaveText("A");
  const longTitle = "Strategische Zusammenarbeit und langfristige Unternehmensentwicklung";
  page.once("dialog", (dialog) => void dialog.accept(longTitle));
  await page.getByRole("button", { name: /^Umbenennen:/ }).click();
  await expect(page.getByRole("button", { name: `Umbenennen: ${longTitle}`, exact: true })).toBeVisible();
  await tool(page, "Kommentare");
  await page.getByTestId("page-comment-input").fill("Unsent review note");
  await closePanel(page);
  await tool(page, "Details");
  await expect(page.getByTestId("note-metadata-sidebar")).toBeVisible();
  await expect(page.getByTestId("comment-rail")).not.toBeVisible();
  await closePanel(page);
  await tool(page, "Kommentare");
  await expect(page.getByTestId("page-comment-input")).toHaveValue("Unsent review note");
  await closePanel(page);
  await page.getByRole("button", { name: "Werkzeuge", exact: true }).click();
  await page.getByTestId("document-mode-toggle").click();
  await expect(page.locator(".wiki-document-canvas")).toBeVisible();
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await tool(page, "Kommentare");
    await expect(page.getByTestId("page-comment-input")).toHaveValue(width === 1440 ? "Unsent review note" : width === 1024 ? "Draft at 1440" : "Draft at 1024");
    await closePanel(page);
    await screenshot(page, `document-${width}`);
    await tool(page, "Dokumentlayout");
    await expect(page.getByTestId("document-layout-panel")).toBeVisible();
    await expect(page.locator("[data-workspace-panel]:visible")).toHaveCount(1);
    if (width < 1280) await expect(page.getByRole("dialog")).toBeVisible();
    await screenshot(page, `document-tools-${width}`);
    if (width < 1280) {
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).not.toBeVisible();
    } else await closePanel(page);
    await tool(page, "Kommentare");
    await page.getByTestId("page-comment-input").fill(`Draft at ${width}`);
    await closePanel(page);
    await tool(page, "Kommentare");
    await expect(page.getByTestId("page-comment-input")).toHaveValue(`Draft at ${width}`);
    await closePanel(page);
  }
  await page.reload();
  await expect(editor).toContainText("A quiet workspace");
  await expect(page.locator("[data-workspace-panel]:visible")).toHaveCount(0);
});

test("presentation panels preserve pending edits, playback order, previews, and canvas position", async ({ page }) => {
  await login(page);
  await page.goto("/wiki/presentations");
  await page.getByRole("button", { name: "Neu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Leer oder aus Vorlage", exact: true }).click();
  const title = `Strategische Unternehmensentwicklung und langfristige Zusammenarbeit ${Date.now()}`;
  await page.getByRole("textbox", { name: "Titel der Präsentation" }).fill(title);
  await page.getByRole("button", { name: "Pitch", exact: true }).click();
  await expect(page.getByRole("button", { name: "Text", exact: true })).toBeEnabled();
  await expect(page.locator("[data-workspace-panel]:visible")).toHaveCount(0);
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  await page.getByRole("button", { name: "Text", exact: true }).click();
  await page.getByRole("textbox", { name: "Text", exact: true }).fill("Saved when switching tools");
  await tool(page, "Dokumentquellen");
  await expect(page.getByRole("textbox", { name: "Text", exact: true })).not.toBeVisible();
  await expect.poll(async () => (await (await page.request.get(`/api/wiki/presentations/${id}`)).json()).elements.some((item: { content: { text?: string } }) => item.content.text === "Saved when switching tools")).toBe(true);
  await closePanel(page);
  const viewport = page.locator(".react-flow__viewport");
  const before = await viewport.getAttribute("style");
  await tool(page, "Design");
  await closePanel(page);
  expect(await viewport.getAttribute("style")).toBe(before);
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await screenshot(page, `presentation-${width}`);
    await page.getByRole("button", { name: "Weg", exact: true }).click();
    await expect(page.getByRole("button", { name: "Your Pitch", exact: true })).toBeVisible();
    await screenshot(page, `presentation-path-${width}`);
    await closePanel(page);
    await tool(page, "Kommentare");
    await page.getByRole("textbox", { name: "Neuer Kommentar" }).fill(`Presentation draft ${width}`);
    await closePanel(page);
    await tool(page, "Kommentare");
    await expect(page.getByRole("textbox", { name: "Neuer Kommentar" })).toHaveValue(`Presentation draft ${width}`);
    await closePanel(page);
  }
  await page.getByRole("link", { name: "Präsentationen", exact: true }).click();
  await page.waitForURL(/\/wiki\/presentations$/, { timeout: 90_000 });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.getByRole("link", { name: title, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: title, exact: true }).locator("svg")).toBeVisible();
  await screenshot(page, "presentation-library");
  await page.getByRole("textbox", { name: "Präsentationen suchen…" }).fill("no-match-for-this-title");
  await screenshot(page, "presentation-no-results");
  await page.context().addCookies([{ name: "locale", value: "en", url: "http://localhost:3100" }]);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Presentations", exact: true })).toBeVisible();
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await expect(page.locator("html")).toHaveClass(/dark/);
  await screenshot(page, "presentation-library-english-dark");
  await page.getByRole("link", { name: title, exact: true }).click();
  await expect(page.getByRole("button", { name: "Tools", exact: true })).toBeVisible();
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await screenshot(page, "presentation-english-dark");
});
