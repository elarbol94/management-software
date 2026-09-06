import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  let response = await page.request.post("/api/auth/sign-in/username", {
    data: { username: "reliable-editor", password: "super-secret-1" },
  });
  if (!response.ok()) {
    response = await page.request.post("/api/auth/sign-in/username", {
      data: { username: "admin", password: "super-secret-1" },
    });
  }
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
  await expect(editor).toHaveAttribute("contenteditable", "true", { timeout: 30_000 });
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
  await expect(page.getByTestId("proofing-language-toggle")).toHaveAccessibleName("Rechtschreibung");
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
  let releasePreview!: () => void;
  const previewGate = new Promise<void>((resolve) => { releasePreview = resolve; });
  await page.route("**/api/wiki/svg-assets/*/content?raw=1&v=*", async (route) => { await previewGate; await route.continue(); });
  try {
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
    await expect(textLayer).toHaveCount(0);
    releasePreview();
    await expect(textLayer).toHaveCount(1);
    await expect(textLayer).toHaveValue("Original label");
    await textLayer.fill("Updated label");
    await panel.getByRole("button", { name: "Grafik speichern" }).click();
    await expect(panel.getByText("Versionsverlauf")).toBeVisible();
    await panel.getByRole("button", { name: "Wiederherstellen" }).click();
    await panel.getByTestId("svg-text-layer-svg-text-1").click();
    await expect(textLayer).toHaveValue("Original label");
  } finally { releasePreview(); }
});


function proofingMatches(paragraphs: string[]) {
  return paragraphs.flatMap((text, paragraph) => [...text.matchAll(/\bFeler\b/g)].map((match) => ({
    paragraph, offset: match.index!, length: 5, message: "Mögliches falsch geschriebenes Wort.", kind: "spelling", category: "Rechtschreibung", ruleId: "SPELL", replacements: ["Fehler"],
  })));
}

async function mockProofing(page: Page) {
  await page.route("**/api/wiki/proofing-dictionary?*", (route) => route.fulfill({ json: { words: [] } }));
  await page.route("**/api/wiki/spellcheck", (route) => route.fulfill({ json: { matches: proofingMatches(route.request().postDataJSON().paragraphs) } }));
}

test("proofing suggestions correct formatted words after line breaks and support keyboard and undo", async ({ page }) => {
  await mockProofing(page);
  await login(page);
  const editor = await createNote(page);
  page.setDefaultTimeout(15_000);
  await editor.fill("Erste Zeile");
  await editor.press("Shift+Enter");
  await page.keyboard.insertText("Fe");
  await page.keyboard.press("Control+b");
  await page.keyboard.insertText("ler");
  await page.keyboard.press("Control+b");
  await expect(page.locator(".wiki-spellcheck-issue").first()).toHaveText("Fe");
  await page.keyboard.press("Alt+Enter");
  const popup = page.getByRole("dialog", { name: "Korrekturvorschläge" });
  await expect(popup).toBeVisible();
  await expect(popup.getByRole("button", { name: "Fehler", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(editor).toHaveText("Erste ZeileFehler");
  await expect(editor).toBeFocused();
  await editor.press("Control+z");
  await expect(editor).toContainText("Feler");
  await expect(page.locator(".wiki-spellcheck-issue").first()).toBeVisible();
  await page.keyboard.press("Alt+F7");
  await expect(popup).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(popup).toBeHidden();
  await expect(editor).toBeFocused();
  await page.locator(".wiki-spellcheck-issue").first().click();
  await expect(popup).toBeVisible();
  await page.getByTestId("proofing-language-toggle").click();
  await expect(popup).toBeHidden();
  await page.keyboard.press("Escape");
});

test("proofing keeps delayed checks useful without applying stale offsets", async ({ page }) => {
  await page.route("**/api/wiki/proofing-dictionary?*", (route) => route.fulfill({ json: { words: [] } }));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const texts: string[] = [];
  await page.route("**/api/wiki/spellcheck", async (route) => {
    const paragraphs = route.request().postDataJSON().paragraphs as string[];
    texts.push(...paragraphs);
    if (paragraphs.includes("Feler alt")) await gate;
    await route.fulfill({ json: { matches: proofingMatches(paragraphs) } });
  });
  await login(page);
  const editor = await createNote(page);
  page.setDefaultTimeout(15_000);
  try {
    await editor.fill("Feler alt");
    await expect.poll(() => texts.includes("Feler alt")).toBe(true);
    await editor.fill("Ganz neuer Text");
    await editor.press("Enter");
    await page.keyboard.insertText("Feler alt");
    release();
    await expect(page.locator(".wiki-spellcheck-issue")).toHaveText("Feler");
    await expect(page.getByTestId("proofing-status")).toHaveText("1 Hinweis");
    expect(texts.filter((text) => text === "Feler alt")).toHaveLength(1);
    await page.locator(".wiki-spellcheck-issue").click();
    await page.getByRole("button", { name: "Fehler", exact: true }).click();
    await expect(editor).toHaveText("Ganz neuer TextFehler alt");
    await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible();
  } finally { release(); }
});

test("proofing replace all leaves unmarked substrings alone and supports deletion suggestions", async ({ page }) => {
  await mockProofing(page);
  await login(page);
  const editor = await createNote(page);
  page.setDefaultTimeout(15_000);
  await editor.fill("Feler Felerchen Feler");
  await expect(page.locator(".wiki-spellcheck-issue")).toHaveCount(2);
  await page.locator(".wiki-spellcheck-issue").first().click();
  const popup = page.getByRole("dialog", { name: "Korrekturvorschläge" });
  await popup.getByText("Weitere Aktionen", { exact: true }).click();
  await popup.getByRole("button", { name: "Alle gleich markierten Stellen ersetzen" }).click();
  await expect(editor).toHaveText("Fehler Felerchen Fehler");
  await page.route("**/api/wiki/spellcheck", (route) => {
    const paragraphs = route.request().postDataJSON().paragraphs as string[];
    return route.fulfill({ json: { matches: paragraphs.flatMap((text, paragraph) => text.includes("doppelt ") ? [{ paragraph, offset: 0, length: 8, message: "Doppeltes Wort", kind: "writing", category: "Grammatik", ruleId: "DOUBLE", replacements: [""] }] : []) } });
  });
  await editor.fill("doppelt doppelt");
  await page.locator(".wiki-spellcheck-issue").click();
  await popup.getByRole("button", { name: "Entfernen", exact: true }).click();
  await expect(editor).toHaveText("doppelt");
});

test("proofing recovers after service failure, selects languages directly and fits small screens", async ({ page }) => {
  await page.route("**/api/wiki/proofing-dictionary?*", (route) => route.fulfill({ json: { words: [] } }));
  let requests = 0;
  await page.route("**/api/wiki/spellcheck", (route) => ++requests === 1 ? route.fulfill({ status: 503, json: { error: "Temporarily unavailable" } })
    : route.fulfill({ json: { matches: proofingMatches(route.request().postDataJSON().paragraphs) } }));
  await login(page);
  const editor = await createNote(page);
  page.setDefaultTimeout(15_000);
  await editor.fill("Feler");
  await expect(editor).toHaveAttribute("spellcheck", "true");
  await expect(page.getByTestId("proofing-status")).toHaveText("Browserprüfung");
  await expect(page.locator(".wiki-spellcheck-issue")).toBeVisible({ timeout: 12_000 });
  await expect(editor).toHaveAttribute("spellcheck", "false");
  await page.getByTestId("proofing-language-toggle").click();
  await page.getByRole("combobox", { name: "Prüfsprache" }).click();
  const languageSaved = page.waitForResponse((response) => response.url().endsWith("/proofing-language") && response.request().method() === "PATCH");
  await page.getByRole("option", { name: "Englisch", exact: true }).click();
  expect((await languageSaved).ok()).toBe(true);
  await expect(page.getByRole("combobox", { name: "Prüfsprache" })).toBeEnabled();
  await expect(editor).toHaveAttribute("lang", "en-US");
  await page.keyboard.press("Escape");
  await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible();
  await page.reload();
  await expect(editor).toHaveAttribute("lang", "en-US");
  await page.setViewportSize({ width: 390, height: 700 });
  await expect(page.getByTestId("proofing-menu-compact")).toBeVisible();
  await page.locator(".wiki-spellcheck-issue").click();
  const popup = page.getByRole("dialog", { name: "Korrekturvorschläge" });
  await expect(popup).toBeVisible();
  const box = await popup.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(700);
});

test("proofing accepts large shared dictionaries without suppressing grammar", async ({ page }) => {
  await page.route("**/api/wiki/proofing-dictionary?*", (route) => route.fulfill({ json: { words: [...Array.from({ length: 510 }, (_, i) => `Brand${i}`), "Feler"] } }));
  await page.route("**/api/wiki/spellcheck", (route) => {
    const payload = route.request().postDataJSON();
    expect(payload.dictionary).toBeUndefined();
    const matches = proofingMatches(payload.paragraphs);
    return route.fulfill({ json: { matches: [...matches, ...matches.map((match) => ({ ...match, kind: "writing", ruleId: "GRAMMAR" }))] } });
  });
  await login(page);
  const editor = await createNote(page);
  page.setDefaultTimeout(15_000);
  await editor.fill("Feler");
  await expect(page.locator(".wiki-spellcheck-issue--writing")).toBeVisible();
  await expect(page.locator(".wiki-spellcheck-issue--spelling")).toHaveCount(0);
  await expect(page.getByTestId("proofing-status")).toHaveText("1 Hinweis");
});


test("proofing menu retries immediately and opens the next correction as plain text", async ({ page }) => {
  await page.route("**/api/wiki/proofing-dictionary?*", (route) => route.fulfill({ json: { words: [] } }));
  let available = false;
  await page.route("**/api/wiki/spellcheck", (route) => available
    ? route.fulfill({ json: { matches: proofingMatches(route.request().postDataJSON().paragraphs).map((match) => ({ ...match, replacements: ["<strong>Fehler</strong>"] })) } })
    : route.fulfill({ status: 503, json: { error: "Unavailable" } }));
  await login(page);
  const editor = await createNote(page);
  page.setDefaultTimeout(15_000);
  await editor.fill("Feler");
  await expect(editor).toHaveAttribute("spellcheck", "true");
  await page.getByTestId("proofing-language-toggle").click();
  available = true;
  await page.getByRole("button", { name: "Erneut prüfen", exact: true }).click();
  await expect(page.locator(".wiki-spellcheck-issue")).toBeVisible();
  await page.getByRole("button", { name: "Nächster Hinweis" }).click();
  const popup = page.getByRole("dialog", { name: "Korrekturvorschläge" });
  await expect(popup).toBeVisible();
  await expect(popup.getByRole("button", { name: "<strong>Fehler</strong>", exact: true })).toBeFocused();
  await popup.screenshot({ path: "tmp/proofing-suggestions.png" });
  await page.keyboard.press("Enter");
  await expect(editor).toHaveText("<strong>Fehler</strong>");
  await expect(editor.locator("strong")).toHaveCount(0);
});
