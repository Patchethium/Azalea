import { createContextProvider } from "@solid-primitives/context";
import { createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { AudioQuery, Preset, Project } from "../binding";
import { usei18n } from "./i18n";
import { useMetaStore } from "./meta";

type TextBlockProps = {
  text: string;
  preset_id: number | null;
  query: AudioQuery | null;
};

const [TextProvider, useTextStore] = createContextProvider(() => {
  const { availableStyleIds } = useMetaStore()!;
  const { t1 } = usei18n()!;
  const [project, setProject] = createStore<Project>({
    blocks: import.meta.env.DEV
      ? [
          {
            text: "こんにちは、世界！",
            preset_id: null,
            query: null,
          },
        ]
      : [], // add a text for quick testing in dev mode
    presets: [],
  });
  const [textStore, setTextStore] = createStore<TextBlockProps[]>(
    project.blocks,
  );
  const [projectPresetStore, setProjectPresetStore] = createStore<Preset[]>(
    project.presets,
  );

  const [projectPath, setProjectPath] = createSignal<string | null>(null);

  const newProject = () => {
    setProjectPath(null);
    setTextStore(
      import.meta.env.DEV
        ? [
            {
              text: "こんにちは、世界！",
              query: null,
              preset_id: 0,
            },
          ]
        : [],
    );
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
    newProject,
  };
});

export { TextProvider, useTextStore };
export type { TextBlockProps };
