import { describe, expect, it } from "vitest";
import { buildSentences, chunkLong, splitSentences, splitWords, wordAtChar } from "../src/lib/segment";

describe("splitSentences", () => {
  it("splits on sentence punctuation", () => {
    expect(splitSentences("It was late. The rain had stopped! Was anyone awake?")).toEqual([
      "It was late.",
      "The rain had stopped!",
      "Was anyone awake?",
    ]);
  });

  it("does not split after common abbreviations", () => {
    expect(splitSentences("Dr. Smith met Mr. Jones at 5 p.m. on Main St. today. Then they left.")).toEqual([
      "Dr. Smith met Mr. Jones at 5 p.m. on Main St. today.",
      "Then they left.",
    ]);
  });

  it("keeps closing quotes with their sentence", () => {
    expect(splitSentences('"Stop," she said. "Now."')).toEqual(['"Stop," she said.', '"Now."']);
  });

  it("returns nothing for blank input", () => {
    expect(splitSentences("   ")).toEqual([]);
  });
});

describe("chunkLong", () => {
  it("leaves short sentences alone", () => {
    expect(chunkLong("Short.", 50)).toEqual(["Short."]);
  });

  it("breaks long sentences at clause punctuation, every chunk within the limit", () => {
    const s = "This sentence goes on, and on, and on for quite a while, because some authors love commas; it keeps going until the end.";
    const chunks = chunkLong(s, 50);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(50);
    expect(chunks.join(" ")).toBe(s);
  });

  it("falls back to spaces when there is no punctuation", () => {
    const s = Array(40).fill("word").join(" ");
    const chunks = chunkLong(s, 30);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(30);
    expect(chunks.join(" ")).toBe(s);
  });
});

describe("words", () => {
  it("records offsets", () => {
    expect(splitWords("Hi  there, you.")).toEqual([
      { text: "Hi", start: 0, end: 2 },
      { text: "there,", start: 4, end: 10 },
      { text: "you.", start: 11, end: 15 },
    ]);
  });

  it("maps character offsets to words", () => {
    const words = splitWords("one two three");
    expect(wordAtChar(words, 0)).toBe(0);
    expect(wordAtChar(words, 4)).toBe(1);
    expect(wordAtChar(words, 3)).toBe(1); // the space before "two"
    expect(wordAtChar(words, 99)).toBe(2);
  });
});

describe("buildSentences", () => {
  it("indexes sentences across paragraphs", () => {
    const s = buildSentences(["One. Two.", "Three."]);
    expect(s.map((x) => [x.index, x.paragraph, x.text])).toEqual([
      [0, 0, "One."],
      [1, 0, "Two."],
      [2, 1, "Three."],
    ]);
  });
});
