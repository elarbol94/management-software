import { createSpellcheckBatches, type ProofingLanguage, type SpellcheckParagraph } from "./spellcheck";

export type SpellcheckUnit = {
  text: string;
  paragraph: number;
  /** Target sentence range, relative to the original paragraph. */
  offset: number;
  end: number;
  contextOffset: number;
};

/** Complete neighboring sentences supply context; UTF-16 offsets stay intact. */
export function collectSpellcheckUnits(paragraphs: SpellcheckParagraph[], language: ProofingLanguage): SpellcheckUnit[] {
  const segmenter = new Intl.Segmenter(language, { granularity: "sentence" });
  return paragraphs.flatMap((paragraph, index) => {
    const sentences = [...segmenter.segment(paragraph.text)].flatMap(({ segment, index: offset }) =>
      createSpellcheckBatches([{ text: segment, from: 0, excludedRanges: [] }]).flatMap((batch) => batch.items)
        .map((item) => ({ offset: offset + item.offset, end: offset + item.offset + item.text.length })));
    return sentences.map((sentence, i) => {
      let from = sentence.offset, to = sentence.end;
      // Oversized sentences respect service limits. Never truncate a neighbor
      // just to fill the context budget.
      if (i > 0 && to - sentences[i - 1].offset <= 12_000) from = sentences[i - 1].offset;
      if (i + 1 < sentences.length && sentences[i + 1].end - from <= 12_000) to = sentences[i + 1].end;
      return { text: paragraph.text.slice(from, to), paragraph: index, offset: sentence.offset, end: sentence.end, contextOffset: from };
    });
  });
}
