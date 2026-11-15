export interface LoadedDoc {
  title: string;
  paragraphs: string[];
}

/** Stable-ish id for remembering reading position per document. */
export function docId(doc: LoadedDoc): string {
  const sample = doc.title + "|" + doc.paragraphs.length + "|" + doc.paragraphs.slice(0, 3).join(" ").slice(0, 500);
  let h = 2166136261;
  for (let i = 0; i < sample.length; i++) {
    h ^= sample.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
