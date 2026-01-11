import { Button } from "@kobalte/core/button";
import { Separator } from "@kobalte/core/separator";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import _ from "lodash";
import {
  createEffect,
  createMemo,
  createSignal,
  JSX,
  on,
  onCleanup,
  ParentComponent,
  Show,
} from "solid-js";
import { produce, unwrap } from "solid-js/store";
import { AudioQuery, commands, SynthState } from "../binding";
import { usei18n } from "../contexts/i18n";
import { useMetaStore } from "../contexts/meta";
import { useTextStore } from "../contexts/text";
import { useUIStore } from "../contexts/ui";
import { getModifiedQuery } from "../utils";
import { createScheduled, debounce } from "@solid-primitives/scheduled";

interface ComponentProps extends JSX.HTMLAttributes<HTMLDivElement> {
  text: string;
  setText: (text: string) => void;
}

function AutogrowInput(props: ComponentProps) {
  let inputRef: HTMLDivElement | undefined;

  createEffect(
    on([() => props.text], () => {
      if (inputRef !== undefined) {
        if (props.text !== inputRef.innerText) {
          inputRef.innerText = props.text;
        }
      }
    }),
  );

  const handleInput = () => {
    if (inputRef !== undefined) {
      const text = inputRef.innerText === "\n" ? "" : inputRef.innerText;
      props.setText(text);
    }
  };

  return (
    <div
      contentEditable="plaintext-only"
      class="w-full outline-none"
      {...props}
      ref={inputRef}
      onInput={handleInput}
    />
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
  const { textStore, setTextStore, projectPresetStore } = useTextStore()!;
  const { availableStyleIds: availableSpeakerIds } = useMetaStore()!;
  const { uiStore, setUIStore } = useUIStore()!;
  const { t1 } = usei18n()!;
  const currentText = createMemo(() => textStore[props.index]);
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

  const fetchAudioQuery = _.throttle(async (text: string, styleId: number) => {
    const audio_query = await commands.audioQuery(text, styleId);
    if (audio_query.status === "ok") {
      setQuery(audio_query.data);
    } else {
      console.error(audio_query.error);
    }
  }, 500);

  onCleanup(() => fetchAudioQuery.cancel());

  createEffect(() => {
    const curPreset = currentPreset();
    const text = currentText().text;
    if (curPreset === null || text === "") {
      fetchAudioQuery.cancel();
      setQuery(null);
    } else if (isStyleIdValid()) {
      fetchAudioQuery(text, curPreset?.style_id ?? 0);
    }
  });

  const selected = createMemo(
    () => uiStore.selectedTextBlockIndex === props.index,
  );

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
    const currentQuery = currentText().query;
    if (currentQuery === null) return false;
    if (currentQuery.accent_phrases.length === 0) return false;
    return true;
  });

  const saveAudio = async () => {
    if (currentPreset() === null) {
      return;
    }
    const path = await saveDialog({
      title: "Save Audio",
      filters: [{ name: "Audio", extensions: ["wav"] }],
    });
    if (path !== null) {
      if (!path.endsWith(".wav")) {
        path.concat(".wav");
      }
      const save_audio = await commands.saveAudio(
        path,
        getModifiedQuery(unwrap(currentText().query!), currentPreset()!),
        currentPreset()?.style_id ?? 0,
      );
      if (save_audio.status === "ok") {
        console.log("Audio saved");
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
    if (selected()) {
      // usually we focus on the text block above
      // but if it's already the first one, we focus on the next one
      // which, in this case, is exactly the 0th one after removing
      if (props.index === 0) {
        setUIStore("selectedTextBlockIndex", 0);
      } else {
        setUIStore("selectedTextBlockIndex", props.index - 1);
      }
    }
    // there's a bug here, if we're focusing on the last one
    // and remove one block above, the focused index will be out of bound
    // we focus one block above before removing to fix this
    if (uiStore.selectedTextBlockIndex > props.index) {
      setUIStore("selectedTextBlockIndex", uiStore.selectedTextBlockIndex! - 1);
    }
    setTextStore(textStore.filter((_, i) => i !== props.index));
  };

  let inputFieldRef: HTMLInputElement | undefined;

  createEffect(() => {
    if (selected()) {
      inputFieldRef?.focus();
    }
  });

  const [synthState, setSynthState] = createSignal<SynthState>("UnInitialized");

  const synthSchedule = createScheduled((fn) => debounce(fn, 1000));

  createEffect(async () => {
    if (synthSchedule()) {
      const preset = currentPreset();
      const query = currentText().query;
      if (preset === null || query === null || preset.style_id === null) {
        setSynthState("UnInitialized");
        return;
      }
      setSynthState("Pending");
      const res = await commands.synthesize(
        getModifiedQuery(unwrap(query!), preset),
        preset.style_id!,
      );
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

  return (
    <div class="py-1.5">
      <div
        class="flex flex-col relative px3 pb1 b-l-2 b-slate-2 bg-white"
        classList={{ " !border-blue-5 shadow-md": selected() }}
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
              class="absolute right-0 flex p1 rounded-lg bg-white shadow-md -top-5 pointer-events-auto z-10"
              classList={{
                "opacity-50": hovered() && !selected() && !toolbarHovered(),
              }}
            >
              <EditButton edit={addTextBelow}>
                <div class="i-lucide:plus w-full h-full group-hover:bg-blue-5 group-active:bg-blue-6" />
              </EditButton>
              <EditButton edit={saveAudio} disable={!saveable()}>
                <div class="i-lucide:save w-full h-full group-hover:bg-blue-5 group-active:bg-blue-6" />
              </EditButton>
              <EditButton edit={moveUp} disable={props.index === 0}>
                <div class="i-lucide:chevron-up w-full h-full group-hover:bg-blue-5 group-active:bg-blue-6" />
              </EditButton>
              <EditButton
                edit={moveDown}
                disable={props.index === textStore.length - 1}
              >
                <div class="i-lucide:chevron-down w-full h-full group-hover:bg-blue-5 group-active:bg-blue-6" />
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
            onInput={(e) => {
              if (e.target != null)
                setText((e.target as HTMLDivElement).innerText);
            }}
            ref={inputFieldRef}
            onFocus={() => setSelected(props.index)}
          />
        </div>
        <div
          class="flex flex-row flex-1 w-full"
          onClick={() => setSelected(props.index)}
        >
          <div class="flex-1 pointer-events-none" />
          <div class="text-sm text-slate-8 select-none pointer-events-none">
            <Show
              when={isStyleIdValid() && currentPreset()}
              fallback={
                <p class="text-yellow-7">{t1("preset.no_preset_selected")}</p>
              }
            >
              <p>{currentPreset()?.name}</p>
            </Show>
          </div>
          {/* The traffic light presenting synthesis state */}
          <div class="flex flex-row items-center ml-2 gap-1" classList={{
            "opacity-50": !selected(),
          }}>
            <div
              class="bg-slate-3 w-3 h-3 rounded-full"
              classList={{
                "!bg-red-5": trafficLightNumber() >= 0,
              }}
            />
            <div
              class="bg-slate-3 w-3 h-3 rounded-full"
              classList={{
                "!bg-yellow-5": trafficLightNumber() >= 1,
              }}
            />
            <div
              class="bg-slate-3 w-3 h-3 rounded-full"
              classList={{ "!bg-green-5": trafficLightNumber() >= 2 }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default TextBlock;
