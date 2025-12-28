import { createContextProvider } from "@solid-primitives/context";
import { createEffect, createSignal, on } from "solid-js";
import { createStore } from "solid-js/store";
import { AudioQuery, Preset, Project } from "../binding";

type TextBlockProps = {
  text: string;
  preset_id: number | null;
  query: AudioQuery | null;
};

const [TextProvider, useTextStore] = createContextProvider(() => {
  const [project, setProject] = createStore<Project>({
    blocks: [
      {
        text: "",
        preset_id: null,
        query: null,
      },
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
  const [dirty, setDirty] = createSignal<boolean>(false);

  createEffect(
    on([() => textStore, () => projectPresetStore], () => {
      setDirty(true);
    }),
  );

  return {
    textStore,
    setTextStore,
    projectPresetStore,
    setProjectPresetStore,
    project,
    projectPath,
    setProjectPath,
    dirty,
    setDirty,
  };
});

export { TextProvider, useTextStore };
export type { TextBlockProps };
