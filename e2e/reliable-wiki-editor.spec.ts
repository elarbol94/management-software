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
  await page.waitForURL(/\/wiki\/pages\/[^/]+$/, { timeout: 180_000 });
  const editor = page.locator(".ProseMirror");
  await expect(editor).toBeVisible();
  await expect(editor).toHaveAttribute("contenteditable", "true", { timeout: 10_000 });
  return editor;
}

test.describe.configure({ mode: "serial", timeout: 240_000 });

async function trackedNote(page: Page) {
  const lease = page.waitForRequest((request) => /\/api\/wiki\/pages\/[^/]+\/lease$/.test(request.url()));
  const editor = await createNote(page);
  const request = await lease;
  return { editor, id: request.url().split("/").at(-2)!, sessionId: request.postDataJSON().sessionId as string };
}

test("save acknowledgements retain newer text and layout in the recovery journal", async ({ page }) => {
  await login(page);
  const { editor, id } = await trackedNote(page);
  let firstDone!: () => void;
  let secondDone!: () => void;
  const firstGate = new Promise<void>((resolve) => { firstDone = resolve; });
  const secondGate = new Promise<void>((resolve) => { secondDone = resolve; });
  let requests = 0;
  await page.route(`**/api/wiki/pages/${id}/content`, async (route) => {
    const index = ++requests;
    const response = await route.fetch();
    if (index === 1) await firstGate;
    if (index === 2) await secondGate;
    await route.fulfill({ response });
  });
  try {
    await editor.fill("First snapshot");
    await expect.poll(() => requests).toBe(1);
    await editor.fill("Newer words must survive");
    await page.getByTestId("document-mode-toggle").click();
    firstDone();
    await expect.poll(() => requests).toBe(2);
    const journal = await page.evaluate((id) => JSON.parse(localStorage.getItem(`wiki-draft:${id}`) ?? "null"), id);
    expect(journal.contentJson).toContain("Newer words must survive");
    expect(journal.documentMode).toBe(true);
    expect(journal.baseContentVersion).toBeGreaterThan(1);
    secondDone();
    await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible();
    await page.reload();
    await expect(editor).toContainText("Newer words must survive");
    await expect(page.locator(".wiki-document-canvas")).toBeVisible();
  } finally { firstDone(); secondDone(); }
});

test("a lost save response retries successfully without a false conflict", async ({ page }) => {
  await login(page);
  const { editor, id } = await trackedNote(page);
  let requests = 0;
  await page.route(`**/api/wiki/pages/${id}/content`, async (route) => {
    if (++requests === 1) { await route.fetch(); await route.abort("failed"); }
    else await route.continue();
  });
  await editor.fill("Saved despite a lost response");
  await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible();
  expect(requests).toBeGreaterThanOrEqual(2);
  await page.reload();
  await expect(editor).toContainText("Saved despite a lost response");
});

test("stale local recovery cannot overwrite a newer server document", async ({ page }) => {
  await login(page);
  const { editor, id, sessionId } = await trackedNote(page);
  await editor.fill("Original words");
  await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible();
  const draft = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Stale local words" }] }] };
  await page.evaluate(({ id, contentJson }) => localStorage.setItem(`wiki-draft:${id}`, JSON.stringify({ contentJson, baseContentVersion: 1 })), { id, contentJson: JSON.stringify(draft) });
  await page.request.post(`/api/wiki/pages/${id}/lease`, { data: { action: "release", sessionId } });
  await page.reload();
  await expect(page.getByRole("button", { name: "Aktuelle laden" })).toBeVisible();
  const current = await page.request.get(`/api/wiki/pages/${id}/export?format=markdown`);
  expect(await current.text()).toContain("Original words");
  await expect(editor).toContainText("Stale local words");
  await page.getByRole("button", { name: "Aktuelle laden" }).click();
  await expect(editor).toContainText("Original words");
  await expect.poll(() => page.evaluate((id) => localStorage.getItem(`wiki-draft:${id}`), id)).toBeNull();
});

test("layout-only drafts recover and export includes the last keystrokes", async ({ page }) => {
  await login(page);
  const { editor, id, sessionId } = await trackedNote(page);
  await editor.fill("Before layout recovery");
  const savedResponse = await page.waitForResponse((response) => response.url().endsWith(`/pages/${id}/content`) && response.request().method() === "PATCH");
  const saved = await savedResponse.json();
  await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible();
  const payload = savedResponse.request().postDataJSON();
  await page.evaluate(({ id, payload, version }) => localStorage.setItem(`wiki-draft:${id}`, JSON.stringify({ ...payload, documentMode: true, baseContentVersion: version })), { id, payload, version: saved.contentVersion });
  await page.request.post(`/api/wiki/pages/${id}/lease`, { data: { action: "release", sessionId } });
  await page.reload();
  await expect(page.locator(".wiki-document-canvas")).toBeVisible();
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate((id) => localStorage.getItem(`wiki-draft:${id}`), id)).toBeNull();
  await editor.fill("Last keystrokes before export");
  await page.getByRole("button", { name: "Mehr", exact: true }).first().click();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Markdown", exact: true }).click();
  const download = await downloadEvent;
  expect(await download.failure()).toBeNull();
  const exported = await page.request.get(`/api/wiki/pages/${id}/export?format=markdown`);
  expect(await exported.text()).toContain("Last keystrokes before export");
});

test("server saving still works when local recovery storage is full", async ({ page }) => {
  await login(page);
  const { editor, id } = await trackedNote(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("wiki-draft:")) throw new DOMException("Full", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await editor.fill("Save through a full recovery journal");
  await expect(page.getByText(/Die lokale Wiederherstellung ist nicht verfügbar/)).toBeVisible();
  await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible();
  const response = await page.request.get(`/api/wiki/pages/${id}/export?format=markdown`);
  expect(await response.text()).toContain("Save through a full recovery journal");
});

test("applying a template preserves current text by default and uses normal saving", async ({ page }) => {
  await login(page);
  const { editor, id } = await trackedNote(page);
  await editor.fill("Keep these current words");
  await page.getByTestId("document-mode-toggle").click();
  await page.getByRole("button", { name: "Mehr", exact: true }).last().click();
  await page.getByRole("menuitem", { name: "Dokumentlayout anzeigen" }).click();
  const panel = page.getByTestId("document-layout-panel");
  await panel.getByRole("tab").nth(1).click();
  await expect(panel.getByLabel("Text durch Vorlageninhalt ersetzen")).not.toBeChecked();
  await panel.getByRole("button", { name: "Vorlage anwenden", exact: true }).click();
  await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible();
  const response = await page.request.get(`/api/wiki/pages/${id}/export?format=markdown`);
  expect(await response.text()).toContain("Keep these current words");
  await expect(editor).toContainText("Keep these current words");
});

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
  await login(page);
  await createNote(page);
  const sideTools = page.getByTestId("editor-side-tools");
  await expect(sideTools).toBeVisible();
  await expect(sideTools.getByRole("button")).toHaveCount(4);
  await expect(page.getByTestId("proofing-language-toggle")).toContainText("DE");
  await expect(page.getByTestId("proofing-language-toggle")).toContainText("EN");
  await page.getByRole("button", { name: "Dokumentgliederung" }).click();
  await expect(page.getByTestId("editor-outline")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Kommentare anzeigen" }).click();
  await expect(page.getByTestId("comment-rail")).toBeVisible();
  await page.getByRole("button", { name: "Kommentare ausblenden" }).click();
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
  await page.getByRole("button", { name: "Bildbeschreibung speichern", exact: true }).click();
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
  await panel.getByRole("button", { name: /Alle Beschriftungen/ }).click();
  await panel.getByTestId("svg-text-layer-svg-text-1").click();
  const textLayer = panel.getByTestId("svg-inline-input-svg-text-1");
  await expect(textLayer).toHaveCount(1);
  await expect(textLayer).toHaveValue("Original label");
  await textLayer.fill("Updated label");
  await panel.getByRole("button", { name: "Grafik speichern" }).click();
  await expect(panel.getByText("Versionsverlauf")).toBeVisible();
  await panel.getByRole("button", { name: "Wiederherstellen" }).click();
  await panel.getByTestId("svg-text-layer-svg-text-1").click();
  await expect(textLayer).toHaveValue("Original label");
});
