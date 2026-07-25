import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial", timeout: 90_000 });

async function login(page: Page) {
  const signup = await page.request.post("/api/auth/sign-up/email", { data: { name: "E2E Admin", username: "admin", displayUsername: "admin", email: "admin" + String.fromCharCode(64) + "example.com", password: "super-secret-1" } });
  if (!signup.ok() && signup.status() !== 422 && signup.status() !== 403) throw new Error("Signup failed " + signup.status() + ": " + await signup.text());
  if (signup.ok()) { await page.goto("/"); await expect(page.getByText("Willkommen, E2E Admin!")).toBeVisible(); return; }
  await page.goto("/login");
  await page.locator("#username").fill("admin");
  await page.locator("#password").fill("super-secret-1");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.getByText("Willkommen, E2E Admin!")).toBeVisible();
}

function nativeTextPdf(text: string): Buffer {
  const escaped = text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
  const stream = `BT /F1 18 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

test("upload, read, search, annotate, reload, and insert traceable PDF evidence", async ({ page }) => {
  await login(page);
  await page.goto("/wiki/sources");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "PDFs auswählen" }).click();
  await (await chooser).setFiles({
      name: "local-evidence.pdf",
      mimeType: "application/pdf",
      buffer: nativeTextPdf("Local PDF evidence supports traceable research"),
    });

  await expect(page).toHaveURL(/\/wiki\/sources\//, { timeout: 15_000 });
  await expect(page.getByText("local-evidence.pdf")).toBeVisible();
  const read = page.getByRole("link", { name: "PDF lesen" });
  await expect(read).toBeVisible({ timeout: 30_000 });
  await read.click();

  await page.getByRole("tab", { name: "Suchen" }).click();
  const pdfSearch = page.getByPlaceholder("In der PDF suchen…");
  await expect(pdfSearch).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Groß-/Kleinschreibung" })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "Nur ganze Wörter" })).toHaveAttribute("aria-pressed", "false");
  await pdfSearch.fill("traceable");
  await expect(page.getByText("Treffer 1 von 1", { exact: true })).toBeVisible();
  await expect(page.getByText("Local PDF evidence supports traceable research").first()).toBeVisible();
  await expect(page.locator("[data-pdf-search-active=true]")).toHaveCount(1);
  await pdfSearch.press("Tab");
  await expect(page.getByText("Treffer 1 von 1", { exact: true })).toBeVisible();
  await pdfSearch.press("Shift+Tab");
  await expect(page.getByText("Treffer 1 von 1", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Nur ganze Wörter" }).click();
  await expect(page.getByRole("button", { name: "Nur ganze Wörter" })).toHaveAttribute("aria-pressed", "true");
  await pdfSearch.press("Enter");
  await expect(page.getByText("Treffer 1 von 1", { exact: true })).toBeVisible();
  await pdfSearch.press("Escape");
  await expect(pdfSearch).toHaveValue("");
  await expect(page.locator("[data-pdf-search-match]")).toHaveCount(0);
  await pdfSearch.press("Escape");
  await expect(page.getByRole("tab", { name: "Seiten" })).toHaveAttribute("aria-selected", "true");

  await page.waitForFunction(() => Array.from(document.querySelector("canvas")?.parentElement?.querySelectorAll("span") ?? []).some((span) => span.textContent?.includes("Local PDF evidence")));
  await page.evaluate(() => {
    const shell = document.querySelector("canvas")?.parentElement;
    const span = Array.from(shell?.querySelectorAll("span") ?? []).find((candidate) => candidate.textContent?.includes("Local PDF evidence"));
    if (!span?.firstChild) throw new Error("PDF text layer not found");
    const range = document.createRange();
    range.selectNodeContents(span);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    span.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.getByTestId("pdf-selection-actions").getByRole("button", { name: "Notiz", exact: true }).click();
  const quotationDialog = page.getByRole("dialog", { name: "Optionale Notiz zu diesem Nachweis" });
  await quotationDialog.getByRole("textbox").fill("Key quotation");
  await quotationDialog.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(page.getByText("Key quotation")).toBeVisible();

  await page.getByRole("button", { name: "Bereich markieren" }).click();
  const regionSelector = page.getByTestId("pdf-region-selector");
  await expect(regionSelector).toBeVisible();
  const box = await regionSelector.boundingBox();
  if (!box) throw new Error("PDF region selector not visible");
  const start = { clientX: box.x + box.width * 0.2, clientY: box.y + box.height * 0.2, pointerId: 1, pointerType: "mouse", buttons: 1 };
  const end = { clientX: box.x + box.width * 0.55, clientY: box.y + box.height * 0.42, pointerId: 1, pointerType: "mouse", buttons: 1 };
  await regionSelector.dispatchEvent("pointerdown", start);
  await regionSelector.dispatchEvent("pointermove", end);
  await regionSelector.dispatchEvent("pointerup", { ...end, buttons: 0 });
  await page.getByTestId("pdf-selection-actions").getByRole("button", { name: "Notiz", exact: true }).click();
  const regionDialog = page.getByRole("dialog", { name: "Optionale Notiz zu diesem Nachweis" });
  await regionDialog.getByRole("textbox").fill("Important figure");
  await regionDialog.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(page.getByText("Important figure")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Key quotation")).toBeVisible();
  await expect(page.getByText("Important figure")).toBeVisible();

  await page.setViewportSize({ width: 1425, height: 679 });
  const annotationMarker = page.getByTestId("pdf-annotation-marker").first();
  await expect(annotationMarker).toBeVisible();
  await annotationMarker.click();
  const card = page.getByTestId("pdf-comments-panel");
  await expect(card).toBeVisible();
  await expect(page).toHaveURL(/annotation=/);

  const cardBeforeZoom = await card.boundingBox();
  const closeButton = card.getByRole("button", { name: "Abbrechen" });
  const closeBounds = await closeButton.boundingBox();
  if (!cardBeforeZoom || !closeBounds) throw new Error("Comment panel geometry unavailable");
  expect(cardBeforeZoom.width).toBeGreaterThanOrEqual(260);
  expect(cardBeforeZoom.width).toBeLessThanOrEqual(420);
  expect(closeBounds.x).toBeGreaterThanOrEqual(cardBeforeZoom.x);
  expect(closeBounds.x + closeBounds.width).toBeLessThanOrEqual(cardBeforeZoom.x + cardBeforeZoom.width);

  const reply = card.getByTestId("pdf-annotation-reply");
  await reply.fill("Draft survives zoom");
  const zoomIn = page.getByTestId("pdf-zoom-in");
  await zoomIn.click();
  await expect(reply).toHaveValue("Draft survives zoom");
  const cardAfterZoom = await card.boundingBox();
  expect(Math.abs((cardAfterZoom?.width ?? 0) - cardBeforeZoom.width)).toBeLessThan(3);

  await reply.press("Control+Enter");
  await expect(card.getByText("Draft survives zoom")).toBeVisible();
  await card.getByRole("button", { name: "Antwort bearbeiten" }).click();
  const editedReply = card.locator("textarea").first();
  await editedReply.fill("Edited after zoom");
  await editedReply.press("Control+Enter");
  await expect(card.getByText("Edited after zoom")).toBeVisible();

  await page.setViewportSize({ width: 997, height: 514 });
  await expect(card).toBeVisible();
  const compactViewport = page.getByTestId("pdf-reader-viewport");
  await expect.poll(async () => (await compactViewport.boundingBox())?.width ?? 0).toBeGreaterThan(250);
  const resizeHandle = page.getByRole("button", { name: "Breite der Kommentarleiste anpassen" });
  const resizeBounds = await resizeHandle.boundingBox();
  if (!resizeBounds) throw new Error("Comment panel resize handle unavailable");
  await page.mouse.move(resizeBounds.x + resizeBounds.width / 2, resizeBounds.y + 40);
  await page.mouse.down();
  await page.mouse.move(resizeBounds.x - 40, resizeBounds.y + 40);
  await page.mouse.up();
  await expect.poll(async () => Number(await page.evaluate(() => localStorage.getItem("wiki:pdf-comment-panel-width")))).toBeGreaterThan(304);
  const resizedWidth = (await card.boundingBox())?.width ?? 0;
  await page.reload();
  await expect(page.getByTestId("pdf-comments-panel")).toBeVisible();
  await expect.poll(async () => (await page.getByTestId("pdf-comments-panel").boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(resizedWidth - 2);
  await page.getByTestId("pdf-comments-panel").getByRole("button", { name: "Zurück zu den Kommentaren" }).click();
  const commentList = page.getByTestId("pdf-comment-list");
  await expect(commentList).toBeVisible();
  await commentList.getByPlaceholder("Kommentare durchsuchen…").fill("Key quotation");
  await expect(commentList.getByText("Key quotation")).toBeVisible();
  await commentList.getByRole("button", { name: "Alle Kommentare" }).click();
  await expect(commentList.getByRole("button", { name: "Nur aktuelle Seite" })).toBeVisible();
  await commentList.getByText("Key quotation").click();

  await page.setViewportSize({ width: 700, height: 700 });
  await expect(page.getByTestId("pdf-annotation-mobile-sheet")).toBeVisible();
  await expect(page.getByTestId("pdf-annotation-mobile-sheet").getByText("Edited after zoom")).toBeVisible();
  await page.getByTestId("pdf-annotation-mobile-sheet").getByRole("button", { name: "Abbrechen" }).click();

  await page.goto("/wiki/inbox");
  await page.getByRole("button", { name: "Schnelle Notiz" }).last().click();
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.type("PDF Evidence Review");
  await page.getByRole("button", { name: "PDF-Nachweis einfügen" }).click();
  await page.getByRole("button", { name: /Local PDF evidence supports traceable research/ }).click();
  await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await expect(page.getByText("Local PDF evidence supports traceable research").first()).toBeVisible();
  await expect(page.getByText(/local evidence.*S\. 1/i)).toBeVisible();
});

test("PDF and note focus modes expand their workspaces and persist independently", async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/wiki/sources");
  await page.locator('a[href*="/read/"]').first().click();
  await expect(page).toHaveURL(/\/wiki\/sources\/[^/]+\/read\/[^/]+/);
  const readerUrl = page.url();

  const viewport = page.getByTestId("pdf-reader-viewport");
  await expect(viewport).toBeVisible();
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await expect(page.getByTestId("research-sidebar")).toBeVisible();
  const standardWidth = (await viewport.boundingBox())?.width ?? 0;

  await page.getByRole("button", { name: "Fokusmodus", exact: true }).click();
  await expect(page.getByTestId("app-sidebar")).toHaveCount(0);
  await expect(page.getByTestId("research-sidebar")).toHaveCount(0);
  await expect(page.getByTestId("pdf-thumbnails-panel")).toHaveCount(0);
  await expect(page.getByTestId("pdf-comments-panel")).toHaveCount(0);
  await expect.poll(async () => (await viewport.boundingBox())?.width ?? 0).toBeGreaterThan(standardWidth + 400);
  await page.getByRole("button", { name: "Zoomoptionen" }).click();
  await page.getByRole("menuitem", { name: "An Breite anpassen" }).click();
  await expect.poll(async () => viewport.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);

  await page.getByRole("button", { name: "Markierungen anzeigen" }).click();
  await expect(page.getByTestId("pdf-comments-panel")).toBeVisible();

  await page.getByRole("button", { name: "Weitere PDF-Aktionen" }).click();
  await page.getByRole("menuitem", { name: "Gliederung" }).click();
  await expect(page.getByTestId("pdf-thumbnails-panel")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Fokusmodus beenden" })).toBeVisible();
  await expect(page.getByTestId("app-sidebar")).toHaveCount(0);
  await expect(page.getByTestId("pdf-thumbnails-panel")).toHaveCount(0);
  await expect(page.getByTestId("pdf-comments-panel")).toHaveCount(0);

  await page.setViewportSize({ width: 1280, height: 900 });

  await page.goto("/wiki/inbox");
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await expect(page.getByTestId("research-sidebar")).toBeVisible();
  await page.getByRole("button", { name: "Schnelle Notiz" }).last().click();
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.type("Focused writing remains autosaved");
  await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: "Fokusmodus", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Fokusmodus", exact: true }).click();
  await expect(page.getByTestId("app-sidebar")).toHaveCount(0);
  await expect(page.getByTestId("research-sidebar")).toHaveCount(0);
  await expect(page.getByTestId("note-metadata-controls")).toHaveCount(0);
  await expect(page.getByTestId("note-metadata-sidebar")).toHaveCount(0);
  await expect(page.getByTestId("comment-rail")).toHaveCount(0);
  await expect(editor).toContainText("Focused writing remains autosaved");

  await page.getByRole("button", { name: "Kommentare anzeigen" }).click();
  await expect(page.getByTestId("comment-rail")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Fokusmodus beenden" })).toBeVisible();
  await expect(page.getByTestId("app-sidebar")).toHaveCount(0);
  await expect(page.locator(".ProseMirror")).toContainText("Focused writing remains autosaved");
  await page.getByRole("button", { name: "Fokusmodus beenden" }).click();

  await page.goto(readerUrl);
  await expect(page.getByRole("button", { name: "Fokusmodus beenden" })).toBeVisible();
  await expect(page.getByTestId("app-sidebar")).toHaveCount(0);
  await page.getByRole("button", { name: "Fokusmodus beenden" }).click();
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await expect(page.getByTestId("research-sidebar")).toBeVisible();
  await expect(page.getByTestId("pdf-thumbnails-panel")).toBeVisible();
  await expect(page.getByTestId("pdf-comments-panel")).toBeVisible();
});
