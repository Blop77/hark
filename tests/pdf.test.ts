import { describe, expect, it } from "vitest";
import { itemsToLines, linesToParagraphs, type PdfLine } from "../src/lib/pdf";

const line = (text: string, y: number, x = 72, height = 12): PdfLine => ({ text, y, x, height });

describe("itemsToLines", () => {
  it("merges items on the same baseline and splits on EOL", () => {
    const items = [
      { str: "Hello", transform: [12, 0, 0, 12, 72, 700], height: 12 },
      { str: "world", transform: [12, 0, 0, 12, 110, 700], height: 12, hasEOL: true },
      { str: "Next line", transform: [12, 0, 0, 12, 72, 686], height: 12 },
    ];
    expect(itemsToLines(items).map((l) => l.text)).toEqual(["Hello world", "Next line"]);
  });
});

describe("linesToParagraphs", () => {
  it("joins wrapped lines and splits on big gaps", () => {
    const page = [
      line("The first paragraph wraps onto a", 700),
      line("second line here.", 686),
      line("A new paragraph after a gap that is", 650),
      line("also wrapped.", 636),
    ];
    expect(linesToParagraphs([page])).toEqual([
      "The first paragraph wraps onto a second line here.",
      "A new paragraph after a gap that is also wrapped.",
    ]);
  });

  it("drops page numbers and running headers", () => {
    const pages = [1, 2, 3, 4].map((n) => [
      line("My Great Book", 760, 72, 9),
      line(`Body text on page ${n} keeps going and going`, 700),
      line(`until ${["one", "two", "three", "four"][n - 1]} ends.`, 686),
      line(String(n), 40, 300, 9),
    ]);
    const paras = linesToParagraphs(pages);
    expect(paras.join(" ")).not.toMatch(/My Great Book/);
    expect(paras).toHaveLength(4);
    expect(paras[0]).toBe("Body text on page 1 keeps going and going until one ends.");
  });

  it("continues a paragraph across a page break mid-sentence", () => {
    const pages = [[line("This sentence starts on one page and", 100)], [line("finishes on the next.", 700)]];
    expect(linesToParagraphs(pages)).toEqual(["This sentence starts on one page and finishes on the next."]);
  });

  it("rejoins hyphenated words", () => {
    expect(linesToParagraphs([[line("an exam-", 700), line("ple of it.", 686)]])).toEqual(["an example of it."]);
  });
});

describe("itemsToLines spacing", () => {
  it("joins items split mid-word and spaces items with a visible gap", () => {
    const items = [
      { str: "whi", transform: [12, 0, 0, 12, 72, 700], width: 18, height: 12 },
      { str: "le", transform: [12, 0, 0, 12, 90, 700], width: 12, height: 12 },
      { str: "it", transform: [12, 0, 0, 12, 106, 700], width: 9, height: 12 },
    ];
    expect(itemsToLines(items)[0].text).toBe("while it");
  });
});
