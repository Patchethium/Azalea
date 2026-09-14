import { For, createSignal, onCleanup, onMount } from "solid-js";
import azaleaLogo from "../../../icon/azalea.png";
import { TuningPreview } from "./TuningPreview";

const repository = "https://github.com/Patchethium/Azalea";
const features = [
  {
    number: "01",
    icon: "i-lucide:sliders-horizontal",
    title: "Find your voice. Keep it.",
    text: "Give each voice its own speed, pitch, and expression. Save your favorite settings as presets and carry them between projects.",
  },
  {
    number: "02",
    icon: "i-lucide:audio-lines",
    title: "Shape the little details.",
    text: "Adjust accent, pitch, and timing, mora by mora. A spectrogram and speaker-specific pitch ranges help you see what you hear.",
  },
  {
    number: "03",
    icon: "i-lucide:feather",
    title: "A lighter place to create.",
    text: "Use compatible VOICEVOX assets you already have. Azalea focuses on speech, with a small desktop app and no bundled engine.",
  },
];

function ThemeToggle() {
  const [dark, setDark] = createSignal(false);
  onMount(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    let preference: string | null = null;
    try {
      preference = localStorage.getItem("azalea-site-theme");
    } catch {
      /* Storage may be unavailable. */
    }
    const apply = (value: boolean) => {
      setDark(value);
      document.documentElement.classList.toggle("dark", value);
    };
    apply(preference === "dark" || (preference !== "light" && query.matches));
    const followSystem = (event: MediaQueryListEvent) => {
      if (preference === null) apply(event.matches);
    };
    query.addEventListener("change", followSystem);
    onCleanup(() => query.removeEventListener("change", followSystem));
    setPreference = (value) => {
      preference = value ? "dark" : "light";
      apply(value);
    };
  });
  let setPreference = (value: boolean): void => {
    setDark(value);
  };
  const toggle = () => {
    const value = !dark();
    setPreference(value);
    try {
      localStorage.setItem("azalea-site-theme", value ? "dark" : "light");
    } catch {
      /* Keep the in-memory preference. */
    }
  };
  return (
    <button
      type="button"
      class="theme-toggle"
      onClick={toggle}
      aria-label={dark() ? "Use light theme" : "Use dark theme"}
      title={dark() ? "Use light theme" : "Use dark theme"}
    >
      <span
        class={dark() ? "i-lucide:sun size-5" : "i-lucide:moon size-5"}
        aria-hidden="true"
      />
    </button>
  );
}

export default function App() {
  return (
    <>
      <a class="skip-link" href="#main">
        Skip to content
      </a>
      <header class="site-header">
        <nav class="container navigation" aria-label="Main navigation">
          <a class="brand" href="#" aria-label="Azalea home">
            <img src={azaleaLogo} alt="" width="36" height="36" />
            <span>Azalea</span>
          </a>
          <div class="nav-links">
            <a href="#features">Features</a>
            <a href="#get-started">Get started</a>
            <a href={repository} class="nav-github">
              <span class="i-lucide:github size-4" aria-hidden="true" />
              GitHub
            </a>
          </div>
          <ThemeToggle />
        </nav>
      </header>
      <main id="main">
        <section class="hero container" aria-labelledby="hero-title">
          <div class="hero-copy">
            <div class="eyebrow">
              <span class="eyebrow-rule" /> A fresh voice for VOICEVOX
            </div>
            <h1 id="hero-title">
              Make every
              <br />
              word <span>your own.</span>
            </h1>
            <p class="hero-description">
              A lightweight desktop app for Japanese speech. Write a line, find
              its voice, and make the smallest details sound just right.
            </p>
            <div class="hero-actions">
              <a class="button button-primary" href="#download">
                <span class="i-lucide:download size-4" aria-hidden="true" />
                Download Azalea
              </a>
              <a class="button button-secondary" href={repository}>
                View source
                <span
                  class="i-lucide:arrow-up-right size-4"
                  aria-hidden="true"
                />
              </a>
            </div>
            <p class="hero-note">
              Free & open source <span aria-hidden="true">·</span> Windows,
              macOS & Linux
            </p>
          </div>
          <TuningPreview />
        </section>
        <section
          class="feature-section container"
          id="features"
          aria-labelledby="features-title"
        >
          <div class="section-intro">
            <span class="eyebrow">A workspace for expression</span>
            <h2 id="features-title">Your words. Your rhythm.</h2>
          </div>
          <div class="feature-grid">
            <For each={features}>
              {(feature) => (
                <article class="feature">
                  <div class="feature-top">
                    <span
                      class={`${feature.icon} size-6 text-primary-5`}
                      aria-hidden="true"
                    />
                    <span>{feature.number}</span>
                  </div>
                  <h3>{feature.title}</h3>
                  <p>{feature.text}</p>
                </article>
              )}
            </For>
          </div>
          <div class="details-row">
            <span>
              <span class="i-lucide:file-text size-4" aria-hidden="true" />
              SRT script import
            </span>
            <span>
              <span class="i-lucide:book-open size-4" aria-hidden="true" />
              Custom pronunciations
            </span>
            <span>
              <span class="i-lucide:languages size-4" aria-hidden="true" />
              English · 日本語 · 简体中文
            </span>
            <span>
              <span class="i-lucide:palette size-4" aria-hidden="true" />
              Your colors, light or dark
            </span>
          </div>
        </section>
        <section
          class="start-section container"
          id="get-started"
          aria-labelledby="start-title"
        >
          <div class="start-heading">
            <span class="eyebrow">From text to voice</span>
            <h2 id="start-title">
              A few steps.
              <br />A voice of your own.
            </h2>
            <p>
              Azalea is an independent interface for VOICEVOX. You’ll need
              compatible voice assets to start speaking.
            </p>
            <a class="text-link" href={`${repository}#setting-up-the-core`}>
              Read the setup guide
              <span class="i-lucide:arrow-up-right size-4" aria-hidden="true" />
            </a>
          </div>
          <ol class="steps">
            <li>
              <span class="step-number">1</span>
              <div>
                <h3>Make a little room.</h3>
                <p>
                  Download the Azalea build for your desktop and install it.
                </p>
              </div>
            </li>
            <li>
              <span class="step-number">2</span>
              <div>
                <h3>Bring your voices.</h3>
                <p>
                  Select a folder with a compatible VOICEVOX runtime, OpenJTalk
                  dictionary, and VVM voice models. Azalea finds the files
                  inside it.
                </p>
              </div>
            </li>
            <li>
              <span class="step-number">3</span>
              <div>
                <h3>Give your words some character.</h3>
                <p>
                  Write Japanese text, choose a speaker, tune the delivery, and
                  export your line as a WAV file.
                </p>
              </div>
            </li>
          </ol>
        </section>
        <section
          class="download-section container"
          id="download"
          aria-labelledby="download-title"
        >
          <div class="download-box">
            <div class="download-copy">
              <span class="eyebrow">Meet your next voice project</span>
              <h2 id="download-title">Start with a hello.</h2>
              <p>
                Azalea is actively developed. Try the latest public build and
                help shape what comes next.
              </p>
              <a
                class="button button-primary"
                href={`${repository}/releases/latest`}
              >
                Open latest release
                <span
                  class="i-lucide:arrow-up-right size-4"
                  aria-hidden="true"
                />
              </a>
            </div>
            <div class="platforms">
              <div>
                <span class="i-lucide:monitor size-5" aria-hidden="true" />
                <span>
                  <strong>Windows</strong>
                  <span>x64 · EXE / MSI</span>
                </span>
              </div>
              <div>
                <span class="i-lucide:laptop size-5" aria-hidden="true" />
                <span>
                  <strong>macOS</strong>
                  <span>Apple Silicon · DMG</span>
                </span>
              </div>
              <div>
                <span class="i-lucide:terminal size-5" aria-hidden="true" />
                <span>
                  <strong>Linux</strong>
                  <span>x64 · AppImage / DEB / RPM</span>
                </span>
              </div>
            </div>
          </div>
          <p class="download-note">
            Voice assets are downloaded separately. Follow the release notes for
            platform-specific installation instructions and each voice’s terms
            of use.
          </p>
        </section>
      </main>
      <footer class="container site-footer">
        <a class="brand" href="#">
          <img src={azaleaLogo} width="28" height="28" alt="" />
          <span>Azalea</span>
          <span class="brand-kana" lang="ja">
            アザレア
          </span>
        </a>
        <p>
          Made by <a href="https://github.com/Patchethium">Patchethium</a>.
          Powered by <a href="https://voicevox.hiroshiba.jp/">VOICEVOX</a>.
        </p>
        <div class="footer-links">
          <a href={`${repository}/blob/master/LICENSE`}>GPLv3 or later</a>
          <a href={`${repository}/issues`}>Feedback</a>
        </div>
      </footer>
    </>
  );
}
