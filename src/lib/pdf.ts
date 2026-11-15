import { joinLines, tidy } from "./clean";
import type { LoadedDoc } from "./doc";

/** One visual line of text on a PDF page. */
export interface PdfLine {
  text: string;
  /** Baseline y in PDF units (grows upward). */
  y: number;
  /** Font height in PDF units. */
  height: number;
  /** Left edge x. */
  x: number;
}

const PAGE_NUMBER = /^(?:page\s*)?\d{1,4}(?:\s*(?:of|\/)\s*\d{1,4})?$/i;

function normalizeForRepeat(text: string): string {
  return text.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
}

/**
 * Turn per-page lines into paragraphs:
 * - drops page numbers and running headers/footers (lines repeated on many pages),
 * - starts a new paragraph on a large vertical gap, an indent, or a font-size change,
 * - joins wrapped lines and words hyphenated across lines.
 */
export function linesToParagraphs(pages: PdfLine[][]): string[] {
  pages = pages.map((page) => page.filter((l) => !PAGE_NUMBER.test(tidy(l.text))));

  // Running headers/footers: the same short text (ignoring digits) as the first
  // or last line of at least 40% of pages.
  const repeated = new Set<string>();
  if (pages.length >= 4) {
    const counts = new Map<string, number>();
    for (const page of pages) {
      const edges = new Set(
        [page[0], page[page.length - 1]]
          .filter((l): l is PdfLine => !!l && tidy(l.text).length <= 80)
          .map((l) => normalizeForRepeat(l.text)),
      );
      for (const key of edges) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const [key, n] of counts) if (key && n >= pages.length * 0.4) repeated.add(key);
  }

  const paragraphs: string[] = [];
  let current: string[] = [];
  const flush = () => {
    const p = joinLines(current);
    if (p) paragraphs.push(p);
    current = [];
  };

  for (const page of pages) {
    const lines = page.filter((l) => {
      const t = tidy(l.text);
      return t && !PAGE_NUMBER.test(t) && !repeated.has(normalizeForRepeat(t));
    });
    if (lines.length === 0) continue;

    const gaps: number[] = [];
    for (let i = 1; i < lines.length; i++) {
      const gap = lines[i - 1].y - lines[i].y;
      if (gap > 0) gaps.push(gap);
    }
    gaps.sort((a, b) => a - b);
    const typicalGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
    const xs = lines.map((l) => l.x).sort((a, b) => a - b);
    const leftEdge = xs[Math.floor(xs.length * 0.2)] ?? 0;

    lines.forEach((line, i) => {
      if (i > 0) {
        const prev = lines[i - 1];
        const gap = prev.y - line.y;
        const bigGap = typicalGap > 0 && gap > typicalGap * 1.45;
        const newColumn = gap < 0; // jumped back up the page
        const indented = line.x > leftEdge + line.height * 1.2 && prev.x <= leftEdge + 1;
        const sizeChange = Math.abs(line.height - prev.height) > Math.max(prev.height * 0.15, 0.5);
        const prevEndsShort = /[.!?:"”]$/.test(tidy(prev.text)) && tidy(prev.text).length < 50;
        if (bigGap || indented || sizeChange || (prevEndsShort && !newColumn)) flush();
      }
      current.push(line.text);
    });
    // A paragraph can continue onto the next page; only break if this page ended a sentence.
    const last = tidy(lines[lines.length - 1].text);
    if (/[.!?:"”]$/.test(last)) flush();
  }
  flush();
  return paragraphs;
}

interface TextItemLike {
  str: string;
  transform: number[];
  width?: number;
  height: number;
  hasEOL?: boolean;
}

/** Group pdf.js text items into visual lines. */
export function itemsToLines(items: TextItemLike[]): PdfLine[] {
  const lines: PdfLine[] = [];
  let cur: PdfLine | null = null;
  let endX = 0; // right edge of the last item on the current line, if known
  for (const item of items) {
    const x = item.transform[4];
    const y = item.transform[5];
    const height = Math.abs(item.height || item.transform[3]) || 10;
    if (cur && Math.abs(cur.y - y) <= height * 0.5) {
      // Items often split mid-word; only add a space when there's a visible gap.
      const gap = item.width !== undefined && endX ? x - endX : height;
      const needsSpace = cur.text && !/\s$/.test(cur.text) && item.str && !/^\s/.test(item.str) && gap > height * 0.15;
      cur.text += (needsSpace ? " " : "") + item.str;
      cur.height = Math.max(cur.height, height);
    } else {
      if (cur && tidy(cur.text)) lines.push(cur);
      cur = { text: item.str, y, height, x };
    }
    endX = item.width !== undefined ? x + item.width : 0;
    if (item.hasEOL && cur) {
      if (tidy(cur.text)) lines.push(cur);
      cur = null;
    }
  }
  if (cur && tidy(cur.text)) lines.push(cur);
  // Some generators emit a space item before a real one; collapse doubled spaces.
  for (const l of lines) l.text = l.text.replace(/\s{2,}/g, " ");
  return lines;
}

/** Load a PDF with pdf.js (lazy-loaded) and extract readable paragraphs. */
export async function parsePdf(
  data: ArrayBuffer,
  fallbackTitle: string,
  onProgress?: (page: number, total: number) => void,
): Promise<LoadedDoc> {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const pdf = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const pages: PdfLine[][] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    pages.push(itemsToLines(content.items.filter((i): i is TextItemLike & typeof i => "str" in i) as TextItemLike[]));
    page.cleanup();
    onProgress?.(n, pdf.numPages);
  }

  let title = fallbackTitle;
  try {
    const meta = await pdf.getMetadata();
    const t = (meta.info as { Title?: string } | undefined)?.Title?.trim();
    if (t && t.length > 2 && !/^untitled|^microsoft word/i.test(t)) title = t;
  } catch {
    // metadata is optional
  }
  await pdf.destroy();

  const paragraphs = linesToParagraphs(pages);
  if (paragraphs.length === 0) {
    throw new Error(
      "This PDF has no text layer. It's probably a scan, which Hark can't read yet (OCR is on the roadmap).",
    );
  }
  return { title, paragraphs };
}
