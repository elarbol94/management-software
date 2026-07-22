import { describe, expect, it } from "vitest";
import { canOpenSlashCommands, filterSlashCommands, type SlashCommandSearchItem } from "./slash-commands";

const commands: SlashCommandSearchItem[] = [
  { id: "paragraph", group: "text", label: "Text", description: "Normaler Absatz", keywords: ["paragraph", "absatz"] },
  { id: "attachment", group: "wiki", label: "Anhang hinzufügen", description: "Datei an diese Seite anhängen", keywords: ["anhänge", "datei", "upload"] },
  { id: "comment", group: "wiki", label: "Kommentar hinzufügen", description: "Seitenkommentar schreiben", keywords: ["kommentare", "discussion"] },
];

describe("filterSlashCommands", () => {
  it("finds commands by localized aliases while preserving command order", () => {
    expect(filterSlashCommands(commands, "DATEI").map((command) => command.id)).toEqual(["attachment"]);
    expect(filterSlashCommands(commands, "anhange").map((command) => command.id)).toEqual(["attachment"]);
    expect(filterSlashCommands(commands, "").map((command) => command.id)).toEqual(["paragraph", "attachment", "comment"]);
    expect(filterSlashCommands(commands, "not-a-command")).toEqual([]);
  });
});


describe("canOpenSlashCommands", () => {
  it("opens at a block boundary or after whitespace, but not mid-word, in links, or in code", () => {
    expect(canOpenSlashCommands({ textBeforeSlash: "", inCodeBlock: false, inLink: false })).toBe(true);
    expect(canOpenSlashCommands({ textBeforeSlash: "Some text ", inCodeBlock: false, inLink: false })).toBe(true);
    expect(canOpenSlashCommands({ textBeforeSlash: "https:/", inCodeBlock: false, inLink: false })).toBe(false);
    expect(canOpenSlashCommands({ textBeforeSlash: "word", inCodeBlock: false, inLink: false })).toBe(false);
    expect(canOpenSlashCommands({ textBeforeSlash: "", inCodeBlock: true, inLink: false })).toBe(false);
    expect(canOpenSlashCommands({ textBeforeSlash: "", inCodeBlock: false, inLink: true })).toBe(false);
  });
});
