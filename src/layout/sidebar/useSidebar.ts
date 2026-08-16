import { commands, type Preset, type StyleId } from "$binding";
import { createScheduled, throttle } from "@solid-primitives/scheduled";
import {
  open as openDialog,
  save as saveDialog,
} from "@tauri-apps/plugin-dialog";
import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { produce } from "solid-js/store";
import { useConfigStore } from "@contexts/config";
import { usei18n } from "@contexts/i18n";
import { useMetaStore } from "@contexts/meta";
import { useSystemStore } from "@contexts/system";
import {
  createPresetId,
  findPresetById,
  findPresetStyle,
  useTextStore,
} from "@contexts/text";
import { useUIStore } from "@contexts/ui";
import {
  isApplicationShortcutAllowed,
  matchesShortcut,
  resolveShortcut,
} from "../../shortcuts";

export function useSidebar() {
  const { availableStyleIds, metas } = useMetaStore()!;
  const { uiStore, setUIStore } = useUIStore()!;
  const {
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
  } = useTextStore()!;
  const { config, setConfig } = useConfigStore()!;
  const { systemStore } = useSystemStore()!;
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
              if (block.preset_id === presetId) block.query_is_modified = false;
            }
          }),
        );
      }
    });
  };

  const [collapsedPresetPanelSize, setCollapsedPresetPanelSize] =
    createSignal(0.05);
  const [expanded, setExpanded] = createSignal(["preset"]);
  const [presetPanelSize, setPresetPanelSize] = createSignal(0.9);
  const [presetPanelMaxSize, setPresetPanelMaxSize] = createSignal(1);
  const [presetPanelSizes, setPresetPanelSizes] = createSignal([0.1, 0.9]);
  const [resizingPresetPanel, setResizingPresetPanel] = createSignal(false);
  const [presetManagerOpen, setPresetManagerOpen] = createSignal(false);
  const [speakerSelectionOpen, setSpeakerSelectionOpen] = createSignal(false);
  const [aboutOpen, setAboutOpen] = createSignal(false);
  let presetSplitter!: HTMLDivElement;
  let presetResizeHandle!: HTMLButtonElement;
  let presetResizeHandleHeight = 0;
  let presetPanelHeader!: HTMLHeadingElement;
  let presetPanelContent!: HTMLDivElement;
  let presetPanelObserver: ResizeObserver | undefined;
  let updatePresetPanelBounds = () => {};
  let expandPresetPanelOnResize = false;

  onMount(() => {
    updatePresetPanelBounds = () => {
      const rootHeight = presetSplitter.offsetHeight;
      const headerHeight = presetPanelHeader.offsetHeight + 2;
      const contentHeight = presetPanelContent.scrollHeight + 1;
      if (rootHeight === 0 || headerHeight === 2 || contentHeight === 1) return;
      presetResizeHandleHeight = Math.max(
        presetResizeHandleHeight,
        presetResizeHandle.offsetHeight,
      );
      const collapsedSize = headerHeight / rootHeight;
      const availableHeight = Math.max(
        rootHeight - presetResizeHandleHeight,
        1,
      );
      const maxSize = Math.min(
        (headerHeight + contentHeight) / availableHeight,
        1,
      );
      const shouldExpand = expandPresetPanelOnResize;
      const size = shouldExpand
        ? maxSize
        : expanded().length > 0
          ? Math.min(presetPanelSizes()[1], maxSize)
          : collapsedSize;
      expandPresetPanelOnResize = false;
      batch(() => {
        setCollapsedPresetPanelSize(collapsedSize);
        setPresetPanelMaxSize(maxSize);
        if (shouldExpand) {
          setExpanded(["preset"]);
          setPresetPanelSize(maxSize);
        }
        setPresetPanelSizes([1 - size, size]);
      });
    };
    presetPanelObserver = new ResizeObserver(updatePresetPanelBounds);
    presetPanelObserver.observe(presetSplitter);
    presetPanelObserver.observe(presetPanelContent);
    queueMicrotask(updatePresetPanelBounds);
    onCleanup(() => presetPanelObserver?.disconnect());
  });

  const collapsePresetPanel = () => {
    setResizingPresetPanel(false);
    const size = collapsedPresetPanelSize();
    batch(() => {
      setExpanded([]);
      setPresetPanelSizes([1 - size, size]);
    });
  };
  const finishPresetPanelResize = () => {
    if (!resizingPresetPanel()) return;
    setResizingPresetPanel(false);
    if (expanded().length > 0) setPresetPanelSize(presetPanelSizes()[1]);
  };

  const currentPreset = createMemo(() =>
    findPresetById(projectPresetStore, currentText()?.preset_id),
  );
  let hadCurrentPreset = currentPreset() !== null;
  createEffect(() => {
    const hasCurrentPreset = currentPreset() !== null;
    if (!hadCurrentPreset && hasCurrentPreset) {
      expandPresetPanelOnResize = true;
      queueMicrotask(() => updatePresetPanelBounds());
    }
    hadCurrentPreset = hasCurrentPreset;
  });
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
    if (block === null || nextPreset === undefined) return;
    const previousStyle = findPresetById(
      projectPresetStore,
      block.preset_id,
    )?.style_id;
    batch(() => {
      setTextStore(selectedTextBlockIndex(), "preset_id", nextPreset.id);
      if (previousStyle !== nextPreset.style_id) {
        setTextStore(selectedTextBlockIndex(), "query_is_modified", false);
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
  const autoSave = createMemo(() => config.ui_config.auto_save);
  const setAutoSave = (value: boolean) => {
    setConfig("ui_config", "auto_save", value);
  };
  const saveProject = async () => {
    let path = projectPath();
    if (path === null) {
      path = await saveDialog({
        title: "Save Project",
        filters: [{ name: "Azalea Poject Files", extensions: ["azp"] }],
      });
      if (path === null) return;
      setProjectPath(path);
    }
    const result = await commands.saveProject(project, path, true);
    if (result.status === "error") console.error(result.error);
  };

  onMount(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        !isApplicationShortcutAllowed(event) ||
        !matchesShortcut(
          event,
          resolveShortcut(config.ui_config.shortcuts, "save_project"),
          systemStore.os,
        )
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
      setUIStore("selectedTextBlockIndex", 0);
    });
  };

  const scheduledSave = createScheduled((fn) => throttle(fn, 500));
  createEffect(() => {
    JSON.stringify(project);
    if (
      scheduledSave() &&
      config.ui_config.auto_save &&
      projectPath() !== null
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
    expanded,
    setExpanded,
    presetPanelSize,
    setPresetPanelSize,
    presetPanelMaxSize,
    presetPanelSizes,
    setPresetPanelSizes,
    resizingPresetPanel,
    setResizingPresetPanel,
    collapsePresetPanel,
    finishPresetPanelResize,
    presetManagerOpen,
    setPresetManagerOpen,
    speakerSelectionOpen,
    setSpeakerSelectionOpen,
    aboutOpen,
    setAboutOpen,
    actionMenuOpen,
    setActionMenuOpen,
    autoSave,
    setAutoSave,
    newProject,
    loadProject,
    saveProject,
    setPresetSplitter: (element: HTMLDivElement) => {
      presetSplitter = element;
    },
    setPresetResizeHandle: (element: HTMLButtonElement) => {
      presetResizeHandle = element;
    },
    setPresetPanelHeader: (element: HTMLHeadingElement) => {
      presetPanelHeader = element;
    },
    setPresetPanelContent: (element: HTMLDivElement) => {
      if (presetPanelContent)
        presetPanelObserver?.unobserve(presetPanelContent);
      presetPanelContent = element;
      presetPanelObserver?.observe(element);
      queueMicrotask(updatePresetPanelBounds);
    },
  };
}

export type SidebarControls = ReturnType<typeof useSidebar>;
