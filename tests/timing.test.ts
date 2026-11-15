import { describe, expect, it } from "vitest";
import { splitWords } from "../src/lib/segment";
import { estimateSeconds, estimateWordStarts, formatDuration, wordAtTime } from "../src/lib/timing";

describe("estimateWordStarts", () => {
  it("returns increasing starts within the clip", () => {
    const words = splitWords("The quick brown fox, which was extraordinarily fast, jumped.");
    const starts = estimateWordStarts(words, 4);
    expect(starts).toHaveLength(words.length);
    for (let i = 1; i < starts.length; i++) expect(starts[i]).toBeGreaterThan(starts[i - 1]);
    expect(starts[0]).toBeGreaterThanOrEqual(0);
    expect(starts[starts.length - 1]).toBeLessThan(4);
  });

  it("gives long words more time than short ones", () => {
    const words = splitWords("a extraordinarily a");
    const s = estimateWordStarts(words, 3, 0, 0);
    expect(s[1] - s[0]).toBeLessThan(s[2] - s[1]);
  });

  it("handles empty input", () => {
    expect(estimateWordStarts([], 2)).toEqual([]);
  });
});

describe("wordAtTime", () => {
  it("finds the word playing at a time", () => {
    const starts = [0, 0.5, 1, 1.5];
    expect(wordAtTime(starts, -1)).toBe(0);
    expect(wordAtTime(starts, 0.7)).toBe(1);
    expect(wordAtTime(starts, 1)).toBe(2);
    expect(wordAtTime(starts, 9)).toBe(3);
    expect(wordAtTime([], 1)).toBe(-1);
  });
});

describe("durations", () => {
  it("estimates and formats listening time", () => {
    expect(estimateSeconds(165, 1)).toBe(60);
    expect(estimateSeconds(165, 2)).toBe(30);
    expect(formatDuration(20)).toBe("<1 min");
    expect(formatDuration(600)).toBe("10 min");
    expect(formatDuration(5400)).toBe("1 h 30 min");
  });
});
