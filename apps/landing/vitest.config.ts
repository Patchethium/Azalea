import { defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  resolve: { conditions: ["development", "browser"] },
  test: {
    include: ["apps/landing/src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    restoreMocks: true,
  },
});
