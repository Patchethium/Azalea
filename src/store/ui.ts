import { createContextProvider } from "@solid-primitives/context";
import { createStore } from "solid-js/store";

type UIStoreType = {
  selectedTextBlockIndex: number;
  coreInitialized: boolean;
  lastError: string | null;
};

const [UIProvider, useUIStore] = createContextProvider(() => {
  const [uiStore, setUIStore] = createStore<UIStoreType>({
    selectedTextBlockIndex: 0,
    coreInitialized: false,
    lastError: null,
  });
  return {
    uiStore,
    setUIStore,
  };
});

export { UIProvider, useUIStore };
