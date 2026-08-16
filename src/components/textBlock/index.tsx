import { type AudioQuery, commands } from "$binding";
import { useTextBlockSynthesis } from "@components/textBlock/useSynthesis";
import { TextBlockView } from "@components/textBlock/View";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import _ from "lodash";
import { batch, createEffect, createMemo, on, onCleanup } from "solid-js";
import { produce, unwrap } from "solid-js/store";
import { useConfigStore } from "@contexts/config";
import { useMetaStore } from "@contexts/meta";
import {
  findPresetById,
  findPresetStyle,
  type TextBlockProps,
  useTextStore,
} from "@contexts/text";
import { useUIStore } from "@contexts/ui";
import { getModifiedQuery } from "$utils";

export { synthesisRequestFingerprint } from "@components/textBlock/useSynthesis";

function TextBlock(props: { index: number }) {
  const {
    textStore,
    setTextStore,
    projectPresetStore,
    selectedTextBlockIndex,
    insertTextBlockBelow,
  } = useTextStore()!;
  const { metas } = useMetaStore()!;
  const { setUIStore } = useUIStore()!;
  const { config, setConfig } = useConfigStore()!;
  const currentText = createMemo(() => textStore[props.index]);
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
      ],
      ([blockId, text, styleId], previousInput) => {
        const sourceBlock = currentText();
        const requestRevision = ++queryRequestRevision;
        if (text === "") {
          fetchAudioQuery.cancel();
          setQuery(null);
        } else if (
          (previousInput === undefined || previousInput[0] !== blockId) &&
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
    const truncationLength = config.ui_config.name_truncation_len;
    if (truncationLength !== 0 && truncationLength !== undefined) {
      fileName = _.truncate(fileName, {
        length: truncationLength,
        omission:
          fileName.length < truncationLength
            ? ""
            : `+${(fileName.length - truncationLength).toString()}`,
      });
    }
    const lastSavedDir = config.ui_config.last_exported_dir ?? ".";
    const targetPath = await commands.joinPath(lastSavedDir, fileName);
    let path = await saveDialog({
      title: "Save Audio",
      filters: [{ name: "Audio", extensions: ["wav"] }],
      defaultPath: targetPath,
    });
    if (path === null) return;
    if (!path.endsWith(".wav")) path = path.concat(".wav");
    const result = await commands.saveAudio(
      path,
      getModifiedQuery(unwrap(currentText().query!), preset),
      preset.style_id,
    );
    if (result.status === "ok") {
      const parent = await commands.parentPath(path);
      setConfig("ui_config", "last_exported_dir", parent);
    } else {
      console.error(result.error);
    }
  };

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
      saveAudio={saveAudio}
      moveUp={moveUp}
      moveDown={moveDown}
      remove={remove}
      synthState={synthState()}
      synthStateText={synthStateText}
      synthStateIcon={synthStateIcon}
    />
  );
}

export default TextBlock;
