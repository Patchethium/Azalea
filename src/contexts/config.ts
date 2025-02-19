// The store holding the configuration
import { createContextProvider } from "@solid-primitives/context";

import { createScheduled } from "@solid-primitives/scheduled";
import _, { debounce } from "lodash";
import { createEffect, createResource, createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { AzaleaConfig, StyleId } from "../binding";
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
      cache_size: 128,
    },
  } as AzaleaConfig);

  type RangeMap = { [key in StyleId]: [number, number] };

  const [range, setRange] = createSignal<RangeMap | null>(null);

  const [configInitialized, setConfigInitialized] = createSignal(false);

  const load_meta = async () => {
    const metas = await commands.getMetas();
    if (metas.status === "ok") {
      setMetas(metas.data);
    } else {
      console.error("Failed to get metas:", metas.error);
    }
  };

  const load_range = async () => {
    const res = await commands.getRange();
    if (res.status === "ok") {
      setRange(res.data as RangeMap);
    } else {
      console.error("Failed to get range:", res.error);
    }
  };

  const [coreInitializeResource, _mutate] = createResource(
    () => config.core_config.core_path,
    async (path) => {
      const res = await commands.initCore(
        path,
        config.core_config.cache_size ?? 128,
      );
      if (res.status === "error") {
        if (res.error === "Core already loaded") {
          load_range();
          load_meta();
          setUIStore("coreInitialized", true);
        } else {
          setUIStore("coreInitialized", false);
          console.error("Failed to initialize core:", res.error);
        }
      } else {
        load_range();
        load_meta();
        setUIStore("coreInitialized", true);
      }
    },
  );

  const saveConfig = () => {
    if (configInitialized()) {
      commands.setConfig(_.cloneDeep(config)).then((res) => {
        if (res.status === "error") {
          console.error("Failed to save config:", res.error);
        }
      });
    }
  };

  const scheduled = createScheduled((saveConfig) => debounce(saveConfig, 500));

  createEffect(() => {
    if (scheduled()) {
      saveConfig();
    }
  });

  return {
    config,
    setConfig,
    configInitialized,
    setConfigInitialized,
    coreInitializeResource,
    range,
  };
});

export { ConfigProvider, useConfigStore };
