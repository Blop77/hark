import type { Sentence } from "./lib/segment";
import type { Engine } from "./tts/types";

export type PlayState = "stopped" | "playing" | "paused";

export interface PlayerEvents {
  onSentence(index: number): void;
  onWord(index: number, word: number): void;
  onState(state: PlayState): void;
  onError(error: Error): void;
}

/** Walks through sentences, handing each to the current voice engine. */
export class Player {
  sentences: Sentence[] = [];
  index = 0;
  state: PlayState = "stopped";

  private engine: Engine;
  private voice: string;
  private rate = 1;
  private run = 0; // bumps whenever playback restarts, so stale loops exit

  constructor(engine: Engine, voice: string, private events: PlayerEvents) {
    this.engine = engine;
    this.voice = voice;
  }

  load(sentences: Sentence[], start = 0) {
    this.stop();
    this.sentences = sentences;
    this.index = Math.min(Math.max(start, 0), Math.max(sentences.length - 1, 0));
    this.events.onSentence(this.index);
  }

  play() {
    if (!this.sentences.length) return;
    if (this.state === "paused") {
      this.engine.resume();
      this.setState("playing");
      return;
    }
    if (this.state === "playing") return;
    if (this.index >= this.sentences.length) this.index = 0;
    this.setState("playing");
    void this.loop(++this.run);
  }

  pause() {
    if (this.state !== "playing") return;
    this.engine.pause();
    this.setState("paused");
  }

  toggle() {
    if (this.state === "playing") this.pause();
    else this.play();
  }

  stop() {
    this.run++;
    this.engine.stop();
    this.setState("stopped");
  }

  /** Jump to a sentence; keeps playing if we were playing. */
  seek(index: number) {
    const wasActive = this.state !== "stopped";
    this.run++;
    this.engine.stop();
    this.index = Math.min(Math.max(index, 0), this.sentences.length - 1);
    this.events.onSentence(this.index);
    if (wasActive) {
      this.state = "stopped";
      this.play();
    }
  }

  next() {
    this.seek(this.index + 1);
  }

  prev() {
    this.seek(this.index - 1);
  }

  setVoice(engine: Engine, voice: string) {
    const restart = this.state !== "stopped";
    if (restart) this.stop();
    this.engine = engine;
    this.voice = voice;
    if (restart) this.play();
  }

  setRate(rate: number) {
    this.rate = rate;
    if (this.state !== "stopped") this.seek(this.index);
  }

  private setState(s: PlayState) {
    if (this.state === s) return;
    this.state = s;
    this.events.onState(s);
  }

  private async loop(run: number) {
    while (run === this.run && this.index < this.sentences.length) {
      const i = this.index;
      const sentence = this.sentences[i];
      this.events.onSentence(i);
      this.engine.prefetch?.(this.sentences.slice(i + 1, i + 3), this.voice, this.rate);
      try {
        await this.engine.speak(sentence, this.voice, this.rate, (w) => {
          if (run === this.run) this.events.onWord(i, w);
        });
      } catch (err) {
        if (run !== this.run) return;
        this.stop();
        this.events.onError(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      if (run !== this.run) return;
      this.index = i + 1;
    }
    if (run === this.run) {
      this.index = Math.max(this.sentences.length - 1, 0);
      this.setState("stopped");
    }
  }
}
