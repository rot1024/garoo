import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// During local dev, run `wrangler dev` (Worker + API on :8787) alongside
// `npm run dev` (Vite on :5173); /api is proxied to the Worker so cookies and
// R2 media work end-to-end. `npm run build` outputs to dist/, which
// wrangler.toml serves as Static Assets (directory = "../web/dist").
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
