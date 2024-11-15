// The store holding the configuration
import { createContextProvider } from "@solid-primitives/context";
import _ from "lodash";
import { createEffect } from "solid-js";
import { createStore } from "solid-js/store";
import { AzaleaConfig } from "../binding";
import { commands } from "../binding";
import { useUIStore } from "./ui";
import { useMetaStore } from "./meta";

const [ConfigProvider, useConfigStore] = createContextProvider(() => {
  const { setUIStore } = useUIStore()!;
  const { setMetas } = useMetaStore()!;

  const [config, setConfig] = createStore<AzaleaConfig>({
    core_config: {
      core_path: null,
      ojt_path: null,
      cache_size: 0,
    },
  });

  createEffect(async () => {
    if (config.core_config.core_path !== null) {
      const res = await commands.initCore(
        config.core_config.core_path,
        config.core_config.cache_size,
      );
      if (res.status === "error") {
        if (res.error === "Core already loaded") {
          setUIStore("coreInitialized", true);
        }
        console.error("Failed to initialize core:", res.error);
        setUIStore("lastError", "The core path is invalid.");
      } else {
        const metas = await commands.getMetas();
        if (metas.status === "ok") {
          setMetas(metas.data);
        } else {
          console.error("Failed to get metas:", metas.error);
        }
        setUIStore("coreInitialized", true);
      }
    }
  });

  createEffect(async () => {
    console.log("Setting", config);
    const res = await commands.setConfig(_.cloneDeep(config));
    if (res.status === "error") {
      console.error("Failed to save config:", res.error);
    }
  })

  return { config, setConfig };
});

export { ConfigProvider, useConfigStore };
