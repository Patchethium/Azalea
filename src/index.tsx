/* @refresh reload */
import "virtual:uno.css";
import "@unocss/reset/tailwind-compat.css";

const start = async () => {
  if (import.meta.env.VITE_E2E === "1") {
    await import("@wdio/tauri-plugin");
  }
  const { mountApp } = await import("./mountApp");
  mountApp();
};

void start();
