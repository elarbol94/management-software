import { test, expect, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#username").fill("admin");
  await page.locator("#password").fill("super-secret-1");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.getByText("Willkommen, E2E Admin!")).toBeVisible();
}

async function quickNote(page: Page, title: string, body: string) {
  await page.goto("/wiki/inbox");
  await page.getByRole("button", { name: "Schnelle Notiz" }).last().click();
  await expect(page).toHaveURL(/\/wiki\/pages\/unbenannte-notiz/);
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

test("internal links create backlinks and unified search finds content", async ({ page }) => {
  await login(page);
  await quickNote(page, "IT-Setup", "Laptop einrichten. Siehe auch: ");
  await page.locator(".ProseMirror").click();
  await page.getByRole("button", { name: "Seite verlinken" }).click();
  await page.getByRole("button", { name: "Onboarding" }).click();
  await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("link", { name: "Onboarding" }).first().click();
  await expect(page.getByText("Verweise auf diese Seite")).toBeVisible();
  await expect(page.getByRole("link", { name: "IT-Setup" }).last()).toBeVisible();
  await page.getByPlaceholder("Seiten und Quellen durchsuchen…").fill("Laptop");
  await expect(page.getByRole("link", { name: /IT-Setup/ }).first()).toBeVisible();
});

test("create a source, cite it, and render the bibliography", async ({ page }) => {
  await login(page);
  await page.goto("/wiki/sources");
  await page.getByRole("button", { name: "Neue Quelle" }).click();
  await page.getByLabel("Titel").fill("Knowledge Systems");
  await page.getByLabel("Mitwirkende").fill("Smith, Jane");
  await page.getByLabel("Erscheinungsdatum").fill("2026");
  await page.getByRole("button", { name: "Quelle anlegen" }).click();
  await expect(page).toHaveURL(/\/wiki\/sources\//);
  await expect(page.getByRole("heading", { name: "Knowledge Systems" })).toBeVisible();
  await page.getByRole("link", { name: "Onboarding" }).first().click();
  await page.locator(".ProseMirror").click();
  await page.getByRole("button", { name: "Zitat einfügen" }).click();
  await page.getByRole("button", { name: /Knowledge Systems/ }).click();
  await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Literaturverzeichnis" })).toBeVisible();
  await expect(page.getByText(/Smith, J\. \(2026\).*Knowledge Systems/)).toBeVisible();
});

test("subpages remain nested and deletion is recoverable", async ({ page }) => {
  await login(page);
  await page.goto("/wiki/pages");
  await page.getByRole("link", { name: "Onboarding" }).last().click();
  page.once("dialog", (dialog) => dialog.accept("Erster Arbeitstag"));
  await page.getByRole("button", { name: "Unterseite anlegen" }).click();
  await expect(page).toHaveURL(/\/wiki\/pages\/erster-arbeitstag/);
  page.once("dialog", (dialog) => dialog.accept("Tag Eins"));
  await page.getByRole("button", { name: "Erster Arbeitstag" }).click();
  await expect(page.getByRole("button", { name: "Tag Eins" })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Seite löschen" }).click();
  await expect(page).toHaveURL(/\/wiki\/inbox/);
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
