import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Multi-threaded Stockfish WASM needs cross-origin isolation (COOP/COEP).
// These headers enable it in `npm run dev`. Without them the engine falls back
// to single-threaded (works, just slower). For production on Cloudflare Pages,
// the same headers are set via public/_headers.
export default defineConfig({
  plugins: [react()],
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  // stockfish ships a worker + wasm; keep them out of dep pre-bundling.
  optimizeDeps: {
    exclude: ["stockfish"],
  },
});
