import { createContextProvider } from "@solid-primitives/context";
import { createStore } from "solid-js/store";

type UIStoreType = {
  selectedTextBlockIndex: number;
};

const [UIProvider, useUIStore] = createContextProvider(() => {
  const [uiStore, setUIStore] = createStore<UIStoreType>({
    selectedTextBlockIndex: 0,
  });
  return {
    uiStore,
    setUIStore,
  };
});

export { UIProvider, useUIStore };
