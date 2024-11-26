/* @refresh reload */
import { render } from "solid-js/web";
import App from "./App";
import "virtual:uno.css";
import "@unocss/reset/tailwind-compat.css";
import { MultiProvider } from "@solid-primitives/context";
import _ from "lodash";
import { ConfigProvider } from "./store/config";
import { i18nProvider } from "./store/i18n";
import { MetaProvider } from "./store/meta";
import { SystemProvider } from "./store/system";
import { TextProvider } from "./store/text";
import { UIProvider } from "./store/ui";

render(() => {
  const texts = [{ text: "", styleId: 0 }];

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
