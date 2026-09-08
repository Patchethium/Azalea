import {
  CharacterMeta,
  Preset,
  Project,
  TextBlockProps as ProjectTextBlockProps,
} from "$binding";
import { createContextProvider } from "@solid-primitives/context";
import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { createStore, produce } from "solid-js/store";
import { usei18n } from "@contexts/i18n";
import { useMetaStore } from "@contexts/meta";
import { useUIStore } from "@contexts/ui";

type TextBlockProps = ProjectTextBlockProps;

let fallbackIdSequence = 0;

const createId = (prefix: string) => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  fallbackIdSequence += 1;
  return `${prefix}-${Date.now()}-${fallbackIdSequence}`;
};

const createTextBlockId = () => createId("text-block");
export const createPresetId = () => createId("preset");

const createTextBlock = (
  presetId: string | null,
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

export const findPresetById = (
  presets: readonly Preset[],
  presetId: string | null | undefined,
) =>
  presetId == null
    ? null
    : (presets.find((preset) => preset.id === presetId) ?? null);

export const clampTextBlockIndex = (index: number, blockCount: number) => {
  if (blockCount === 0 || !Number.isFinite(index)) return 0;
  return Math.min(Math.max(Math.trunc(index), 0), blockCount - 1);
};

const hasNoFocusedElement = () => {
  const active = document.activeElement;
  return (
    active === null ||
    active === document.body ||
    active === document.documentElement
  );
};

// Mirrors the fields persisted by `save_project`, ignoring regenerated queries
// so that derived `AudioQuery` refreshes do not count as user edits.
const serializeProject = (
  blocks: readonly TextBlockProps[],
  presets: readonly Preset[],
) =>
  JSON.stringify({
    blocks: blocks.map((block) => ({
      id: block.id,
      text: block.text,
      query: block.query_is_modified ? block.query : null,
      query_is_modified: block.query_is_modified,
      preset_id: block.preset_id,
    })),
    presets: presets.map((preset) => ({
      id: preset.id,
      name: preset.name,
      style_id: preset.style_id,
      speed: preset.speed,
      pitch: preset.pitch,
      intonation: preset.intonation,
      volume: preset.volume,
      start_slience: preset.start_slience,
      end_slience: preset.end_slience,
      speaker_uuid: preset.speaker_uuid,
      style_name: preset.style_name,
    })),
  });

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
  const [queryRefreshVersion, setQueryRefreshVersion] = createSignal(0);
  const [suppressFocusBlockId, setSuppressFocusBlockId] = createSignal<
    string | null
  >(null);
  const [pendingFocusPlacement, setPendingFocusPlacement] = createSignal<{
    blockId: string;
    placement: "start" | "end";
  } | null>(null);

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
      setSuppressFocusBlockId(null);
      setPendingFocusPlacement(null);
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

  const resolvedProjectPresets = createMemo(() =>
    projectPresetStore.map((preset) => resolvePresetIdentity(preset, metas)),
  );
  const projectSnapshot = createMemo(() =>
    serializeProject(textStore, resolvedProjectPresets()),
  );
  const [savedProjectSnapshot, setSavedProjectSnapshot] =
    createSignal(projectSnapshot());
  const isProjectDirty = createMemo(
    () => projectSnapshot() !== savedProjectSnapshot(),
  );
  const markProjectSaved = () => setSavedProjectSnapshot(projectSnapshot());

  const replaceTextBlocks = (blocks: ProjectTextBlockProps[]) => {
    setTextStore(blocks.map((block) => ({ ...block })));
  };

  const removeProjectPreset = (presetId: string) => {
    const index = projectPresetStore.findIndex(
      (preset) => preset.id === presetId,
    );
    if (index === -1) return -1;
    batch(() => {
      setTextStore(
        produce((blocks) => {
          for (const block of blocks) {
            if (block.preset_id === presetId) block.preset_id = null;
          }
        }),
      );
      setProjectPresetStore(
        projectPresetStore.filter((preset) => preset.id !== presetId),
      );
    });
    return index;
  };

  const markQueryModified = (index: number) => {
    const query = textStore[index]?.query;
    if (query !== null && query !== undefined) {
      setTextStore(index, "query_is_modified", true);
    }
  };

  const refreshGeneratedQueries = () => {
    batch(() => {
      setTextStore(
        produce((blocks) => {
          for (const block of blocks) {
            if (!block.query_is_modified) block.query = null;
          }
        }),
      );
      setQueryRefreshVersion((version) => version + 1);
    });
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

  onMount(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        !hasNoFocusedElement()
      ) {
        return;
      }
      const current = selectedTextBlockIndex();
      const next = clampTextBlockIndex(
        current + (event.key === "ArrowUp" ? -1 : 1),
        textStore.length,
      );
      const nextBlock = textStore[next];
      if (next === current || nextBlock === undefined) return;
      event.preventDefault();
      batch(() => {
        setSuppressFocusBlockId(nextBlock.id);
        setPendingFocusPlacement(null);
        setUIStore("selectedTextBlockIndex", next);
      });
    };
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });

  const createFirstTextBlock = () => {
    if (textStore.length > 0) {
      setUIStore("selectedTextBlockIndex", selectedTextBlockIndex());
      return;
    }
    batch(() => {
      setTextStore([createTextBlock(projectPresetStore[0]?.id ?? null)]);
      setSuppressFocusBlockId(null);
      setPendingFocusPlacement(null);
      setUIStore("selectedTextBlockIndex", 0);
    });
  };

  const newProject = () => {
    const presetId = createPresetId();
    batch(() => {
      setProjectPath(null);
      setSuppressFocusBlockId(null);
      setPendingFocusPlacement(null);
      setTextStore([
        createTextBlock(
          presetId,
          import.meta.env.DEV ? "こんにちは、世界！" : "",
        ),
      ]);
      setProjectPresetStore([
        {
          id: presetId,
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
    markProjectSaved();
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
    queryRefreshVersion,
    refreshGeneratedQueries,
    replaceTextBlocks,
    removeProjectPreset,
    newProject,
    isProjectDirty,
    markProjectSaved,
    suppressFocusBlockId,
    setSuppressFocusBlockId,
    pendingFocusPlacement,
    setPendingFocusPlacement,
  };
});

export { createTextBlock, TextProvider, useTextStore };
export type { TextBlockProps };
