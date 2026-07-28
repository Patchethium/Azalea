import { MultiProvider } from "@solid-primitives/context";
import { render } from "solid-js/web";
import App from "./App";
import { ConfigProvider } from "./contexts/config";
import { i18nProvider } from "./contexts/i18n";
import { MetaProvider } from "./contexts/meta";
import { SpectrogramProvider } from "./contexts/spectrogram";
import { SystemProvider } from "./contexts/system";
import { TextProvider } from "./contexts/text";
import { UIProvider } from "./contexts/ui";

export const mountApp = () =>
  render(
    () => (
      <MultiProvider
        values={[
          [MetaProvider, []],
          [UIProvider, null],
          [SpectrogramProvider, null],
          [ConfigProvider, null],
          [SystemProvider, null],
          [i18nProvider, null],
          [TextProvider, null],
        ]}
      >
        <App />
      </MultiProvider>
    ),
    document.getElementById("root") as HTMLElement,
  );
