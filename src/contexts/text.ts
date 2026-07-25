import { createContextProvider } from "@solid-primitives/context";
import { batch, createEffect, createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { AudioQuery, Preset, Project } from "../binding";
import { usei18n } from "./i18n";
import { useMetaStore } from "./meta";
import { useUIStore } from "./ui";

type TextBlockProps = {
  text: string;
  preset_id: number | null;
  query: AudioQuery | null;
};

const createTextBlock = (
  presetId: number | null,
  text = "",
): TextBlockProps => ({
  text,
  preset_id: presetId,
  query: null,
});

const clampTextBlockIndex = (index: number, blockCount: number) => {
  if (blockCount === 0 || !Number.isFinite(index)) return 0;
  return Math.min(Math.max(Math.trunc(index), 0), blockCount - 1);
};

const [TextProvider, useTextStore] = createContextProvider(() => {
  const { availableStyleIds } = useMetaStore()!;
  const { uiStore, setUIStore } = useUIStore()!;
  const { t1 } = usei18n()!;
  const [project, setProject] = createStore<Project>({
    blocks: [
      createTextBlock(null, import.meta.env.DEV ? "こんにちは、世界！" : ""),
    ],
    presets: [],
  });
  const [textStore, setTextStore] = createStore<TextBlockProps[]>(
    project.blocks,
  );
  const [projectPresetStore, setProjectPresetStore] = createStore<Preset[]>(
    project.presets,
  );

  const [projectPath, setProjectPath] = createSignal<string | null>(null);

  const selectedTextBlockIndex = () =>
    clampTextBlockIndex(uiStore.selectedTextBlockIndex, textStore.length);

  const selectedTextBlock = () => textStore[selectedTextBlockIndex()] ?? null;

  createEffect(() => {
    const clampedIndex = selectedTextBlockIndex();
    if (uiStore.selectedTextBlockIndex !== clampedIndex) {
      setUIStore("selectedTextBlockIndex", clampedIndex);
    }
  });

  const createFirstTextBlock = () => {
    if (textStore.length > 0) {
      setUIStore("selectedTextBlockIndex", selectedTextBlockIndex());
      return;
    }
    batch(() => {
      setTextStore([createTextBlock(projectPresetStore.length > 0 ? 0 : null)]);
      setUIStore("selectedTextBlockIndex", 0);
    });
  };

  const newProject = () => {
    batch(() => {
      setProjectPath(null);
      setTextStore([
        createTextBlock(0, import.meta.env.DEV ? "こんにちは、世界！" : ""),
      ]);
      setProjectPresetStore([
        {
          name: t1("preset.new_preset"),
          style_id: Math.min(...availableStyleIds()),
          speed: 100,
          pitch: 0.0,
          intonation: 1.0,
          volume: 1.0,
          start_slience: 0,
          end_slience: 300,
        },
      ]);
      setUIStore("selectedTextBlockIndex", 0);
    });
  };

  return {
    textStore,
    setTextStore,
    projectPresetStore,
    setProjectPresetStore,
    project,
    setProject,
    projectPath,
    setProjectPath,
    selectedTextBlock,
    selectedTextBlockIndex,
    createFirstTextBlock,
    newProject,
  };
});

export { TextProvider, useTextStore };
export type { TextBlockProps };
