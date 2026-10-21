// Drives the real Azalea window through tauri-driver and WebKitWebDriver.
//
//   pnpm e2e:build                 build the debug app with the embedded frontend
//   pnpm e2e start                 launch the app and keep a WebDriver session
//   pnpm e2e exec '<js>'           run JS with `browser`, `$`, `$$` and `type`
//   pnpm e2e shot [path.png]       save a screenshot of the window
//   pnpm e2e stop                  close the app and tauri-driver
//   pnpm e2e smoke                 start, check the main page renders, stop
//
// The session survives between commands in `logs/e2e-session.json`, so an
// interactive caller can issue one command at a time against a live window.
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { attach, remote } from "webdriverio";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOG_DIR = join(ROOT, "logs");
const SESSION_FILE = join(LOG_DIR, "e2e-session.json");
const DRIVER_LOG = join(LOG_DIR, "e2e-driver.log");
const DEFAULT_SHOT = join(LOG_DIR, "e2e-shot.png");
const PORT = Number(process.env.AZALEA_E2E_PORT ?? 4444);
const APPLICATION =
  process.env.AZALEA_E2E_APP ?? join(ROOT, "src-tauri/target/debug/azalea");

const capabilities = {
  "tauri:options": { application: APPLICATION },
};

/** The first editable text block appears once the main page has loaded. */
const MAIN_PAGE_SELECTOR = '[contenteditable="plaintext-only"][aria-label]';

interface SavedSession {
  sessionId: string;
  driverPid: number;
}

function readSession(): SavedSession {
  if (!existsSync(SESSION_FILE)) {
    throw new Error("No e2e session is running; run `pnpm e2e start` first.");
  }
  return JSON.parse(readFileSync(SESSION_FILE, "utf8")) as SavedSession;
}

async function driverReady(): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/status`);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitFor(
  check: () => Promise<boolean>,
  timeoutMs: number,
  what: string,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error(`Timed out waiting for ${what}.`);
}

function killDriver(pid: number) {
  try {
    // The driver runs in its own process group with WebKitWebDriver and the app.
    process.kill(-pid, "SIGTERM");
  } catch {
    // Already gone.
  }
}

async function start() {
  if (existsSync(SESSION_FILE)) {
    throw new Error(
      "An e2e session is already running; run `pnpm e2e stop` first.",
    );
  }
  if (!existsSync(APPLICATION)) {
    throw new Error(
      `${APPLICATION} does not exist; run \`pnpm e2e:build\` first.`,
    );
  }
  if (await driverReady()) {
    throw new Error(
      `Port ${PORT} is already in use by another WebDriver server.`,
    );
  }
  mkdirSync(LOG_DIR, { recursive: true });
  const log = openSync(DRIVER_LOG, "w");
  const driver = spawn("tauri-driver", ["--port", String(PORT)], {
    detached: true,
    stdio: ["ignore", log, log],
  });
  driver.unref();
  if (driver.pid === undefined)
    throw new Error("Failed to spawn tauri-driver.");
  const driverPid = driver.pid;

  try {
    await waitFor(driverReady, 10_000, "tauri-driver");
    const browser = await remote({
      hostname: "127.0.0.1",
      port: PORT,
      logLevel: "error",
      capabilities,
    });
    writeFileSync(
      SESSION_FILE,
      JSON.stringify({ sessionId: browser.sessionId, driverPid }),
    );
    await browser.$(MAIN_PAGE_SELECTOR).waitForExist({ timeout: 30_000 });
    console.log(`Session ${browser.sessionId} started.`);
  } catch (error) {
    killDriver(driverPid);
    rmSync(SESSION_FILE, { force: true });
    throw error;
  }
}

async function connect() {
  const { sessionId } = readSession();
  return attach({
    sessionId,
    options: { hostname: "127.0.0.1", port: PORT, logLevel: "error" },
    capabilities,
  });
}

type Browser = Awaited<ReturnType<typeof connect>>;

/**
 * Types into the focused element one key at a time. WebKitWebDriver drops
 * repeated characters sent by `browser.keys` ("Hello" arrives as "Helo"), so
 * each key is released and followed by a short pause.
 */
async function typeText(browser: Browser, text: string) {
  await browser.performActions([
    {
      type: "key",
      id: "keyboard",
      actions: [...text].flatMap((value) => [
        { type: "keyDown", value },
        { type: "keyUp", value },
        { type: "pause", duration: 30 },
      ]),
    },
  ]);
  await browser.releaseActions();
}

async function exec(code: string) {
  const browser = await connect();
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const run = new AsyncFunction("browser", "$", "$$", "type", code);
  const result = await run(
    browser,
    browser.$.bind(browser),
    browser.$$.bind(browser),
    (text: string) => typeText(browser, text),
  );
  if (result !== undefined) console.log(JSON.stringify(result, null, 2));
}

async function shot(path = DEFAULT_SHOT) {
  const browser = await connect();
  const target = resolve(path);
  mkdirSync(dirname(target), { recursive: true });
  await browser.saveScreenshot(target);
  console.log(target);
}

async function stop() {
  const session = readSession();
  try {
    const browser = await connect();
    await browser.deleteSession();
  } catch (error) {
    console.warn(`Could not close the session cleanly: ${String(error)}`);
  } finally {
    killDriver(session.driverPid);
    rmSync(SESSION_FILE, { force: true });
  }
  console.log("Session stopped.");
}

async function smoke() {
  await start();
  try {
    await shot();
  } finally {
    await stop();
  }
}

const [command, ...args] = process.argv.slice(2);
const commands: Record<string, () => Promise<void>> = {
  start,
  exec: () => exec(args.join(" ")),
  shot: () => shot(args[0]),
  stop,
  smoke,
};

const handler = command === undefined ? undefined : commands[command];
if (handler === undefined) {
  console.error(`Usage: pnpm e2e <${Object.keys(commands).join("|")}> [args]`);
  process.exit(2);
}
handler().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
