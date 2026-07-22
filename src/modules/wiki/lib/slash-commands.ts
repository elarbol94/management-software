export type SlashCommandSearchItem = {
  id: string;
  group: string;
  label: string;
  description: string;
  keywords: string[];
};

export type SlashCommandContext = {
  textBeforeSlash: string;
  inCodeBlock: boolean;
  inLink: boolean;
};

export function canOpenSlashCommands({ textBeforeSlash, inCodeBlock, inLink }: SlashCommandContext) {
  if (inCodeBlock || inLink) return false;
  return textBeforeSlash.length === 0 || /\s$/.test(textBeforeSlash);
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .trim();
}

export function filterSlashCommands<T extends SlashCommandSearchItem>(commands: T[], query: string): T[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return commands;
  return commands.filter((command) =>
    normalizeSearchText([command.label, command.description, ...command.keywords].join(" ")).includes(normalizedQuery),
  );
}
