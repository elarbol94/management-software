import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  let response = await page.request.post("/api/auth/sign-in/username", {
    data: { username: "reliable-editor", password: "super-secret-1" },
  });
  if (!response.ok()) {
    response = await page.request.post("/api/auth/sign-up/email", {
      data: {
        name: "Reliable Editor",
        username: "reliable-editor",
        displayUsername: "reliable-editor",
        email: "reliable-editor@example.com",
        password: "super-secret-1",
      },
    });
  }
  expect(response.ok()).toBe(true);
  await page.goto("/wiki/inbox");
  await expect(page.getByTestId("research-sidebar")).toBeVisible();
}

async function createNote(page: Page) {
  await page.getByRole("button", { name: "Schnelle Notiz" }).last().click();
  await page.waitForURL(/\/wiki\/pages\/[^/]+$/, { timeout: 45_000 });
  const editor = page.locator(".ProseMirror");
  await expect(editor).toBeVisible();
  await expect(editor).toHaveAttribute("contenteditable", "true", { timeout: 10_000 });
  return editor;
}

test.describe.configure({ mode: "serial" });

test("collapsed research rail expands its search without covering content", async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  const sidebar = page.getByTestId("research-sidebar");
  await expect(sidebar).toHaveCSS("width", "56px");
  const compactSearch = sidebar.getByRole("button", { name: "Dokumente und Quellen durchsuchen…" });
  await expect(compactSearch).toBeVisible();
  await compactSearch.evaluate((button: HTMLButtonElement) => button.click());
  const fullSearch = page.locator("#research-search-desktop");
  await expect(fullSearch).toBeFocused();
  await expect(sidebar).toHaveCSS("width", "256px");
  const box = await sidebar.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(255);
});

test("slash source command stays in the viewport and opens the IEEE picker", async ({ page }) => {
  await login(page);
  const editor = await createNote(page);
  await editor.click();
  await page.keyboard.type("/quelle");
  const palette = page.getByRole("listbox", { name: "Slash-Befehle" });
  await expect(palette).toBeVisible();
  const box = await palette.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(800);
  await expect(palette).toHaveCSS("z-index", "80");
  await palette.getByRole("option", { name: /Quelle zitieren/ }).click();
  await expect(page.getByPlaceholder("Quelle suchen…")).toBeVisible();
  await expect(page.getByText("IEEE", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Literaturverzeichnis" })).toHaveCount(0);
});

test("a second editor is read-only until it explicitly takes over", async ({ browser, page }) => {
  await login(page);
  const editor = await createNote(page);
  await editor.fill("Protected draft");
  await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible({ timeout: 15_000 });
  const storageState = await page.context().storageState();
  const competingContext = await browser.newContext({ storageState });
  const competingPage = await competingContext.newPage();
  await competingPage.goto(page.url());
  const competingEditor = competingPage.locator(".ProseMirror");
  await expect(competingEditor).toBeVisible();
  await expect(competingEditor).toHaveAttribute("contenteditable", "false");
  const takeOver = competingPage.getByRole("button", { name: "Bearbeitung übernehmen" });
  await expect(takeOver).toBeVisible();
  await takeOver.click();
  await expect(competingEditor).toHaveAttribute("contenteditable", "true");
  await competingContext.close();
});

test("document paper keeps its physical aspect ratio and margin guides can be toggled", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1042, height: 720 });
  await login(page);
  await createNote(page);
  const sideTools = page.getByTestId("editor-side-tools");
  await expect(sideTools).toBeVisible();
  await expect(sideTools.getByRole("button")).toHaveCount(4);
  await expect.poll(async () => (await sideTools.boundingBox())?.width ?? 0).toBeLessThanOrEqual(48);
  await sideTools.hover();
  await expect.poll(async () => (await sideTools.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(170);
  await page.mouse.move(4, 4);
  await expect.poll(async () => (await sideTools.boundingBox())?.width ?? 0).toBeLessThanOrEqual(48);
  await expect(page.getByTestId("proofing-language-toggle")).toContainText("DE");
  await expect(page.getByTestId("proofing-language-toggle")).toContainText("EN");
  await page.getByRole("button", { name: "Dokumentgliederung" }).click();
  await expect(page.getByTestId("editor-outline")).toBeVisible();
  await page.keyboard.press("Escape");
  await sideTools.getByRole("button", { name: "Kommentare anzeigen" }).click();
  await expect(page.getByTestId("comment-sheet")).toBeVisible();
  await page.keyboard.press("Escape");
  await sideTools.getByRole("button", { name: "Kommentare ausblenden" }).click();

  await page.setViewportSize({ width: 1682, height: 912 });
  await sideTools.getByRole("button", { name: "Dokumentgliederung" }).click();
  const outlinePanel = page.getByTestId("editor-outline");
  await expect(outlinePanel).toBeVisible();
  const outlineBox = await outlinePanel.boundingBox();
  await sideTools.getByRole("button", { name: "Kommentare anzeigen" }).click();
  await expect(outlinePanel).toHaveCount(0);
  const commentPanel = page.getByTestId("comment-rail");
  await expect(commentPanel).toBeVisible();
  const commentBox = await commentPanel.boundingBox();
  expect(Math.abs((outlineBox?.width ?? 0) - (commentBox?.width ?? 0))).toBeLessThanOrEqual(2);
  await sideTools.getByRole("button", { name: "Kommentare ausblenden" }).click();
  await page.getByTestId("document-mode-toggle").click();
  await page.getByRole("button", { name: "Mehr", exact: true }).last().click();
  await page.getByRole("menuitem", { name: "Dokumentlayout anzeigen" }).click();
  const canvas = page.locator(".wiki-document-canvas");
  const sheet = canvas.locator(".wiki-document-page-sheet").first();
  await expect(sheet).toBeVisible();
  const sheetBox = await sheet.boundingBox();
  expect(sheetBox).not.toBeNull();
  expect(sheetBox!.width / sheetBox!.height).toBeCloseTo(210 / 297, 2);
  const guides = page.getByLabel("Seitenränder anzeigen");
  await expect(guides).toBeChecked();
  await guides.uncheck();
  await expect(canvas).toHaveAttribute("data-margin-guides", "false");
  await guides.check();
  await expect(canvas).toHaveAttribute("data-margin-guides", "true");
  await page.keyboard.press("ControlOrMeta+0");
  await page.keyboard.press("ControlOrMeta++");
  await expect(canvas).toHaveCSS("zoom", "1.1");
  await page.keyboard.press("ControlOrMeta+0");
  await page.locator(".wiki-document-workspace").dispatchEvent("wheel", { ctrlKey: true, deltaY: -100 });
  await expect(canvas).toHaveCSS("zoom", "1.08");
  await page.getByRole("button", { name: "Mehr", exact: true }).last().click();
  await expect(page.getByRole("menuitem", { name: "Verkleinern" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Vergrößern" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByTestId("document-mode-toggle").click();
  await expect(page.locator(".wiki-editor-surface")).toHaveCSS("zoom", "1.08");
});

test("SVG text updates live and previous versions can be restored", async ({ page }) => {
  await login(page);
  await createNote(page);
  await page.getByTestId("wiki-inline-image-input").setInputFiles({
    name: "editable-figure.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120"><rect width="100%" height="100%" fill="white"/><text x="20" y="65">Original label</text></svg>'),
  });
  await expect(page.locator("figure[data-commentable-image]")).toBeVisible();
  await page.getByRole("button", { name: "Mehr", exact: true }).last().click();
  await page.getByRole("menuitem", { name: "Grafiken" }).click();
  const panel = page.getByRole("dialog", { name: "Grafiken" });
  await expect(panel).toBeVisible();
  const panelBox = await panel.boundingBox();
  const viewport = page.viewportSize();
  expect(panelBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(panelBox!.x + panelBox!.width / 2).toBeCloseTo(viewport!.width / 2, 0);
  expect(panelBox!.y + panelBox!.height / 2).toBeCloseTo(viewport!.height / 2, 0);
  expect(panelBox!.width).toBeGreaterThan(viewport!.width * 0.95);
  expect(panelBox!.height).toBeGreaterThan(viewport!.height * 0.95);
  const textLayer = panel.getByTestId("svg-text-layer-svg-text-1").locator('input[data-slot="input"]');
  await expect(textLayer).toHaveCount(1);
  await expect(textLayer).toHaveValue("Original label");
  await textLayer.fill("Updated label");
  await panel.getByRole("button", { name: "Grafik speichern" }).click();
  await expect(panel.getByText("Versionsverlauf")).toBeVisible();
  await panel.getByRole("button", { name: "Wiederherstellen" }).click();
  await expect(textLayer).toHaveValue("Original label");
});
