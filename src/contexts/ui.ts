import { createContextProvider } from "@solid-primitives/context";
import { createStore } from "solid-js/store";

type PageType = "config" | "dictionary" | "shortcuts" | null; // null means main page
type BottomPanelType = "accent" | "tuning";
type ConfigSection = "interface" | "project" | "voice" | "synthesis";
type PendingProjectAction = "new" | "open" | "close" | "quit";
type LastFocusedCaret = { blockId: string; offset: number } | null;

type UIStoreType = {
  selectedTextBlockIndex: number;
  selectedDictionaryEntryId: string | null;
  coreInitialized: boolean;
  page: PageType;
  bottomPanel: BottomPanelType;
  /** Last opened config section; kept for the session only. */
  configSection: ConfigSection;
  bottom_scroll_pos: number;
  pendingProjectAction: PendingProjectAction | null;
  lastFocusedCaret: LastFocusedCaret;
};

const [UIProvider, useUIStore] = createContextProvider(() => {
  const [uiStore, setUIStore] = createStore<UIStoreType>({
    selectedTextBlockIndex: 0,
    selectedDictionaryEntryId: null,
    coreInitialized: false,
    page: null,
    bottomPanel: "accent",
    configSection: "interface",
    bottom_scroll_pos: 0,
    pendingProjectAction: null,
    lastFocusedCaret: null,
  });
  return {
    uiStore,
    setUIStore,
  };
});

export { UIProvider, useUIStore };
export type { PageType, BottomPanelType, ConfigSection, PendingProjectAction };
