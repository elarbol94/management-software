import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export type WritingStats = { words: number; characters: number; selectedWords: number; readingMinutes: number };

function words(text: string) {
  return text.trim() ? text.trim().split(/\s+/u).length : 0;
}

export function calculateWritingStats(doc: ProseMirrorNode, selection?: { from: number; to: number }): WritingStats {
  const text = doc.textBetween(0, doc.content.size, " ", " ");
  const wordCount = words(text);
  const selected = selection && selection.from !== selection.to ? doc.textBetween(selection.from, selection.to, " ", " ") : "";
  return {
    words: wordCount,
    characters: text.length,
    selectedWords: words(selected),
    readingMinutes: wordCount ? Math.max(1, Math.ceil(wordCount / 200)) : 0,
  };
}
