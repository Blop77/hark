import type { Sentence } from "../lib/segment";
import { estimateWordStarts, wordAtTime } from "../lib/timing";
import type { WorkerRequest, WorkerResponse } from "./protocol";
import type { Engine, VoiceOption } from "./types";

export interface Clip {
  samples: Float32Array;
  sampleRate: number;
}

export type KokoroStatus =
  | { state: "idle" }
  | { state: "loading"; loaded: number; total: number }
  | { state: "ready"; device: "webgpu" | "wasm" }
  | { state: "error"; message: string };

// Best-sounding voices first (grades from the Kokoro model card).
export const KOKORO_VOICES: VoiceOption[] = [
  { id: "af_heart", label: "Heart", note: "US ★", engine: "kokoro" },
  { id: "af_bella", label: "Bella", note: "US", engine: "kokoro" },
  { id: "af_nicole", label: "Nicole", note: "US · soft", engine: "kokoro" },
  { id: "am_michael", label: "Michael", note: "US", engine: "kokoro" },
  { id: "am_fenrir", label: "Fenrir", note: "US", engine: "kokoro" },
  { id: "am_puck", label: "Puck", note: "US", engine: "kokoro" },
  { id: "af_sarah", label: "Sarah", note: "US", engine: "kokoro" },
  { id: "af_aoede", label: "Aoede", note: "US", engine: "kokoro" },
  { id: "af_kore", label: "Kore", note: "US", engine: "kokoro" },
  { id: "bf_emma", label: "Emma", note: "UK", engine: "kokoro" },
  { id: "bf_isabella", label: "Isabella", note: "UK", engine: "kokoro" },
  { id: "bm_george", label: "George", note: "UK", engine: "kokoro" },
  { id: "bm_fable", label: "Fable", note: "UK", engine: "kokoro" },
];

const CACHE_LIMIT = 40;

export class KokoroEngine implements Engine {
  readonly kind = "kokoro" as const;
  status: KokoroStatus = { state: "idle" };
  onStatus: (s: KokoroStatus) => void = () => {};

  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (c: Clip) => void; reject: (e: Error) => void }>();
  private cache = new Map<string, Promise<Clip>>();
  private ctx: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private finish: (() => void) | null = null;
  private raf = 0;
  private stopped = false;

  private setStatus(s: KokoroStatus) {
    this.status = s;
    this.onStatus(s);
  }

  /** Start downloading the model (cached by the browser after the first time). */
  load() {
    if (this.worker) return;
    this.worker = new Worker(new URL("./kokoro.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.handle(e.data);
    this.worker.onerror = (e) => this.setStatus({ state: "error", message: e.message || "The voice engine crashed." });
    this.setStatus({ state: "loading", loaded: 0, total: 0 });
    this.post({ type: "load" });
  }

  private post(msg: WorkerRequest) {
    this.worker!.postMessage(msg);
  }

  private handle(msg: WorkerResponse) {
    switch (msg.type) {
      case "progress":
        if (this.status.state !== "ready") this.setStatus({ state: "loading", loaded: msg.loaded, total: msg.total });
        break;
      case "ready":
        this.setStatus({ state: "ready", device: msg.device });
        break;
      case "audio": {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        p?.resolve({ samples: msg.samples, sampleRate: msg.sampleRate });
        break;
      }
      case "error": {
        if (msg.id === -1) {
          this.setStatus({ state: "error", message: msg.message });
          for (const p of this.pending.values()) p.reject(new Error(msg.message));
          this.pending.clear();
          return;
        }
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        p?.reject(new Error(msg.message));
      }
    }
  }

  /** Generate audio for some text. Results are cached so re-plays are instant. */
  synth(text: string, voice: string, speed: number): Promise<Clip> {
    this.load();
    const key = `${voice}|${speed}|${text}`;
    const hit = this.cache.get(key);
    if (hit) {
      // Refresh recency.
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const id = this.nextId++;
    const promise = new Promise<Clip>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.post({ type: "synth", id, text, voice, speed });
    });
    promise.catch(() => this.cache.delete(key));
    this.cache.set(key, promise);
    while (this.cache.size > CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value!);
    return promise;
  }

  prefetch(sentences: Sentence[], voice: string, rate: number) {
    for (const s of sentences) void this.synth(s.text, voice, rate).catch(() => {});
  }

  /** Must be called from a user gesture at least once (autoplay rules). */
  private audio(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  async speak(sentence: Sentence, voice: string, rate: number, onWord: (word: number) => void): Promise<void> {
    this.stop();
    this.stopped = false;
    const ctx = this.audio();
    const clip = await this.synth(sentence.text, voice, rate);
    if (this.stopped) return;

    const buffer = ctx.createBuffer(1, clip.samples.length, clip.sampleRate);
    buffer.copyToChannel(clip.samples as Float32Array<ArrayBuffer>, 0);
    const starts = estimateWordStarts(sentence.words, buffer.duration);

    return new Promise((resolve) => {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      this.source = source;

      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        cancelAnimationFrame(this.raf);
        if (this.source === source) this.source = null;
        this.finish = null;
        resolve();
      };
      this.finish = done;
      source.onended = done;

      const startedAt = ctx.currentTime;
      let last = -1;
      const tick = () => {
        const w = wordAtTime(starts, ctx.currentTime - startedAt);
        if (w !== last) {
          last = w;
          onWord(w);
        }
        this.raf = requestAnimationFrame(tick);
      };
      source.start();
      tick();
    });
  }

  pause() {
    void this.ctx?.suspend();
  }

  resume() {
    void this.ctx?.resume();
  }

  stop() {
    this.stopped = true;
    const source = this.source;
    this.source = null;
    try {
      source?.stop();
    } catch {
      // already stopped
    }
    const finish = this.finish;
    this.finish = null;
    finish?.();
    if (this.ctx?.state === "suspended") void this.ctx.resume();
  }
}
