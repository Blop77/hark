const TERMINAL = /[.!?:…"”’)\]]$/;

/** Collapse whitespace and strip invisible characters that confuse voices. */
export function tidy(text: string): string {
  return text
    .replace(/[­​-‍⁠﻿]/g, "") // soft hyphen, zero-width chars
    .replace(/[ \t ]+/g, " ")
    .trim();
}

/**
 * Join lines that were hard-wrapped, and fix words hyphenated across lines.
 * `lines` are the visual lines of one paragraph-ish block.
 */
export function joinLines(lines: string[]): string {
  let out = "";
  for (const raw of lines) {
    const line = tidy(raw);
    if (!line) continue;
    if (!out) {
      out = line;
    } else if (/[a-z]-$/.test(out) && /^[a-z]/.test(line)) {
      out = out.slice(0, -1) + line; // "infor-" + "mation"
    } else {
      out += " " + line;
    }
  }
  return out;
}

const LIST_ITEM = /^\s*(?:•|\d+[.)])\s/;

/**
 * Turn plain text (pasted or from a .txt/.md file) into paragraphs.
 *
 * Blank lines always separate paragraphs. For single newlines we guess:
 * - text hard-wrapped at ~70–80 columns has long middle lines and a short last
 *   line, so we join long lines and break after short ones (also catches headings);
 * - text pasted from the web has one very long line per paragraph, so a long line
 *   that ends a sentence is treated as a paragraph end;
 * - list items always stand alone.
 */
export function textToParagraphs(text: string): string[] {
  const blocks = text.replace(/\r\n?/g, "\n").split(/\n\s*\n/);
  const paragraphs: string[] = [];

  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((l) => l.replace(/^\s*#{1,6}\s+/, "").replace(/^\s*[-*•]\s+/, "• "));
    let current: string[] = [];
    lines.forEach((line, i) => {
      current.push(line);
      const t = tidy(line);
      const next = lines[i + 1];
      const endsHere =
        next === undefined ||
        LIST_ITEM.test(next) ||
        LIST_ITEM.test(line) ||
        t.length < 60 ||
        (t.length > 100 && TERMINAL.test(t));
      if (endsHere) {
        const p = joinLines(current);
        if (p) paragraphs.push(p);
        current = [];
      }
    });
  }
  return paragraphs;
}

/** Markdown → plain text, enough for reading aloud. */
export function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/^>\s?/gm, "")
    .replace(/^\s*[-*_]{3,}\s*$/gm, "");
}
