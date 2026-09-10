export const DEFAULT_PRIMARY_COLOR = "#3b82f6";
export const PRIMARY_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

const primaryColor = `var(--primary-color, ${DEFAULT_PRIMARY_COLOR})`;

// Keep the app and website on the same configurable UnoCSS primary scale.
export const primaryColors = {
  50: `color-mix(in srgb, ${primaryColor} 8%, white)`,
  1: `color-mix(in srgb, ${primaryColor} 20%, white)`,
  2: `color-mix(in srgb, ${primaryColor} 35%, white)`,
  3: `color-mix(in srgb, ${primaryColor} 55%, white)`,
  4: `color-mix(in srgb, ${primaryColor} 75%, white)`,
  5: primaryColor,
  6: `color-mix(in srgb, ${primaryColor} 90%, black)`,
  7: `color-mix(in srgb, ${primaryColor} 75%, black)`,
  9: `color-mix(in srgb, ${primaryColor} 40%, black)`,
};
