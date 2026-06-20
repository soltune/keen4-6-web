import { defineConfig } from "vite";

// Serverless static build: everything ships as static assets so the game can be
// hosted on any static file host (GitHub Pages, etc.). Game data lives under
// public/data/<ck4|ck5|ck6>/ and is fetched at runtime.
export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    outDir: "dist",
    assetsInlineLimit: 0,
  },
  server: {
    host: true,
  },
  // AudioWorklet / WASM friendly headers for SharedArrayBuffer if needed later.
  // (Kept permissive for local dev; tighten per-host in production.)
});
