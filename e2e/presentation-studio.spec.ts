import { expect, test, type Page } from "@playwright/test";
import { zipSync, strToU8 } from "fflate";

async function login(page: Page) {
  const credentials = { username: "admin", password: "super-secret-1" };
  let response = await page.request.post("/api/auth/sign-in/username", { data: credentials });
  if (!response.ok()) response = await page.request.post("/api/auth/sign-up/email", { data: { ...credentials, name: "E2E Admin", email: "admin@example.com" } });
  expect(response.ok()).toBe(true);
}

function pptx() {
  return Buffer.from(zipSync({
    "ppt/presentation.xml": strToU8('<p:presentation xmlns:p="urn:p" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId r:id="rId1"/></p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/></p:presentation>'),
    "ppt/_rels/presentation.xml.rels": strToU8('<Relationships xmlns="urn:r"><Relationship Id="rId1" Target="slides/slide1.xml"/></Relationships>'),
    "ppt/slides/slide1.xml": strToU8('<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><p:cSld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="3657600" cy="914400"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:rPr b="1"/><a:t>Imported title</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>'),
  }));
}
async function seed(page: Page) {
  const imported = await page.request.post("/api/wiki/presentations/import", { multipart: { file: { name: "Studio.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", buffer: pptx() } } });
  expect(imported.status(), await imported.text()).toBe(200);
  const { id } = await imported.json();
  const source = await (await page.request.get(`/api/wiki/presentations/${id}`)).json();
  const elements = [
    { id: "frame", type: "frame", x: 0, y: 0, width: 900, height: 500, rotation: 0, content: { label: "Overview", shape: "rect", color: "#6366f1" } },
    { id: "a", type: "text", parentId: "frame", x: 60, y: 100, width: 260, height: 90, rotation: 0, content: { text: "First idea", fontSize: 32, bold: false, align: "left", color: "#172033" } },
    { id: "b", type: "text", parentId: "frame", x: 420, y: 100, width: 260, height: 90, rotation: 0, content: { text: "Second idea", fontSize: 32, bold: false, align: "left", color: "#172033" } },
  ];
  const response = await page.request.patch(`/api/wiki/presentations/${id}`, { data: { ...source, elements, steps: [{ id: "s1", elementId: "frame", notes: "PRIVATE_SPEAKER_NOTE" }, { id: "s2", elementId: "a" }], expectedUpdatedAt: source.updatedAt, sessionId: "studio-fixture-session" } });
  expect(response.status()).toBe(200);
  return id as string;
}
async function open(page: Page, id: string) {
  await page.goto(`/wiki/presentations/${id}`);
  await expect(page.getByRole("button", { name: "Text", exact: true })).toBeEnabled();
}
const documentOf = async (page: Page, id: string) => (await page.request.get(`/api/wiki/presentations/${id}`)).json();

test("PowerPoint import is available from the presentation list", async ({ page }) => {
  await login(page); await page.goto("/wiki/presentations");
  await page.getByRole("button", { name: "PowerPoint importieren" }).click();
  await page.getByLabel("PowerPoint-Datei auswählen").setInputFiles({ name: "Imported workshop.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", buffer: pptx() });
  await expect(page.getByRole("heading", { name: "Importhinweise" })).toBeVisible();
  await page.getByRole("button", { name: "Importierte Präsentation öffnen" }).click();
  await expect(page.getByTestId("presentation-editor")).toBeVisible();
  await expect(page.getByTestId("presentation-editor").locator(".react-flow__node-text")).toContainText("Imported title");
});

test("nested groups persist, transform descendants, lock and ungroup", async ({ page }, info) => {
  await login(page); const id = await seed(page); await open(page, id);
  await page.locator('[data-testid="rf__node-a"]').click();
  await page.locator('[data-testid="rf__node-b"]').click({ modifiers: ["Shift"] });
  await page.getByRole("button", { name: "Auswahl gruppieren", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Drehung (Grad)" }).fill("30");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect.poll(async () => (await documentOf(page, id)).elements.find((element: { id: string }) => element.id === "a").rotation).toBe(30);
  await page.getByRole("button", { name: "Objekt sperren", exact: true }).click();
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  const saved = await documentOf(page, id);
  const group = saved.elements.find((element: { content: { isGroup?: boolean } }) => element.content.isGroup);
  expect(group.locked).toBe(true);
  await page.screenshot({ path: info.outputPath("groups-editor.png") });
  await page.getByRole("button", { name: "Objekt entsperren" }).click();
  await page.getByRole("button", { name: "Gruppierung aufheben" }).click();
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect.poll(async () => (await documentOf(page, id)).elements.find((element: { id: string }) => element.id === "a").parentId).toBe("frame");
});

test("rich text, charts, icons and reveal/hide playback survive saving", async ({ page }, info) => {
  await login(page); const id = await seed(page); await open(page, id);
  await page.getByRole("combobox", { name: "Objekt auswählen" }).selectOption("a");
  const rich = page.getByRole("textbox", { name: "Formatierter Text" });
  await rich.fill("Formatted idea");
  await rich.press("Control+a");
  await page.getByRole("button", { name: "Kursiv", exact: true }).click();
  await page.getByRole("combobox", { name: "Schriftart", exact: true }).selectOption("georgia");
  await page.getByRole("button", { name: "Diagramm hinzufügen" }).click();
  await page.getByRole("textbox", { name: "Diagrammtitel" }).fill("Revenue");
  await page.getByRole("combobox", { name: "Diagrammtyp" }).selectOption("pie");
  await page.getByRole("button", { name: "Symbol hinzufügen" }).click();
  await page.getByRole("combobox", { name: "Objekt auswählen" }).selectOption("a");
  await page.locator("summary").filter({ hasText: /^Animation$/ }).click();
  await page.getByRole("button", { name: "Einblenden", exact: true }).click();
  await page.getByRole("button", { name: "Ausblenden", exact: true }).click();
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  const saved = await documentOf(page, id);
  expect(saved.elements.find((element: { id: string }) => element.id === "a").content).toMatchObject({ font: "georgia", runs: [{ text: "Formatted idea", italic: true }] });
  expect(saved.elements.some((element: { type: string }) => element.type === "chart")).toBe(true);
  const offline = await page.request.get(`/api/wiki/presentations/${id}/offline`);
  expect(offline.status(), await offline.text()).toBe(200);
  expect(await offline.text()).toContain("Revenue");
  await page.getByRole("link", { name: "Präsentieren", exact: true }).click();
  const node = page.getByTestId("presentation-player").locator('[data-testid="rf__node-a"]');
  await expect(node).toHaveCSS("opacity", "0");
  await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowRight");
  await expect(node).toHaveCSS("opacity", "1");
  await page.keyboard.press("ArrowRight"); await expect(node).toHaveCSS("opacity", "0");
  await page.keyboard.press("ArrowLeft"); await expect(node).toHaveCSS("opacity", "1");
  await page.screenshot({ path: info.outputPath("rich-player.png") });
});

test("co-editing syncs independent edits in two browser windows", async ({ page, context }) => {
  await login(page); const id = await seed(page);
  expect((await page.request.post(`/api/wiki/presentations/${id}/studio`, { data: { action: "access", restricted: false, coediting: true } })).ok()).toBe(true);
  await open(page, id); const second = await context.newPage(); await open(second, id);
  await page.getByRole("combobox", { name: "Objekt auswählen" }).selectOption("a");
  await second.getByRole("combobox", { name: "Objekt auswählen" }).selectOption("b");
  await page.getByRole("textbox", { name: "Text", exact: true }).fill("Alice's edit"); await page.getByRole("textbox", { name: "Text", exact: true }).blur();
  await second.getByRole("textbox", { name: "Text", exact: true }).fill("Bob's edit"); await second.getByRole("textbox", { name: "Text", exact: true }).blur();
  await expect.poll(async () => (await documentOf(page, id)).elements.filter((element: { type: string }) => element.type === "text").map((element: { content: { text: string } }) => element.content.text)).toEqual(["Alice's edit", "Bob's edit"]);
  await expect(page.locator('[data-testid="rf__node-b"]')).toContainText("Bob's edit");
  await expect(second.locator('[data-testid="rf__node-a"]')).toContainText("Alice's edit");
  await second.close();
});

test("public links, embeds and offline files work without sign-in and exclude notes", async ({ page, browser }) => {
  await login(page); const id = await seed(page);
  const published = await page.request.post(`/api/wiki/presentations/${id}/studio`, { data: { action: "public", enabled: true } });
  const { token } = await published.json(); expect(token).toMatch(/^[a-f0-9]{64}$/);
  const anonymous = await browser.newContext({ baseURL: "http://localhost:3100" }); const viewer = await anonymous.newPage();
  const errors: string[] = []; viewer.on("pageerror", (error) => errors.push(error.message));
  const response = await viewer.goto(`/share/presentations/${token}?embed=1`);
  expect(response?.status()).toBe(200); await expect(viewer.locator("#counter")).toHaveText("1 / 2");
  await viewer.locator("#next").click(); await expect(viewer.locator("#counter")).toHaveText("2 / 2");
  expect(await response!.text()).not.toContain("PRIVATE_SPEAKER_NOTE");
  expect((await viewer.request.get(`/share/presentations/${token}/media/unknown`)).status()).toBe(404);
  const download = await page.request.get(`/api/wiki/presentations/${id}/offline`);
  expect(download.status(), await download.text()).toBe(200);
  const html = await download.text(); expect(html).not.toContain("PRIVATE_SPEAKER_NOTE"); expect(html).not.toContain("/_next/");
  await viewer.goto("about:blank"); await anonymous.setOffline(true); await viewer.setContent(html);
  await expect(viewer.locator("#counter")).toHaveText("1 / 2"); await viewer.locator("#next").click(); await expect(viewer.locator("#counter")).toHaveText("2 / 2");
  expect(errors).toEqual([]);
  await anonymous.setOffline(false);
  await page.request.post(`/api/wiki/presentations/${id}/studio`, { data: { action: "public", enabled: false } });
  expect((await viewer.request.get(`/share/presentations/${token}`)).status()).toBe(404);
  await anonymous.close();
});

test("typing during a merged save retains the local draft when it conflicts", async ({ page }) => {
  await login(page); const id = await seed(page);
  await page.request.post(`/api/wiki/presentations/${id}/studio`, { data: { action: "access", restricted: false, coediting: true } });
  await open(page, id);
  const base = await documentOf(page, id);
  let release!: () => void, ready!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const responseReady = new Promise<void>((resolve) => { ready = resolve; });
  let intercepted = false;
  await page.route(`**/api/wiki/presentations/${id}`, async (route) => {
    if (route.request().method() !== "PATCH" || intercepted) return route.continue();
    intercepted = true;
    const remote = { ...base, elements: base.elements.map((element: { id: string; content: object }) => element.id === "a" ? { ...element, content: { ...element.content, text: "Remote change" } } : element), base, expectedUpdatedAt: base.updatedAt, sessionId: "remote-save-session" };
    expect((await page.request.patch(`/api/wiki/presentations/${id}`, { data: remote })).ok()).toBe(true);
    const response = await route.fetch();
    expect(response.ok()).toBe(true); ready(); await gate;
    await route.fulfill({ response });
  });
  try {
    await page.getByRole("combobox", { name: "Objekt auswählen" }).selectOption("b");
    await page.getByRole("textbox", { name: "Text", exact: true }).fill("Local change on B");
    await page.getByRole("textbox", { name: "Text", exact: true }).blur();
    await responseReady;
    await page.getByRole("combobox", { name: "Objekt auswählen" }).selectOption("a");
    await page.getByRole("textbox", { name: "Text", exact: true }).fill("Local change on A");
    await page.getByRole("textbox", { name: "Text", exact: true }).blur();
    release();
    await expect(page.getByRole("button", { name: "Lokalen Entwurf herunterladen" })).toBeVisible();
    await expect(page.getByTestId("rf__node-a")).toContainText("Local change on A");
    const remote = await documentOf(page, id);
    expect(remote.elements.find((element: { id: string }) => element.id === "a").content.text).toBe("Remote change");
    expect(remote.elements.find((element: { id: string }) => element.id === "b").content.text).toBe("Local change on B");
  } finally { release(); }
});

test("company themes, templates and object comments are usable from the inspector", async ({ page }) => {
  await login(page); const id = await seed(page); await open(page, id);
  await page.locator("summary").filter({ hasText: /^Themen und Vorlagen$/ }).click();
  const name = `Brand ${Date.now()}`;
  await page.getByRole("textbox", { name: "Designname" }).fill(name);
  await page.getByRole("button", { name: "Firmenthema speichern" }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Designname" }).fill(`${name} template`);
  await page.getByRole("button", { name: "Firmenvorlage speichern" }).click();
  await expect(page.getByText(`${name} template`, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Text", exact: true }).click();
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  expect((await documentOf(page, id)).elements).toHaveLength(4);
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByText(`${name} template`, { exact: true }).locator("..").getByRole("button", { name: "Anwenden", exact: true }).click();
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect.poll(async () => (await documentOf(page, id)).elements.length).toBe(3);
  await page.getByRole("combobox", { name: "Objekt auswählen" }).selectOption("a");
  await page.locator("summary").filter({ hasText: /^Kommentare$/ }).click();
  await page.getByRole("textbox", { name: "Neuer Kommentar" }).fill("Clarify this idea");
  await page.getByRole("button", { name: "Kommentar senden" }).click();
  await expect(page.getByText("Clarify this idea", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Erledigen", exact: true }).click();
  await expect(page.getByRole("button", { name: "Wieder öffnen", exact: true })).toBeVisible();
});

test("presenter previews, editable notes and pause/reset timer", async ({ page }, info) => {
  await login(page); const id = await seed(page);
  await page.goto(`/wiki/presentations/${id}/present/notes`);
  await expect(page.getByRole("heading", { name: "Aktueller Rahmen" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Nächster Rahmen" })).toBeVisible();
  await page.getByRole("textbox", { name: "Sprechernotizen" }).fill("Updated while presenting");
  await page.getByRole("button", { name: "Notizen speichern" }).click();
  await expect.poll(async () => (await documentOf(page, id)).steps[0].notes).toBe("Updated while presenting");
  await page.getByRole("button", { name: "Zeit anhalten" }).click();
  await page.getByRole("button", { name: "Zeit zurücksetzen" }).click();
  await expect(page.getByRole("timer")).toHaveText("0:00");
  await page.waitForTimeout(1200); await expect(page.getByRole("timer")).toHaveText("0:00");
  await expect(page.getByRole("textbox", { name: "Sprechernotizen" })).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: info.outputPath("presenter-studio.png") });
});

test("viewer and commenter roles protect editing, notes and restricted attachments", async ({ page, browser }) => {
  await login(page); const id = await seed(page);
  const email = `viewer-${Date.now()}@example.com`, password = "studio-test-password";
  const created = await page.request.post("/api/auth/admin/create-user", { headers: { Origin: "http://localhost:3100" }, data: { name: "Studio viewer", email, password, role: "member" } });
  expect(created.ok(), await created.text()).toBe(true);
  const { user } = await created.json();
  await page.request.post(`/api/wiki/presentations/${id}/studio`, { data: { action: "access", restricted: true, coediting: false } });
  const viewerContext = await browser.newContext({ baseURL: "http://localhost:3100" });
  const viewer = await viewerContext.newPage();
  expect((await viewer.request.post("/api/auth/sign-in/email", { data: { email, password } })).ok()).toBe(true);
  expect((await viewer.request.get(`/api/wiki/presentations/${id}`)).status()).toBe(404);
  await page.request.post(`/api/wiki/presentations/${id}/studio`, { data: { action: "member", userId: user.id, role: "view" } });
  const document = await documentOf(viewer, id);
  expect(JSON.stringify(document)).not.toContain("PRIVATE_SPEAKER_NOTE");
  expect((await viewer.request.patch(`/api/wiki/presentations/${id}`, { data: { ...document, elements: [], sessionId: "forbidden-session", expectedUpdatedAt: document.updatedAt } })).status()).toBe(403);
  expect((await viewer.request.post(`/api/wiki/presentations/${id}/studio`, { data: { action: "comment", body: "Not yet allowed" } })).status()).toBe(403);
  expect((await viewer.request.post(`/api/wiki/presentations/${id}/studio`, { data: { action: "public", enabled: true } })).status()).toBe(403);
  await viewer.goto(`/wiki/presentations/${id}/present`);
  await expect(viewer.getByRole("button", { name: "Präsentationsansicht öffnen" })).toHaveCount(0);
  await page.request.post(`/api/wiki/presentations/${id}/studio`, { data: { action: "member", userId: user.id, role: "comment" } });
  await viewer.goto(`/wiki/presentations/${id}`);
  await expect(viewer.getByRole("button", { name: "Text", exact: true })).toBeDisabled();
  await viewer.locator('[data-testid="rf__node-a"]').click();
  await viewer.locator("summary").filter({ hasText: /^Kommentare$/ }).click();
  await viewer.getByRole("textbox", { name: "Neuer Kommentar" }).fill("Commenter feedback");
  await viewer.getByRole("button", { name: "Kommentar senden" }).click();
  await expect(viewer.getByText("Commenter feedback", { exact: true })).toBeVisible();
  const studio = await (await page.request.get(`/api/wiki/presentations/${id}/studio`)).json();
  expect(studio.comments[0].elementId).toBe("a");
  await page.request.post(`/api/wiki/presentations/${id}/studio`, { data: { action: "member", userId: user.id, role: "remove" } });
  expect((await viewer.request.get(`/api/wiki/presentations/${id}`)).status()).toBe(404);
  await viewerContext.close();
});

test("cropped images and uploaded audio play publicly and offline with scoped media access", async ({ page, browser }, info) => {
  await login(page); const id = await seed(page);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE1sAAAAASUVORK5CYII=", "base64");
  const upload = await page.request.post("/api/files", { multipart: { entityType: "wikiPresentation", entityId: id, file: { name: "Brand.png", mimeType: "image/png", buffer: png } } });
  expect(upload.ok()).toBe(true); const attachment = await upload.json();
  const source = await documentOf(page, id);
  const image = { id: "image", type: "image", x: 420, y: 250, width: 200, height: 180, rotation: 0, parentId: "frame", content: { attachmentId: attachment.id, alt: "Brand image" } };
  expect((await page.request.patch(`/api/wiki/presentations/${id}`, { data: { ...source, elements: [...source.elements, image], expectedUpdatedAt: source.updatedAt, sessionId: "studio-fixture-session" } })).ok()).toBe(true);
  await open(page, id);
  await page.getByRole("combobox", { name: "Objekt auswählen" }).selectOption("image");
  await page.getByRole("combobox", { name: "Bildmaske" }).selectOption("circle");
  await page.getByRole("combobox", { name: "Bildanpassung" }).selectOption("cover");
  const wave = Buffer.alloc(1644);
  wave.write("RIFF"); wave.writeUInt32LE(wave.length - 8, 4); wave.write("WAVEfmt ", 8); wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22); wave.writeUInt32LE(8000, 24); wave.writeUInt32LE(16000, 28); wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34); wave.write("data", 36); wave.writeUInt32LE(1600, 40);
  await page.getByLabel("Video oder Audio hochladen").setInputFiles({ name: "Voice.wav", mimeType: "audio/wav", buffer: wave });
  await expect(page.getByRole("textbox", { name: "Medientitel" })).toHaveValue("Voice.wav");
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  const saved = await documentOf(page, id); expect(saved.elements.find((element: { id: string }) => element.id === "image").content).toMatchObject({ mask: "circle", fit: "cover" });
  const audio = saved.elements.find((element: { type: string }) => element.type === "audio"); expect(audio).toBeTruthy();
  const spoofed = await page.request.post("/api/files", { multipart: { entityType: "wikiPresentation", entityId: id, file: { name: "fake.mp4", mimeType: "video/mp4", buffer: Buffer.from("<html>not a video</html>") } } });
  expect(spoofed.status()).toBe(400);
  const { token } = await (await page.request.post(`/api/wiki/presentations/${id}/studio`, { data: { action: "public", enabled: true } })).json();
  const anonymous = await browser.newContext({ baseURL: "http://localhost:3100" }); const viewer = await anonymous.newPage();
  expect((await viewer.request.get(`/api/files/${attachment.id}`)).status()).toBe(401);
  const partial = await viewer.request.get(`/share/presentations/${token}/media/${audio.content.attachmentId}`, { headers: { Range: "bytes=0-15" } });
  expect(partial.status()).toBe(206); expect((await partial.body()).length).toBe(16);
  await viewer.goto(`/share/presentations/${token}`);
  await expect.poll(() => viewer.locator("audio").evaluate((audio) => (audio as HTMLAudioElement).readyState)).toBeGreaterThan(0);
  await expect.poll(() => viewer.getByAltText("Brand image").evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBe(1);
  const html = await (await page.request.get(`/api/wiki/presentations/${id}/offline`)).text();
  expect(html).toContain("data:audio/wav;base64,"); expect(html).toContain("data:image/png;base64,");
  await viewer.goto("about:blank"); await anonymous.setOffline(true); await viewer.setContent(html);
  await expect.poll(() => viewer.locator("audio").evaluate((audio) => (audio as HTMLAudioElement).readyState)).toBeGreaterThan(0);
  await viewer.screenshot({ path: info.outputPath("offline-media.png") });
  await anonymous.close();
});
