import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  const credentials = { username: "admin", password: "super-secret-1" };
  let response = await page.request.post("/api/auth/sign-in/username", { data: credentials });
  if (!response.ok()) response = await page.request.post("/api/auth/sign-up/email", { data: { ...credentials, displayUsername: "admin", name: "E2E Admin", email: "admin@example.com" } });
  expect(response.ok()).toBe(true);
  await page.goto("/wiki/inbox");
}

test("document sections and presentation elements support saved round trips and manual relinking", async ({ page }) => {
  // Cold document/presentation route compilation can exceed four minutes on shared hosts.
  test.setTimeout(360_000);
  await login(page);
  await page.getByRole("button", { name: "Schnelle Notiz" }).last().click();
  await page.waitForURL(/\/wiki\/pages\/[^/]+$/);
  const editor = page.locator(".ProseMirror");
  await expect(editor).toHaveAttribute("contenteditable", "true");
  const docTitle = `E2E linked document ${Date.now()}`;
  const initialSave = page.waitForResponse((response) => response.request().method() === "PATCH" && /\/api\/wiki\/pages\/[^/]+\/content$/.test(new URL(response.url()).pathname) && response.request().postData()?.includes(docTitle) === true);
  // Seed through the live editor so its normal save/version/recovery state stays
  // authoritative, just as it does for a paste or an imported document.
  await editor.evaluate((node, content) => {
    (node as HTMLElement & { editor: { commands: { setContent: (content: unknown) => boolean } } }).editor.commands.setContent(content);
  }, { type: "doc", content: [
    { type: "heading", attrs: { id: "budget", level: 1, collapsed: true }, content: [{ type: "text", text: docTitle }] },
    { type: "paragraph", content: [{ type: "text", text: "Budget details" }] },
    { type: "heading", attrs: { id: "forecast", level: 2, collapsed: true }, content: [{ type: "text", text: "Forecast" }] },
    { type: "paragraph", content: [{ type: "text", text: "Forecast details" }] },
  ] });
  expect((await (await initialSave).json()).saved).toBe(true);
  await expect(page.getByRole("status").filter({ hasText: "Gespeichert" })).toBeVisible();
  await page.goto("/wiki/presentations");
  await page.getByRole("button", { name: "Aus Wiki-Seite", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox").click();
  await page.getByRole("option", { name: docTitle, exact: true }).click();
  await dialog.getByRole("button", { name: "Neu", exact: true }).click();
  await page.waitForURL(/\/wiki\/presentations\/[^/]+$/);
  const presentationId = new URL(page.url()).pathname.split("/").at(-1)!;
  const response = await page.request.get(`/api/wiki/presentations/${presentationId}`);
  const deck = await response.json();
  const frame = deck.elements.find((element: { source?: { sectionId: string } }) => element.source?.sectionId === "forecast");
  expect(frame).toBeTruthy();
  await page.getByRole("button", { name: "Forecast", exact: true }).click();
  const source = page.getByRole("region", { name: "Dokumentquelle" });
  await expect(source.getByRole("button", { name: "Dokumentabschnitt öffnen" })).toBeVisible();
  await expect(source.getByText("Forecast details", { exact: false })).toBeVisible();
  await expect(source.getByText("Quelle seit der letzten Prüfung unverändert", { exact: true })).toBeVisible();
  expect(frame.source.reviewedFingerprint).toMatch(/^[a-f0-9]{64}$/);
  await page.screenshot({ path: test.info().outputPath("presentation.png") });
  // A focused title must be committed even when navigating before autosave.
  const renamed = `Linked deck ${Date.now()}`;
  await page.getByRole("textbox", { name: "Titel der Präsentation" }).fill(renamed);
  await source.getByRole("button", { name: "Dokumentabschnitt öffnen" }).click();
  await page.waitForURL(/\/wiki\/pages\/.*section=forecast/);
  // Verify the navigation outcome; the brief highlight can expire during hydration.
  await expect(editor.locator('h2[id="forecast"]')).toBeInViewport();
  await expect(editor.getByText("Forecast details", { exact: true })).toBeVisible();
  await expect(editor.getByText("Budget details", { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("document.png") });
  const savedDeck = await (await page.request.get(`/api/wiki/presentations/${presentationId}`)).json();
  expect(savedDeck.title).toBe(renamed);
  const token = new URL(page.url()).searchParams.get("resume")!;
  const savedPosition = await page.evaluate((token) => JSON.parse(sessionStorage.getItem(`wiki-linked-navigation:${token}`)!), token);
  const renameSave = page.waitForResponse((response) => response.request().method() === "PATCH" && /\/api\/wiki\/pages\/[^/]+\/content$/.test(new URL(response.url()).pathname) && response.request().postData()?.includes("Updated forecast") === true);
  await editor.evaluate((node) => {
    const active = (node as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
    active.state.doc.descendants((heading, position) => {
      if (heading.type.name === "heading" && heading.attrs.id === "forecast") active.view.dispatch(active.state.tr.insertText("Updated forecast", position + 1, position + heading.nodeSize - 1));
    });
  });
  await expect(page.getByRole("status").filter({ hasText: "Gespeichert" })).toBeVisible();
  expect((await (await renameSave).json()).saved).toBe(true);
  const player = await page.context().newPage();
  await player.goto(`/wiki/presentations/${presentationId}/present`);
  await expect(player.locator(`.react-flow__node[data-id="${frame.id}"]`)).toContainText("Updated forecast");
  await player.close();
  await page.getByRole("button", { name: "Zurück zur Präsentation", exact: true }).click();
  await page.waitForURL(/\/wiki\/presentations\/.*element=/);
  await expect(page.locator(`.react-flow__node[data-id="${frame.id}"]`)).toHaveClass(/selected/);
  await expect.poll(async () => {
    const actual = await page.locator(".react-flow__viewport").evaluate((node) => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(node).transform);
      return { x: matrix.e, y: matrix.f, zoom: matrix.a };
    });
    // Browsers round CSS matrix serialization; compare the visible geometry.
    return Math.max(Math.abs(actual.x - savedPosition.viewport.x), Math.abs(actual.y - savedPosition.viewport.y), Math.abs(actual.zoom - savedPosition.viewport.zoom));
  }).toBeLessThan(0.001);
  await expect(page.getByRole("button", { name: "Zurück zum Dokument", exact: true })).toBeVisible();
  await expect(source.getByText("Quelle seit der letzten Prüfung geändert", { exact: true })).toBeVisible();
  await expect(page.locator(`.react-flow__node[data-id="${frame.id}"]`)).toContainText("Updated forecast");
  await expect.poll(async () => (await (await page.request.get(`/api/wiki/presentations/${presentationId}`)).json()).elements.find((item: { id: string }) => item.id === frame.id).content.label).toBe("Updated forecast");
  await expect(source.getByText("Updated forecast", { exact: false }).last()).toBeVisible();
  await source.getByText("Zu prüfende Quellen anzeigen", { exact: true }).click();
  await expect(source.getByRole("button", { name: "Updated forecast · Quelle seit der letzten Prüfung geändert", exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("source-review.png") });
  await source.getByRole("button", { name: "Quelle als geprüft markieren", exact: true }).click();
  await expect(source.getByText("Quelle seit der letzten Prüfung unverändert", { exact: true })).toBeVisible();
  await expect.poll(async () => (await (await page.request.get(`/api/wiki/presentations/${presentationId}`)).json()).elements.find((item: { id: string }) => item.id === frame.id).source.reviewedFingerprint).not.toBe(frame.source.reviewedFingerprint);
  await page.reload();
  await expect(source.getByText("Quelle seit der letzten Prüfung unverändert", { exact: true })).toBeVisible();
  // A failed refresh must stay visible and offer recovery.
  await page.route("**/api/wiki/presentation-sources", async (route) => {
    if (route.request().method() === "POST") await route.fulfill({ status: 503, body: "unavailable" });
    else await route.continue();
  });
  await source.getByRole("button", { name: "Dokumentquellen aktualisieren", exact: true }).click();
  await expect(source.getByText("Quellenprüfung fehlgeschlagen. Zum Wiederholen aktualisieren.", { exact: true }).first()).toBeVisible();
  await page.unroute("**/api/wiki/presentation-sources");
  await source.getByRole("button", { name: "Dokumentquellen aktualisieren", exact: true }).click();
  await expect(source.getByText("Quelle seit der letzten Prüfung unverändert", { exact: true })).toBeVisible();
  // Existing elements can override their source.
  await source.getByRole("button", { name: "Verknüpfung ändern" }).click();
  await source.getByRole("combobox", { name: "Abschnitt", exact: true }).selectOption("budget");
  await source.getByRole("button", { name: "Verknüpfung speichern" }).click();
  await expect.poll(async () => (await (await page.request.get(`/api/wiki/presentations/${presentationId}`)).json()).elements.find((item: { id: string }) => item.id === frame.id).source.sectionId).toBe("budget");
  await expect(source.getByText("Noch nicht geprüft", { exact: true })).toBeVisible();
  await expect(source.getByText(/Budget details/).last()).toBeVisible();
  await expect(page.locator(`.react-flow__node[data-id="${frame.id}"]`)).toContainText(docTitle);
  await page.route("**/api/wiki/presentation-sources", async (route) => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    const response = await route.fetch();
    const result = await response.json();
    for (const preview of result.previews) if (preview.sectionId === "budget" && preview.snapshot) preview.snapshot.headingTitle = "Background rename";
    await route.fulfill({ response, json: result });
  });
  await page.getByRole("textbox", { name: "Beschriftung", exact: true }).fill("Custom forecast");
  // Simulate another author's heading update while this field still has focus.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(source.getByText(`${docTitle} › Background rename`, { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Beschriftung", exact: true })).toHaveValue("Custom forecast");
  await page.unroute("**/api/wiki/presentation-sources");
  await page.getByRole("textbox", { name: "Beschriftung", exact: true }).press("Tab");
  await expect(source.getByRole("checkbox", { name: "Dokumentüberschrift als Rahmentitel verwenden" })).not.toBeChecked();
  await source.getByRole("button", { name: "Dokumentquellen aktualisieren", exact: true }).click();
  await expect(page.locator(`.react-flow__node[data-id="${frame.id}"]`)).toContainText("Custom forecast");
  await page.getByRole("button", { name: "Zurück zum Dokument", exact: true }).click();
  await page.waitForURL(/\/wiki\/pages\//);
  const badge = editor.locator('button.wiki-presentation-section-badge[data-section-id="budget"]');
  await expect(badge).toHaveText("1 Präsentation");
  await badge.click();
  const backlinks = page.getByRole("dialog");
  await expect(backlinks).toContainText(renamed);
  await backlinks.getByRole("button", { name: new RegExp(`${renamed}.*Custom forecast`) }).click();
  await page.waitForURL(/\/wiki\/presentations\/.*element=/);
  await expect(page.locator(`.react-flow__node[data-id="${frame.id}"]`)).toHaveClass(/selected/);
  // Failed saves block navigation and leave the draft in place.
  await page.getByRole("textbox", { name: "Titel der Präsentation" }).fill("Unsaved draft");
  await page.route("**/wiki/presentations/**", async (route) => {
    if (route.request().method() === "POST" && route.request().headers()["next-action"]) await route.abort("failed");
    else await route.continue();
  });
  await source.getByRole("button", { name: "Dokumentabschnitt öffnen" }).click();
  await expect(page.getByText("Speichern fehlgeschlagen", { exact: false }).first()).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(`/wiki/presentations/${presentationId}`);
  await page.unroute("**/wiki/presentations/**");
});

test("collapsed document sections remove hidden media, nested headings and page-break spacing", async ({ page }) => {
  test.setTimeout(240_000);
  await login(page);
  await page.getByRole("button", { name: "Schnelle Notiz" }).last().click();
  await page.waitForURL(/\/wiki\/pages\/[^/]+$/);
  const editor = page.locator(".ProseMirror");
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await editor.evaluate((node) => {
    const active = (node as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
    active.commands.setContent({ type: "doc", content: [
      { type: "heading", attrs: { id: "fold", level: 1 }, content: [{ type: "text", text: "Fold this section" }] },
      { type: "paragraph", content: [{ type: "text", text: "Long section content. ".repeat(350) }] },
      { type: "heading", attrs: { id: "nested", level: 2 }, content: [{ type: "text", text: "Nested heading" }] },
      { type: "commentableImage", attrs: { attachmentId: "missing-test-image", src: "/missing-test-image.png", alt: "Section artwork", aspectRatio: 1.5 } },
      { type: "pageBreak" },
      { type: "paragraph", content: [{ type: "text", text: "After the internal page break" }] },
      { type: "heading", attrs: { id: "following", level: 1 }, content: [{ type: "text", text: "Following section" }] },
      { type: "paragraph", content: [{ type: "text", text: "Visible content" }] },
    ] });
  });
  if (!await page.locator(".wiki-document-canvas").count()) await page.getByTestId("document-mode-toggle").click();
  await expect(editor.locator(".wiki-document-auto-page-break").first()).toBeAttached();
  await editor.locator("#fold").click({ position: { x: 60, y: 12 } });
  await expect(editor.locator("#fold")).toHaveAttribute("data-collapsed", "true");
  await expect(editor.locator("#nested")).toBeHidden();
  await expect(editor.getByText("After the internal page break", { exact: true })).toBeHidden();
  await expect.poll(async () => editor.evaluate((node) => {
    const first = node.querySelector("#fold")!.getBoundingClientRect();
    return node.querySelector("#following")!.getBoundingClientRect().top - first.bottom;
  })).toBeLessThan(70);
  await expect(editor.locator(".wiki-document-auto-page-break")).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("collapsed-section.png") });
  // Click another point on the heading text so ProseMirror treats this as a
  // separate click even when a fast production render finishes within 500 ms.
  await editor.locator("#fold").click({ position: { x: 100, y: 12 } });
  await expect(editor.locator("#nested")).toBeVisible();
  await expect(editor.getByText("After the internal page break", { exact: true })).toBeVisible();
  await expect(editor.locator(".wiki-document-auto-page-break").first()).toBeAttached();
});

test("heading structure changes require approval and preserve playback order through undo and reload", async ({ page }) => {
  test.setTimeout(300_000);
  await login(page);
  await page.getByRole("button", { name: "Schnelle Notiz" }).last().click();
  await page.waitForURL(/\/wiki\/pages\/[^/]+$/);
  const documentUrl = page.url();
  const editor = page.locator(".ProseMirror");
  await expect(editor).toHaveAttribute("contenteditable", "true");
  const title = `E2E structure ${Date.now()}`;
  const initialSave = page.waitForResponse((response) => response.request().method() === "PATCH" && /\/api\/wiki\/pages\/[^/]+\/content$/.test(new URL(response.url()).pathname) && response.request().postData()?.includes(title) === true);
  await editor.evaluate((node, title) => {
    const active = (node as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
    active.commands.setContent({ type: "doc", content: [
      { type: "heading", attrs: { id: "root", level: 1 }, content: [{ type: "text", text: title }] },
      { type: "heading", attrs: { id: "promote", level: 2 }, content: [{ type: "text", text: "Promote me" }] },
      { type: "paragraph", content: [{ type: "text", text: "Keep this source content" }] },
      { type: "heading", attrs: { id: "following", level: 2 }, content: [{ type: "text", text: "Following section" }] },
      { type: "heading", attrs: { id: "outside", level: 1 }, content: [{ type: "text", text: "Untouched root" }] },
    ] });
  }, title);
  expect((await (await initialSave).json()).saved).toBe(true);
  await expect(page.getByRole("status").filter({ hasText: "Gespeichert" })).toBeVisible();
  await page.goto("/wiki/presentations");
  await page.getByRole("button", { name: "Aus Wiki-Seite", exact: true }).click();
  await page.getByRole("dialog").getByRole("combobox").click();
  await page.getByRole("option", { name: title, exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Neu", exact: true }).click();
  await page.waitForURL(/\/wiki\/presentations\/[^/]+$/);
  const presentationId = new URL(page.url()).pathname.split("/").at(-1)!;
  const read = async () => (await (await page.request.get(`/api/wiki/presentations/${presentationId}`)).json()) as { elements: import("../src/modules/wiki/lib/presentation").PresentationElement[]; steps: unknown[] };
  const before = await read();
  const promoted = before.elements.find((e) => e.source?.sectionId === "promote")!;
  const following = before.elements.find((e) => e.source?.sectionId === "following")!;
  const outside = before.elements.find((e) => e.source?.sectionId === "outside")!;
  await page.getByRole("button", { name: "Promote me", exact: true }).click();
  const source = page.getByRole("region", { name: "Dokumentquelle" });
  await source.getByRole("button", { name: "Dokumentabschnitt öffnen", exact: true }).click();
  await page.waitForURL(/\/wiki\/pages\/.*section=promote/);
  async function level(target: Page, value: number) {
    await expect(target.locator(".ProseMirror")).toHaveAttribute("contenteditable", "true");
    const saved = target.waitForResponse((response) => response.request().method() === "PATCH" && /\/api\/wiki\/pages\/[^/]+\/content$/.test(new URL(response.url()).pathname));
    await target.locator(".ProseMirror").evaluate((node, value) => {
      const active = (node as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
      active.state.doc.descendants((heading, position) => {
        if (heading.type.name === "heading" && heading.attrs.id === "promote") active.view.dispatch(active.state.tr.setNodeMarkup(position, undefined, { ...heading.attrs, level: value }));
      });
    }, value);
    expect((await (await saved).json()).saved).toBe(true);
    await expect(target.getByRole("status").filter({ hasText: "Gespeichert" })).toBeVisible();
  }
  await level(page, 1);
  await page.getByRole("button", { name: "Zurück zur Präsentation", exact: true }).click();
  await page.waitForURL(/\/wiki\/presentations\/.*element=/);
  const reviewButton = source.getByRole("button", { name: /Strukturänderung prüfen/ });
  await expect(reviewButton).toBeVisible();
  expect((await read()).elements).toEqual(before.elements);
  // A content acknowledgement must not approve a structure change.
  await source.getByRole("button", { name: "Quelle als geprüft markieren", exact: true }).click();
  await expect(reviewButton).toBeVisible();
  await reviewButton.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Überschriftenebene: ## → #");
  await expect(dialog).toContainText("Following section");
  await page.screenshot({ path: test.info().outputPath("structure-review.png") });
  await dialog.getByRole("button", { name: "Jetzt nicht", exact: true }).click();
  expect((await read()).elements.find((e) => e.id === promoted.id)?.parentId).toBe(promoted.parentId);
  await reviewButton.click();
  // A real document edit during review invalidates approval, without moving frames.
  const documentTab = await page.context().newPage();
  await documentTab.goto(documentUrl);
  await level(documentTab, 3);
  await page.bringToFront();
  await dialog.getByRole("button", { name: "Änderung übernehmen", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("während der Prüfung geändert");
  await expect(dialog).toContainText("Überschriftenebene: ## → ###");
  expect((await read()).elements.find((e) => e.id === promoted.id)?.parentId).toBe(promoted.parentId);
  await documentTab.bringToFront();
  await level(documentTab, 1);
  await documentTab.close();
  await page.bringToFront();
  await dialog.getByRole("button", { name: "Änderung übernehmen", exact: true }).click();
  await expect(dialog).toContainText("Überschriftenebene: ## → #");
  await dialog.getByRole("button", { name: "Änderung übernehmen", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect.poll(async () => (await read()).elements.find((e) => e.id === promoted.id)?.parentId).toBeUndefined();
  const approved = await read();
  expect(approved.elements.find((e) => e.id === following.id)?.parentId).toBe(promoted.id);
  expect(approved.elements.find((e) => e.id === outside.id)).toEqual(outside);
  expect(approved.steps).toEqual(before.steps);
  await page.getByRole("button", { name: "Rückgängig", exact: true }).click();
  await expect.poll(async () => (await read()).elements.find((e) => e.id === promoted.id)?.parentId).toBe(promoted.parentId);
  await expect(reviewButton).toBeVisible();
  await page.getByRole("button", { name: "Wiederholen", exact: true }).click();
  await expect.poll(async () => (await read()).elements.find((e) => e.id === promoted.id)?.parentId).toBeUndefined();
  await page.reload();
  await expect(source).toBeVisible();
  await expect(reviewButton).toHaveCount(0);
  expect((await read()).steps).toEqual(before.steps);
  await page.getByRole("link", { name: "Präsentieren", exact: true }).click();
  await page.waitForURL(/\/present$/);
  await expect(page.getByTestId("presentation-player").locator(`.react-flow__node[data-id="${following.id}"]`)).toBeVisible();
});
