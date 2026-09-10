import { primaryColors } from "@azalea/theme/tokens";
import presetIcons from "@unocss/preset-icons";
import { defineConfig, presetWind3 } from "unocss";

export default defineConfig({
  theme: { colors: { primary: primaryColors } },
  presets: [presetWind3(), presetIcons()],
});
