import { primaryColors } from "@azalea/theme/tokens";
import {
  defineConfig,
  transformerVariantGroup,
  presetWind3,
  transformerDirectives,
} from "unocss";
import presetIcons from "@unocss/preset-icons";
import { presetKobalte } from "unocss-preset-primitives";
import presetCorvu from "@corvu/unocss";

export default defineConfig({
  theme: { colors: { primary: primaryColors } },
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
