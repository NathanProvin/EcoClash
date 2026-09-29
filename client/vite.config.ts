import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

// Cross-origin isolation, for SharedArrayBuffer (INSTRUCTIONS §14); the deployed site gets the
// same headers from public/_headers.
const isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    // Addons (MapControls) import "three"; point it at the WebGPU build so a single Three.js
    // instance is loaded (three.js docs, WebGPU + import maps).
    alias: [{ find: /^three$/, replacement: "three/webgpu" }],
  },
  server: { headers: isolation },
  preview: { headers: isolation },
  worker: { format: "es" }, // the sim worker is an ES module (sim-wasm's `--target web` glue)
  test: {
    environment: "node",
  },
});
