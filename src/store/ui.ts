import { createContextProvider } from "@solid-primitives/context";
import { createStore } from "solid-js/store";

type UIStoreType = {
  selectedTextBlockIndex: number;
  coreInitialized: boolean;
  tunableScale: number;
};

const [UIProvider, useUIStore] = createContextProvider(() => {
  const [uiStore, setUIStore] = createStore<UIStoreType>({
    selectedTextBlockIndex: 0,
    coreInitialized: false,
    tunableScale: 360,
  });
  return {
    uiStore,
    setUIStore,
  };
});

export { UIProvider, useUIStore };
