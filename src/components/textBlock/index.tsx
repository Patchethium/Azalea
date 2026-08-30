import { type AudioQuery, commands } from "$binding";
import { showSuccessToast } from "@components/toast";
import { useTextBlockSynthesis } from "@components/textBlock/useSynthesis";
import { TextBlockView } from "@components/textBlock/View";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import _ from "lodash";
import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
} from "solid-js";
import { produce, unwrap } from "solid-js/store";
import { useConfigStore } from "@contexts/config";
import { usei18n } from "@contexts/i18n";
import { useMetaStore } from "@contexts/meta";
import { useSystemStore } from "@contexts/system";
import {
  findPresetById,
  findPresetStyle,
  type TextBlockProps,
  useTextStore,
} from "@contexts/text";
import { useUIStore } from "@contexts/ui";
import { getModifiedQuery } from "$utils";
import {
  isApplicationShortcutAllowed,
  matchesShortcut,
  resolveShortcut,
} from "$shortcuts";

export { renderRequestFingerprint as synthesisRequestFingerprint } from "$utils";

function TextBlock(props: { index: number }) {
  const {
    textStore,
    setTextStore,
    projectPresetStore,
    selectedTextBlockIndex,
    insertTextBlockBelow,
    queryRefreshVersion,
  } = useTextStore()!;
  const { metas } = useMetaStore()!;
  const { systemStore } = useSystemStore()!;
  const { setUIStore } = useUIStore()!;
  const { config, setConfig } = useConfigStore()!;
  const { t1 } = usei18n()!;
  const currentText = createMemo(() => textStore[props.index]);
  const [caretOffset, setCaretOffset] = createSignal<number | null>(null);
  const currentQuery = createMemo(() => currentText().query);
  const currentPreset = createMemo(() => {
    const preset = findPresetById(projectPresetStore, currentText().preset_id);
    return preset !== null && findPresetStyle(preset, metas) !== null
      ? preset
      : null;
  });

  const setText = (text: string) => {
    setTextStore(props.index, {
      ...currentText(),
      text,
      query_is_modified: false,
    });
  };

  const setQuery = (query: AudioQuery | null) => {
    setTextStore(
      props.index,
      produce((draft) => {
        draft.query = query;
        draft.query_is_modified = false;
      }),
    );
  };

  const currentPresetStyle = createMemo(() => {
    const preset = currentPreset();
    return preset === null ? null : findPresetStyle(preset, metas);
  });

  let queryRequestRevision = 0;
  let disposed = false;
  const fetchAudioQuery = _.throttle(
    async (
      text: string,
      styleId: number,
      requestRevision: number,
      sourceBlock: TextBlockProps,
    ) => {
      const audioQuery = await commands.audioQuery(text, styleId);
      if (
        disposed ||
        requestRevision !== queryRequestRevision ||
        textStore[props.index] !== sourceBlock
      ) {
        return;
      }
      if (audioQuery.status === "ok") setQuery(audioQuery.data);
      else console.error(audioQuery.error);
    },
    500,
  );

  onCleanup(() => {
    disposed = true;
    queryRequestRevision += 1;
    fetchAudioQuery.cancel();
  });

  createEffect(
    on(
      [
        () => currentText().id,
        () => currentText().text,
        () => currentPresetStyle()?.style.id,
        queryRefreshVersion,
      ],
      ([, text, styleId]) => {
        const sourceBlock = currentText();
        const requestRevision = ++queryRequestRevision;
        if (text === "") {
          fetchAudioQuery.cancel();
          setQuery(null);
        } else if (
          sourceBlock.query_is_modified &&
          sourceBlock.query !== null
        ) {
          fetchAudioQuery.cancel();
        } else if (styleId !== undefined) {
          fetchAudioQuery(text, styleId, requestRevision, sourceBlock);
        } else {
          fetchAudioQuery.cancel();
        }
      },
    ),
  );

  const selected = createMemo(() => selectedTextBlockIndex() === props.index);
  const setSelected = (index = props.index) => {
    setUIStore("selectedTextBlockIndex", index);
  };
  const saveable = createMemo(() => {
    const query = currentQuery();
    return query !== null && query.accent_phrases.length > 0;
  });

  const saveAudio = async () => {
    const preset = currentPreset();
    if (preset === null) return;
    let fileName = currentText().text;
    const truncationLength = config.ui.name_truncation_len;
    if (truncationLength !== 0 && truncationLength !== undefined) {
      fileName = _.truncate(fileName, {
        length: truncationLength,
        omission:
          fileName.length < truncationLength
            ? ""
            : `+${(fileName.length - truncationLength).toString()}`,
      });
    }
    const pinnedDir = config.ui.default_export_dir_enabled
      ? config.ui.default_export_dir
      : undefined;
    const silentExportDir = config.ui.silent_save ? pinnedDir : undefined;
    const preventOverwrite = config.ui.prevent_overwrite === true;
    const preventOverwriteOnSave = silentExportDir != null && preventOverwrite;
    let path: string;
    if (silentExportDir != null) {
      path = await commands.joinPath(silentExportDir, fileName);
    } else {
      let lastSavedDir = pinnedDir ?? config.ui.last_exported_dir;
      if (lastSavedDir == null) {
        const home = await commands.homeDir();
        lastSavedDir = home ?? ".";
      }
      let targetPath = await commands.joinPath(lastSavedDir, fileName);
      if (!targetPath.endsWith(".wav")) targetPath = targetPath.concat(".wav");
      if (preventOverwrite) {
        const resolvedPath = await commands.resolveAudioSavePath(targetPath);
        if (resolvedPath.status === "ok") {
          targetPath = resolvedPath.data;
        } else {
          console.error(resolvedPath.error);
        }
      }
      const selectedPath = await saveDialog({
        title: "Save Audio",
        filters: [{ name: "Audio", extensions: ["wav"] }],
        defaultPath: targetPath,
      });
      if (selectedPath === null) return;
      path = selectedPath;
    }
    if (!path.endsWith(".wav")) path = path.concat(".wav");
    const result = await commands.saveAudio(
      path,
      getModifiedQuery(unwrap(currentText().query!), preset),
      preset.style_id,
      preventOverwriteOnSave,
    );
    if (result.status === "ok") {
      showSuccessToast(t1("toast.audio_exported"), t1("toast.close"));
      const parent = await commands.parentPath(result.data);
      setConfig("ui", "last_exported_dir", parent);
    } else {
      console.error(result.error);
    }
  };

  onMount(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        !selected() ||
        !saveable() ||
        !isApplicationShortcutAllowed(event) ||
        !matchesShortcut(
          event,
          resolveShortcut(config.ui.shortcuts, "export_audio"),
          systemStore.os,
        )
      ) {
        return;
      }
      event.preventDefault();
      void saveAudio();
    };
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });

  const moveUp = () => {
    if (props.index > 0) {
      const previous = _.cloneDeep(textStore[props.index - 1]);
      setTextStore(props.index - 1, currentText());
      setTextStore(props.index, previous);
      setSelected(props.index - 1);
    }
  };

  const moveDown = () => {
    if (props.index < textStore.length - 1) {
      const next = _.cloneDeep(textStore[props.index + 1]);
      setTextStore(props.index + 1, currentText());
      setTextStore(props.index, next);
      setSelected(props.index + 1);
    }
  };

  const splitDisabled = createMemo(() => {
    const text = currentText().text;
    if (text === "") return true;
    const offset = caretOffset();
    if (offset === null) return true;
    const clamped = Math.min(Math.max(Math.trunc(offset), 0), text.length);
    return clamped === 0 || clamped === text.length;
  });

  const splitText = () => {
    const text = currentText().text;
    const offset = caretOffset() ?? text.length;
    const clamped = Math.min(Math.max(Math.trunc(offset), 0), text.length);
    batch(() => {
      setTextStore(props.index, {
        ...currentText(),
        text: text.slice(0, clamped),
        query_is_modified: false,
      });
      const nextIndex = insertTextBlockBelow(props.index);
      setTextStore(nextIndex, {
        ...textStore[nextIndex],
        text: text.slice(clamped),
      });
    });
  };

  const remove = () => {
    if (textStore.length === 1) {
      setTextStore(0, { text: "" });
      return;
    }
    const selectedIndex = selectedTextBlockIndex();
    const remainingBlocks = textStore.filter(
      (_, index) => index !== props.index,
    );
    let nextSelectedIndex = selectedIndex;
    if (selectedIndex === props.index) {
      nextSelectedIndex = props.index === 0 ? 0 : props.index - 1;
    } else if (selectedIndex > props.index) {
      nextSelectedIndex = selectedIndex - 1;
    }
    nextSelectedIndex = Math.min(
      Math.max(nextSelectedIndex, 0),
      remainingBlocks.length - 1,
    );
    batch(() => {
      setTextStore(remainingBlocks);
      setUIStore("selectedTextBlockIndex", nextSelectedIndex);
    });
  };

  const currentModifiedQuery = createMemo(() => {
    const preset = currentPreset();
    const query = currentQuery();
    return preset === null || query === null
      ? null
      : getModifiedQuery(query, preset);
  });
  const { synthState, synthStateText, synthStateIcon } = useTextBlockSynthesis({
    index: props.index,
    currentText,
    currentPreset,
    currentModifiedQuery,
  });

  return (
    <TextBlockView
      index={props.index}
      blockCount={textStore.length}
      currentText={currentText()}
      currentPreset={currentPreset()}
      presetAvailable={currentPresetStyle() !== null}
      selected={selected()}
      saveable={saveable()}
      setText={setText}
      setSelected={() => setSelected()}
      addTextBelow={() => insertTextBlockBelow(props.index)}
      splitDisabled={splitDisabled()}
      splitText={splitText}
      saveAudio={saveAudio}
      moveUp={moveUp}
      moveDown={moveDown}
      remove={remove}
      onCaretChange={setCaretOffset}
      synthState={synthState()}
      synthStateText={synthStateText}
      synthStateIcon={synthStateIcon}
    />
  );
}

export default TextBlock;
