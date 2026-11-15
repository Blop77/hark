export type WorkerRequest =
  | { type: "load" }
  | { type: "synth"; id: number; text: string; voice: string; speed: number };

export type WorkerResponse =
  | { type: "progress"; loaded: number; total: number }
  | { type: "ready"; device: "webgpu" | "wasm" }
  | { type: "audio"; id: number; samples: Float32Array; sampleRate: number }
  | { type: "error"; id: number; message: string };
