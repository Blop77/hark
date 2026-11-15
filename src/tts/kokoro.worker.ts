/// <reference lib="webworker" />
// Runs the Kokoro model off the main thread so the page never freezes.
import { KokoroTTS } from "kokoro-js";
import type { WorkerRequest, WorkerResponse } from "./protocol";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

let tts: KokoroTTS | null = null;
let loading: Promise<KokoroTTS> | null = null;
let queue: Promise<unknown> = Promise.resolve();

const post = (msg: WorkerResponse, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

async function hasWebGPU(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return !!gpu && !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

async function load(): Promise<KokoroTTS> {
  if (tts) return tts;
  if (loading) return loading;
  loading = (async () => {
    const progress = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status === "progress" && p.file?.endsWith(".onnx") && p.total) {
        post({ type: "progress", loaded: p.loaded ?? 0, total: p.total });
      }
    };
    const attempts: Array<{ device: "webgpu" | "wasm"; dtype: "fp32" | "q8" }> = (await hasWebGPU())
      ? [{ device: "webgpu", dtype: "fp32" }, { device: "wasm", dtype: "q8" }]
      : [{ device: "wasm", dtype: "q8" }];

    let lastError: unknown;
    for (const opts of attempts) {
      try {
        const model = await KokoroTTS.from_pretrained(MODEL_ID, { ...opts, progress_callback: progress });
        // Run once so the first real sentence isn't slow (compiles GPU shaders etc).
        await model.generate("Ready.", { voice: "af_heart" });
        tts = model;
        post({ type: "ready", device: opts.device });
        return model;
      } catch (err) {
        lastError = err;
      }
    }
    loading = null;
    throw lastError;
  })();
  return loading;
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === "load") {
    load().catch((err) => post({ type: "error", id: -1, message: String(err?.message ?? err) }));
    return;
  }
  if (msg.type === "synth") {
    // One generation at a time; the model isn't re-entrant.
    queue = queue.then(async () => {
      try {
        const model = await load();
        const audio = await model.generate(msg.text, { voice: msg.voice as never, speed: msg.speed });
        const samples = audio.audio as Float32Array;
        post({ type: "audio", id: msg.id, samples, sampleRate: audio.sampling_rate }, [samples.buffer]);
      } catch (err) {
        post({ type: "error", id: msg.id, message: String((err as Error)?.message ?? err) });
      }
    });
  }
};
