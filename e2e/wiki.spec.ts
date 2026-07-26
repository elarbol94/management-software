import { test, expect, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#username").fill("admin");
  await page.locator("#password").fill("super-secret-1");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.getByText("Willkommen, E2E Admin!")).toBeVisible({ timeout: 30_000 });
}

async function quickNote(page: Page, title: string, body: string) {
  await page.goto("/wiki/inbox");
  await page.getByRole("button", { name: "Schnelle Notiz" }).last().click();
  await expect(page).toHaveURL(/\/wiki\/pages\/unbenannte-notiz/, { timeout: 30_000 });
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.type(title);
  await page.keyboard.press("Enter");
  await page.keyboard.type(body);
  await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await expect(page.getByRole("button", { name: title })).toBeVisible();
}

test("capture an inbox note and retain autosaved content", async ({ page }) => {
  await login(page);
  await quickNote(page, "Onboarding", "Willkommen im Team! Erste Schritte für neue Kollegen.");
  await expect(page.getByText("Willkommen im Team! Erste Schritte für neue Kollegen.")).toBeVisible();
});

test("Markdown reference dialog opens from the editor toolbar and closes on Escape or outside click", async ({ page }) => {
  await login(page);
  await page.goto("/wiki/pages/unbenannte-notiz");

  await page.getByTestId("markdown-help-button").click();
  const dialog = page.getByTestId("markdown-reference-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("**fett**");
  await expect(dialog).toContainText(/Syntax\s*\|\s*Beschreibung/);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await page.getByTestId("markdown-help-button").click();
  await expect(dialog).toBeVisible();
  await page.locator('[data-slot="dialog-overlay"]').click({ position: { x: 4, y: 4 } });
  await expect(dialog).toBeHidden();
});

test("global writing style previews, cancels, persists across pages, and reaches HTML export", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  await quickNote(page, `Typography settings ${Date.now()}`, "A compact list preview.");

  await page.getByRole("button", { name: "Schreibbild", exact: true }).click();
  const dialog = page.getByTestId("wiki-typography-dialog");
  const preview = page.getByTestId("wiki-typography-preview");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Standard" }).click();
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await page.getByRole("button", { name: "Schreibbild", exact: true }).click();
  await expect(preview).toContainText("Entscheidungen nachvollziehbar dokumentieren");
  await expect(page.getByTestId("listItemSpacingEm-number")).toHaveValue("0.15");

  await page.getByTestId("listItemSpacingEm-number").fill("0.8");
  await expect(page.getByTestId("listItemSpacingEm-slider")).toHaveValue("0.8");
  await expect(dialog.getByRole("button", { name: "Benutzerdefiniert" })).toHaveAttribute("aria-pressed", "true");
  await expect(preview).toHaveCSS("--wiki-list-item-spacing", "0.8em");
  await dialog.getByRole("button", { name: "Abbrechen" }).click();

  await page.getByRole("button", { name: "Schreibbild", exact: true }).click();
  await expect(page.getByTestId("listItemSpacingEm-number")).toHaveValue("0.15");
  await dialog.getByRole("button", { name: "Kompakt" }).click();
  await expect(page.getByTestId("lineHeight-number")).toHaveValue("1.35");
  await expect(page.getByTestId("listItemSpacingEm-number")).toHaveValue("0");
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".wiki-editor-surface")).toHaveCSS("--wiki-list-item-spacing", "0em");

  await page.reload();
  await expect(page.locator(".wiki-editor-surface")).toHaveCSS("--wiki-line-height", "1.35");
  await page.getByRole("button", { name: "Seite exportieren" }).click();
  const htmlHref = await page.locator('a[href*="format=html"]').getAttribute("href");
  expect(htmlHref).toBeTruthy();
  const htmlResponse = await page.request.get(htmlHref!);
  expect(htmlResponse.status()).toBe(200);
  const html = await htmlResponse.text();
  expect(html).toContain("--line-height: 1.35");
  expect(html).toContain("--list-item-spacing: 0em");

  await page.goto("/wiki/inbox");
  await page.getByRole("button", { name: "Schnelle Notiz" }).last().click();
  await expect(page).toHaveURL(/\/wiki\/pages\/unbenannte-notiz/, { timeout: 30_000 });
  await expect(page.locator(".wiki-editor-surface")).toHaveCSS("--wiki-list-item-spacing", "0em", { timeout: 30_000 });

  await page.getByRole("button", { name: "Schreibbild", exact: true }).click();
  await dialog.getByRole("button", { name: "Standard" }).click();
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(page.locator(".wiki-editor-surface")).toHaveCSS("--wiki-list-item-spacing", "0.15em");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Schreibbild", exact: true }).click();
  const dialogBox = await dialog.boundingBox();
  const previewBox = await preview.boundingBox();
  const firstSectionBox = await dialog.locator("section").first().boundingBox();
  const footerBox = await dialog.locator('[data-slot="dialog-footer"]').boundingBox();
  expect(dialogBox?.width).toBeLessThanOrEqual(390);
  expect(previewBox!.y).toBeGreaterThan(firstSectionBox!.y);
  expect(footerBox!.y + footerBox!.height).toBeLessThanOrEqual(844);
  await dialog.getByRole("button", { name: "Abbrechen" }).click();
});

test("document mode persists page layout, document blocks, templates, and PDF export", async ({ page }) => {
  await login(page);
  await quickNote(page, "Funding application", "A structured project description.");

  await page.getByTestId("document-mode-toggle").click();
  const panel = page.getByTestId("document-layout-panel");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("wiki-editor")).toHaveAttribute("data-document-mode", "true");

  await panel.getByLabel("Ausrichtung").click();
  await page.getByRole("option", { name: "Querformat" }).click();
  await panel.getByRole("tab", { name: "Inhalt" }).click();
  await panel.getByRole("button", { name: "Seitenumbruch" }).click();
  await expect(page.locator(".wiki-document-page-break")).toHaveCount(1);

  await panel.getByPlaceholder("applicant").fill("Example Applicant");
  await panel.getByRole("button", { name: "Feld applicant einfügen" }).click();
  await expect(page.locator("[data-document-variable='applicant']")).toHaveCount(1);

  await panel.getByLabel("Name der neuen Vorlage").fill("E2E application profile");
  await panel.getByRole("button", { name: "Als Vorlage speichern" }).click();
  await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible({ timeout: 10_000 });

  await page.reload();
  await expect(page.getByTestId("document-layout-panel")).toBeVisible();
  await expect(page.locator(".wiki-document-page-break")).toHaveCount(1);
  await expect(page.locator("[data-document-variable='applicant']")).toContainText("applicant");

  await page.getByTestId("document-layout-panel").getByRole("tab", { name: "Prüfung" }).click();
  const href = await page.getByTestId("document-layout-panel").locator('a[href*="format=pdf"]').getAttribute("href");
  expect(href).toBeTruthy();
  const response = await page.request.get(href!);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/pdf");
  expect((await response.body()).length).toBeGreaterThan(1_000);
});

test("editor productivity tools support links, Markdown paste, search, outline, and writing statistics", async ({ page, context }) => {
  await login(page);
  await quickNote(page, "Editor tools", "Alpha beta alpha");
  const editor = page.locator(".ProseMirror");

  await expect(page.getByRole("button", { name: "Fett" })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("editor-writing-status")).toContainText("Wörter");

  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await page.evaluate(() => {
    const target = document.querySelector(".ProseMirror");
    const data = new DataTransfer();
    data.setData("text/plain", "## Imported heading\n\n- First\n- Second");
    target?.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
  });
  await expect(editor.getByRole("heading", { level: 2, name: "Imported heading" })).toBeVisible();
  await expect(editor.locator("ul li")).toHaveCount(2);

  await page.keyboard.press("ControlOrMeta+f");
  const search = page.getByTestId("editor-search-panel");
  await expect(search).toBeVisible();
  await search.getByPlaceholder("In dieser Notiz suchen…").fill("alpha");
  await expect(search).toContainText("1 von 2");
  await search.getByPlaceholder("Ersetzen durch…").fill("Gamma");
  await search.getByRole("button", { name: "Alle ersetzen" }).click();
  await expect(editor).toContainText("Gamma beta Gamma");
  await page.getByRole("button", { name: "Suchen und ersetzen" }).click();
  await expect(search).toBeHidden();

  await page.getByRole("button", { name: "Dokumentgliederung" }).click();
  const outline = page.getByTestId("editor-outline");
  await expect(outline.getByRole("button", { name: "Imported heading" })).toBeVisible();
  await outline.getByRole("button", { name: "Imported heading" }).click();

  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" Link text");
  await page.keyboard.press("Shift+ControlOrMeta+ArrowLeft");
  await page.keyboard.press("Shift+ControlOrMeta+ArrowLeft");
  await page.getByRole("button", { name: "Link bearbeiten" }).click();
  await page.getByLabel("Webadresse").fill("example.com");
  await page.getByRole("button", { name: "Übernehmen" }).click();
  await expect(editor.locator('a[href="https://example.com"]')).toContainText("Link text");

  await context.setOffline(true);
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" offline");
  await expect(page.getByText("Offline · lokal gesichert")).toBeVisible({ timeout: 10_000 });
  await context.setOffline(false);
});

test("markdown shortcuts render on a boundary, undo cleanly, and persist", async ({ page }) => {
  await login(page);
  await quickNote(page, "Markdown Shortcuts", "Start");
  const editor = page.locator(".ProseMirror");

  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("**delayed**");
  await expect(editor).toContainText("**delayed**");
  await expect(editor.locator("strong", { hasText: "delayed" })).toHaveCount(0);

  await page.keyboard.press("Space");
  await expect(editor).not.toContainText("**delayed**");
  await expect(editor.locator("strong", { hasText: "delayed" })).toHaveCount(1);

  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor).toContainText("**delayed**");
  await expect(editor.locator("strong", { hasText: "delayed" })).toHaveCount(0);

  await page.keyboard.press("Space");
  await page.keyboard.type("plain");
  await expect(editor.locator("strong", { hasText: "delayed" })).toHaveText("delayed");
  await expect(editor.locator("strong")).not.toContainText("plain");

  await page.keyboard.press("Enter");
  await page.keyboard.type("*next line*");
  await expect(editor).toContainText("*next line*");
  await page.keyboard.press("Enter");
  await page.keyboard.type("unformatted");
  await expect(editor.locator("em", { hasText: "next line" })).toHaveText("next line");
  await expect(editor.locator("em")).not.toContainText("unformatted");

  await page.keyboard.press("Enter");
  await page.keyboard.type("# ");
  await page.keyboard.type("Markdown heading");
  await expect(editor.getByRole("heading", { level: 1, name: "Markdown heading" })).toBeVisible();

  await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await expect(editor.locator("strong", { hasText: "delayed" })).toHaveText("delayed");
  await expect(editor.locator("em", { hasText: "next line" })).toHaveText("next line");
  await expect(editor.getByRole("heading", { level: 1, name: "Markdown heading" })).toBeVisible();
});

test("extended Markdown syntax creates editable semantic content", async ({ page }) => {
  await login(page);
  await quickNote(page, "Extended Markdown", "Start");
  const editor = page.locator(".ProseMirror");

  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("==important==");
  await expect(editor.locator("mark.wiki-highlight")).toHaveCount(0);
  await page.keyboard.press("Space");
  await page.keyboard.type("H~2~O");
  await page.keyboard.press("Space");
  await page.keyboard.type("X^2^");
  await page.keyboard.press("Space");
  await page.keyboard.type(":joy:");
  await page.keyboard.press("Space");
  await page.keyboard.type("[^1]");
  await page.keyboard.press("Space");
  await expect(editor.locator("mark.wiki-highlight")).toHaveText("important");
  await expect(editor.locator("sub")).toHaveText("2");
  await expect(editor.locator("sup:not([data-footnote-reference])")).toHaveText("2");
  await expect(editor.locator("sup[data-footnote-reference]")).toHaveText("1");
  await expect(editor).toContainText("😂");

  await page.keyboard.press("Enter");
  await page.keyboard.type("[^1]: Footnote text");
  await page.keyboard.press("Enter");
  await expect(editor.locator("aside[data-footnote-definition='1']")).toContainText("Footnote text");

  await page.keyboard.type("term");
  await page.keyboard.press("Enter");
  await page.keyboard.type(": definition");
  await page.keyboard.press("Enter");
  await expect(editor.locator("dl[data-markdown-definition-list] dt")).toHaveText("term");
  await expect(editor.locator("dl[data-markdown-definition-list] dd")).toHaveText("definition");

  await page.keyboard.type("| Syntax | Description |");
  await page.keyboard.press("Enter");
  await page.keyboard.type("| --- | --- |");
  await page.keyboard.press("Enter");
  const table = editor.locator("table[data-markdown-table]");
  await expect(table.locator("th")).toHaveCount(2);
  await expect(table.locator("td")).toHaveCount(2);
  await table.locator("td").nth(0).click();
  await page.keyboard.type("Header");
  await table.locator("td").nth(1).click();
  await page.keyboard.type("Title");
  await expect(table.locator("td").nth(0)).toHaveText("Header");
  await expect(table.locator("td").nth(1)).toHaveText("Title");

  await editor.locator("table[data-markdown-table] + p").click();
  await page.keyboard.type("### ");
  await page.keyboard.type("My Great Heading {#custom-id}");
  await page.keyboard.press("Enter");
  await expect(editor.locator("h3#custom-id")).toHaveText("My Great Heading");

  await page.keyboard.type("![diagram](/window.svg)");
  await page.keyboard.press("Enter");
  await expect(editor.locator("figure[data-commentable-image] img")).toHaveAttribute("alt", "diagram");

  await page.keyboard.type("```");
  await page.keyboard.press("Enter");
  await page.keyboard.type("const x = 1");
  await page.keyboard.press("Enter");
  await page.keyboard.type("```");
  await page.keyboard.press("Enter");
  await expect(editor.locator("pre code")).toHaveText("const x = 1");

  await page.keyboard.type("---");
  await expect(editor.locator("hr")).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(editor.locator("hr")).toHaveCount(1);

  await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await expect(editor.locator("table[data-markdown-table]")).toHaveCount(1);
  await expect(editor.locator("aside[data-footnote-definition='1']")).toContainText("Footnote text");
  await expect(editor.locator("h3#custom-id")).toHaveText("My Great Heading");
  await expect(editor.locator("pre code")).toHaveText("const x = 1");
});

test("internal links create backlinks and unified search finds content", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  await quickNote(page, "IT-Setup", "Laptop einrichten. Siehe auch: ");
  await page.locator(".ProseMirror").click();
  await page.getByRole("button", { name: "Seite verlinken" }).click();
  await page.getByRole("button", { name: "Onboarding" }).first().click();
  await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible({ timeout: 10_000 });
  const onboardingHref = await page.locator(".ProseMirror").getByRole("link", { name: "Onboarding" }).getAttribute("href");
  expect(onboardingHref).toBeTruthy();
  await page.goto(onboardingHref!);
  await expect(page.getByText("Verweise auf diese Seite")).toBeVisible();
  await expect(page.getByRole("link", { name: "IT-Setup" }).last()).toBeVisible();
  await page.getByRole("button", { name: "Seiten und Quellen durchsuchen…" }).click();
  await page.getByPlaceholder("Seiten und Quellen durchsuchen…").fill("Laptop");
  await expect(page.getByRole("link", { name: /IT-Setup/ }).first()).toBeVisible();
});

test("create a source, cite it, and render the bibliography", async ({ page }) => {
  test.setTimeout(120_000);
  const sourceTitle = `Knowledge Systems ${Date.now()}`;
  await login(page);
  await page.goto("/wiki/sources");
  await page.getByRole("button", { name: "Neue Quelle" }).click();
  await page.getByLabel("Titel", { exact: true }).fill(sourceTitle);
  await page.getByLabel("Mitwirkende").fill("Smith, Jane");
  await page.getByLabel("Erscheinungsdatum").fill("2026");
  await page.getByRole("button", { name: "Quelle anlegen" }).click();
  await expect(page).toHaveURL(/\/wiki\/sources\//, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: sourceTitle })).toBeVisible();
  await page.goto("/wiki/pages");
  await page.getByRole("link", { name: "Onboarding" }).first().click();
  await page.locator(".ProseMirror").click();
  await page.getByRole("button", { name: "Zitat einfügen" }).click();
  await page.getByRole("button", { name: sourceTitle }).click();
  await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Literaturverzeichnis" })).toBeVisible();
  await expect(page.getByText(/Smith, J\. \(2026\)/)).toBeVisible();
  await expect(page.getByText(sourceTitle, { exact: false })).toBeVisible();
});

test("subpages remain nested and deletion is recoverable", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  await page.goto("/wiki/pages");
  await page.getByRole("link", { name: "Onboarding" }).last().click();
  page.once("dialog", (dialog) => dialog.accept("Erster Arbeitstag"));
  await page.getByRole("button", { name: "Unterseite anlegen" }).click();
  await expect(page).toHaveURL(/\/wiki\/pages\/erster-arbeitstag/, { timeout: 30_000 });
  page.once("dialog", (dialog) => dialog.accept("Tag Eins"));
  await page.getByRole("button", { name: "Erster Arbeitstag" }).click();
  await expect(page.getByRole("button", { name: "Tag Eins" })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Seite löschen" }).click();
  await expect(page).toHaveURL(/\/wiki\/inbox/, { timeout: 30_000 });
  await page.goto("/wiki/trash");
  await expect(page.getByText("Tag Eins")).toBeVisible();
  await page.getByRole("button", { name: "Wiederherstellen" }).click();
  await expect(page.getByText("Tag Eins")).toHaveCount(0);
});

test("slash palette filters commands and applies a block command from the keyboard", async ({ page }) => {
  await login(page);
  await quickNote(page, "Slash Palette", "Start");
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/uberschrift 2");
  await expect(page.getByRole("listbox", { name: "Slash-Befehle" })).toBeVisible();
  await page.keyboard.press("Enter");
  await page.keyboard.type("A useful heading");
  await expect(editor.getByRole("heading", { level: 2, name: "A useful heading" })).toBeVisible();
  await expect(editor).not.toContainText("/uberschrift 2");

  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/trennlinie");
  await page.getByRole("option", { name: /Trennlinie/ }).click();
  await expect(editor.locator("hr")).toHaveCount(1);
});

test("slash wiki actions open the existing attachment, source, and comment controls", async ({ page }) => {
  await login(page);
  await quickNote(page, "Slash Actions", "Action start");
  const editor = page.locator(".ProseMirror");

  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/datei");
  const chooserPromise = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: "slash-note.txt", mimeType: "text/plain", buffer: Buffer.from("slash upload") });
  await expect(page.getByText("slash-note.txt")).toBeVisible();

  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/kommentar");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("page-comment-input")).toBeFocused();

  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/quelle verknupfen");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("supporting-source-picker")).toBeFocused();
});

test("slash palette dismisses without deleting text and stays closed in URLs and code blocks", async ({ page }) => {
  await login(page);
  await quickNote(page, "Slash Guardrails", "Guardrail start");
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("https://");
  await expect(page.getByRole("listbox", { name: "Slash-Befehle" })).toHaveCount(0);

  await page.keyboard.press("Enter");
  await page.keyboard.type("/");
  await expect(page.getByRole("listbox", { name: "Slash-Befehle" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox", { name: "Slash-Befehle" })).toHaveCount(0);
  await expect(editor).toContainText("/");

  await page.keyboard.press("Enter");
  await page.keyboard.type("/code");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/");
  await expect(page.getByRole("listbox", { name: "Slash-Befehle" })).toHaveCount(0);
});

test("slash wiki insert commands open the shared page, citation, and PDF evidence pickers", async ({ page }) => {
  await login(page);
  await quickNote(page, "Slash Pickers", "Picker start");
  const editor = page.locator(".ProseMirror");
  const openCommand = async (query: string) => {
    await editor.click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/" + query);
    await page.keyboard.press("Enter");
  };

  await openCommand("seite verknupfen");
  await expect(page.getByPlaceholder("Seiten filtern…")).toBeVisible();
  await page.keyboard.press("Escape");

  await openCommand("zitat einfugen");
  await expect(page.getByPlaceholder("Quelle suchen…")).toBeVisible();
  await page.keyboard.press("Escape");

  await openCommand("pdf");
  await expect(page.getByPlaceholder("PDF-Markierungen durchsuchen…")).toBeVisible();
});

test("workspace groups notes and applies local filters", async ({ page }) => {
  await login(page);
  await quickNote(page, "Arbeitsansicht", "Diese Notiz wird in der Übersicht sortiert.");
  await page.goto("/wiki/inbox");

  const inbox = page.getByTestId("workspace-group-inbox");
  await expect(inbox).toContainText("Arbeitsansicht");
  const note = inbox.getByTestId("workspace-note").filter({ hasText: "Arbeitsansicht" });
  await note.getByTestId("workspace-note-status").click();
  await page.getByRole("option", { name: "In Arbeit" }).click();

  const working = page.getByTestId("workspace-group-working");
  await expect(working).toContainText("Arbeitsansicht");
  const workingNote = working.getByTestId("workspace-note").filter({ hasText: "Arbeitsansicht" });
  await workingNote.getByTestId("workspace-note-favorite").click();
  await page.getByRole("button", { name: "Nur Favoriten" }).click();
  await expect(working).toContainText("Arbeitsansicht");
  await page.getByPlaceholder("Notizen durchsuchen…").fill("sortiert");
  await expect(working).toContainText("Arbeitsansicht");
});
