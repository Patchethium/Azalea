import { createContextProvider } from "@solid-primitives/context";
import { createStore } from "solid-js/store";
import { AudioQuery, Preset, Project } from "../binding";

type TextBlockProps = {
  text: string;
  preset_id: number | null;
  query: AudioQuery | null;
};

const [TextProvider, useTextStore] = createContextProvider(
  () => {
    const [textStore, setTextStore] = createStore<TextBlockProps[]>(
      [
        {
          text: "",
          query: null,
          preset_id: null
        }
      ]
    );
    const [projectPresetStore, setProjectPresetStore] = createStore<Preset[]>(
      []
    );
    const getProject = (): Project => {
      return {
        blocks: textStore,
        presets: projectPresetStore
      }
    }
    const setProject = (p: Project) => {
      setTextStore(p.blocks);
      setProjectPresetStore(p.presets);
    }

    return {
      textStore,
      setTextStore,
      projectPresetStore,
      setProjectPresetStore,
      setProject,
      getProject
    };
  }
);

export { TextProvider, useTextStore };
export type { TextBlockProps };