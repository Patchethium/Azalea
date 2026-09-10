import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import UnoCSS from "unocss/vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  // Relative assets work at /Azalea/, on a custom domain, and in local preview.
  base: "./",
  plugins: [UnoCSS(), solid()],
  server: { port: 4321, strictPort: true },
  preview: { port: 4321, strictPort: true },
  build: { outDir: "dist", emptyOutDir: true },
});
