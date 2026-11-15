import type { Sentence } from "../lib/segment";

export interface VoiceOption {
  id: string;
  label: string;
  engine: "kokoro" | "system";
  /** Short note shown in the picker, e.g. "Best" or the browser voice's language. */
  note?: string;
}

/** Speaks one sentence at a time. The player decides what comes next. */
export interface Engine {
  readonly kind: "kokoro" | "system";
  /**
   * Speak a sentence. Resolves when it finishes or is stopped.
   * `onWord` is called with the index of the word being spoken.
   */
  speak(sentence: Sentence, voice: string, rate: number, onWord: (word: number) => void): Promise<void>;
  /** Warm up upcoming sentences so playback doesn't stall between them. */
  prefetch?(sentences: Sentence[], voice: string, rate: number): void;
  pause(): void;
  resume(): void;
  stop(): void;
}
