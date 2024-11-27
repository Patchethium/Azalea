import { Button } from "@kobalte/core/button";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import _ from "lodash";
import {
  ParentComponent,
  Show,
  createEffect,
  createMemo,
  createSignal,
} from "solid-js";
import { commands } from "../binding";
import { AudioQuery } from "../binding";
import { useMetaStore } from "../store/meta";
import { useTextStore } from "../store/text";
import { useUIStore } from "../store/ui";
import AutogrowInput from "./AutogrowInput";

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
  const { textStore, setTextStore } = useTextStore()!;
  const { metas, availableSpeakerIds } = useMetaStore()!;
  const { uiStore, setUIStore } = useUIStore()!;
  const currentText = createMemo(() => textStore[props.index]);
  const speakerName = createMemo(() => {
    const speakerId = currentText().styleId;
    if (speakerId !== undefined) {
      const speaker = metas.find((meta) =>
        meta.styles.some((style) => style.id === speakerId),
      );
      const style = speaker?.styles.find((style) => style.id === speakerId);
      return _.join([speaker?.name, style?.name], "-");
    }
  });

  const [hovered, setHovered] = createSignal(false);
  const [toolbarHovered, setToolbarHovered] = createSignal(false);

  const setText = (text: string) => {
    setTextStore(props.index, { ...currentText(), text });
  };

  const setQuery = (query: AudioQuery) => {
    setTextStore(props.index, { ...currentText(), query });
  };

  const isStyleIdValid = createMemo(() => {
    const curData = currentText();
    if (curData.styleId !== undefined) {
      return availableSpeakerIds().includes(curData.styleId);
    }
    return false;
  });

  createEffect(async () => {
    const curData = currentText();
    if (isStyleIdValid()) {
      const audio_query = await commands.audioQuery(
        curData.text,
        curData.styleId!,
      );
      if (audio_query.status === "ok") {
        setQuery(audio_query.data);
      } else {
        console.error(audio_query.error);
      }
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
    setTextStore(textStore.length, { text: "", query: undefined });
    // shift every text block below by 1
    for (let i = textStore.length - 1; i > props.index + 1; i--) {
      const temp = textStore[i];
      setTextStore(i, textStore[i - 1]);
      setTextStore(i - 1, temp);
    }
    // clear the below text block
    setTextStore(props.index + 1, { text: "", styleId: currentText().styleId });
    // focus on the new text block
    setUIStore("selectedTextBlockIndex", props.index + 1);
  };

  const saveable = createMemo(
    () =>
      currentText().query !== undefined &&
      currentText().styleId !== undefined &&
      currentText().query!.accent_phrases.length > 0,
  );

  const saveAudio = async () => {
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
        currentText().query!,
        currentText().styleId!,
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
    setTextStore(textStore.filter((_, i) => i !== props.index));
  };

  let inputFieldRef: HTMLInputElement | undefined;

  createEffect(() => {
    if (selected()) {
      inputFieldRef?.focus();
    }
  });

  return (
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
            class="absolute right-0 flex p1 rounded-lg bg-white shadow-md -top-6 pointer-events-auto z-10"
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
      <div class="flex flex-row flex-1 w-full">
        <div class="flex-1 pointer-events-none" />
        <div class="text-sm text-slate-8 select-none pointer-events-none">
          <Show
            when={isStyleIdValid()}
            fallback={<p>Choose a Style from Left Input</p>}
          >
            <p>{speakerName()}</p>
          </Show>
        </div>
      </div>
    </div>
  );
}

export default TextBlock;
