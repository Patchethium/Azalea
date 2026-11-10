import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import UnoCss from "unocss/vite";

export default defineConfig({
  // Relative asset URLs, so the build works under any GitHub Pages path.
  base: "./",
  plugins: [UnoCss(), solid()],
  server: { port: 1440 },
});
