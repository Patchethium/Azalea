import { createContextProvider } from "@solid-primitives/context";
import { createStore } from "solid-js/store";

type PageType = "config" | null; // null means main page. TODO: make it consistent with other pages

type UIStoreType = {
  selectedTextBlockIndex: number;
  coreInitialized: boolean;
  page: PageType;
  projectPath: string | null;
};

const [UIProvider, useUIStore] = createContextProvider(() => {
  const [uiStore, setUIStore] = createStore<UIStoreType>({
    selectedTextBlockIndex: 0,
    coreInitialized: false,
    page: null,
    projectPath: null,
  });
  return {
    uiStore,
    setUIStore,
  };
});

export { UIProvider, useUIStore };
export type { PageType };
