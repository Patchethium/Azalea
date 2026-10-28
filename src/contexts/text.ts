import {
  CharacterMeta,
  PostEdit,
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
  untrack,
} from "solid-js";
import { createStore, produce, reconcile, unwrap } from "solid-js/store";
import { usei18n } from "@contexts/i18n";
import { useMetaStore } from "@contexts/meta";
import { useConfigStore } from "@contexts/config";
import { useSpectrogramStore } from "@contexts/spectrogram";
import { useUIStore } from "@contexts/ui";
import { getModifiedQuery, indexAfterMove, postEditBase } from "$utils";

type TextBlockProps = ProjectTextBlockProps;
type SeedHistory = { seeds: number[]; index: number };
/** Whole post edits before (undo) and after (redo) the current one. */
type PostHistory = {
  base: string;
  undo: (PostEdit | null)[];
  redo: (PostEdit | null)[];
};
type PostHistoryDirection = "undo" | "redo";

/** How many post edits a block's undo stack keeps. */
const POST_HISTORY_LIMIT = 100;

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
  accent_is_modified: false,
  duration_is_modified: false,
  pitch_is_modified: false,
  pitch_noise_seed: Math.floor(Math.random() * 2 ** 32),
  post: null,
});

/** Whether any accent, duration, or pitch edit was made to the block query. */
export const isQueryModified = (block: TextBlockProps) =>
  block.accent_is_modified === true ||
  block.duration_is_modified === true ||
  block.pitch_is_modified === true;

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

/** The preset identity fields for a style, or null when it is unknown. */
export const styleIdentityPatch = (
  styleId: number,
  metas: CharacterMeta[],
): Pick<Preset, "style_id" | "speaker_uuid" | "style_name"> | null => {
  for (const speaker of metas) {
    const style = speaker.styles.find((candidate) => candidate.id === styleId);
    if (style !== undefined) {
      return {
        style_id: style.id,
        speaker_uuid: speaker.speaker_uuid,
        style_name: style.name,
      };
    }
  }
  return null;
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

// Mirrors the fields persisted by `save_project`. Unedited queries are saved
// too, but regenerating them is derived work rather than a user edit, so they
// do not make the project dirty.
const serializeProject = (
  blocks: readonly TextBlockProps[],
  presets: readonly Preset[],
) =>
  JSON.stringify({
    blocks: blocks.map((block) => ({
      id: block.id,
      text: block.text,
      query: isQueryModified(block) ? block.query : null,
      accent_is_modified: block.accent_is_modified === true,
      duration_is_modified: block.duration_is_modified === true,
      pitch_is_modified: block.pitch_is_modified === true,
      preset_id: block.preset_id,
      pitch_noise_seed: block.pitch_noise_seed,
      post:
        block.post != null &&
        (block.post.f0.length > 0 || block.post.time.length > 0)
          ? block.post
          : null,
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
  const { coreRevision, englishReadingRevision } = useConfigStore()!;
  const spectrogramStore = useSpectrogramStore();
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
  const [queryPending, setQueryPending] = createStore<
    Record<string, number | undefined>
  >({});
  let queryUpdateSequence = 0;
  const beginQueryUpdate = (blockId: string) => {
    const revision = ++queryUpdateSequence;
    setQueryPending(blockId, revision);
    return {
      isCurrent: () => queryPending[blockId] === revision,
      finish: () => {
        if (queryPending[blockId] === revision)
          setQueryPending(blockId, undefined);
      },
    };
  };
  const [suppressFocusBlockId, setSuppressFocusBlockId] = createSignal<
    string | null
  >(null);
  const [pendingFocusPlacement, setPendingFocusPlacement] = createSignal<{
    blockId: string;
    placement: "start" | "end";
    offset?: number;
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

  /**
   * Inserts one block per text right after `index`, using that block's preset,
   * then selects the last inserted block with the caret at its end.
   */
  const insertTextBlocksBelow = (index: number, texts: string[]) => {
    if (texts.length === 0) return;
    const sourceIndex = clampTextBlockIndex(index, textStore.length);
    const nextIndex = textStore.length === 0 ? 0 : sourceIndex + 1;
    const presetId = textStore[sourceIndex]?.preset_id ?? null;
    const blocks = texts.map((text) => createTextBlock(presetId, text));
    const last = blocks[blocks.length - 1];
    batch(() => {
      setTextStore(
        produce((draft) => {
          draft.splice(nextIndex, 0, ...blocks);
        }),
      );
      setSuppressFocusBlockId(null);
      setPendingFocusPlacement({ blockId: last.id, placement: "end" });
      setUIStore("selectedTextBlockIndex", nextIndex + blocks.length - 1);
    });
  };

  /**
   * Applies `patch` to a project preset. Changing its style clears the query
   * edits of every block that uses it, since they no longer match the voice.
   */
  const updateProjectPreset = (presetId: string, patch: Partial<Preset>) => {
    const index = projectPresetStore.findIndex(
      (preset) => preset.id === presetId,
    );
    if (index === -1) return;
    const styleChanged =
      patch.style_id !== undefined &&
      patch.style_id !== projectPresetStore[index].style_id;
    batch(() => {
      setProjectPresetStore(index, (preset) => ({ ...preset, ...patch }));
      if (!styleChanged) return;
      setTextStore(
        produce((blocks) => {
          for (const block of blocks) {
            if (block.preset_id === presetId) {
              block.accent_is_modified = false;
              block.duration_is_modified = false;
              block.pitch_is_modified = false;
            }
          }
        }),
      );
    });
  };

  const moveTextBlock = (from: number, to: number) => {
    const count = textStore.length;
    if (from === to || from < 0 || from >= count || to < 0 || to >= count) {
      return;
    }
    const selected = selectedTextBlockIndex();
    batch(() => {
      setTextStore(
        produce((blocks) => {
          const [block] = blocks.splice(from, 1);
          blocks.splice(to, 0, block);
        }),
      );
      setUIStore("selectedTextBlockIndex", indexAfterMove(selected, from, to));
    });
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

  // Per-block noise seed histories, navigated like undo/redo. They are kept
  // only in memory, so a loaded project starts with fresh histories.
  const [seedHistories, setSeedHistories] = createStore<
    Record<string, SeedHistory | undefined>
  >({});

  // Per-block post edit undo and redo stacks, kept only in memory and only
  // while the content before the post tab stays the same.
  const postHistories = new Map<string, PostHistory>();
  const [postHistoryRevision, setPostHistoryRevision] = createSignal(0);
  const dropPostHistories = (ids: Iterable<string>) => {
    let dropped = false;
    for (const id of ids) dropped = postHistories.delete(id) || dropped;
    if (dropped) setPostHistoryRevision((revision) => revision + 1);
  };

  const replaceTextBlocks = (blocks: ProjectTextBlockProps[]) => {
    batch(() => {
      setSeedHistories(reconcile({}));
      dropPostHistories([...postHistories.keys()]);
      setTextStore(blocks.map((block) => ({ ...block })));
    });
  };

  // Every block's history starts with its seed when the block appears, and
  // is dropped with the block.
  createEffect(() => {
    const ids = new Set(textStore.map((block) => block.id));
    untrack(() =>
      dropPostHistories([...postHistories.keys()].filter((id) => !ids.has(id))),
    );
    untrack(() =>
      setSeedHistories(
        produce((histories) => {
          for (const id of Object.keys(histories))
            if (!ids.has(id)) delete histories[id];
          for (const block of textStore)
            histories[block.id] ??= {
              seeds: [block.pitch_noise_seed],
              index: 0,
            };
        }),
      ),
    );
  });

  // A seed set outside the history (typing, loading) joins it as the newest
  // entry, discarding entries after the current one as a new edit would.
  const syncedSeedHistory = (block: TextBlockProps): SeedHistory => {
    const seed = block.pitch_noise_seed;
    const history = seedHistories[block.id];
    if (history === undefined) return { seeds: [seed], index: 0 };
    if (history.seeds[history.index] === seed)
      return { seeds: [...history.seeds], index: history.index };
    return {
      seeds: [...history.seeds.slice(0, history.index + 1), seed],
      index: history.index + 1,
    };
  };

  /** Records a block's current seed, or a new one, as a history entry. */
  const commitPitchNoiseSeed = (index: number, seed?: number) => {
    const block = textStore[index];
    if (block === undefined) return;
    batch(() => {
      let history = syncedSeedHistory(block);
      if (seed !== undefined && seed !== history.seeds[history.index]) {
        history = {
          seeds: [...history.seeds.slice(0, history.index + 1), seed],
          index: history.index + 1,
        };
        setTextStore(index, "pitch_noise_seed", seed);
      }
      setSeedHistories(block.id, history);
    });
  };

  const canStepSeedHistory = (index: number, delta: -1 | 1) => {
    const block = textStore[index];
    if (block === undefined) return false;
    const history = syncedSeedHistory(block);
    const target = history.index + delta;
    return target >= 0 && target < history.seeds.length;
  };

  const stepSeedHistory = (index: number, delta: -1 | 1) => {
    const block = textStore[index];
    if (block === undefined || !canStepSeedHistory(index, delta)) return;
    const history = syncedSeedHistory(block);
    const target = history.index + delta;
    batch(() => {
      setSeedHistories(block.id, { seeds: history.seeds, index: target });
      setTextStore(index, "pitch_noise_seed", history.seeds[target]);
    });
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

  const markQueryPartModified = (
    index: number,
    part: "accent_is_modified" | "duration_is_modified" | "pitch_is_modified",
  ) => {
    const query = textStore[index]?.query;
    if (query !== null && query !== undefined) {
      setTextStore(index, part, true);
    }
  };

  // Accent and phoneme edits cannot be regenerated by the tuning reset; they
  // only disappear when the query is rebuilt from the block text.
  const markQueryAccentModified = (index: number) =>
    markQueryPartModified(index, "accent_is_modified");
  const markQueryDurationModified = (index: number) =>
    markQueryPartModified(index, "duration_is_modified");
  const markQueryPitchModified = (index: number) =>
    markQueryPartModified(index, "pitch_is_modified");

  const refreshGeneratedQueries = () => {
    batch(() => {
      setTextStore(
        produce((blocks) => {
          for (const block of blocks) {
            if (!isQueryModified(block)) block.query = null;
          }
        }),
      );
      setQueryRefreshVersion((version) => version + 1);
    });
  };

  createEffect(() => {
    if (englishReadingRevision() === 0) return;
    untrack(refreshGeneratedQueries);
  });

  // A new voice setup renders different waveforms, so post edits made on the
  // previous ones no longer apply.
  const clearPostEdits = () =>
    batch(() => {
      dropPostHistories([...postHistories.keys()]);
      setTextStore(
        produce((blocks) => {
          for (const block of blocks) block.post = null;
        }),
      );
    });

  createEffect(() => {
    if (coreRevision() === 0) return;
    untrack(() => {
      spectrogramStore?.clearSpectrogramCache();
      batch(() => {
        clearPostEdits();
        refreshGeneratedQueries();
      });
    });
  });

  const setPostEdit = (index: number, edit: PostEdit | null) => {
    if (textStore[index] === undefined) return;
    setTextStore(index, "post", edit);
  };

  // Setting an object in a store merges it into the previous one, so history
  // entries are copies rather than the store's own objects.
  const postEditSnapshot = (edit: PostEdit | null | undefined, base: string) =>
    edit != null && edit.base === base ? structuredClone(unwrap(edit)) : null;

  /**
   * Saves a block's post edit made on content `base` as an undoable step,
   * unless it equals the current one.
   */
  const commitPostEdit = (
    index: number,
    base: string,
    edit: PostEdit | null,
  ) => {
    const block = textStore[index];
    if (block === undefined) return;
    const current = postEditSnapshot(block.post, base);
    if (JSON.stringify(current) === JSON.stringify(edit)) return;
    const history = postHistories.get(block.id);
    const undo = history?.base === base ? history.undo : [];
    postHistories.set(block.id, {
      base,
      undo: [...undo, current].slice(-POST_HISTORY_LIMIT),
      redo: [],
    });
    batch(() => {
      setPostHistoryRevision((revision) => revision + 1);
      setPostEdit(index, edit);
    });
  };

  const canStepPostHistory = (
    index: number,
    direction: PostHistoryDirection,
  ) => {
    postHistoryRevision();
    const block = textStore[index];
    if (block === undefined) return false;
    return (postHistories.get(block.id)?.[direction].length ?? 0) > 0;
  };

  /** Restores the post edit before (undo) or after (redo) the current one. */
  const stepPostHistory = (index: number, direction: PostHistoryDirection) => {
    const block = textStore[index];
    const history = block && postHistories.get(block.id);
    if (block === undefined || history === undefined) return;
    const stack = [...history[direction]];
    if (stack.length === 0) return;
    const target = stack.pop()!;
    const current = postEditSnapshot(block.post, history.base);
    const opposite = direction === "undo" ? "redo" : "undo";
    postHistories.set(block.id, {
      ...history,
      [direction]: stack,
      [opposite]: [...history[opposite], current],
    });
    batch(() => {
      setPostHistoryRevision((revision) => revision + 1);
      setPostEdit(index, target);
    });
  };

  // Post edits depend on the content before them: once a block's synthesized
  // query or style no longer matches the one they were made on, they and the
  // block's post history are dropped. Blocks whose query is regenerating or
  // whose preset cannot be resolved yet keep them until they can be compared.
  createEffect(() => {
    postHistoryRevision();
    textStore.forEach((block, index) => {
      const edit = block.post;
      const history = postHistories.get(block.id);
      if ((edit == null && history === undefined) || block.query === null) {
        return;
      }
      const preset = findPresetById(projectPresetStore, block.preset_id);
      if (preset === null || findPresetStyle(preset, metas) === null) return;
      // Reading through the store proxies tracks every nested query and
      // preset field, so any edit before the post tab is noticed.
      const base = postEditBase(
        getModifiedQuery(block.query, preset),
        preset.style_id,
      );
      untrack(() =>
        batch(() => {
          if (history !== undefined && history.base !== base) {
            dropPostHistories([block.id]);
          }
          if (edit != null && edit.base !== base) setPostEdit(index, null);
        }),
      );
    });
  });

  const resetQueryEdits = (index: number) => {
    batch(() => {
      setTextStore(index, "query", null);
      setTextStore(index, "accent_is_modified", false);
      setTextStore(index, "duration_is_modified", false);
      setTextStore(index, "pitch_is_modified", false);
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
      const isArrow = event.key === "ArrowUp" || event.key === "ArrowDown";
      const isEnter = event.key === "Enter";
      if (!isArrow && !isEnter) return;
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
      if (isEnter) {
        const selectedBlock = textStore[current];
        if (selectedBlock === undefined) return;
        const saved = uiStore.lastFocusedCaret;
        event.preventDefault();
        batch(() => {
          setSuppressFocusBlockId(null);
          setPendingFocusPlacement({
            blockId: selectedBlock.id,
            placement: "end",
            offset:
              saved?.blockId === selectedBlock.id ? saved.offset : undefined,
          });
        });
        return;
      }
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
    insertTextBlocksBelow,
    moveTextBlock,
    updateProjectPreset,
    selectedTextBlock,
    selectedTextBlockIndex,
    createFirstTextBlock,
    markQueryAccentModified,
    markQueryDurationModified,
    markQueryPitchModified,
    queryRefreshVersion,
    queryPending,
    beginQueryUpdate,
    refreshGeneratedQueries,
    resetQueryEdits,
    setPostEdit,
    commitPostEdit,
    canStepPostHistory,
    stepPostHistory,
    replaceTextBlocks,
    commitPitchNoiseSeed,
    canStepSeedHistory,
    stepSeedHistory,
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
