import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Deliberately NOT using @cloudflare/vite-plugin. It pulls in workerd, which
// publishes no win32-arm64 binary (only @cloudflare/workerd-windows-64), so on
// this project's primary dev machine `npm ci` dies with
// "Unsupported platform: win32 arm64 LE" and nothing installs at all. The
// plugin only buys local Worker emulation, which cannot run here anyway; the
// deploy itself is a plain static-asset upload that Cloudflare's own Linux
// build runners handle without it.

// Multi-threaded Stockfish WASM needs cross-origin isolation (COOP/COEP).
// These headers enable it in `npm run dev`. Without them the engine falls back
// to single-threaded (works, just slower). In production the same headers come
// from public/_headers.
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