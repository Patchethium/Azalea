import { Locale } from "$binding";
import { createContextProvider } from "@solid-primitives/context";
import * as i18n from "@solid-primitives/i18n";
import { DEFAULT_LOCALE } from "$constants";
import { getDict } from "../i18n";
import { useConfigStore } from "@contexts/config";

const [i18nProvider, usei18n] = createContextProvider(() => {
  const { config } = useConfigStore()!;
  const locale = (): Locale => config.ui_config?.locale ?? DEFAULT_LOCALE;
  const t1 = i18n.translator(() => getDict(locale()));
  const t2 = i18n.translator(() => getDict(locale()), i18n.resolveTemplate);
  return { t1, t2 };
});

export { i18nProvider, usei18n };
