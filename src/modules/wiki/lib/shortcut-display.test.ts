import { describe, expect, it } from "vitest";
import { displayShortcut } from "./shortcut-display";

const de = { ctrl: "Strg", delete: "Entf" };
const en = { ctrl: "Ctrl", delete: "Del" };

describe("displayShortcut", () => {
  it("uses the locale's modifier words", () => {
    expect(displayShortcut("Ctrl+Delete", de)).toBe("Strg+Entf");
    expect(displayShortcut("Ctrl+Delete", en)).toBe("Ctrl+Del");
  });

  it("renders arrows as glyphs in every locale", () => {
    for (const labels of [de, en]) {
      expect(displayShortcut("Ctrl+Alt+ArrowUp", labels)).toContain("↑");
      expect(displayShortcut("Ctrl+ArrowLeft", labels)).toContain("←");
      expect(displayShortcut("Ctrl+Alt+ArrowDown", labels)).toContain("↓");
      expect(displayShortcut("Ctrl+ArrowRight", labels)).toContain("→");
    }
  });

  it("leaves other keys untouched", () => {
    expect(displayShortcut("Ctrl+Shift+F", en)).toBe("Ctrl+Shift+F");
    expect(displayShortcut("Shift+Tab", en)).toBe("Shift+Tab");
  });
});
