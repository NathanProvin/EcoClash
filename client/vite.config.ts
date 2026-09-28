import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    // Addons (MapControls) import "three"; point it at the WebGPU build so a single Three.js
    // instance is loaded (three.js docs, WebGPU + import maps).
    alias: [{ find: /^three$/, replacement: "three/webgpu" }],
  },
  test: {
    environment: "node",
  },
});
