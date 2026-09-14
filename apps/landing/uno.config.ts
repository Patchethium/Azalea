import { primaryColors } from "@azalea/theme/tokens";
import presetIcons from "@unocss/preset-icons";
import { defineConfig, presetWind3, transformerVariantGroup } from "unocss";
import { presetKobalte } from "unocss-preset-primitives";

export default defineConfig({
  theme: { colors: { primary: primaryColors } },
  presets: [presetWind3(), presetIcons(), presetKobalte()],
  transformers: [transformerVariantGroup()],
});
