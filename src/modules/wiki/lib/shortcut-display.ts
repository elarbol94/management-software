/** Words that differ by locale. Arrow glyphs do not, so they stay in this module. */
export type ShortcutKeyLabels = { ctrl: string; delete: string };

/**
 * Renders a stored binding such as "Ctrl+Alt+ArrowUp" for display.
 *
 * The modifier words are passed in rather than hardcoded: this used to substitute "Strg"
 * and "Entf" unconditionally, so every shortcut hint in the app read German regardless of
 * the chosen locale. Lib files cannot reach next-intl, so the caller supplies them.
 */
export function displayShortcut(shortcut: string, labels: ShortcutKeyLabels) {
  return shortcut
    .replaceAll("Ctrl", labels.ctrl)
    .replaceAll("ArrowLeft", "←")
    .replaceAll("ArrowRight", "→")
    .replaceAll("ArrowUp", "↑")
    .replaceAll("ArrowDown", "↓")
    .replaceAll("Delete", labels.delete);
}
