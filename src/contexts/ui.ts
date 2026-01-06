import { createContextProvider } from "@solid-primitives/context";
import { createStore } from "solid-js/store";

type PageType = "config" | null; // null means main page. TODO: make it consistent with other pages
type BottomPanelType = "accent" | "tuning";

type UIStoreType = {
  selectedTextBlockIndex: number;
  coreInitialized: boolean;
  page: PageType;
  bottomPanel: BottomPanelType;
  bottom_scroll_pos: number;
};

const [UIProvider, useUIStore] = createContextProvider(() => {
  const [uiStore, setUIStore] = createStore<UIStoreType>({
    selectedTextBlockIndex: 0,
    coreInitialized: false,
    page: null,
    bottomPanel: "accent",
    bottom_scroll_pos: 0,
  });
  return {
    uiStore,
    setUIStore,
  };
});

export { UIProvider, useUIStore };
export type { PageType };
