import { Button } from "@kobalte/core/button";
import { createScheduled, debounce } from "@solid-primitives/scheduled";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import _ from "lodash";
import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  JSX,
  on,
  onCleanup,
  ParentComponent,
  Show,
  splitProps,
} from "solid-js";
import { produce, unwrap } from "solid-js/store";
import { AudioQuery, commands, SynthState } from "../binding";
import { useConfigStore } from "../contexts/config";
import { usei18n } from "../contexts/i18n";
import { useMetaStore } from "../contexts/meta";
import { type TextBlockProps, useTextStore } from "../contexts/text";
import { useUIStore } from "../contexts/ui";
import { getModifiedQuery } from "../utils";

interface ComponentProps extends JSX.HTMLAttributes<HTMLDivElement> {
  text: string;
  setText: (text: string) => void;
  focused: boolean;
  placeholder: string;
}

function AutogrowInput(props: ComponentProps) {
  const [local, inputProps] = splitProps(props, [
    "text",
    "setText",
    "focused",
    "placeholder",
  ]);
  let inputRef: HTMLDivElement | undefined;

  createEffect(
    on([() => local.text], () => {
      if (inputRef !== undefined) {
        if (local.text !== inputRef.innerText) {
          inputRef.innerText = local.text;
        }
      }
    }),
  );

  createEffect(() => {
    if (local.focused) inputRef?.focus();
  });

  const handleInput = () => {
    if (inputRef !== undefined) {
      const text = inputRef.innerText === "\n" ? "" : inputRef.innerText;
      local.setText(text);
    }
  };

  return (
    <div class="relative w-full">
      <Show when={local.text === ""}>
        <span
          aria-hidden="true"
          class="pointer-events-none absolute inset-0 text-slate-4 dark:text-slate-5"
        >
          {local.placeholder}
        </span>
      </Show>
      <div
        contentEditable="plaintext-only"
        class="relative min-h-6 w-full outline-none"
        {...inputProps}
        ref={inputRef}
        onInput={handleInput}
      />
    </div>
  );
}

const EditButton: ParentComponent<{
  edit: () => void;
  disable?: boolean;
}> = (props) => {
  const disabled = createMemo(() => props.disable ?? false);
  return (
    <Button
      class="group h-6 w-6 bg-transparent rounded-md ui-disabled:(cursor-not-allowed)"
      disabled={disabled()}
      onClick={props.edit}
    >
      {props.children}
    </Button>
  );
};

function TextBlock(props: { index: number }) {
  const {
    textStore,
    setTextStore,
    projectPresetStore,
    selectedTextBlockIndex,
  } = useTextStore()!;
  const { availableStyleIds: availableSpeakerIds } = useMetaStore()!;
  const { setUIStore } = useUIStore()!;
  const { config, setConfig } = useConfigStore()!;
  const { t1 } = usei18n()!;
  const currentText = createMemo(() => textStore[props.index]);
  const currentQuery = createMemo(() => currentText().query);
  const currentPreset = createMemo(() => {
    if (projectPresetStore.length === 0 || currentText().preset_id === null) {
      return null;
    }
    return projectPresetStore[currentText().preset_id ?? 0];
  });

  const [hovered, setHovered] = createSignal(false);
  const [toolbarHovered, setToolbarHovered] = createSignal(false);

  const setText = (text: string) => {
    setTextStore(props.index, { ...currentText(), text });
  };

  const setQuery = (query: AudioQuery | null) => {
    setTextStore(
      props.index,
      produce((draft) => {
        draft.query = query;
      }),
    );
  };

  const isStyleIdValid = createMemo(() => {
    const curPreset = currentPreset();
    if (curPreset === null) {
      return false;
    }
    return availableSpeakerIds().includes(curPreset?.style_id ?? 0);
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
      const audio_query = await commands.audioQuery(text, styleId);
      if (
        disposed ||
        requestRevision !== queryRequestRevision ||
        textStore[props.index] !== sourceBlock
      ) {
        return;
      }
      if (audio_query.status === "ok") {
        setQuery(audio_query.data);
      } else {
        console.error(audio_query.error);
      }
    },
    500,
  );

  onCleanup(() => {
    disposed = true;
    queryRequestRevision++;
    fetchAudioQuery.cancel();
  });

  createEffect(() => {
    const sourceBlock = currentText();
    const curPreset = currentPreset();
    const text = sourceBlock.text;
    const requestRevision = ++queryRequestRevision;
    if (curPreset === null || text === "") {
      fetchAudioQuery.cancel();
      setQuery(null);
    } else if (isStyleIdValid()) {
      fetchAudioQuery(text, curPreset.style_id, requestRevision, sourceBlock);
    } else {
      fetchAudioQuery.cancel();
    }
  });

  const selected = createMemo(() => selectedTextBlockIndex() === props.index);

  const setSelected = (index: number) => {
    setUIStore("selectedTextBlockIndex", index);
  };

  // the toobar actions
  const addTextBelow = () => {
    setTextStore(textStore.length, {
      text: "",
      query: null,
      preset_id: 0,
    });
    // shift every text block below by 1
    for (let i = textStore.length - 1; i > props.index + 1; i--) {
      const temp = textStore[i];
      setTextStore(i, textStore[i - 1]);
      setTextStore(i - 1, temp);
    }
    // clear the below text block
    setTextStore(props.index + 1, {
      text: "",
      preset_id: currentText().preset_id,
    });
    // focus on the new text block
    setUIStore("selectedTextBlockIndex", props.index + 1);
  };

  const saveable = createMemo(() => {
    const query = currentQuery();
    if (query === null) return false;
    if (query.accent_phrases.length === 0) return false;
    return true;
  });

  const saveAudio = async () => {
    if (currentPreset() === null) {
      return;
    }
    let file_name = currentText().text;
    const truncation_len = config.ui_config.name_truncation_len;
    // add indication number for overflow length
    if (truncation_len !== 0 && truncation_len !== undefined) {
      file_name = _.truncate(file_name, {
        length: truncation_len ?? 0,
        omission:
          file_name.length < truncation_len
            ? ""
            : `+${(file_name.length - truncation_len).toString()}`,
      });
    }
    const last_saved_dir = config.ui_config.last_exported_dir ?? ".";
    const target_path = await commands.joinPath(last_saved_dir, file_name);
    let path = await saveDialog({
      title: "Save Audio",
      filters: [{ name: "Audio", extensions: ["wav"] }],
      defaultPath: target_path,
    });
    if (path !== null) {
      if (!path.endsWith(".wav")) {
        path = path.concat(".wav");
      }
      const save_audio = await commands.saveAudio(
        path,
        getModifiedQuery(unwrap(currentText().query!), currentPreset()!),
        currentPreset()?.style_id ?? 0,
      );
      if (save_audio.status === "ok") {
        console.log("Audio saved");
        // save last saved directory into config
        const parent = await commands.parentPath(path);
        setConfig("ui_config", "last_exported_dir", parent);
      } else {
        console.error(save_audio.error);
      }
    }
  };

  const moveUp = () => {
    if (props.index > 0) {
      const temp = _.cloneDeep(textStore[props.index - 1]);
      setTextStore(props.index - 1, currentText());
      setTextStore(props.index, temp);
      setSelected(props.index - 1);
    }
  };

  const moveDown = () => {
    if (props.index < textStore.length - 1) {
      const temp = _.cloneDeep(textStore[props.index + 1]);
      setTextStore(props.index + 1, currentText());
      setTextStore(props.index, temp);
      setSelected(props.index + 1);
    }
  };

  const remove = () => {
    // won't remove them all
    if (textStore.length === 1) {
      setTextStore(0, { text: "" });
      return;
    }
    const selectedIndex = selectedTextBlockIndex();
    const remainingBlocks = textStore.filter((_, i) => i !== props.index);
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

  const [synthState, setSynthState] = createSignal<SynthState>("UnInitialized");

  const synthSchedule = createScheduled((fn) => debounce(fn, 1000));

  const currentModifiedQuery = createMemo(() => {
    const preset = currentPreset();
    const query = currentQuery();
    if (preset === null || query === null) {
      return null;
    }
    return getModifiedQuery(unwrap(query!), preset);
  });

  createEffect(async () => {
    if (synthSchedule() && config.ui_config.buffer_render) {
      setSynthState("Pending");
      const query = currentModifiedQuery();
      if (query === null || currentPreset() === null) {
        setSynthState("UnInitialized");
        return;
      }
      const res = await commands.synthesize(query, currentPreset()!.style_id!);
      if (res.status === "ok") {
        // update the cache in the backend
        setSynthState("Done");
        console.log("Synthesis successful for block", props.index);
      } else {
        setSynthState("UnInitialized");
        console.error(
          "Synthesis failed for block",
          props.index,
          ":",
          res.error,
        );
      }
    }
  });

  const trafficLightNumber = () => {
    if (currentText().query === null || currentPreset() === null) {
      return -1; // all lights off if no query or preset
    }
    switch (synthState()) {
      case "UnInitialized":
        return 0;
      case "Pending":
        return 1;
      case "Done":
        return 2;
    }
  };

  const synthStateText = () => {
    switch (trafficLightNumber()) {
      case -1:
        return t1("text_block.synth_state.no_query");
      case 0:
        return t1("text_block.synth_state.not_started");
      case 1:
        return t1("text_block.synth_state.in_progress");
      case 2:
        return t1("text_block.synth_state.completed");
      default:
        return "";
    }
  };

  return (
    <div class="py-1.5">
      <div
        class="flex flex-col relative px3 pb1 b-l-2 b-slate-2 dark:b-slate-6 bg-white dark:bg-slate-8"
        classList={{ " !border-primary-5 shadow-md": selected() }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* The jupyter/Google Colab notebook style code block */}
        <div
          class="sticky flex h-0 top-5 bg-transparent pointer-events-none z-10"
          onMouseEnter={() => setToolbarHovered(true)}
          onMouseLeave={() => setToolbarHovered(false)}
        >
          <Show when={selected() || hovered() || toolbarHovered()}>
            <div
              class="absolute right-0 flex p1 rounded-lg bg-white dark:bg-slate-7 shadow-md -top-5 pointer-events-auto z-10"
              classList={{
                "opacity-50": hovered() && !selected() && !toolbarHovered(),
              }}
            >
              <EditButton edit={addTextBelow}>
                <div class="i-lucide:plus w-full h-full group-hover:bg-primary-5 group-active:bg-primary-6" />
              </EditButton>
              <EditButton edit={saveAudio} disable={!saveable()}>
                <div class="i-lucide:save w-full h-full group-hover:bg-primary-5 group-active:bg-primary-6" />
              </EditButton>
              <EditButton edit={moveUp} disable={props.index === 0}>
                <div class="i-lucide:chevron-up w-full h-full group-hover:bg-primary-5 group-active:bg-primary-6" />
              </EditButton>
              <EditButton
                edit={moveDown}
                disable={props.index === textStore.length - 1}
              >
                <div class="i-lucide:chevron-down w-full h-full group-hover:bg-primary-5 group-active:bg-primary-6" />
              </EditButton>
              <EditButton edit={remove}>
                <div class="i-lucide:trash2 w-full h-full group-hover:bg-red-5 group-active:bg-red-6" />
              </EditButton>
            </div>
          </Show>
        </div>
        <div
          class="flex flex-row items-start justify-center pt-sm"
          onFocus={() => setSelected(props.index)}
        >
          <AutogrowInput
            text={currentText().text}
            setText={setText}
            focused={selected()}
            placeholder={t1("text_block.input_label")}
            aria-label={t1("text_block.input_label")}
            onFocus={() => setSelected(props.index)}
          />
        </div>
        <div
          class="flex flex-row flex-1 w-full"
          onClick={() => setSelected(props.index)}
        >
          <div class="flex-1 pointer-events-none" />
          <div class="text-sm text-slate-8 dark:text-slate-2 select-none pointer-events-none">
            <Show
              when={isStyleIdValid() && currentPreset()}
              fallback={
                <p class="text-yellow-7">{t1("preset.no_preset_selected")}</p>
              }
            >
              <p>{currentPreset()?.name}</p>
            </Show>
          </div>
          <Show when={config.ui_config.buffer_render}>
            {/* The traffic light presenting synthesis state */}
            <div
              class="flex flex-row items-center ml-2 gap-1"
              classList={{
                "opacity-50": !selected(),
              }}
              title={synthStateText()}
            >
              <div
                class="bg-slate-3 dark:bg-slate-6 w-3 h-3 rounded-full"
                classList={{
                  "!bg-red-4": trafficLightNumber() >= 0,
                }}
              />
              <div
                class="bg-slate-3 dark:bg-slate-6 w-3 h-3 rounded-full"
                classList={{
                  "!bg-yellow-4": trafficLightNumber() >= 1,
                }}
              />
              <div
                class="bg-slate-3 dark:bg-slate-6 w-3 h-3 rounded-full"
                classList={{ "!bg-green-4": trafficLightNumber() >= 2 }}
              />
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}

export default TextBlock;
