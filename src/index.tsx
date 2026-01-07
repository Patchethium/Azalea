/* @refresh reload */
import { render } from "solid-js/web";
import App from "./App";
import "virtual:uno.css";
import "@unocss/reset/tailwind-compat.css";
import { MultiProvider } from "@solid-primitives/context";
import { ConfigProvider } from "./contexts/config";
import { i18nProvider } from "./contexts/i18n";
import { MetaProvider } from "./contexts/meta";
import { SystemProvider } from "./contexts/system";
import { TextProvider } from "./contexts/text";
import { UIProvider } from "./contexts/ui";

render(() => {
  return (
    <MultiProvider
      values={[
        [MetaProvider, []],
        [UIProvider, null],
        [ConfigProvider, null],
        [SystemProvider, null],
        [i18nProvider, null],
        [TextProvider, null],
      ]}
    >
      <App />
    </MultiProvider>
  );
}, document.getElementById("root") as HTMLElement);
