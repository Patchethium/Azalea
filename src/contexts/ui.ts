import { createContextProvider } from "@solid-primitives/context";
import { createStore } from "solid-js/store";

type PageType = "config" | "dictionary" | null; // null means main page
type BottomPanelType = "accent" | "tuning" | "post";
type PostTool = "pencil" | "line";
type ConfigSection =
  | "interface"
  | "project"
  | "voice"
  | "synthesis"
  | "shortcuts";
type PendingProjectAction =
  | "new"
  | "open"
  | "close"
  | "quit"
  | { kind: "open_recent"; path: string };
type LastFocusedCaret = { blockId: string; offset: number } | null;

type UIStoreType = {
  selectedTextBlockIndex: number;
  selectedDictionaryEntryId: string | null;
  coreInitialized: boolean;
  page: PageType;
  bottomPanel: BottomPanelType;
  /** Drawing tool of the post-processing tab. */
  postTool: PostTool;
  /** Whether post-processing strokes may voice frames WORLD found unvoiced. */
  postDrawUnvoiced: boolean;
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
    postTool: "pencil",
    postDrawUnvoiced: false,
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
export type {
  PageType,
  BottomPanelType,
  ConfigSection,
  PendingProjectAction,
  PostTool,
};
