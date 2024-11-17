/* @refresh reload */
import { render } from "solid-js/web";
import App from "./App";
import "virtual:uno.css";
import "@unocss/reset/tailwind-compat.css";
import { MultiProvider } from "@solid-primitives/context";
import _ from "lodash";
import { ConfigProvider } from "./store/config";
import { MetaProvider } from "./store/meta";
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
      ]}
    >
      <App />
    </MultiProvider>
  );
}, document.getElementById("root") as HTMLElement);
