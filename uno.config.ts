import { defineConfig, presetUno, transformerVariantGroup } from "unocss";
import presetIcons from "@unocss/preset-icons";
import { presetKobalte } from "unocss-preset-primitives";
import presetCorvu from '@corvu/unocss'

export default defineConfig({
  presets: [
    presetUno(),
    presetIcons(),
    // don't mind the ts-ignore, it works anyway
    // @ts-ignore-next-line
    presetKobalte(),
    // @ts-ignore-next-line
    presetCorvu(),
  ],
  transformers: [transformerVariantGroup()],
});
