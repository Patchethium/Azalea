import { DropdownMenu } from "@kobalte/core/dropdown-menu";
import { createEffect, createSignal, For, onCleanup, onMount } from "solid-js";
import logo from "../../icon/azalea.png";
import {
  type Locale,
  locale,
  localeNames,
  locales,
  setLocale,
  t,
} from "./i18n";
import { startScrollEffects } from "./scroll";
import type { WaveFieldOptions } from "./waveField";

const REPOSITORY = "https://github.com/Patchethium/Azalea";
const RELEASES = `${REPOSITORY}/releases/latest`;
const GUIDE = `${REPOSITORY}#quickstart`;
const shot = (name: string, theme: "light" | "dark") =>
  `${import.meta.env.BASE_URL}screenshots/${name}-${theme}.png`;

const featureIcons = [
  "i-lucide-package-check",
  "i-lucide-layers",
  "i-lucide-dices",
  "i-lucide-pencil-line",
  "i-lucide-zap",
  "i-lucide-plug",
];

/** An app screenshot in both themes; only the one matching the page shows. */
function Screenshot(props: {
  name: string;
  alt: string;
  width: number;
  height: number;
  eager?: boolean;
}) {
  return (
    <For each={["light", "dark"] as const}>
      {(theme) => (
        <img
          class={`shot-${theme} block h-auto w-full`}
          src={shot(props.name, theme)}
          alt={props.alt}
          width={props.width}
          height={props.height}
          loading={props.eager ? "eager" : "lazy"}
          decoding="async"
        />
      )}
    </For>
  );
}

/**
 * A decorative three.js wave field behind its section. The scene loads after
 * the page, so three.js stays out of the first paint.
 */
function WaveField(props: { class?: string; options?: WaveFieldOptions }) {
  let canvas!: HTMLCanvasElement;
  onMount(() => {
    let disposed = false;
    let stop: (() => void) | null = null;
    void import("./waveField").then(({ startWaveField }) => {
      if (disposed) return;
      stop = startWaveField(canvas, props.options);
      if (stop) canvas.classList.add("is-ready");
    });
    onCleanup(() => {
      disposed = true;
      stop?.();
    });
  });
  return (
    <canvas
      ref={canvas}
      class={`wave-field pointer-events-none absolute ${props.class ?? ""}`}
      aria-hidden="true"
    />
  );
}

function LanguageSelect() {
  return (
    <DropdownMenu gutter={8} placement="bottom-end">
      <DropdownMenu.Trigger
        class="focus-outline inline-flex h-9 items-center gap-1.5 rounded-lg bg-transparent px-2.5 text-sm text-ink-muted transition-colors duration-150 hover:(bg-hover text-ink)"
        aria-label={t().nav.language}
      >
        <span class="i-lucide-languages size-4" aria-hidden="true" />
        <span>{localeNames[locale()]}</span>
        <span class="i-lucide-chevron-down size-3.5" aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="menu-panel z-popover text-sm text-ink">
          <DropdownMenu.RadioGroup
            value={locale()}
            onChange={(value) => setLocale(value as Locale)}
          >
            <For each={locales}>
              {(option) => (
                <DropdownMenu.RadioItem
                  class="menu-item"
                  value={option}
                  lang={option}
                >
                  {localeNames[option]}
                  <DropdownMenu.ItemIndicator
                    class="i-lucide-check size-4"
                    aria-hidden="true"
                  />
                </DropdownMenu.RadioItem>
              )}
            </For>
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  );
}

function ThemeToggle() {
  const [dark, setDark] = createSignal(
    document.documentElement.classList.contains("dark"),
  );
  const toggle = () => {
    const next = !dark();
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("azalea-theme", next ? "dark" : "light");
    } catch {
      // Storage can be unavailable; the choice then lasts for this visit.
    }
  };
  return (
    <button
      type="button"
      class="icon-button"
      aria-label={t().nav.theme}
      aria-pressed={dark()}
      onClick={toggle}
    >
      <span
        class={`size-4.5 ${dark() ? "i-lucide-sun" : "i-lucide-moon"}`}
        aria-hidden="true"
      />
    </button>
  );
}

function SectionHeading(props: { eyebrow: string; title: string }) {
  return (
    <div data-reveal>
      <p class="eyebrow">{props.eyebrow}</p>
      <h2 class="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
        {props.title}
      </h2>
    </div>
  );
}

function App() {
  let heroFrame!: HTMLDivElement;

  createEffect(() => {
    document.documentElement.lang = locale();
  });
  onMount(() => onCleanup(startScrollEffects(heroFrame)));

  return (
    <>
      <header class="nav-surface fixed inset-x-0 top-0 z-overlay b-b b-border">
        <nav class="container flex h-14 items-center gap-1">
          <a
            href="#top"
            class="focus-outline mr-auto flex items-center gap-2.5 rounded-lg font-semibold tracking-tight"
          >
            <img
              src={logo}
              alt=""
              width="28"
              height="28"
              class="size-7 rounded-md b b-border"
            />
            Azalea
          </a>
          <div class="mr-2 hidden items-center gap-6 text-sm text-ink-muted md:flex">
            <a class="focus-outline rounded hover:text-ink" href="#features">
              {t().nav.features}
            </a>
            <a class="focus-outline rounded hover:text-ink" href="#tuning">
              {t().nav.tuning}
            </a>
            <a class="focus-outline rounded hover:text-ink" href="#start">
              {t().nav.start}
            </a>
          </div>
          <LanguageSelect />
          <ThemeToggle />
          <a class="icon-button" href={REPOSITORY} aria-label={t().nav.github}>
            <span class="i-lucide-github size-4.5" aria-hidden="true" />
          </a>
        </nav>
      </header>

      <main id="top">
        <section class="relative overflow-hidden pt-32 sm:pt-40">
          <div
            class="canvas-dots pointer-events-none absolute inset-0"
            aria-hidden="true"
          />
          <WaveField class="hero-waves inset-x-0 top-40 h-[52rem] w-full" />
          <div class="container relative text-center">
            <p
              data-reveal
              class="mx-auto inline-flex items-center gap-2 rounded-full b b-border bg-surface px-3.5 py-1 text-xs text-ink-muted"
            >
              <span
                class="size-1.5 rounded-full bg-accent"
                aria-hidden="true"
              />
              {t().hero.badge}
            </p>
            <h1
              data-reveal
              style={{ "--reveal-delay": "80ms" }}
              class="mx-auto mt-7 max-w-4xl text-balance text-[2.6rem] font-semibold leading-[1.08] tracking-[-0.035em] sm:text-6xl lg:text-7xl"
            >
              {t().hero.title[0]}
              <br />
              <span class="text-accent">{t().hero.title[1]}</span>
            </h1>
            <p
              data-reveal
              style={{ "--reveal-delay": "160ms" }}
              class="mx-auto mt-6 max-w-2xl text-pretty text-base leading-relaxed text-ink-muted sm:text-lg"
            >
              {t().hero.lead}
            </p>
            <div
              data-reveal
              style={{ "--reveal-delay": "240ms" }}
              class="mt-9 flex flex-wrap items-center justify-center gap-3"
            >
              <a class="button-primary" href={RELEASES}>
                <span class="i-lucide-download size-4" aria-hidden="true" />
                {t().hero.download}
              </a>
              <a class="button-secondary" href={REPOSITORY}>
                <span class="i-lucide-github size-4" aria-hidden="true" />
                {t().hero.source}
              </a>
            </div>
            <p
              data-reveal
              style={{ "--reveal-delay": "320ms" }}
              class="mt-5 text-xs text-ink-subtle"
            >
              {t().hero.platforms}
            </p>
          </div>

          <div class="container hero-stage relative mt-14 pb-24 sm:mt-20 sm:pb-32">
            <div
              class="hero-glow pointer-events-none absolute inset-x-0 -top-10 mx-auto h-130 max-w-4xl"
              aria-hidden="true"
            />
            <div
              ref={heroFrame}
              class="hero-frame relative overflow-hidden rounded-xl b b-border bg-surface"
            >
              <Screenshot
                name="editor"
                alt={t().hero.shot}
                width={2400}
                height={1500}
                eager
              />
            </div>
          </div>
        </section>

        <section
          id="features"
          class="scroll-mt-14 b-t b-border bg-surface py-24 sm:py-32"
        >
          <div class="container">
            <SectionHeading
              eyebrow={t().features.eyebrow}
              title={t().features.title}
            />
            <ul class="mt-14 grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
              <For each={t().features.items}>
                {(item, index) => (
                  <li
                    data-reveal
                    style={{ "--reveal-delay": `${(index() % 3) * 80}ms` }}
                  >
                    <span
                      class="flex size-10 items-center justify-center rounded-lg bg-primary-50 text-accent dark:bg-canvas"
                      aria-hidden="true"
                    >
                      <span class={`size-5 ${featureIcons[index()]}`} />
                    </span>
                    <h3 class="mt-5 font-semibold tracking-tight">
                      {item.title}
                    </h3>
                    <p class="mt-2 text-sm leading-relaxed text-ink-muted">
                      {item.body}
                    </p>
                  </li>
                )}
              </For>
            </ul>
          </div>
        </section>

        <section id="tuning" class="scroll-mt-14 b-t b-border py-24 sm:py-32">
          <div class="container grid items-center gap-14 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <div>
              <SectionHeading
                eyebrow={t().tuning.eyebrow}
                title={t().tuning.title}
              />
              <p data-reveal class="mt-5 leading-relaxed text-ink-muted">
                {t().tuning.lead}
              </p>
              <ul class="mt-7 space-y-3.5 text-sm">
                <For each={t().tuning.points}>
                  {(point, index) => (
                    <li
                      data-reveal
                      style={{ "--reveal-delay": `${index() * 80}ms` }}
                      class="flex items-start gap-3"
                    >
                      <span
                        class="i-lucide-check mt-0.5 size-4 shrink-0 text-accent"
                        aria-hidden="true"
                      />
                      {point}
                    </li>
                  )}
                </For>
              </ul>
            </div>
            <div class="space-y-5">
              <For each={["accent-panel", "tuning-panel"]}>
                {(name, index) => (
                  <div
                    data-reveal
                    style={{ "--reveal-delay": `${index() * 120}ms` }}
                    class="frame-shadow overflow-hidden rounded-xl b b-border bg-surface"
                  >
                    <Screenshot
                      name={name}
                      alt={t().tuning.shots[index()]}
                      width={1970}
                      height={605}
                    />
                  </div>
                )}
              </For>
            </div>
          </div>
        </section>

        <section
          id="start"
          class="scroll-mt-14 b-t b-border bg-surface py-24 sm:py-32"
        >
          <div class="container">
            <SectionHeading
              eyebrow={t().start.eyebrow}
              title={t().start.title}
            />
            <ol class="mt-14 grid gap-10 md:grid-cols-3">
              <For each={t().start.steps}>
                {(step, index) => (
                  <li
                    data-reveal
                    style={{ "--reveal-delay": `${index() * 80}ms` }}
                    class="b-t b-border pt-6"
                  >
                    <span class="text-sm font-semibold tabular-nums text-accent">
                      {String(index() + 1).padStart(2, "0")}
                    </span>
                    <h3 class="mt-3 font-semibold tracking-tight">
                      {step.title}
                    </h3>
                    <p class="mt-2 text-sm leading-relaxed text-ink-muted">
                      {step.body}
                    </p>
                  </li>
                )}
              </For>
            </ol>
            <div data-reveal class="mt-12 flex flex-wrap gap-3">
              <a class="button-primary" href={RELEASES}>
                <span class="i-lucide-download size-4" aria-hidden="true" />
                {t().start.download}
              </a>
              <a class="button-secondary" href={GUIDE}>
                {t().start.guide}
                <span
                  class="i-lucide-arrow-up-right size-4"
                  aria-hidden="true"
                />
              </a>
            </div>
          </div>
        </section>

        <section class="relative overflow-hidden b-t b-border py-28 text-center sm:py-40">
          <WaveField
            class="inset-0 size-full"
            options={{ lines: 44, amplitude: 1.25, cameraHeight: 1.5 }}
          />
          <div class="container relative">
            <h2
              data-reveal
              class="mx-auto max-w-3xl text-balance text-4xl font-semibold leading-tight tracking-[-0.03em] sm:text-6xl"
            >
              {t().closing.title}
            </h2>
            <div data-reveal class="mt-10 flex justify-center">
              <a class="button-primary" href={RELEASES}>
                <span class="i-lucide-download size-4" aria-hidden="true" />
                {t().hero.download}
              </a>
            </div>
            <p data-reveal class="mt-5 text-xs text-ink-subtle">
              {t().hero.platforms}
            </p>
          </div>
        </section>
      </main>

      <footer class="b-t b-border py-10 text-xs leading-relaxed text-ink-subtle">
        <div class="container flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div class="max-w-xl space-y-1">
            <p>{t().footer.disclaimer}</p>
            <p>{t().footer.screenshots}</p>
          </div>
          <div class="flex items-center gap-4">
            <a
              class="focus-outline rounded hover:text-ink"
              href={`${REPOSITORY}/blob/master/LICENSE`}
            >
              {t().footer.license}
            </a>
            <a class="focus-outline rounded hover:text-ink" href={REPOSITORY}>
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </>
  );
}

export default App;
