// The store holding the configuration
import { createContextProvider } from "@solid-primitives/context";
import _ from "lodash";
import { createEffect, createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { AzaleaConfig } from "../binding";
import { commands } from "../binding";
import { useMetaStore } from "./meta";
import { useUIStore } from "./ui";

const [ConfigProvider, useConfigStore] = createContextProvider(() => {
  const { setUIStore } = useUIStore()!;
  const { setMetas } = useMetaStore()!;

  const [config, setConfig] = createStore<AzaleaConfig>({
    core_config: {
      core_path: null,
      ojt_path: null,
      cache_size: 1024,
    },
  });

  const [configInitialized, setConfigInitialized] = createSignal(false);

  const load_meta = async () => {
    const metas = await commands.getMetas();
    if (metas.status === "ok") {
      setMetas(metas.data);
    } else {
      console.error("Failed to get metas:", metas.error);
    }
  };

  createEffect(async () => {
    if (config.core_config.core_path !== null) {
      const res = await commands.initCore(
        config.core_config.core_path,
        config.core_config.cache_size,
      );
      if (res.status === "error") {
        if (res.error === "Core already loaded") {
          load_meta();
          setUIStore("coreInitialized", true);
        } else {
          console.error("Failed to initialize core:", res.error);
          setUIStore("lastError", "The core path is invalid.");
        }
      } else {
        load_meta();
        setUIStore("coreInitialized", true);
      }
    }
  });

  createEffect(async () => {
    if (configInitialized()) {
      const res = await commands.setConfig(_.cloneDeep(config));
      if (res.status === "error") {
        console.error("Failed to save config:", res.error);
      }
    }
  });

  return { config, setConfig, configInitialized, setConfigInitialized };
});

export { ConfigProvider, useConfigStore };
