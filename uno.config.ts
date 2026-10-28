import { defineConfig, transformerVariantGroup, presetWind3, transformerDirectives } from "unocss";
import presetIcons from "@unocss/preset-icons";
import { presetKobalte } from "unocss-preset-primitives";
import presetCorvu from "@corvu/unocss";

const primaryColor = "var(--primary-color, #3b82f6)";
const token = (name: string) => `var(--az-${name})`;

export default defineConfig({
  theme: {
    // Semantic tokens from the Azalea design system; light and dark values
    // live in src/app.module.css. Opacity modifiers (`/50`) don't apply to
    // them, so translucent tokens carry their alpha in the variable.
    zIndex: {
      ruler: "3",
      "block-toolbar": "10",
      overlay: "50",
      popover: "60",
      toast: "70",
    },
    colors: {
      canvas: token("canvas"),
      surface: {
        DEFAULT: token("surface"),
        raised: token("surface-raised"),
        menu: token("surface-menu"),
        titlebar: token("surface-titlebar"),
      },
      hover: {
        DEFAULT: token("hover"),
        titlebar: token("hover-titlebar"),
      },
      border: {
        DEFAULT: token("border"),
        menu: token("border-menu"),
        titlebar: token("border-titlebar"),
      },
      ink: {
        DEFAULT: token("ink"),
        secondary: token("ink-secondary"),
        muted: token("ink-muted"),
        subtle: token("ink-subtle"),
        faint: token("ink-faint"),
        disabled: token("ink-disabled"),
      },
      track: token("track"),
      // Hyphenated names are nested so UnoCSS resolves them
      // (`bg-control-off`, `text-on-accent`, `ring-focus-ring`).
      control: { off: token("control-off") },
      tooltip: token("tooltip"),
      on: { tooltip: token("on-tooltip"), accent: "#ffffff" },
      accent: {
        DEFAULT: primaryColor,
        hover: `color-mix(in srgb, ${primaryColor} 90%, black)`,
        soft: token("accent-soft"),
      },
      focus: {
        ring: {
          DEFAULT: `color-mix(in srgb, ${primaryColor} 55%, white)`,
          soft: `color-mix(in srgb, ${primaryColor} 35%, white)`,
        },
      },
      danger: {
        DEFAULT: "#ef4444",
        strong: "#dc2626",
        ring: "#fca5a5",
        ink: token("danger-ink"),
        border: token("danger-border"),
        soft: token("danger-soft"),
      },
      warning: {
        DEFAULT: "#f59e0b",
        border: token("warning-border"),
        soft: token("warning-soft"),
        ink: "#a16207",
      },
      overlay: "rgba(0, 0, 0, 0.5)",
      synth: Object.fromEntries(
        ["idle", "queued", "running", "completed", "failed"].map((state) => [
          state,
          {
            bg: token(`synth-${state}-bg`),
            border: token(`synth-${state}-border`),
            ink: token(`synth-${state}-ink`),
          },
        ]),
      ),
      primary: {
        50: `color-mix(in srgb, ${primaryColor} 8%, white)`,
        1: `color-mix(in srgb, ${primaryColor} 20%, white)`,
        2: `color-mix(in srgb, ${primaryColor} 35%, white)`,
        3: `color-mix(in srgb, ${primaryColor} 55%, white)`,
        4: `color-mix(in srgb, ${primaryColor} 75%, white)`,
        5: primaryColor,
        6: `color-mix(in srgb, ${primaryColor} 90%, black)`,
        7: `color-mix(in srgb, ${primaryColor} 75%, black)`,
        9: `color-mix(in srgb, ${primaryColor} 40%, black)`,
      },
    },
  },
  shortcuts: {
    // Dropdown and context menus (design system: Menu).
    "menu-panel":
      "rounded-md bg-surface-menu p1 shadow-xl outline-none ring-1 ring-border-menu",
    "menu-item-base":
      "w-full min-w-44 cursor-pointer rounded-md outline-none hover:(bg-accent text-on-accent) ui-highlighted:(bg-accent text-on-accent) ui-disabled:(cursor-not-allowed opacity-50)",
    "menu-item":
      "menu-item-base flex h-8 flex-row items-center justify-between gap2 p2",
    // An item with a title line over a caption line, such as a recent file.
    "menu-item-stacked": "menu-item-base flex flex-col px2 py1",
    "menu-separator": "mx2 my1 b-t b-border-menu",
    "menu-group-label": "px2 py1 text-xs text-ink-subtle",
  },
  presets: [
    presetWind3(),
    presetIcons(),
    // don't mind the ts-ignore, it works anyway
    // @ts-ignore-next-line
    presetKobalte(),
    // @ts-ignore-next-line
    presetCorvu(),
  ],
  transformers: [transformerVariantGroup(), transformerDirectives()],
});
