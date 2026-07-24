type JsonAttrs = Record<string, unknown>;
export type TiptapJsonNode = {
  type: string;
  attrs?: JsonAttrs;
  marks?: Array<{ type: string; attrs?: JsonAttrs }>;
  content?: TiptapJsonNode[];
  text?: string;
};

const emoji: Record<string, string> = {
  joy: "😂", smile: "😄", grin: "😁", wink: "😉", heart: "❤️", broken_heart: "💔",
  thumbsup: "👍", thumbsdown: "👎", clap: "👏", pray: "🙏", tada: "🎉", fire: "🔥",
  rocket: "🚀", eyes: "👀", thinking: "🤔", sob: "😭", angry: "😠",
  white_check_mark: "✅", warning: "⚠️", x: "❌",
};

function textNode(text: string, mark?: string, attrs?: JsonAttrs): TiptapJsonNode {
  return { type: "text", text, ...(mark ? { marks: [{ type: mark, ...(attrs ? { attrs } : {}) }] } : {}) };
}

export function parseMarkdownInline(input: string): TiptapJsonNode[] {
  const nodes: TiptapJsonNode[] = [];
  let rest = input;
  while (rest) {
    const patterns: Array<{
      regex: RegExp;
      build: (match: RegExpMatchArray) => TiptapJsonNode;
    }> = [
      { regex: /^\*\*([^*\n]+)\*\*/, build: (match) => textNode(match[1], "bold") },
      { regex: /^\*([^*\n]+)\*/, build: (match) => textNode(match[1], "italic") },
      { regex: /^~~([^~\n]+)~~/, build: (match) => textNode(match[1], "strike") },
      { regex: /^`([^`\n]+)`/, build: (match) => textNode(match[1], "code") },
      { regex: /^==([^=\n]+)==/, build: (match) => textNode(match[1], "highlight") },
      { regex: /^\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/, build: (match) => textNode(match[1], "link", { href: match[2], target: null, rel: "noopener noreferrer nofollow", class: null }) },
      { regex: /^\[\^([A-Za-z0-9_-]+)\]/, build: (match) => ({ type: "footnoteReference", attrs: { label: match[1] } }) },
      { regex: /^([^\s~])~([^~\n]+)~/, build: (match) => ({ type: "text", text: `${match[1]}${match[2]}`, marks: [{ type: "subscript", attrs: { offset: 1 } }] }) },
      { regex: /^([^\s^])\^([^^\n]+)\^/, build: (match) => ({ type: "text", text: `${match[1]}${match[2]}`, marks: [{ type: "superscript", attrs: { offset: 1 } }] }) },
      { regex: /^:([a-z0-9_+-]+):/i, build: (match) => textNode(emoji[match[1]] ?? match[0]) },
    ];
    const candidate = patterns.map((pattern) => ({ pattern, match: rest.match(pattern.regex) })).find((item) => item.match);
    if (candidate?.match) {
      const node = candidate.pattern.build(candidate.match);
      if (node.marks?.[0]?.attrs?.offset === 1 && node.text) {
        const first = node.text.slice(0, 1);
        const marked = node.text.slice(1);
        nodes.push(textNode(first), { ...node, text: marked, marks: node.marks.map((mark) => ({ type: mark.type })) });
      } else {
        nodes.push(node);
      }
      rest = rest.slice(candidate.match[0].length);
      continue;
    }
    const next = rest.slice(1).search(/[*~`=[\]^:]/);
    const length = next < 0 ? rest.length : next + 1;
    nodes.push(textNode(rest.slice(0, length)));
    rest = rest.slice(length);
  }
  return nodes;
}

function paragraph(text = ""): TiptapJsonNode {
  const content = parseMarkdownInline(text);
  return { type: "paragraph", ...(content.length ? { content } : {}) };
}

function tableCells(line: string) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;
  return trimmed.slice(1, -1).split("|").map((cell) => cell.trim());
}

function tableNode(lines: string[]): TiptapJsonNode | null {
  const rows = lines.map(tableCells);
  if (rows.some((row) => !row)) return null;
  const typed = rows as string[][];
  if (
    typed.length < 2 ||
    !typed[1].every((cell) => /^:?-{3,}:?$/.test(cell)) ||
    !typed.every((row) => row.length === typed[0].length)
  ) return null;
  const makeCell = (type: string, value: string): TiptapJsonNode => ({ type, content: [paragraph(value)] });
  return {
    type: "markdownTable",
    content: [
      { type: "markdownTableRow", content: typed[0].map((cell) => makeCell("markdownTableHeader", cell)) },
      ...(typed.slice(2).length ? typed.slice(2) : [typed[0].map(() => "")]).map((row) => ({
        type: "markdownTableRow",
        content: row.map((cell) => makeCell("markdownTableCell", cell)),
      })),
    ],
  };
}

export function looksLikeMarkdown(input: string) {
  const signals = [
    /^#{1,3}\s+/m, /^\s*>\s+/m, /^\s*(?:[-*]|\d+\.)\s+/m, /^\s*- \[[ xX]\]\s+/m,
    /^\s*```/m, /^\s*\|.+\|\s*$/m, /\*\*[^*\n]+\*\*/, /~~[^~\n]+~~/, /\[[^\]]+\]\(https?:\/\/[^)]+\)/,
    /^---\s*$/m, /^\[\^[\w-]+\]:\s+/m, /^:\s+\S+/m,
  ];
  return signals.filter((pattern) => pattern.test(input)).length >= 1;
}

export function parseMarkdownDocument(input: string, createNodeId = () => crypto.randomUUID()): TiptapJsonNode {
  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  const content: TiptapJsonNode[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (/^```/.test(line.trim())) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index].trim())) code.push(lines[index++]);
      if (index < lines.length) index += 1;
      content.push({ type: "codeBlock", attrs: { language: null }, content: code.length ? [textNode(code.join("\n"))] : undefined });
      continue;
    }
    const possibleTable: string[] = [];
    let cursor = index;
    while (cursor < lines.length && tableCells(lines[cursor])) possibleTable.push(lines[cursor++]);
    const table = tableNode(possibleTable);
    if (table) { content.push(table); index = cursor; continue; }
    const heading = line.match(/^(#{1,3})\s+(.+?)(?:\s+\{#([A-Za-z][\w-]*)\})?\s*$/);
    if (heading) {
      content.push({ type: "heading", attrs: { textAlign: null, level: heading[1].length, id: heading[3] ?? null }, content: parseMarkdownInline(heading[2]) });
      index += 1; continue;
    }
    if (/^---\s*$/.test(line)) { content.push({ type: "horizontalRule" }); index += 1; continue; }
    const image = line.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
    if (image) {
      content.push({ type: "commentableImage", attrs: { nodeId: createNodeId(), attachmentId: "", src: image[2], alt: image[1], caption: image[1] } });
      index += 1; continue;
    }
    const footnote = line.match(/^\[\^([A-Za-z0-9_-]+)\]:\s+(.+)$/);
    if (footnote) {
      content.push({ type: "footnoteDefinition", attrs: { label: footnote[1] }, content: parseMarkdownInline(footnote[2]) });
      index += 1; continue;
    }
    if (index + 1 < lines.length && /^:\s+/.test(lines[index + 1]) && line.trim()) {
      content.push({
        type: "definitionList",
        content: [
          { type: "definitionTerm", content: parseMarkdownInline(line.trim()) },
          { type: "definitionDescription", content: parseMarkdownInline(lines[index + 1].replace(/^:\s+/, "")) },
        ],
      });
      index += 2; continue;
    }
    const task = line.match(/^- \[([ xX])\]\s+(.+)$/);
    if (task) {
      const items: TiptapJsonNode[] = [];
      while (index < lines.length) {
        const match = lines[index].match(/^- \[([ xX])\]\s+(.+)$/);
        if (!match) break;
        items.push({ type: "taskItem", attrs: { checked: match[1].toLowerCase() === "x" }, content: [paragraph(match[2])] });
        index += 1;
      }
      content.push({ type: "taskList", content: items }); continue;
    }
    const list = line.match(/^([-*]|\d+\.)\s+(.+)$/);
    if (list) {
      const ordered = /\d+\./.test(list[1]);
      const items: TiptapJsonNode[] = [];
      while (index < lines.length) {
        const match = lines[index].match(ordered ? /^\d+\.\s+(.+)$/ : /^[-*]\s+(.+)$/);
        if (!match) break;
        items.push({ type: "listItem", content: [paragraph(match[1])] });
        index += 1;
      }
      content.push({ type: ordered ? "orderedList" : "bulletList", ...(ordered ? { attrs: { start: 1, type: null } } : {}), content: items });
      continue;
    }
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) { content.push({ type: "blockquote", content: [paragraph(quote[1])] }); index += 1; continue; }
    if (!line.trim()) { content.push(paragraph()); index += 1; continue; }
    const paragraphLines = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !looksLikeMarkdown(lines[index])) paragraphLines.push(lines[index++]);
    content.push(paragraph(paragraphLines.join("\n")));
  }
  return { type: "doc", content: content.length ? content : [paragraph()] };
}
