import { defineConfig, transformerVariantGroup, presetWind3, transformerDirectives } from "unocss";
import presetIcons from "@unocss/preset-icons";
import { presetKobalte } from "unocss-preset-primitives";
import presetCorvu from "@corvu/unocss";

const primaryColor = "var(--primary-color, #3b82f6)";

export default defineConfig({
  theme: {
    colors: {
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
