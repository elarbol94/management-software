import { expect, test, type Page } from "@playwright/test";
import { unzipSync, strFromU8 } from "fflate";
import { PDFDocument } from "pdf-lib";
import { pdfFigurePages } from "../src/modules/wiki/lib/document-pdf-engine";
import type { FigureManifest } from "../src/modules/wiki/lib/figure-types";

test.describe.configure({ timeout: 180_000 });
test.use({ actionTimeout: 45_000, screenshot: "only-on-failure", trace: "retain-on-failure" });
const artwork = (color = "#315EFB") => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="240"><rect x="20" y="100" width="140" height="120" fill="${color}"/><rect x="200" y="60" width="140" height="160" fill="${color}"/><text x="20" y="35" font-size="24">Quarterly revenue</text></svg>`);
async function note(page: Page) {
  let response = await page.request.post("/api/auth/sign-in/username", { data: { username: "figure-editor", password: "super-secret-1" } });
  if (!response.ok()) response = await page.request.post("/api/auth/sign-in/username", { data: { username: "admin", password: "super-secret-1" } });
  if (!response.ok()) response = await page.request.post("/api/auth/sign-in/username", { data: { username: "reliable-editor", password: "super-secret-1" } });
  if (!response.ok()) response = await page.request.post("/api/auth/sign-up/email", { data: { name: "Figure Editor", username: "figure-editor", displayUsername: "figure-editor", email: "figures@example.test", password: "super-secret-1" } });
  expect(response.ok()).toBeTruthy();
  await page.goto("/wiki/inbox");
  const lease = page.waitForRequest((request) => /\/api\/wiki\/pages\/[^/]+\/lease$/.test(request.url()), { timeout: 90_000 });
  await page.getByRole("button", { name: "Schnelle Notiz" }).last().click();
  const request = await lease;
  const editor = page.locator(".ProseMirror"); await expect(editor).toHaveAttribute("contenteditable", "true");
  return { editor, id: request.url().split("/").at(-2)!, sessionId: request.postDataJSON().sessionId as string };
}
async function loadDoc(page: Page, id: string, sessionId: string, content: unknown[]) {
  await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible();
  const documentUrl = page.url();
  await page.goto("/wiki/inbox");
  await page.request.post(`/api/wiki/pages/${id}/lease`, { data: { action: "acquire", sessionId } });
  const data = { editorSessionId: sessionId, expectedContentVersion: 1, documentMode: true, contentJson: JSON.stringify({ type: "doc", content }) };
  let result = await (await page.request.patch(`/api/wiki/pages/${id}/content`, { data })).json();
  if (result.conflict && result.contentVersion) result = await (await page.request.patch(`/api/wiki/pages/${id}/content`, { data: { ...data, expectedContentVersion: result.contentVersion } })).json();
  expect(result).toMatchObject({ saved: true });
  await page.request.post(`/api/wiki/pages/${id}/lease`, { data: { action: "release", sessionId } });
  await page.evaluate((id) => localStorage.removeItem(`wiki-draft:${id}`), id);
  await page.goto(documentUrl); await expect(page.locator(".ProseMirror")).toHaveAttribute("contenteditable", "true");
}

test("insert, caption, resize, wrap, crop and insert a live reference and figure list", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const { editor, id } = await note(page);
  await editor.fill("This report explains our quarterly results.");
  await page.keyboard.press("End"); await page.keyboard.press("Enter");
  await page.getByTestId("wiki-inline-image-input").setInputFiles({ name: "revenue.svg", mimeType: "image/svg+xml", buffer: artwork() });
  const figure = editor.locator("figure[data-figure-view]"); await expect(figure).toHaveCount(1);
  await figure.getByLabel("Bildunterschrift", { exact: true }).pressSequentially("Umsatz nach Quartal", { delay: 15 });
  await expect(figure.getByLabel("Bildunterschrift", { exact: true })).toHaveValue("Umsatz nach Quartal");
  await figure.locator("img").click();
  await page.getByTestId("figure-panel").getByRole("spinbutton", { name: "Breite", exact: true }).fill("50");
  await page.getByTestId("figure-panel").getByRole("combobox", { name: "Textumbruch" }).selectOption("left");
  await page.getByTestId("figure-panel").getByRole("button", { name: "Zuschneiden", exact: true }).click();
  await page.getByText("Genaue Zuschnittmaße", { exact: true }).click();
  await page.getByTestId("figure-panel").getByLabel("Links (%)", { exact: true }).fill("10");
  await page.getByRole("button", { name: "Werkzeuge", exact: true }).click();
  await page.getByRole("menuitem", { name: "Details", exact: true }).click();
  await page.getByRole("button", { name: "Werkzeuge", exact: true }).click();
  await page.getByRole("menuitem", { name: "Bild", exact: true }).click();
  await expect(page.getByTestId("figure-panel").getByLabel("Links (%)", { exact: true })).toHaveValue("10");
  await page.getByRole("button", { name: "Zuschnitt übernehmen", exact: true }).click();
  await expect(figure).toHaveAttribute("data-figure-wrap", "left");
  await page.getByTestId("figure-panel").getByRole("button", { name: "Fertig", exact: true }).click();
  await page.getByRole("button", { name: "Werkzeuge", exact: true }).click();
  await page.getByTestId("document-mode-toggle").click();
  await page.getByRole("button", { name: "Einfügen", exact: true }).click();
  await page.getByRole("menuitem", { name: "Querverweis einfügen", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Abbildung 1: Umsatz nach Quartal/ }).click();
  await expect(editor.locator(".wiki-document-cross-reference")).toHaveText("Abbildung 1");
  await page.getByRole("button", { name: "Einfügen", exact: true }).click();
  await page.getByRole("menuitem", { name: "Abbildungsverzeichnis einfügen", exact: true }).click();
  await expect(editor.locator("[data-figure-list]")).toContainText("Umsatz nach Quartal");
  await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible();
  const response = await page.request.get(`/api/wiki/pages/${id}/export?format=docx`); expect(response.ok(), await response.text()).toBeTruthy();
  const files = unzipSync(await response.body()); expect(Object.keys(files).some((name) => /word\/media\/.+\.svg$/.test(name))).toBeTruthy(); expect(strFromU8(files["word/document.xml"])).toContain("Umsatz nach Quartal");
  const imported = await page.request.post("/api/wiki/docx/import", { multipart: { pageId: id, file: { name: "report.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: await response.body() } } });
  expect(imported.ok(), await imported.text()).toBeTruthy();
  const importedContent = JSON.stringify((await imported.json()).document); expect(importedContent).toContain("commentableImage"); expect(importedContent).toContain("/api/files/");
  await page.screenshot({ path: testInfo.outputPath("figure-editor.png"), fullPage: true });
  await page.reload(); await expect(editor.getByLabel("Bildunterschrift", { exact: true })).toHaveValue("Umsatz nach Quartal");
});

test("a delayed upload keeps its mapped insertion location, and cancellation leaves subsequent text", async ({ page }) => {
  const { editor } = await note(page); await editor.fill("Before upload."); await page.keyboard.press("End"); await page.keyboard.press("Enter");
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/wiki/pages/*/figures", async (route) => { if (route.request().method() === "POST") { await gate; } await route.continue(); });
  await page.getByTestId("wiki-inline-image-input").setInputFiles({ name: "delayed.svg", mimeType: "image/svg+xml", buffer: artwork() });
  await expect(editor.getByRole("status")).toBeVisible();
  await editor.locator("p").last().click(); await page.keyboard.type("Text typed while uploading.");
  release(); await expect(editor.locator("figure[data-figure-view]")).toHaveCount(1);
  await expect(editor).toContainText("Text typed while uploading.");
  await page.unroute("**/api/wiki/pages/*/figures");
  let releaseSecond!: () => void; const gateSecond = new Promise<void>((resolve) => { releaseSecond = resolve; });
  await page.route("**/api/wiki/pages/*/figures", async (route) => { if (route.request().method() === "POST") await gateSecond; await route.continue(); });
  try {
    await page.getByTestId("wiki-inline-image-input").setInputFiles({ name: "cancelled.svg", mimeType: "image/svg+xml", buffer: artwork() });
    await editor.getByRole("button", { name: "Abbrechen", exact: true }).click(); releaseSecond();
    await expect(editor.locator("figure[data-figure-view]")).toHaveCount(1); await expect(editor).toContainText("Text typed while uploading.");
  } finally { releaseSecond(); }
});

test("linked revisions update every instance without a text save; references and PDF links survive a cover", async ({ page }) => {
  const { id, sessionId, editor } = await note(page);
  const sourceResponse = await page.request.post(`/api/wiki/pages/${id}/figures`, { data: { action: "source", source: { kind: "laptop", name: "Plots" } } }); const sourceId = (await sourceResponse.json()).result.id;
  const response = await page.request.post(`/api/wiki/pages/${id}/figures`, { multipart: { sourceId, path: "revenue.svg", file: { name: "revenue.svg", mimeType: "image/svg+xml", buffer: artwork() } } });
  const linked = ((await response.json()) as FigureManifest).assets[0];
  const attrs = { assetId: linked.id, attachmentId: linked.attachmentId, src: linked.src, numbered: true, caption: "Abbildung 9: Umsatz", widthPercent: 50 };
  await loadDoc(page, id, sessionId, [
    { type: "paragraph", content: [{ type: "text", text: "Siehe " }, { type: "crossReference", attrs: { targetId: "first", label: "Old 99" } }] },
    { type: "commentableImage", attrs: { ...attrs, nodeId: "first" } }, { type: "paragraph", content: [{ type: "text", text: "Weitere Ergebnisse" }] },
    { type: "commentableImage", attrs: { ...attrs, nodeId: "second" } }, { type: "figureList", attrs: { title: "Abbildungsverzeichnis" } },
  ]);
  await expect(editor.locator(".wiki-document-cross-reference")).toHaveText("Abbildung 1");
  await expect(editor.locator(".wiki-figure-list-row")).toHaveCount(2);
  await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible();
  let saves = 0; page.on("request", (request) => { if (request.url().endsWith(`/pages/${id}/content`)) saves++; });
  const updated = await page.request.post(`/api/wiki/pages/${id}/figures`, { multipart: { sourceId, path: "revenue.svg", assetId: linked.id, expectedVersion: "1", file: { name: "revenue.svg", mimeType: "image/svg+xml", buffer: artwork("#14845B") } } }); expect(updated.ok(), await updated.text()).toBeTruthy();
  await expect(editor.locator("figure img").first()).toHaveAttribute("src", /v=2$/); await expect(editor.locator("figure img").last()).toHaveAttribute("src", /v=2$/); expect(saves).toBe(0);
  await expect(editor.getByLabel("Bildunterschrift", { exact: true }).first()).toHaveValue("Umsatz");
  const pdfResponse = await page.request.get(`/api/wiki/pages/${id}/export?format=pdf&allowSaved=1`); expect(pdfResponse.ok(), await pdfResponse.text()).toBeTruthy();
  const pdf = await PDFDocument.load(await pdfResponse.body()); expect(pdf.getPageCount()).toBeGreaterThan(1);
  const destinations = pdf.catalog.get((await import("pdf-lib")).PDFName.of("Dests")); expect(destinations).toBeTruthy();
  const pages = pdfFigurePages(pdf); expect(pages.first).toBeGreaterThan(1); expect(pages.second).toBeGreaterThanOrEqual(pages.first);
});

async function openPicker(page: Page) {
  await page.getByRole("button", { name: "Einfügen", exact: true }).click();
  await page.getByRole("menuitem", { name: /^Bild oder Diagramm einfügen/ }).click();
}
test("a persisted folder handle follows replacement files and recovers from an invalid update", async ({ page }) => {
  // OPFS provides real structured-cloneable directory handles; only the native chooser is replaced.
  await page.addInitScript(() => {
    Object.defineProperty(window, "showDirectoryPicker", { value: async () => (await navigator.storage.getDirectory()).getDirectoryHandle("figure-test", { create: true }), configurable: true });
  });
  const { editor } = await note(page);
  const write = (svg: string) => page.evaluate(async (value) => {
    const folder = await (await navigator.storage.getDirectory()).getDirectoryHandle("figure-test", { create: true });
    await folder.removeEntry("chart.svg").catch(() => undefined);
    const file = await folder.getFileHandle("chart.svg", { create: true }); const writable = await file.createWritable(); await writable.write(value); await writable.close();
  }, svg);
  await write(artwork().toString());
  await openPicker(page);
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "Dateipfad verknüpfen" }).click();
  await dialog.getByRole("button", { name: "Lokalen Ordner verbinden" }).click();
  await expect(dialog.getByRole("combobox", { name: "Quelldatei", exact: true })).not.toHaveValue("");
  await dialog.getByLabel("Lokaler Ordnerpfad (optional)", { exact: false }).fill("C:\\Research");
  await dialog.getByLabel("Dateipfad", { exact: true }).fill("C:\\Research\\chart.svg");
  await dialog.getByRole("button", { name: "Verknüpft einfügen" }).click();
  const figure = editor.locator("figure[data-figure-view]"); await expect(figure).toHaveCount(1);
  await figure.getByLabel("Bildunterschrift", { exact: true }).fill("Meine unveränderte Beschriftung");
  await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible();
  await write(artwork("#119944").toString()); await expect(figure.locator("img")).toHaveAttribute("src", /v=2$/);
  await write("incomplete file"); await expect(figure).toContainText("Quelldatei nicht erreichbar"); await expect(figure.locator("img")).toHaveAttribute("src", /v=2$/);
  await write(artwork("#992233").toString()); await expect(figure.locator("img")).toHaveAttribute("src", /v=3$/);
  await page.reload(); await expect(figure.getByLabel("Bildunterschrift", { exact: true })).toHaveValue("Meine unveränderte Beschriftung");
  await expect(figure).toContainText("Automatisch aktuell");
});

test("native diagrams are numbered, editable and embedded in Word", async ({ page }) => {
  const { editor, id } = await note(page); await openPicker(page);
  await page.getByRole("dialog").getByRole("button", { name: "Mermaid-Diagramm", exact: true }).click();
  const figure = editor.locator("figure[data-figure-view]");
  await expect(figure.locator("img")).toHaveAttribute("src", /^data:image\/svg/);
  await figure.getByLabel("Bildunterschrift", { exact: true }).fill("Prüfverfahren");
  await expect(figure.locator("figcaption")).toContainText("Abbildung 1");
  await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible();
  const response = await page.request.get(`/api/wiki/pages/${id}/export?format=docx`); expect(response.ok(), await response.text()).toBeTruthy();
  const files = unzipSync(await response.body()); expect(Object.keys(files).some((name) => /word\/media\/.+\.svg$/.test(name))).toBeTruthy();
});

test("multi-page figure lists paginate and missing references offer repair", async ({ page }, testInfo) => {
  const { editor, id, sessionId } = await note(page);
  const response = await page.request.post(`/api/wiki/pages/${id}/figures`, { multipart: { file: { name: "chart.svg", mimeType: "image/svg+xml", buffer: artwork() } } });
  const image = ((await response.json()) as FigureManifest).assets[0];
  const figures = Array.from({ length: 45 }, (_, i) => ({ type: "commentableImage", attrs: { nodeId: `chart-${i}`, assetId: image.id, src: image.src, widthPercent: 10, caption: `Ergebnis ${i + 1}: Eine ausführliche Beschreibung der Messung und ihrer Datengrundlage im Projekt.` } }));
  await loadDoc(page, id, sessionId, [{ type: "paragraph", content: [{ type: "crossReference", attrs: { targetId: "deleted", label: "Stale 99" } }] }, { type: "figureList", attrs: { title: "Abbildungsverzeichnis" } }, ...figures]);
  await expect(editor.locator(".wiki-figure-list-row")).toHaveCount(45);
  const reference = editor.locator(".wiki-document-cross-reference"); await expect(reference).toContainText("Verweisziel fehlt"); await reference.click();
  await page.getByRole("dialog").getByRole("button", { name: /Abbildung 1: Ergebnis 1:/ }).click();
  await expect(reference).toHaveText("Abbildung 1");
  await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("figure-list-pages.png") });
  const pdfResponse = await page.request.get(`/api/wiki/pages/${id}/export?format=pdf`); expect(pdfResponse.ok(), await pdfResponse.text()).toBeTruthy();
  const bytes = await pdfResponse.body(); const pdf = await PDFDocument.load(bytes); expect(pdf.getPageCount()).toBeGreaterThan(4);
  const pages = pdfFigurePages(pdf); expect(Object.keys(pages).filter((id) => id.startsWith("chart-"))).toHaveLength(45);
  expect(pages["chart-0"]).toBeGreaterThan(3); expect(pages["chart-44"]).toBeGreaterThan(pages["chart-0"]);
  await import("node:fs/promises").then((fs) => fs.writeFile(testInfo.outputPath("figure-list.pdf"), bytes));
});

test("English controls support batch insertion, renumbering, undo and decorative images", async ({ page }, testInfo) => {
  const { editor } = await note(page);
  await page.context().addCookies([{ name: "locale", value: "en", url: "http://localhost:3100" }]);
  await page.reload(); await expect(editor).toHaveAttribute("contenteditable", "true");
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await page.getByRole("menuitem", { name: /^Insert image or diagram/ }).click();
  await page.getByTestId("figure-picker-upload").setInputFiles([
    { name: "one.svg", mimeType: "image/svg+xml", buffer: artwork() }, { name: "two.svg", mimeType: "image/svg+xml", buffer: artwork("red") },
  ]);
  const figures = editor.locator("figure[data-figure-view]"); await expect(figures).toHaveCount(2);
  await figures.first().getByLabel("Caption", { exact: true }).fill("First result");
  await figures.last().getByLabel("Caption", { exact: true }).fill("Second result");
  const originalIds = await figures.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-comment-node-id")));
  expect(new Set(originalIds).size).toBe(2);
  await figures.first().locator("img").click(); await page.keyboard.press("Delete"); await expect(figures).toHaveCount(1);
  await expect(figures.locator("figcaption > span")).toHaveText("Abbildung 1:");
  await page.keyboard.press("Control+z"); await expect(figures).toHaveCount(2);
  expect(await figures.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-comment-node-id")))).toEqual(originalIds);
  await page.keyboard.press("Control+Shift+z"); await expect(figures).toHaveCount(1);
  await figures.locator("img").click();
  await page.getByTestId("figure-panel").getByLabel("Decorative image without a number").check();
  await expect(figures.locator("figcaption > span")).toHaveCount(0);
  await page.setViewportSize({ width: 600, height: 800 });
  await page.screenshot({ path: testInfo.outputPath("figure-narrow-en.png") });
});

test("clipboard copies get new identities, cut moves keep their identity, and dropped images use the picker workflow", async ({ page }) => {
  const { editor } = await note(page);
  await editor.fill("Before the figure"); await page.keyboard.press("End"); await page.keyboard.press("Enter");
  await page.getByTestId("wiki-inline-image-input").setInputFiles({ name: "copy.svg", mimeType: "image/svg+xml", buffer: artwork() });
  const figures = editor.locator("figure[data-figure-view]"); await expect(figures).toHaveCount(1);
  await figures.getByLabel("Bildunterschrift", { exact: true }).fill("Original chart");
  const original = await figures.getAttribute("data-comment-node-id");
  const clipboard = async (kind: "copy" | "cut") => editor.evaluate((element, kind) => {
    const clipboardData = new DataTransfer(); element.dispatchEvent(new ClipboardEvent(kind, { clipboardData, bubbles: true, cancelable: true })); return clipboardData.getData("text/html");
  }, kind);
  const paste = async (html: string) => {
    await page.keyboard.press("ArrowRight"); await page.keyboard.press("Control+End");
    await editor.evaluate((element, html) => { const clipboardData = new DataTransfer(); clipboardData.setData("text/html", html); element.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true })); }, html);
  };
  await figures.locator("img").click(); const html = await clipboard("copy"); expect(html).toContain("data-figure-attrs");
  await paste(html); await expect(figures).toHaveCount(2);
  expect(await figures.first().getAttribute("data-comment-node-id")).toBe(original); expect(await figures.last().getAttribute("data-comment-node-id")).not.toBe(original);
  await figures.first().locator("img").click(); const cut = await clipboard("cut"); await expect(figures).toHaveCount(1);
  await paste(cut); await expect(figures).toHaveCount(2); expect(await figures.last().getAttribute("data-comment-node-id")).toBe(original);
  await editor.locator("p").last().evaluate((element, svg) => {
    const dataTransfer = new DataTransfer(); dataTransfer.items.add(new File([svg], "dropped.svg", { type: "image/svg+xml" }));
    const bounds = element.getBoundingClientRect(); element.dispatchEvent(new DragEvent("drop", { dataTransfer, clientX: bounds.left + 5, clientY: bounds.top + 5, bubbles: true, cancelable: true }));
  }, artwork("#771199").toString());
  await expect(figures).toHaveCount(3);
  await figures.last().locator("img").click(); await page.getByTestId("figure-panel").getByRole("button", { name: "Fertig", exact: true }).click();
  await expect(editor.locator(".wiki-figure-controls")).toHaveCount(0);
  await page.keyboard.press("Control+End"); await editor.evaluate((element, svg) => {
    const clipboardData = new DataTransfer(); clipboardData.items.add(new File([svg], "pasted.svg", { type: "image/svg+xml" })); element.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
  }, artwork("#994477").toString());
  await expect(figures).toHaveCount(4);
});


test("a floating figure and its caption stay inside a document page", async ({ page }) => {
  const { editor, id, sessionId } = await note(page);
  const uploaded = await page.request.post(`/api/wiki/pages/${id}/figures`, { multipart: { file: { name: "boundary.svg", mimeType: "image/svg+xml", buffer: artwork() } } });
  const image = ((await uploaded.json()) as FigureManifest).assets[0];
  await loadDoc(page, id, sessionId, [
    { type: "paragraph", content: Array.from({ length: 39 }, (_, index) => [{ type: "text", text: `Line ${index + 1}: Results before the figure.` }, { type: "hardBreak" }]).flat() },
    { type: "commentableImage", attrs: { nodeId: "boundary", assetId: image.id, src: image.src, widthPercent: 60, wrap: "left", caption: "Caption attached to the floating chart" } },
    { type: "paragraph", content: [{ type: "text", text: "Following text flows beside the chart. ".repeat(16) }] },
  ]);
  const figure = editor.locator("figure[data-figure-view]");
  await expect(figure.locator("img")).toHaveJSProperty("complete", true);
  await expect.poll(() => figure.evaluate((element) => {
    const canvas = element.closest(".wiki-document-canvas") as HTMLElement;
    const body = canvas.querySelector(".ProseMirror")!;
    const style = getComputedStyle(canvas);
    const scale = canvas.getBoundingClientRect().width / 210;
    const top = (element.getBoundingClientRect().top - body.getBoundingClientRect().top) / scale;
    const height = element.getBoundingClientRect().height / scale;
    const withinPage = top % 309;
    const marginBottom = parseFloat(style.getPropertyValue("--document-margin-bottom"));
    return withinPage >= 20 && withinPage + height <= 297 - marginBottom + .5;
  }), { timeout: 30_000 }).toBe(true);
});
