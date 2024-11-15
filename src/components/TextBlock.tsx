import { Button } from "@kobalte/core/button";
import { NumberField } from "@kobalte/core/number-field";
import { TextField } from "@kobalte/core/text-field";
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
import { StyleId } from "../binding";
import { useMetaStore } from "../store/meta";
import { useTextStore } from "../store/text";
import { useUIStore } from "../store/ui";

const EditButton: ParentComponent<{
  edit: () => void;
  disable?: () => boolean;
}> = (props) => {
  const disabled = createMemo(() => props.disable?.() ?? false);
  return (
    <Button
      class="group h-6 w-6 bg-white rounded-md ui-disabled:cursor-not-allowed"
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
  const data = createMemo(() => textStore[props.index]);
  const speakerName = createMemo(() => {
    const speakerId = data().styleId;
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
    setTextStore(props.index, { ...data(), text });
  };

  const setQuery = (query: AudioQuery) => {
    setTextStore(props.index, { ...data(), query });
  };

  const setStyleId = (styleId: StyleId) => {
    if (styleId >= 0) {
      setTextStore(props.index, { ...data(), styleId });
    }
  };

  const isStyleIdValid = createMemo(() => {
    const curData = data();
    if (curData.styleId !== undefined) {
      return availableSpeakerIds().includes(curData.styleId);
    }
    return false;
  });

  const speak = () => {
    const curData = data();
    if (isStyleIdValid() && curData.query !== undefined) {
      commands.synthesize(curData.query, curData.styleId!);
    }
  };

  createEffect(async () => {
    const curData = data();
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
    setTextStore(props.index + 1, { text: "", styleId: data().styleId });
    // focus on the new text block
    setUIStore("selectedTextBlockIndex", props.index + 1);
  };

  const moveUp = () => {
    if (props.index > 0) {
      const temp = _.cloneDeep(textStore[props.index - 1]);
      setTextStore(props.index - 1, data());
      setTextStore(props.index, temp);
      setSelected(props.index - 1);
    }
  };

  const moveDown = () => {
    if (props.index < textStore.length - 1) {
      const temp = _.cloneDeep(textStore[props.index + 1]);
      setTextStore(props.index + 1, data());
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

  return (
    <div
      class="p3 border border-slate-2 rounded-2xl my-2 flex flex-col gap-3 relative"
      classList={{ "!border-blue-500": selected() }}
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
            class="absolute right-4 flex overflow-hidden rounded-lg p1 bg-white shadow-md -top-8 pointer-events-auto z-20 py1 px2"
            classList={{
              "opacity-50": hovered() && !selected() && !toolbarHovered(),
            }}
          >
            <EditButton edit={addTextBelow}>
              <div class="i-lucide:plus w-full h-full group-hover:bg-blue-5 group-active:bg-blue-6" />
            </EditButton>
            <EditButton edit={moveUp} disable={() => props.index === 0}>
              <div class="i-lucide:chevron-up w-full h-full group-hover:bg-blue-5 group-active:bg-blue-6" />
            </EditButton>
            <EditButton
              edit={moveDown}
              disable={() => props.index === textStore.length - 1}
            >
              <div class="i-lucide:chevron-down w-full h-full group-hover:bg-blue-5 group-active:bg-blue-6" />
            </EditButton>
            <EditButton edit={remove}>
              <div class="i-lucide:trash2 w-full h-full group-hover:bg-red-5 group-active:bg-red-6" />
            </EditButton>
          </div>
        </Show>
      </div>
      <div class="flex flex-row items-center justify-center gap-1">
        <Button
          class="group w-6 h-6 flex bg-transparent items-center justify-center"
          onClick={speak}
        >
          <div class="i-lucide:play w-5 h-5 bg-gray-8 group-hover:bg-blue-5 group-active:bg-blue-6" />
        </Button>
        <TextField
          onChange={(value: string) => setText(value)}
          value={data().text}
          onFocus={() => setSelected(props.index)}
          onFocusIn={() => setSelected(props.index)}
          class="flex-1"
        >
          <TextField.Label />
          <TextField.Input
            class="w-full h-10 p1 px-3 rounded-xl border border-slate-2 outline-none"
            classList={{ "ring-1 ring-blue-500": selected() }}
          />
        </TextField>
      </div>
      <div class="flex flex-row flex-1 w-full">
        <NumberField
          class="w-10"
          value={data().styleId?.toString()}
          rawValue={data().styleId}
          minValue={0}
          onRawValueChange={setStyleId}
        >
          <div class="flex flex-row gap-1 w-10">
            <NumberField.Input class="w-6" />
            <div class="flex flex-row items-center justify-center w-auto">
              <NumberField.IncrementTrigger
                aria-label="Increment"
                class="bg-transparent w5 h5 flex item-center justify-center disabled:cursor-not-allowed"
              >
                <div class="i-lucide:chevron-up w-full h-full hover:bg-blue-5 active:bg-blue-6" />
              </NumberField.IncrementTrigger>
              <NumberField.DecrementTrigger
                aria-label="Decrement"
                class="bg-transparent w5 h5 flex disabled:cursor-not-allowed"
              >
                <div class="i-lucide:chevron-down w-full h-full hover:bg-blue-5 active:bg-blue-6" />
              </NumberField.DecrementTrigger>
            </div>
          </div>
        </NumberField>
        <div class="flex-1" />
        <Show
          when={isStyleIdValid()}
          fallback={<p>Choose a Style from Left Input</p>}
        >
          <p>{speakerName()}</p>
        </Show>
      </div>
    </div>
  );
}

export default TextBlock;
