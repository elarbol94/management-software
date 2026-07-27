import { describe, expect, it } from "vitest";
import { DEFAULT_PDF_SHORTCUT_BINDINGS, isReservedPdfShortcut, normalizePdfShortcut, parsePdfShortcutBindings, shortcutConflicts } from "./pdf-shortcuts";

describe("PDF shortcuts", () => {
  it("normalizes Ctrl and Cmd combinations", () => {
    expect(normalizePdfShortcut({ key: "f", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBe("Ctrl+F");
    expect(normalizePdfShortcut({ key: "ArrowLeft", ctrlKey: false, metaKey: true, altKey: true, shiftKey: false })).toBe("Ctrl+Alt+ArrowLeft");
    expect(normalizePdfShortcut({ key: "+", ctrlKey: true, metaKey: false, altKey: false, shiftKey: true })).toBe("Ctrl++");
    expect(normalizePdfShortcut({ key: "/", ctrlKey: true, metaKey: false, altKey: false, shiftKey: true })).toBe("Ctrl+/");
    expect(normalizePdfShortcut({ key: "f", ctrlKey: true, metaKey: false, altKey: false, shiftKey: true })).toBe("Ctrl+Shift+F");
    expect(normalizePdfShortcut({ key: "Shift", ctrlKey: true, metaKey: false, altKey: false, shiftKey: true })).toBeNull();
  });

  it("fills missing bindings with defaults and detects collisions", () => {
    const bindings = parsePdfShortcutBindings({ search: "Ctrl+K" });
    expect(bindings.search).toBe("Ctrl+K");
    expect(bindings.printPdf).toBe(DEFAULT_PDF_SHORTCUT_BINDINGS.printPdf);
    expect(shortcutConflicts(bindings, "nextMatch", "Ctrl+K")).toBe("search");
  });

  it("rejects browser-reserved terminal keys", () => {
    expect(isReservedPdfShortcut("Ctrl+Tab")).toBe(true);
    expect(isReservedPdfShortcut("Ctrl+F")).toBe(false);
  });

  it("defines one unique binding for every fixed PDF command", () => {
    expect(DEFAULT_PDF_SHORTCUT_BINDINGS.createTask).toBe("Ctrl+Shift+A");
    expect(DEFAULT_PDF_SHORTCUT_BINDINGS.createDeadline).toBe("Ctrl+Shift+D");
    expect(Object.keys(DEFAULT_PDF_SHORTCUT_BINDINGS)).toHaveLength(36);
    expect(new Set(Object.values(DEFAULT_PDF_SHORTCUT_BINDINGS)).size).toBe(36);
  });
});
