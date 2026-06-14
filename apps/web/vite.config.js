import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const apiTarget = process.env.HOK_API_TARGET ?? "http://127.0.0.1:3001";
const projectPublicDir = fileURLToPath(new URL("../../public", import.meta.url));
// GitHub Pages serves under /<repo-name>/. Vercel/local serve under /.
// Set GITHUB_PAGES=1 in CI to switch base path.
const base = process.env.GITHUB_PAGES === "1" ? "/hok-five-stack-analytics/" : "/";

export default defineConfig({
  plugins: [react()],
  publicDir: projectPublicDir,
  base,
  server: {
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
