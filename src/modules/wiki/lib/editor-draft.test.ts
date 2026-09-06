import { afterEach, describe, expect, it, vi } from "vitest";
import { parseEditorDraft, readEditorStorage, sameEditorSnapshot, writeEditorStorage } from "./editor-draft";

const server = { contentJson: '{"type":"doc","content":[{"type":"paragraph"}]}', documentMode: false, documentSettingsJson: "{}" };
afterEach(() => vi.unstubAllGlobals());

describe("editor recovery", () => {
  it("recovers layout-only changes and retains their original content version", () => {
    const draft = { ...server, documentMode: true, baseContentVersion: 3 };
    expect(parseEditorDraft(JSON.stringify(draft), server)).toEqual(draft);
    expect(sameEditorSnapshot(draft, server)).toBe(false);
  });
  it("does not recover an already saved snapshot or damaged JSON", () => {
    expect(parseEditorDraft(JSON.stringify(server), server)).toBeNull();
    expect(parseEditorDraft("{broken", server)).toBeNull();
    expect(parseEditorDraft(JSON.stringify({ ...server, contentJson: "null" }), server)).toBeNull();
    expect(parseEditorDraft(JSON.stringify({ ...server, contentJson: '{"type":"doc","content":[null]}' }), server)).toBeNull();
  });
  it("treats a legacy draft as based on the first version, not the latest server version", () => {
    expect(parseEditorDraft(JSON.stringify({ ...server, documentMode: true }), server)?.baseContentVersion).toBe(1);
  });
  it("survives denied storage and a full quota", () => {
    vi.stubGlobal("window", { get localStorage() { throw new Error("denied"); } });
    expect(readEditorStorage("draft")).toBeNull();
    expect(writeEditorStorage("draft", "text")).toBe(false);
    vi.stubGlobal("window", { localStorage: { setItem() { throw new Error("quota"); } } });
    expect(writeEditorStorage("draft", "text")).toBe(false);
  });
});
