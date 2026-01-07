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
    blocks: import.meta.env.DEV
      ? [
          {
            text: "こんにちは、世界！",
            preset_id: 0,
            query: null,
          },
        ]
      : [], // add a text for quick testing in dev mode
    presets: [
      {
        name: "Default Preset",
        style_id: 0,
        speed: 100,
        pitch: 0.0,
        intonation: 1.0,
        volume: 1.0,
        start_slience: 100,
        end_slience: 100,
      },
    ],
  });
  const [textStore, setTextStore] = createStore<TextBlockProps[]>(
    project.blocks
  );
  const [projectPresetStore, setProjectPresetStore] = createStore<Preset[]>(
    project.presets
  );

  const [projectPath, setProjectPath] = createSignal<string | null>(null);

  return {
    textStore,
    setTextStore,
    projectPresetStore,
    setProjectPresetStore,
    project,
    setProject,
    projectPath,
    setProjectPath,
  };
});

export { TextProvider, useTextStore };
export type { TextBlockProps };
