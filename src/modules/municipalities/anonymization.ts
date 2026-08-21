export type OcrWord = {
  id: number;
  text: string;
  line: string;
};

export type RedactionReason = "person_name" | "email" | "phone" | "sensitive_value";

export type RedactionMatch = {
  wordId: number;
  reasons: RedactionReason[];
};

const personalTitles = new Set([
  "herr", "frau", "hr", "fr", "dr", "mag", "dipl", "ing", "prof", "buergermeister", "bürgermeister",
  "buergermeisterin", "bürgermeisterin", "vizebuergermeister", "vizebürgermeister", "gemeinderat", "gemeinderätin",
  "gemeinderät", "obmann", "obfrau", "schriftfuehrer", "schriftführer", "schriftfuehrerin", "schriftführerin",
]);

const personalLabels = new Set([
  "name", "unterschrift", "anwesend", "entschuldigt", "teilnehmer", "teilnehmerinnen", "teilnehmerin",
  "auskunftsperson", "protokollfuehrer", "protokollführer", "protokollfuehrerin", "protokollführerin",
]);

const sensitiveLabels = new Set([
  "adresse", "anschrift", "telefon", "tel", "telefonnummer", "mobil", "e-mail", "email", "geburtsdatum",
  "iban", "kontonummer", "svnr", "sozialversicherungsnummer",
]);

function clean(value: string) {
  return value.replace(/^[^\p{L}\p{N}@+]+|[^\p{L}\p{N}@+]+$/gu, "");
}

function normalized(value: string) {
  return clean(value).toLocaleLowerCase("de-AT");
}

function isNamePart(value: string) {
  const token = clean(value);
  return /^(?:[A-ZÄÖÜ][a-zäöüß]+(?:[-'][A-ZÄÖÜ][a-zäöüß]+)*|[A-ZÄÖÜ]{2,})$/u.test(token);
}

function looksLikeEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(clean(value));
}

function looksLikePhone(value: string) {
  const token = clean(value);
  return /^(?:\+\d{1,3}|0\d{1,4})[\d/ -]{4,}$/u.test(token) || /^\d{6,}$/u.test(token.replace(/\D/g, ""));
}

/** Identifies high-confidence personal-data tokens in local OCR output. */
export function findRedactionMatches(words: OcrWord[]): RedactionMatch[] {
  const reasons = new Map<number, Set<RedactionReason>>();
  const mark = (word: OcrWord | undefined, reason: RedactionReason) => {
    if (!word) return;
    const current = reasons.get(word.id) ?? new Set<RedactionReason>();
    current.add(reason);
    reasons.set(word.id, current);
  };

  const lines = new Map<string, OcrWord[]>();
  for (const word of words) {
    const line = lines.get(word.line) ?? [];
    line.push(word);
    lines.set(word.line, line);
    if (looksLikeEmail(word.text)) mark(word, "email");
    if (looksLikePhone(word.text)) mark(word, "phone");
  }

  for (const line of lines.values()) {
    for (let index = 0; index < line.length; index += 1) {
      const token = normalized(line[index].text);
      if (personalTitles.has(token) || personalLabels.has(token)) {
        let selected = 0;
        for (let next = index + 1; next < line.length && selected < 4; next += 1) {
          if (!isNamePart(line[next].text)) {
            if (selected > 0) break;
            continue;
          }
          mark(line[next], "person_name");
          selected += 1;
        }
      }
      if (sensitiveLabels.has(token)) {
        for (let next = index + 1; next < Math.min(line.length, index + 7); next += 1) mark(line[next], "sensitive_value");
      }
    }

    for (let index = 0; index < line.length - 1; index += 1) {
      if (!isNamePart(line[index].text) || !isNamePart(line[index + 1].text)) continue;
      let end = index + 2;
      while (end < line.length && isNamePart(line[end].text) && end < index + 5) end += 1;
      for (let selected = index; selected < end; selected += 1) mark(line[selected], "person_name");
      index = end - 1;
    }
  }

  return [...reasons.entries()].map(([wordId, value]) => ({ wordId, reasons: [...value].sort() }));
}
