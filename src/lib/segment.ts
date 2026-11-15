/** A word inside a sentence; offsets are relative to the sentence text. */
export interface Word {
  text: string;
  start: number;
  end: number;
}

export interface Sentence {
  /** Index in the document's flat sentence list. */
  index: number;
  /** Paragraph this sentence belongs to. */
  paragraph: number;
  text: string;
  words: Word[];
}

/** Longest chunk we hand to a voice in one go. Kokoro truncates long inputs. */
export const MAX_SENTENCE_CHARS = 280;

const sentenceSegmenter: Intl.Segmenter | null =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter("en", { granularity: "sentence" })
    : null;

// Abbreviations that Intl.Segmenter sometimes splits after.
const ABBREVIATIONS = /\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|Mt|vs|etc|e\.g|i\.e|Fig|No|Vol|pp|Inc|Ltd|Co)\.$/i;

/** Split a paragraph into sentences. */
export function splitSentences(paragraph: string): string[] {
  const text = paragraph.trim();
  if (!text) return [];

  let parts: string[];
  if (sentenceSegmenter) {
    parts = Array.from(sentenceSegmenter.segment(text), (s) => s.segment);
  } else {
    parts = text.match(/[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)\s*/g) ?? [text];
  }

  // Re-join pieces that were split right after a common abbreviation.
  const merged: string[] = [];
  for (const part of parts) {
    const prev = merged[merged.length - 1];
    if (prev !== undefined && ABBREVIATIONS.test(prev.trimEnd())) {
      merged[merged.length - 1] = prev + part;
    } else {
      merged.push(part);
    }
  }

  return merged.map((s) => s.trim()).filter(Boolean).flatMap((s) => chunkLong(s));
}

/** Break a sentence longer than `max` at clause punctuation, then at spaces. */
export function chunkLong(sentence: string, max = MAX_SENTENCE_CHARS): string[] {
  if (sentence.length <= max) return [sentence];

  const out: string[] = [];
  let rest = sentence;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = -1;
    // Prefer the last clause break in the second half of the window.
    for (const m of window.matchAll(/[,;:—–)]\s/g)) {
      if (m.index! > max * 0.4) cut = m.index! + 1;
    }
    if (cut === -1) cut = window.lastIndexOf(" ");
    if (cut <= 0) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** Find word spans in a sentence. */
export function splitWords(sentence: string): Word[] {
  const words: Word[] = [];
  for (const m of sentence.matchAll(/\S+/g)) {
    words.push({ text: m[0], start: m.index!, end: m.index! + m[0].length });
  }
  return words;
}

/** Turn a list of paragraphs into the flat, indexed sentence list the player uses. */
export function buildSentences(paragraphs: string[]): Sentence[] {
  const sentences: Sentence[] = [];
  paragraphs.forEach((para, p) => {
    for (const text of splitSentences(para)) {
      sentences.push({ index: sentences.length, paragraph: p, text, words: splitWords(text) });
    }
  });
  return sentences;
}

/** Index of the word containing (or starting after) a character offset. */
export function wordAtChar(words: Word[], charIndex: number): number {
  for (let i = 0; i < words.length; i++) {
    if (charIndex < words[i].end) return i;
  }
  return words.length - 1;
}
