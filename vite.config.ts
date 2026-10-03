import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const path = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: "demo",
  base: "./",
  resolve: {
    alias: [{ find: /^@dietdev\/music$/, replacement: path("src/index.ts") }],
  },
  build: {
    outDir: "../dist-demo",
    emptyOutDir: true,
  },
});
