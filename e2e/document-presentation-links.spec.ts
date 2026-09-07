import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  const credentials = { username: "admin", password: "super-secret-1" };
  let response = await page.request.post("/api/auth/sign-in/username", { data: credentials });
  if (!response.ok()) response = await page.request.post("/api/auth/sign-up/email", { data: { ...credentials, displayUsername: "admin", name: "E2E Admin", email: "admin@example.com" } });
  expect(response.ok()).toBe(true);
  await page.goto("/wiki/inbox");
}

test("document sections and presentation elements support saved round trips and manual relinking", async ({ page }) => {
  test.setTimeout(240_000);
  await login(page);
  await page.getByRole("button", { name: "Schnelle Notiz" }).last().click();
  await page.waitForURL(/\/wiki\/pages\/[^/]+$/);
  const editor = page.locator(".ProseMirror");
  await expect(editor).toHaveAttribute("contenteditable", "true");
  const docTitle = `E2E linked document ${Date.now()}`;
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
  await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible();
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
  await expect(editor.locator('h2[id="forecast"]')).toHaveAttribute("data-linked-section-focus", "true");
  await expect(editor.getByText("Forecast details", { exact: true })).toBeVisible();
  await expect(editor.getByText("Budget details", { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("document.png") });
  const savedDeck = await (await page.request.get(`/api/wiki/presentations/${presentationId}`)).json();
  expect(savedDeck.title).toBe(renamed);
  const token = new URL(page.url()).searchParams.get("resume")!;
  const savedPosition = await page.evaluate((token) => JSON.parse(sessionStorage.getItem(`wiki-linked-navigation:${token}`)!), token);
  await editor.evaluate((node) => {
    const active = (node as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
    active.state.doc.descendants((heading, position) => {
      if (heading.type.name === "heading" && heading.attrs.id === "forecast") active.view.dispatch(active.state.tr.insertText("Updated forecast", position + 1, position + heading.nodeSize - 1));
    });
  });
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
  await expect(source.getByText("Updated forecast", { exact: false }).last()).toBeVisible();
  await source.getByText("Zu prüfende Quellen anzeigen", { exact: true }).click();
  await expect(source.getByRole("button", { name: "Forecast · Quelle seit der letzten Prüfung geändert", exact: true })).toBeVisible();
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
  await page.getByRole("button", { name: "Zurück zum Dokument", exact: true }).click();
  await page.waitForURL(/\/wiki\/pages\//);
  const badge = editor.locator('button.wiki-presentation-section-badge[data-section-id="budget"]');
  await expect(badge).toHaveText("1 Präsentation");
  await badge.click();
  const backlinks = page.getByRole("dialog");
  await expect(backlinks).toContainText(renamed);
  await backlinks.getByRole("button", { name: new RegExp(`${renamed}.*Forecast`) }).click();
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
