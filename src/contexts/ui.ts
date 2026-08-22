import { createContextProvider } from "@solid-primitives/context";
import { createStore } from "solid-js/store";

type PageType = "config" | "dictionary" | "shortcuts" | null; // null means main page
type BottomPanelType = "accent" | "tuning";

type UIStoreType = {
  selectedTextBlockIndex: number;
  selectedDictionaryEntryId: string | null;
  coreInitialized: boolean;
  page: PageType;
  bottomPanel: BottomPanelType;
  bottom_scroll_pos: number;
};

const [UIProvider, useUIStore] = createContextProvider(() => {
  const [uiStore, setUIStore] = createStore<UIStoreType>({
    selectedTextBlockIndex: 0,
    selectedDictionaryEntryId: null,
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
export type { PageType, BottomPanelType };
