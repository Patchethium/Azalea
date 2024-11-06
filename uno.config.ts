import { defineConfig, presetUno, transformerVariantGroup } from "unocss";
import presetIcons from "@unocss/preset-icons";
import { presetKobalte } from "unocss-preset-primitives";

export default defineConfig({
  presets: [
    presetUno(),
    presetIcons(),
    // @ts-ignore-next-line
    presetKobalte(),
  ],
  transformers: [transformerVariantGroup()],
});
