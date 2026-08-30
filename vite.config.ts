import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import UnoCss from "unocss/vite";

const host = process.env.TAURI_DEV_HOST;

const attachViteBase = (url: string) => fileURLToPath(new URL(url, import.meta.url));

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [UnoCss({}), solid()],
  resolve: {
    alias: {
      "$binding": attachViteBase("./src/binding.ts"),
      "$constants": attachViteBase("./src/constants.ts"),
      "$utils": attachViteBase("./src/utils.ts"),
      "@contexts": attachViteBase("./src/contexts"),
      "@dialogs": attachViteBase("./src/dialogs"),
      "@layout": attachViteBase("./src/layout"),
      "@components": attachViteBase("./src/components"),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
