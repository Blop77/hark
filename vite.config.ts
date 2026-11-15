import { defineConfig } from "vitest/config";

export default defineConfig({
  // Relative base so the build works on GitHub Pages under /<repo>/.
  base: "./",
  worker: { format: "es" },
  optimizeDeps: {
    // onnxruntime-web ships its own wasm loader; pre-bundling breaks it.
    exclude: ["kokoro-js", "@huggingface/transformers", "onnxruntime-web"],
  },
  build: { target: "es2022", chunkSizeWarningLimit: 3000 },
  test: { environment: "happy-dom", include: ["tests/**/*.test.ts"] },
});
