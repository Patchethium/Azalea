import { commands, type Preset, type StyleId } from "$binding";
import type { ExportAllFailure } from "@dialogs/ExportAll";
import { createScheduled, throttle } from "@solid-primitives/scheduled";
import {
  open as openDialog,
  save as saveDialog,
} from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { produce, unwrap } from "solid-js/store";
import { useConfigStore } from "@contexts/config";
import { usei18n } from "@contexts/i18n";
import { useMetaStore } from "@contexts/meta";
import { useShortcutsStore } from "@contexts/shortcuts";
import {
  createPresetId,
  createTextBlock,
  findPresetById,
  findPresetStyle,
  useTextStore,
} from "@contexts/text";
import { type PendingProjectAction, useUIStore } from "@contexts/ui";
import { createAudioFileName, getModifiedQuery, parseSrt } from "$utils";

export function useSidebar() {
  const { availableStyleIds, metas } = useMetaStore()!;
  const { uiStore, setUIStore } = useUIStore()!;
  const {
    textStore,
    setTextStore,
    projectPresetStore,
    setProjectPresetStore,
    project,
    projectPath,
    setProjectPath,
    selectedTextBlock,
    selectedTextBlockIndex,
    replaceTextBlocks,
    removeProjectPreset,
    newProject,
    isProjectDirty,
    markProjectSaved,
    setSuppressFocusBlockId,
    setPendingFocusPlacement,
  } = useTextStore()!;
  const { config, setConfig } = useConfigStore()!;
  const { isApplicationShortcutAllowed, matchesShortcut } =
    useShortcutsStore()!;
  const { t1 } = usei18n()!;
  const currentText = selectedTextBlock;

  const setStyleId = (styleId: StyleId) => {
    const presetId = currentText()?.preset_id;
    const presetIndex = projectPresetStore.findIndex(
      (preset) => preset.id === presetId,
    );
    const styleChanged =
      presetIndex !== -1 &&
      projectPresetStore[presetIndex]?.style_id !== styleId;
    const speaker = metas.find((candidate) =>
      candidate.styles.some((style) => style.id === styleId),
    );
    const style = speaker?.styles.find((candidate) => candidate.id === styleId);
    if (
      presetId == null ||
      presetIndex === -1 ||
      speaker === undefined ||
      style === undefined
    )
      return;
    batch(() => {
      setProjectPresetStore(presetIndex, "style_id", styleId);
      setProjectPresetStore(presetIndex, "speaker_uuid", speaker.speaker_uuid);
      setProjectPresetStore(presetIndex, "style_name", style.name);
      if (styleChanged) {
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
      }
    });
  };

  const [presetManagerOpen, setPresetManagerOpen] = createSignal(false);
  const [speakerSelectionOpen, setSpeakerSelectionOpen] = createSignal(false);
  const [aboutOpen, setAboutOpen] = createSignal(false);

  const currentPreset = createMemo(() =>
    findPresetById(projectPresetStore, currentText()?.preset_id),
  );
  const currentPresetIndex = createMemo(() =>
    projectPresetStore.findIndex(
      (preset) => preset.id === currentText()?.preset_id,
    ),
  );
  const currentStyleIdentity = createMemo(() => {
    const preset = currentPreset();
    return preset === null ? null : findPresetStyle(preset, metas);
  });
  const curMeta = () => currentStyleIdentity()?.speaker;
  const curStyle = () => currentStyleIdentity()?.style;
  const availableStyleNames = () =>
    curMeta()?.styles.map((style) => style.name) ?? [];
  const availableSpeakerNames = () => metas.map((meta) => meta.name);
  const selectSpeakerByName = (name: string) => {
    const speaker = metas.find((meta) => meta.name === name);
    if (speaker?.styles[0]) setStyleId(speaker.styles[0].id);
  };
  const setStyleByName = (name: string) => {
    const style = curMeta()?.styles.find(
      (candidate) => candidate.name === name,
    );
    if (style) setStyleId(style.id);
  };
  const createPresetSetter = (key: keyof Preset) => (value: number) => {
    const presetIndex = currentPresetIndex();
    if (presetIndex !== -1) setProjectPresetStore(presetIndex, key, value);
  };
  const pitch = createMemo(() => currentPreset()?.pitch);
  const speed = createMemo(() => currentPreset()?.speed);
  const intonation = createMemo(() => currentPreset()?.intonation);
  const volume = createMemo(() => currentPreset()?.volume);
  const startSli = createMemo(() => currentPreset()?.start_slience);
  const endSli = createMemo(() => currentPreset()?.end_slience);
  const setPresetName = (name: string) => {
    const presetIndex = currentPresetIndex();
    if (presetIndex !== -1) setProjectPresetStore(presetIndex, "name", name);
  };
  const setTextPresetIdx = (presetIndex: number) => {
    const block = currentText();
    const nextPreset = projectPresetStore[presetIndex];
    const nextPresetId = nextPreset?.id;
    if (block === null || nextPresetId === undefined) return;
    const previousStyle = findPresetById(
      projectPresetStore,
      block.preset_id,
    )?.style_id;
    batch(() => {
      setTextStore(selectedTextBlockIndex(), "preset_id", nextPresetId);
      if (previousStyle !== nextPreset.style_id) {
        setTextStore(selectedTextBlockIndex(), "accent_is_modified", false);
        setTextStore(selectedTextBlockIndex(), "duration_is_modified", false);
        setTextStore(selectedTextBlockIndex(), "pitch_is_modified", false);
      }
    });
  };

  const createPreset = () => {
    const presetIndex = projectPresetStore.length;
    const preset: Preset = {
      ...(currentPreset() ?? {
        speed: 100,
        pitch: 0,
        intonation: 1,
        volume: 1,
        start_slience: 200,
        end_slience: 200,
        style_id: Math.min(...availableStyleIds()),
        speaker_uuid: null,
        style_name: null,
      }),
      id: createPresetId(),
      name: t1("preset.new_preset"),
    };
    setProjectPresetStore(presetIndex, preset);
    setTextPresetIdx(presetIndex);
  };
  const removePreset = () => {
    const presetId = currentText()?.preset_id;
    if (presetId == null) return;
    const index = removeProjectPreset(presetId);
    if (index !== -1 && projectPresetStore.length > 0) {
      setTextPresetIdx(Math.max(0, index - 1));
    }
  };

  const [actionMenuOpen, setActionMenuOpen] = createSignal(false);
  const saveProject = async () => {
    let path = projectPath();
    if (path === null) {
      path = await saveDialog({
        title: "Save Project",
        filters: [{ name: "Azalea Poject Files", extensions: ["azp"] }],
      });
      if (path === null) return false;
    }
    const result = await commands.saveProject(project, path, true);
    if (result.status === "error") {
      console.error(result.error);
      return false;
    }
    batch(() => {
      setProjectPath(path);
      markProjectSaved();
    });
    return true;
  };

  const [resolvingProjectAction, setResolvingProjectAction] =
    createSignal(false);

  const runProjectAction = async (action: PendingProjectAction) => {
    try {
      switch (action) {
        case "new":
          newProject();
          break;
        case "open":
          await loadProject();
          break;
        case "close":
          await getCurrentWindow().destroy();
          break;
        case "quit":
          await commands.quit();
          break;
      }
    } catch (error) {
      console.error(`Failed to run project action ${action}:`, error);
    }
  };

  const requestProjectAction = (action: PendingProjectAction) => {
    if (isProjectDirty()) {
      setUIStore("pendingProjectAction", action);
      return;
    }
    void runProjectAction(action);
  };

  const resolveProjectAction = async (
    choice: "save" | "discard" | "cancel",
  ) => {
    const action = uiStore.pendingProjectAction;
    if (action === null || resolvingProjectAction()) return;
    if (choice === "cancel") {
      setUIStore("pendingProjectAction", null);
      return;
    }
    if (choice === "discard") {
      setUIStore("pendingProjectAction", null);
      await runProjectAction(action);
      return;
    }
    setResolvingProjectAction(true);
    try {
      if (await saveProject()) {
        setUIStore("pendingProjectAction", null);
        await runProjectAction(action);
      }
    } finally {
      setResolvingProjectAction(false);
    }
  };

  onMount(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        !isApplicationShortcutAllowed(event) ||
        !matchesShortcut(event, "save_project")
      ) {
        return;
      }
      event.preventDefault();
      void saveProject();
    };
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });

  const loadProject = async () => {
    const path = await openDialog({
      title: t1("menu.load_project"),
      filters: [{ name: "Azalea Poject Files", extensions: ["azp"] }],
    });
    if (path === null) return;
    const result = await commands.loadProject(path);
    if (result.status === "error") {
      console.error(result.error);
      return;
    }
    batch(() => {
      setProjectPath(path);
      replaceTextBlocks(result.data.blocks);
      setProjectPresetStore(result.data.presets);
      setSuppressFocusBlockId(null);
      setPendingFocusPlacement(null);
      setUIStore("selectedTextBlockIndex", 0);
    });
    markProjectSaved();
  };

  const importSrt = async () => {
    const path = await openDialog({
      title: t1("menu.import_srt"),
      filters: [{ name: "SRT Subtitle Files", extensions: ["srt"] }],
    });
    if (path === null) return;
    const result = await commands.readTextFile(path);
    if (result.status === "error") {
      console.error(result.error);
      return;
    }
    const texts = parseSrt(result.data);
    if (texts.length === 0) return;
    const presetId =
      currentText()?.preset_id ?? projectPresetStore[0]?.id ?? null;
    const startIndex = textStore.length;
    batch(() => {
      setTextStore(
        produce((blocks) => {
          for (const text of texts) {
            blocks.push(createTextBlock(presetId, text));
          }
        }),
      );
      setUIStore("selectedTextBlockIndex", startIndex);
    });
  };

  const [exportAllOpen, setExportAllOpen] = createSignal(false);
  const [exportAllRunning, setExportAllRunning] = createSignal(false);
  const [exportAllCancelling, setExportAllCancelling] = createSignal(false);
  const [exportAllFinished, setExportAllFinished] = createSignal(0);
  const [exportAllTotal, setExportAllTotal] = createSignal(0);
  const [exportAllCancelled, setExportAllCancelled] = createSignal(false);
  const [exportAllFailures, setExportAllFailures] = createSignal<
    ExportAllFailure[]
  >([]);
  const [exportAllOutputDir, setExportAllOutputDir] = createSignal<
    string | null
  >(null);
  let exportAllCancelRequested = false;

  const resetExportAll = (total: number) => {
    exportAllCancelRequested = false;
    setExportAllFailures([]);
    setExportAllFinished(0);
    setExportAllTotal(total);
    setExportAllCancelled(false);
    setExportAllCancelling(false);
    setExportAllOutputDir(null);
  };

  const exportAll = async () => {
    if (exportAllRunning()) return;
    const exportable = textStore
      .map((block, index) => ({ block, index }))
      .filter(({ block }) => block.text !== "");

    const pinnedDir = config.ui.default_export_dir_enabled
      ? config.ui.default_export_dir
      : undefined;
    const silentExportDir = config.ui.silent_save ? pinnedDir : undefined;
    let dir = silentExportDir;
    if (dir == null && exportable.length > 0) {
      let initialDir = pinnedDir ?? config.ui.last_exported_dir;
      if (initialDir == null) {
        initialDir = (await commands.homeDir()) ?? ".";
      }
      const selectedDir = await openDialog({
        directory: true,
        multiple: false,
        title: t1("menu.export_all"),
        defaultPath: initialDir,
      });
      if (selectedDir === null) return;
      dir = selectedDir;
    }

    resetExportAll(exportable.length);
    setExportAllOpen(true);
    if (dir == null) return;

    setExportAllOutputDir(dir);
    setExportAllRunning(true);

    const preventOverwrite = config.ui.prevent_overwrite === true;
    let savedDir: string | null = null;
    let finished = 0;
    const recordFailure = (failure: ExportAllFailure) => {
      setExportAllFailures((failures) => [...failures, failure]);
    };

    try {
      for (const { block, index } of exportable) {
        if (exportAllCancelRequested) break;
        try {
          const preset = findPresetById(projectPresetStore, block.preset_id);
          const identity =
            preset === null ? null : findPresetStyle(preset, metas);
          if (preset === null || identity === null) {
            recordFailure({
              blockId: block.id,
              index,
              text: block.text,
              error: t1("export_all.error.no_preset"),
            });
          } else {
            let query = block.query;
            if (query === null || query.accent_phrases.length === 0) {
              const fetched = await commands.audioQuery(
                block.text,
                identity.style.id,
                block.pitch_noise_seed,
              );
              if (fetched.status === "error") {
                recordFailure({
                  blockId: block.id,
                  index,
                  text: block.text,
                  error: fetched.error,
                });
                query = null;
              } else {
                query = fetched.data;
              }
            }
            if (query !== null) {
              const fileName = `${createAudioFileName(block.text, config.ui.name_truncation_len)}.wav`;
              const targetPath = await commands.joinPath(dir, fileName);
              const result = await commands.saveAudio(
                targetPath,
                getModifiedQuery(unwrap(query), preset),
                identity.style.id,
                preventOverwrite,
              );
              if (result.status === "ok") {
                if (savedDir === null) {
                  try {
                    savedDir = (await commands.parentPath(result.data)) ?? dir;
                  } catch (error) {
                    console.error(error);
                    savedDir = dir;
                  }
                }
              } else {
                recordFailure({
                  blockId: block.id,
                  index,
                  text: block.text,
                  error: result.error,
                });
              }
            }
          }
        } catch (error) {
          recordFailure({
            blockId: block.id,
            index,
            text: block.text,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        finished += 1;
        setExportAllFinished(finished);
      }
    } finally {
      setExportAllRunning(false);
      setExportAllCancelling(false);
      if (exportAllCancelRequested) setExportAllCancelled(true);
      if (savedDir !== null) {
        setExportAllOutputDir(savedDir);
        setConfig("ui", "last_exported_dir", savedDir);
      }
    }
  };

  const cancelExportAll = () => {
    if (!exportAllRunning()) return;
    exportAllCancelRequested = true;
    setExportAllCancelling(true);
  };

  const closeExportAll = () => {
    if (exportAllRunning()) {
      cancelExportAll();
      return;
    }
    setExportAllOpen(false);
  };

  const scheduledSave = createScheduled((fn) => throttle(fn, 500));
  createEffect(() => {
    JSON.stringify(project);
    if (
      scheduledSave() &&
      config.ui.auto_save &&
      projectPath() !== null &&
      isProjectDirty()
    ) {
      void saveProject();
    }
  });

  const movePreset = (index: number, offset: -1 | 1) => {
    const nextIndex = index + offset;
    if (index < 0 || nextIndex < 0 || nextIndex >= projectPresetStore.length) {
      return;
    }
    const presets = [...projectPresetStore];
    [presets[index], presets[nextIndex]] = [presets[nextIndex], presets[index]];
    setProjectPresetStore(presets);
  };

  return {
    metas,
    uiStore,
    setUIStore,
    projectPresetStore,
    currentText,
    currentPreset,
    currentPresetIndex,
    curMeta,
    curStyle,
    availableStyleNames,
    availableSpeakerNames,
    selectSpeakerByName,
    setStyleByName,
    setStyleId,
    pitch,
    speed,
    intonation,
    volume,
    startSli,
    endSli,
    setPitch: createPresetSetter("pitch"),
    setSpeed: createPresetSetter("speed"),
    setIntonation: createPresetSetter("intonation"),
    setVolume: createPresetSetter("volume"),
    setStartSli: createPresetSetter("start_slience"),
    setEndSli: createPresetSetter("end_slience"),
    setPresetName,
    setTextPresetIdx,
    createPreset,
    removePreset,
    movePreset,
    presetManagerOpen,
    setPresetManagerOpen,
    speakerSelectionOpen,
    setSpeakerSelectionOpen,
    aboutOpen,
    setAboutOpen,
    actionMenuOpen,
    setActionMenuOpen,
    newProject,
    loadProject,
    saveProject,
    importSrt,
    exportAll,
    cancelExportAll,
    closeExportAll,
    exportAllOpen,
    exportAllRunning,
    exportAllCancelling,
    exportAllFinished,
    exportAllTotal,
    exportAllCancelled,
    exportAllFailures,
    exportAllOutputDir,
    requestProjectAction,
    resolveProjectAction,
    resolvingProjectAction,
  };
}

export type SidebarControls = ReturnType<typeof useSidebar>;
