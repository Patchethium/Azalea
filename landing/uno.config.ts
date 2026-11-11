import { defineConfig } from "unocss";
import app from "../uno.config";

// The landing page shares the app's theme, shortcuts and presets, so it
// follows the Azalea design system instead of redefining it.
export default defineConfig({
  ...app,
  shortcuts: {
    ...app.shortcuts,
    container: "mx-auto w-full max-w-290 px-5 sm:px-8",
    "focus-outline":
      "outline-none focus-visible:(ring-2 ring-focus-ring ring-offset-2 ring-offset-canvas)",
    "button-base":
      "focus-outline inline-flex h-11 items-center justify-center gap-2 rounded-lg px-5 text-sm font-medium transition-colors duration-150",
    "button-primary":
      "button-base bg-accent text-on-accent hover:bg-accent-hover",
    "button-secondary":
      "button-base b b-border bg-surface text-ink hover:bg-hover",
    "icon-button":
      "focus-outline inline-flex size-9 items-center justify-center rounded-lg bg-transparent text-ink-muted transition-colors duration-150 hover:(bg-hover text-ink)",
    eyebrow: "text-xs font-semibold uppercase tracking-[0.18em] text-accent",
  },
});
