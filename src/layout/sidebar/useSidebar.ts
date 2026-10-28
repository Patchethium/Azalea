import {
  type AudioSequenceItem,
  commands,
  events,
  type Preset,
  type StyleId,
} from "$binding";
import { useToasts } from "@components/toast";
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
  styleIdentityPatch,
  useTextStore,
} from "@contexts/text";
import { type PendingProjectAction, useUIStore } from "@contexts/ui";
import {
  createAudioFileName,
  createAudioSidecars,
  addRecentProject,
  createUniqueName,
  getModifiedQuery,
  moveItem,
  parseSrt,
  splitTextIntoBlocks,
} from "$utils";
import { activePostEdit } from "@layout/bottomPanel/post/postEdit";

const projectFileFilters = [
  { name: "Azalea Project Files", extensions: ["azp"] },
];

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
    updateProjectPreset,
    newProject,
    isProjectDirty,
    markProjectSaved,
    setSuppressFocusBlockId,
    setPendingFocusPlacement,
  } = useTextStore()!;
  const { config, setConfig, voicesReady, postProcessingEnabled } =
    useConfigStore()!;
  const { isApplicationShortcutAllowed, matchesShortcut } =
    useShortcutsStore()!;
  const { t1, t2 } = usei18n()!;
  const toasts = useToasts();
  const currentText = selectedTextBlock;

  const setStyleId = (styleId: StyleId) => {
    const presetId = currentText()?.preset_id;
    const patch = styleIdentityPatch(styleId, metas);
    if (presetId == null || patch === null) return;
    updateProjectPreset(presetId, patch);
  };
  const updateCurrentPreset = (patch: Partial<Preset>) => {
    const presetId = currentText()?.preset_id;
    if (presetId != null) updateProjectPreset(presetId, patch);
  };

  const [presetManagerOpen, setPresetManagerOpen] = createSignal(false);
  const [aboutOpen, setAboutOpen] = createSignal(false);
  const [licensesOpen, setLicensesOpen] = createSignal(false);

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
      name: createUniqueName(
        t1("preset.new_preset"),
        projectPresetStore.map((preset) => preset.name),
      ),
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

  const recentProjects = () => config.ui.recent_projects ?? [];
  /** The most recent project other than the one currently open. */
  const previousProject = createMemo(
    () => recentProjects().find((path) => path !== projectPath()) ?? null,
  );
  const rememberRecentProject = (path: string) => {
    if (recentProjects()[0] === path) return;
    setConfig(
      "ui",
      "recent_projects",
      addRecentProject(recentProjects(), path),
    );
  };
  const forgetRecentProject = (path: string) => {
    if (!recentProjects().includes(path)) return;
    setConfig(
      "ui",
      "recent_projects",
      recentProjects().filter((entry) => entry !== path),
    );
  };
  const clearRecentProjects = () => setConfig("ui", "recent_projects", []);
  /**
   * Writes the project to `path` and adopts it as the active project only
   * after the write succeeds. A failed write keeps the previous path, and a
   * write that finishes after another save or load has already changed the
   * active path does not overwrite that newer state.
   */
  const writeProject = async (path: string) => {
    const pathBeforeWrite = projectPath();
    const result = await commands.saveProject(project, path, true);
    if (result.status === "error") {
      console.error(result.error);
      toasts.error(t2("toast.error.save_project", { path }), result.error);
      return false;
    }
    if (projectPath() !== pathBeforeWrite) return true;
    batch(() => {
      setProjectPath(path);
      markProjectSaved();
      rememberRecentProject(path);
    });
    return true;
  };
  const chooseProjectSavePath = (title: string) =>
    saveDialog({
      title,
      defaultPath: projectPath() ?? undefined,
      filters: projectFileFilters,
    });
  const saveProject = async () => {
    const path =
      projectPath() ?? (await chooseProjectSavePath(t1("menu.save_project")));
    if (path === null) return false;
    return writeProject(path);
  };
  /** Always asks for a location; the current path stays active until saved. */
  const saveProjectAs = async () => {
    const path = await chooseProjectSavePath(t1("menu.save_project_as"));
    if (path === null) return false;
    return writeProject(path);
  };

  const [resolvingProjectAction, setResolvingProjectAction] =
    createSignal(false);

  const runProjectAction = async (action: PendingProjectAction) => {
    try {
      if (typeof action === "object") {
        await openProjectPath(action.path);
        return;
      }
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
      const name = typeof action === "object" ? action.kind : action;
      console.error(`Failed to run project action ${name}:`, error);
      toasts.error(t1("toast.error.project_action"), error);
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
      if (!isApplicationShortcutAllowed(event)) return;
      if (matchesShortcut(event, "save_project")) {
        event.preventDefault();
        void saveProject();
      } else if (matchesShortcut(event, "save_project_as")) {
        event.preventDefault();
        void saveProjectAs();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });

  const openProjectPath = async (path: string) => {
    const result = await commands.loadProject(path);
    if (result.status === "error") {
      console.error(result.error);
      toasts.error(t2("toast.error.load_project", { path }), result.error);
      forgetRecentProject(path);
      return false;
    }
    batch(() => {
      setProjectPath(path);
      replaceTextBlocks(result.data.blocks);
      setProjectPresetStore(result.data.presets);
      setSuppressFocusBlockId(null);
      setPendingFocusPlacement(null);
      setUIStore("selectedTextBlockIndex", 0);
      rememberRecentProject(path);
    });
    markProjectSaved();
    return true;
  };

  const loadProject = async () => {
    const path = await openDialog({
      title: t1("menu.load_project"),
      filters: projectFileFilters,
    });
    if (path === null) return;
    await openProjectPath(path);
  };

  const openRecentProject = (path: string) =>
    requestProjectAction({ kind: "open_recent", path });
  const openPreviousProject = () => {
    const path = previousProject();
    if (path !== null) openRecentProject(path);
  };

  // A project passed to the first launch opens once the voices are ready, so
  // its preset fallbacks resolve against the loaded speaker metadata.
  const [projectListenerReady, setProjectListenerReady] = createSignal(false);
  let startupProjectRequested = false;
  createEffect(() => {
    if (startupProjectRequested || !voicesReady() || !projectListenerReady())
      return;
    startupProjectRequested = true;
    commands
      .takeStartupProject()
      .then((path) => {
        if (path !== null) openRecentProject(path);
      })
      .catch((error) => {
        console.error("Failed to read the startup project:", error);
      });
  });

  // A second application launch with a project path forwards it here; open it
  // like a recent project so unsaved changes are confirmed first.
  onMount(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    onCleanup(() => {
      disposed = true;
      unlisten?.();
    });
    events.openProjectRequested
      .listen(({ payload }) => openRecentProject(payload.path))
      .then((stop) => {
        if (disposed) stop();
        else {
          unlisten = stop;
          setProjectListenerReady(true);
        }
      })
      .catch((error) => {
        console.error("Failed to listen for open project requests:", error);
      });
  });

  /**
   * Picks a text file, reads it as UTF-8, and appends one block per entry
   * returned by `parse`, using the current block's preset.
   */
  const importTextFile = async (options: {
    title: string;
    filterName: string;
    extensions: string[];
    errorTitle: (path: string) => string;
    parse: (content: string) => string[];
  }) => {
    const path = await openDialog({
      title: options.title,
      filters: [{ name: options.filterName, extensions: options.extensions }],
    });
    if (path === null) return;
    const result = await commands.readTextFile(path);
    if (result.status === "error") {
      console.error(result.error);
      toasts.error(options.errorTitle(path), result.error);
      return;
    }
    const texts = options.parse(result.data);
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

  const importSrt = () =>
    importTextFile({
      title: t1("menu.import_srt"),
      filterName: "SRT Subtitle Files",
      extensions: ["srt"],
      errorTitle: (path) => t2("toast.error.import_srt", { path }),
      parse: parseSrt,
    });

  const importText = () =>
    importTextFile({
      title: t1("menu.import_text"),
      filterName: "Text Files",
      extensions: ["txt"],
      errorTitle: (path) => t2("toast.error.import_text", { path }),
      parse: splitTextIntoBlocks,
    });

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
              const targetPath = await commands.audioExportPath(
                dir,
                createAudioFileName(block.text, config.ui.name_truncation_len),
              );
              const audioQuery = getModifiedQuery(unwrap(query), preset);
              const result = await commands.saveAudio(
                targetPath,
                audioQuery,
                identity.style.id,
                postProcessingEnabled()
                  ? activePostEdit(block, audioQuery, identity.style.id)
                  : null,
                preventOverwrite,
                createAudioSidecars(config.ui, block.text),
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

  const openOutputDir = async (path: string) => {
    try {
      const result = await commands.openPathLocation(path);
      if (result.status === "error") {
        toasts.error(t1("toast.error.open_output_dir"), result.error);
      }
    } catch (error) {
      toasts.error(t1("toast.error.open_output_dir"), error);
    }
  };

  /** The saved project's file stem, or the first block's text. */
  const combinedAudioFileName = (firstText: string) => {
    const path = projectPath();
    if (path !== null) {
      const stem = (path.split(/[\\/]/).filter(Boolean).pop() ?? "").replace(
        /\.azp$/i,
        "",
      );
      if (stem !== "") return stem;
    }
    return createAudioFileName(firstText, config.ui.name_truncation_len);
  };

  const [exportCombinedRunning, setExportCombinedRunning] = createSignal(false);

  /**
   * Exports every non-empty block, in order, as one WAV. Any block that
   * cannot be prepared aborts the export so the file never silently skips a
   * block.
   */
  const exportCombined = async () => {
    if (exportCombinedRunning()) return;
    const exportable = textStore
      .map((block, index) => ({ block, index }))
      .filter(({ block }) => block.text !== "");
    if (exportable.length === 0) {
      toasts.warning(t1("toast.warning.export_combined_empty"));
      return;
    }

    const fileName = combinedAudioFileName(exportable[0].block.text);
    const pinnedDir = config.ui.default_export_dir_enabled
      ? config.ui.default_export_dir
      : undefined;
    const silentExportDir = config.ui.silent_save ? pinnedDir : undefined;
    const preventOverwrite = config.ui.prevent_overwrite === true;
    const preventOverwriteOnSave = silentExportDir != null && preventOverwrite;

    setExportCombinedRunning(true);
    let path: string | null = null;
    let dismissProgress: (() => void) | null = null;
    try {
      if (silentExportDir != null) {
        path = await commands.audioExportPath(silentExportDir, fileName);
      } else {
        let initialDir = pinnedDir ?? config.ui.last_exported_dir;
        if (initialDir == null) {
          initialDir = (await commands.homeDir()) ?? ".";
        }
        let targetPath = await commands.audioExportPath(initialDir, fileName);
        if (preventOverwrite) {
          const resolved = await commands.resolveAudioSavePath(targetPath);
          if (resolved.status === "ok") {
            targetPath = resolved.data;
          } else {
            console.error(resolved.error);
            toasts.warning(
              t1("toast.warning.resolve_export_path"),
              resolved.error,
            );
          }
        }
        const selectedPath = await saveDialog({
          title: t1("menu.export_all_combined"),
          filters: [{ name: "Audio", extensions: ["wav"] }],
          defaultPath: targetPath,
        });
        if (selectedPath === null) return;
        path = selectedPath;
      }
      if (!path.endsWith(".wav")) path = path.concat(".wav");

      dismissProgress = toasts.progress(t1("toast.exporting_combined"));
      const items: AudioSequenceItem[] = [];
      for (const { block, index } of exportable) {
        const blockError = () =>
          t2("toast.error.export_combined_block", { index: index + 1 });
        const preset = findPresetById(projectPresetStore, block.preset_id);
        const identity =
          preset === null ? null : findPresetStyle(preset, metas);
        if (preset === null || identity === null) {
          toasts.error(blockError(), t1("export_all.error.no_preset"));
          return;
        }
        let query = block.query;
        if (query === null || query.accent_phrases.length === 0) {
          const fetched = await commands.audioQuery(
            block.text,
            identity.style.id,
            block.pitch_noise_seed,
          );
          if (fetched.status === "error") {
            console.error(fetched.error);
            toasts.error(blockError(), fetched.error);
            return;
          }
          query = fetched.data;
        }
        const audioQuery = getModifiedQuery(unwrap(query), preset);
        items.push({
          audio_query: audioQuery,
          speaker_id: identity.style.id,
          post: postProcessingEnabled()
            ? activePostEdit(block, audioQuery, identity.style.id)
            : null,
        });
      }

      const texts = exportable.map(({ block }) => block.text).join("\n");
      const result = await commands.saveCombinedAudio(
        path,
        items,
        preventOverwriteOnSave,
        createAudioSidecars(config.ui, texts),
      );
      dismissProgress();
      dismissProgress = null;
      if (result.status === "error") {
        console.error(result.error);
        toasts.error(t2("toast.error.export_combined", { path }), result.error);
        return;
      }
      const savedPath = result.data;
      toasts.success(t1("toast.combined_audio_exported"), {
        label: t1("toast.open_output_dir"),
        onClick: () => void openOutputDir(savedPath),
      });
      const parent = await commands.parentPath(savedPath);
      setConfig("ui", "last_exported_dir", parent);
    } catch (error) {
      console.error(error);
      toasts.error(
        t2("toast.error.export_combined", { path: path ?? fileName }),
        error,
      );
    } finally {
      dismissProgress?.();
      setExportCombinedRunning(false);
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

  const movePreset = (from: number, to: number) => {
    const count = projectPresetStore.length;
    if (from === to || from < 0 || from >= count || to < 0 || to >= count) {
      return;
    }
    setProjectPresetStore(moveItem(projectPresetStore, from, to));
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
    updateCurrentPreset,
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
    aboutOpen,
    setAboutOpen,
    licensesOpen,
    setLicensesOpen,
    actionMenuOpen,
    setActionMenuOpen,
    newProject,
    loadProject,
    saveProject,
    saveProjectAs,
    recentProjects,
    previousProject,
    openRecentProject,
    openPreviousProject,
    clearRecentProjects,
    importSrt,
    importText,
    exportAll,
    exportCombined,
    exportCombinedRunning,
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
