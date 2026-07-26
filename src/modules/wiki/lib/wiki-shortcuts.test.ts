import { describe, expect, it } from "vitest";
import { DEFAULT_WIKI_SHORTCUT_BINDINGS, isReservedWikiShortcut, normalizeWikiShortcut, parseWikiShortcutBindings, wikiShortcutConflicts } from "./wiki-shortcuts";

describe("Wiki shortcuts", () => {
  it("normalizes Ctrl and Cmd combinations", () => {
    expect(normalizeWikiShortcut({ key: "f", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBe("Ctrl+F");
    expect(normalizeWikiShortcut({ key: "ArrowLeft", ctrlKey: false, metaKey: true, altKey: true, shiftKey: false })).toBe("Ctrl+Alt+ArrowLeft");
    expect(normalizeWikiShortcut({ key: "/", ctrlKey: true, metaKey: false, altKey: false, shiftKey: true })).toBe("Ctrl+/");
  });

  it("normalizes damaged bindings and detects collisions", () => {
    const bindings = parseWikiShortcutBindings({ bold: "Ctrl+K", redo: "F11" });
    expect(bindings.bold).toBe("Ctrl+K");
    expect(bindings.redo).toBe(DEFAULT_WIKI_SHORTCUT_BINDINGS.redo);
    expect(wikiShortcutConflicts(bindings, "externalLink", "Ctrl+K")).toBe("bold");
  });

  it("keeps defaults unique and reserves browser terminal keys", () => {
    expect(isReservedWikiShortcut("Ctrl+Tab")).toBe(true);
    expect(new Set(Object.values(DEFAULT_WIKI_SHORTCUT_BINDINGS)).size).toBe(Object.keys(DEFAULT_WIKI_SHORTCUT_BINDINGS).length);
  });
});
