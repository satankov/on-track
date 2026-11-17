import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // The Markdown decoder's browser entry needs document.createElement.
    // Use its portable entry so dev and production can share it with a worker.
    alias: {
      "decode-named-character-reference": fileURLToPath(
        import.meta.resolve("decode-named-character-reference"),
      ),
    },
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: false,
  },
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": { target: "http://127.0.0.1:4173", changeOrigin: false },
    },
  },
});
