import type { Word } from "./segment";

/**
 * Estimate when each word starts inside a clip of `duration` seconds.
 *
 * Neural voices like Kokoro don't report word timestamps, so we spread the
 * clip's duration over the words, weighted by length, with extra weight for the
 * pauses that punctuation causes. It's not exact, but it keeps the highlight on
 * the right word or the one next to it, which is what read-along needs.
 */
export function estimateWordStarts(words: Word[], duration: number, leadIn = 0.08, tail = 0.12): number[] {
  if (words.length === 0) return [];
  const speech = Math.max(duration - leadIn - tail, duration * 0.5);
  const offset = (duration - speech) * (leadIn / (leadIn + tail || 1));

  const weights = words.map((w) => {
    const letters = w.text.replace(/[^\p{L}\p{N}]/gu, "").length;
    let weight = Math.max(letters, 1) + 1.5; // +1.5: every word has some onset cost
    if (/\d/.test(w.text)) weight += letters * 1.5; // numbers are spoken longer than they look
    if (/[,;:]$/.test(w.text)) weight += 3;
    else if (/[.!?…]["'”’)]*$/.test(w.text)) weight += 4;
    else if (/[—–]$/.test(w.text)) weight += 2;
    return weight;
  });

  const total = weights.reduce((a, b) => a + b, 0);
  const starts: number[] = [];
  let t = offset;
  for (const w of weights) {
    starts.push(t);
    t += (w / total) * speech;
  }
  return starts;
}

/** Index of the word playing at `time`, given start times. */
export function wordAtTime(starts: number[], time: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  if (hi < 0) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= time) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Rough listening time for text at a given speed, in seconds (~165 wpm at 1x). */
export function estimateSeconds(wordCount: number, rate: number): number {
  return (wordCount / 165) * 60 / rate;
}

export function formatDuration(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 1) return "<1 min";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}
