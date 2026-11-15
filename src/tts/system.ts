import { wordAtChar, type Sentence } from "../lib/segment";
import type { Engine, VoiceOption } from "./types";

export const systemSupported = typeof window !== "undefined" && "speechSynthesis" in window;

/** The voices built into the browser / OS. Instant, but quality varies a lot. */
export async function listSystemVoices(): Promise<VoiceOption[]> {
  if (!systemSupported) return [];
  const get = () => speechSynthesis.getVoices();
  let voices = get();
  if (voices.length === 0) {
    // Chrome loads voices asynchronously.
    voices = await new Promise<SpeechSynthesisVoice[]>((resolve) => {
      const done = () => resolve(get());
      speechSynthesis.addEventListener("voiceschanged", done, { once: true });
      setTimeout(done, 1500);
    });
  }
  const lang = navigator.language.slice(0, 2);
  // macOS ships joke voices ("Bubbles", "Zarvox") nobody wants to read a book with.
  const NOVELTY = /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Deranged|Fred|Good News|Hysterical|Jester|Junior|Kathy|Organ|Pipe Organ|Ralph|Superstar|Trinoids|Whisper|Wobble|Zarvox)\b/;
  const usable = voices.filter((v) => !NOVELTY.test(v.name));
  const mine = usable.filter((v) => v.lang.startsWith(lang));
  return (mine.length ? mine : usable)
    .slice()
    .sort((a, b) => {
      // User's language first, then "natural"/"premium" voices, then name.
      const score = (v: SpeechSynthesisVoice) =>
        (v.lang === navigator.language ? 0 : 2) +
        (/natural|premium|enhanced|neural|^(Samantha|Google)/i.test(v.name) ? 0 : 1);
      return score(a) - score(b) || a.name.localeCompare(b.name);
    })
    .map((v) => ({ id: v.voiceURI, label: v.name.replace(/\s*\(.*\)$/, ""), engine: "system" as const, note: v.lang }));
}

export class SystemEngine implements Engine {
  readonly kind = "system" as const;
  private finish: (() => void) | null = null;

  speak(sentence: Sentence, voice: string, rate: number, onWord: (word: number) => void): Promise<void> {
    this.stop();
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(sentence.text);
      const v = speechSynthesis.getVoices().find((x) => x.voiceURI === voice);
      if (v) {
        u.voice = v;
        u.lang = v.lang;
      }
      u.rate = rate;
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        this.finish = null;
        resolve();
      };
      this.finish = done;
      u.onboundary = (e) => {
        if (e.name === "word" || e.name === undefined) onWord(wordAtChar(sentence.words, e.charIndex));
      };
      u.onend = done;
      u.onerror = done;
      onWord(0);
      speechSynthesis.speak(u);
    });
  }

  pause() {
    speechSynthesis.pause();
  }

  resume() {
    speechSynthesis.resume();
  }

  stop() {
    const finish = this.finish;
    this.finish = null;
    speechSynthesis.cancel();
    finish?.();
  }
}
