import { describe, expect, it } from "vitest";
import { joinLines, stripMarkdown, textToParagraphs, tidy } from "../src/lib/clean";

describe("tidy", () => {
  it("removes invisible characters and collapses spaces", () => {
    expect(tidy("  a­b​  c d ")).toBe("ab c d");
  });
});

describe("joinLines", () => {
  it("rejoins words hyphenated across lines", () => {
    expect(joinLines(["the infor-", "mation age"])).toBe("the information age");
  });
  it("keeps real hyphens before capitals", () => {
    expect(joinLines(["a well-", "Known case"])).toBe("a well- Known case");
  });
});

describe("textToParagraphs", () => {
  it("splits on blank lines", () => {
    expect(textToParagraphs("First para.\n\nSecond para.")).toEqual(["First para.", "Second para."]);
  });

  it("joins hard-wrapped lines", () => {
    const text =
      "It was the best of times, it was the worst of times, it was the age of\n" +
      "wisdom, it was the age of foolishness, it was the epoch of belief, it\n" +
      "was the epoch of incredulity.\n\nNext.";
    expect(textToParagraphs(text)).toEqual([
      "It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness, it was the epoch of belief, it was the epoch of incredulity.",
      "Next.",
    ]);
  });

  it("treats long single-newline lines from the web as paragraphs", () => {
    const a = "A".repeat(20) + " " + "word ".repeat(25).trim() + ".";
    const b = "Another paragraph that is also quite long, " + "word ".repeat(20).trim() + ".";
    expect(textToParagraphs(`${a}\n${b}`)).toEqual([a, b]);
  });

  it("keeps headings and list items separate", () => {
    expect(textToParagraphs("# Title\nIntro line that is fairly long and keeps on going past sixty chars.\n- one\n- two")).toEqual([
      "Title",
      "Intro line that is fairly long and keeps on going past sixty chars.",
      "• one",
      "• two",
    ]);
  });
});

describe("stripMarkdown", () => {
  it("drops markup but keeps link text", () => {
    expect(stripMarkdown("**Bold** and [a link](http://x) with `code`.")).toBe("Bold and a link with code.");
  });
});
