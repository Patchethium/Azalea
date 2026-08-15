import {
  CharacterMeta,
  Preset,
  Project,
  TextBlockProps as ProjectTextBlockProps,
} from "$binding";
import { createContextProvider } from "@solid-primitives/context";
import { batch, createEffect, createSignal } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { usei18n } from "@contexts/i18n";
import { useMetaStore } from "@contexts/meta";
import { useUIStore } from "@contexts/ui";

type TextBlockProps = ProjectTextBlockProps;

let textBlockSequence = 0;

const createTextBlockId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  textBlockSequence += 1;
  return `text-block-${Date.now()}-${textBlockSequence}`;
};

const createTextBlock = (
  presetId: number | null,
  text = "",
): TextBlockProps => ({
  id: createTextBlockId(),
  text,
  preset_id: presetId,
  query: null,
  query_is_modified: false,
});

type PresetStyle = {
  speaker: CharacterMeta;
  style: CharacterMeta["styles"][number];
};

export const findPresetStyle = (
  preset: Preset,
  metas: CharacterMeta[],
): PresetStyle | null => {
  if (
    preset.speaker_uuid !== null &&
    preset.speaker_uuid !== undefined &&
    preset.style_name !== null &&
    preset.style_name !== undefined
  ) {
    const speaker = metas.find(
      (candidate) => candidate.speaker_uuid === preset.speaker_uuid,
    );
    const style = speaker?.styles.find(
      (candidate) => candidate.name === preset.style_name,
    );
    return speaker !== undefined && style !== undefined
      ? { speaker, style }
      : null;
  }

  for (const speaker of metas) {
    const style = speaker.styles.find(
      (candidate) => candidate.id === preset.style_id,
    );
    if (style !== undefined) return { speaker, style };
  }
  return null;
};

export const resolvePresetIdentity = (
  preset: Preset,
  metas: CharacterMeta[],
): Preset => {
  const identity = findPresetStyle(preset, metas);
  if (identity === null) return { ...preset };
  return {
    ...preset,
    style_id: identity.style.id,
    speaker_uuid: identity.speaker.speaker_uuid,
    style_name: identity.style.name,
  };
};

export const clampTextBlockIndex = (index: number, blockCount: number) => {
  if (blockCount === 0 || !Number.isFinite(index)) return 0;
  return Math.min(Math.max(Math.trunc(index), 0), blockCount - 1);
};

const [TextProvider, useTextStore] = createContextProvider(() => {
  const { availableStyleIds, metas } = useMetaStore()!;
  const { uiStore, setUIStore } = useUIStore()!;
  const { t1 } = usei18n()!;
  const [project, setProject] = createStore<Project>({
    blocks: [
      createTextBlock(null, import.meta.env.DEV ? "こんにちは、世界！" : ""),
    ],
    presets: [],
  });
  const [textStore, setTextStore] = createStore<TextBlockProps[]>(
    project.blocks as TextBlockProps[],
  );
  const [projectPresetStore, setProjectPresetStore] = createStore<Preset[]>(
    project.presets,
  );

  const [projectPath, setProjectPath] = createSignal<string | null>(null);

  const insertTextBlockBelow = (index: number) => {
    const sourceIndex = clampTextBlockIndex(index, textStore.length);
    const nextIndex = textStore.length === 0 ? 0 : sourceIndex + 1;
    const presetId = textStore[sourceIndex]?.preset_id ?? null;
    batch(() => {
      setTextStore(
        produce((blocks) => {
          blocks.splice(nextIndex, 0, createTextBlock(presetId));
        }),
      );
      setUIStore("selectedTextBlockIndex", nextIndex);
    });
    return nextIndex;
  };

  createEffect(() => {
    setProject({
      blocks: textStore.map((block) => ({ ...block })),
      presets: projectPresetStore.map((item) => ({ ...item })),
    });
  });

  createEffect(() => {
    projectPresetStore.forEach((preset, index) => {
      const resolved = resolvePresetIdentity(preset, metas);
      if (
        resolved.style_id !== preset.style_id ||
        resolved.speaker_uuid !== preset.speaker_uuid ||
        resolved.style_name !== preset.style_name
      ) {
        setProjectPresetStore(index, resolved);
      }
    });
  });

  const replaceTextBlocks = (blocks: ProjectTextBlockProps[]) => {
    setTextStore(blocks.map((block) => ({ ...block })));
  };

  const markQueryModified = (index: number) => {
    const query = textStore[index]?.query;
    if (query !== null && query !== undefined) {
      setTextStore(index, "query_is_modified", true);
    }
  };

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
          speaker_uuid: null,
          style_name: null,
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
    insertTextBlockBelow,
    selectedTextBlock,
    selectedTextBlockIndex,
    createFirstTextBlock,
    markQueryModified,
    replaceTextBlocks,
    newProject,
  };
});

export { createTextBlock, TextProvider, useTextStore };
export type { TextBlockProps };
