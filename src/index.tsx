/* @refresh reload */
import { render } from "solid-js/web";
import App from "./App";
import "virtual:uno.css";
import "@unocss/reset/tailwind-compat.css";
import { MultiProvider } from "@solid-primitives/context";
import _ from "lodash";
import { ConfigProvider } from "./contexts/config";
import { i18nProvider } from "./contexts/i18n";
import { MetaProvider } from "./contexts/meta";
import { SystemProvider } from "./contexts/system";
import { TextProvider } from "./contexts/text";
import { UIProvider } from "./contexts/ui";

render(() => {
  const texts = [{ text: "", presetId: 0 }];

  return (
    <MultiProvider
      values={[
        [MetaProvider, []],
        [TextProvider, texts],
        [UIProvider, null],
        [ConfigProvider, null],
        [SystemProvider, null],
        [i18nProvider, null],
      ]}
    >
      <App />
    </MultiProvider>
  );
}, document.getElementById("root") as HTMLElement);
