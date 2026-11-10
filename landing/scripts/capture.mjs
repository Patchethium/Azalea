// Takes the landing page's screenshots from the app's real frontend.
//
//   pnpm --filter azalea-landing capture
//
// Starts the app's Vite dev server from the repository root, loads the
// frontend in Chromium with `mockBackend.js` answering the Tauri IPC, and
// writes PNGs to `landing/public/screenshots/`. Rerun it after UI changes.
// Requires Playwright with Chromium (`pnpm dlx playwright install chromium`).
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const output = resolve(here, "../public/screenshots");
const PORT = 1430;
const SIZE = { width: 1200, height: 750 };

// `panel` shots are cropped to the bottom panel; the others show the window.
const shots = ["Light", "Dark"].flatMap((theme) => [
  { name: "editor", theme, tab: "Tuning" },
  { name: "accent-panel", theme, tab: "Accent", panel: true },
  { name: "tuning-panel", theme, tab: "Tuning", panel: true },
]);

mkdirSync(output, { recursive: true });
const server = await createServer({
  root,
  configFile: join(root, "vite.config.ts"),
  server: { port: PORT, strictPort: true },
  logLevel: "warn",
});
await server.listen();
const browser = await chromium.launch();

try {
  for (const shot of shots) {
    const dark = shot.theme === "Dark";
    const context = await browser.newContext({
      viewport: SIZE,
      deviceScaleFactor: 2,
      colorScheme: dark ? "dark" : "light",
    });
    await context.addInitScript(
      (options) => {
        window.__AZALEA_CAPTURE__ = options;
      },
      { ui: { theme_mode: shot.theme } },
    );
    await context.addInitScript({ path: join(here, "mockBackend.js") });
    const page = await context.newPage();
    page.on("pageerror", (error) => console.error(`[page] ${error.message}`));
    await page.goto(`http://localhost:${PORT}/`);
    await page.locator('[contenteditable="plaintext-only"]').nth(2).click();
    await page.getByRole("tab", { name: shot.tab }).click();
    // Let the spectrogram and slider transitions settle.
    await page.waitForTimeout(1500);
    const file = join(output, `${shot.name}-${shot.theme.toLowerCase()}.png`);
    // The bottom panel is the tab list's first ancestor spanning the editor.
    const clip = shot.panel
      ? await page.getByRole("tablist").evaluate((tabs) => {
          let panel = tabs;
          while (
            panel.parentElement &&
            panel.getBoundingClientRect().height < 200
          )
            panel = panel.parentElement;
          const { x, y, width, height } = panel.getBoundingClientRect();
          return { x, y, width, height };
        })
      : undefined;
    await page.screenshot({ path: file, clip });
    console.log(file, clip ? `${clip.width * 2}x${clip.height * 2}` : "");
    if (process.env.CAPTURE_DEBUG)
      console.log(
        await page.evaluate(() => [...new Set(window.__AZALEA_CALLS__)]),
      );
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}
