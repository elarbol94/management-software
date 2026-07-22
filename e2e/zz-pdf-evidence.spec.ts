import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

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
  await page.locator('input[type="file"][accept*="pdf"]').first().setInputFiles({
    name: "local-evidence.pdf",
    mimeType: "application/pdf",
    buffer: nativeTextPdf("Local PDF evidence supports traceable research"),
  });

  await expect(page).toHaveURL(/\/wiki\/sources\//, { timeout: 15_000 });
  await expect(page.getByText("local-evidence.pdf")).toBeVisible();
  const read = page.getByRole("link", { name: "PDF lesen" });
  await expect(read).toBeVisible({ timeout: 30_000 });
  await read.click();

  await expect(page.getByPlaceholder("In der PDF suchen…")).toBeVisible({ timeout: 15_000 });
  await page.getByPlaceholder("In der PDF suchen…").fill("traceable");
  await expect(page.getByText("Local PDF evidence supports traceable research").first()).toBeVisible();

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
  page.once("dialog", (dialog) => dialog.accept("Key quotation"));
  await page.getByRole("button", { name: "Text markieren" }).click();
  await expect(page.getByText("Key quotation")).toBeVisible();

  await page.getByRole("button", { name: "Bereich markieren" }).click();
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("PDF canvas not visible");
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.42);
  await page.mouse.up();
  page.once("dialog", (dialog) => dialog.accept("Important figure"));
  const saveRegion = page.getByRole("button", { name: "Bereich speichern" }); await expect(saveRegion).toBeVisible(); await saveRegion.evaluate((button) => (button as HTMLButtonElement).click());
  await expect(page.getByText("Important figure")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Key quotation")).toBeVisible();
  await expect(page.getByText("Important figure")).toBeVisible();

  await page.goto("/wiki/inbox");
  await page.getByRole("button", { name: "Schnelle Notiz" }).last().click();
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.type("PDF Evidence Review");
  await page.getByRole("button", { name: "PDF-Nachweis einfügen" }).click();
  await page.getByRole("button", { name: /Local PDF evidence supports traceable research/ }).click();
  await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await expect(page.getByText("Local PDF evidence supports traceable research")).toBeVisible();
  await expect(page.getByText(/local evidence.*S\. 1/i)).toBeVisible();
});
