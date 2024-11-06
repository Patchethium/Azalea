import { useTextStore } from "../store/text";
import { useMetaStore } from "../store/meta";
import { createEffect, createMemo, Show } from "solid-js";
import { query, synthesize } from "../commands";
import _ from "lodash";
import { AudioQuery } from "../types/AudioQuery";
import { StyleId } from "../types/StyleId";
import { NumberField } from "@kobalte/core/number-field";
import { TextField } from "@kobalte/core/text-field";
import { Button } from "@kobalte/core/button";

function TextBlock(props: { index: number }) {
  const { textStore, setTextStore } = useTextStore()!;
  const { metas, availableSpeakerIds } = useMetaStore()!;
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
      synthesize(curData.query, curData.styleId!);
    }
  };

  createEffect(async () => {
    const curData = data();
    if (isStyleIdValid()) {
      try {
        const audio_query = await query(curData.text, curData.styleId!);
        if (audio_query !== undefined) {
          setQuery(audio_query);
        }
      } catch (e) {
        console.error(e);
      }
    }
  });
  return (
    <div class="p3 border border-gray-100 rounded-2xl my-2 flex flex-col gap-2">
      <div class="flex flex-row items-center justify-center gap-1">
        <Button
          class="i-lucide:play w-6 h-6 border-1 border-gray rounded hover:(border border-blue-5 bg-blue-3)"
          onClick={speak}
        />
        <TextField
          onChange={(value: string) => setText(value)}
          value={data().text}
          class="flex-1"
        >
          <TextField.Label />
          <TextField.Input class="w-full h-10 p1 rounded-xl border border-gray-200" />
        </TextField>
      </div>
      <div class="flex flex-row flex-1 w-full">
        <NumberField
          class="w-10"
          value={data().styleId?.toString()}
          rawValue={data().styleId}
          onRawValueChange={setStyleId}
        >
          <div class="flex flex-row gap-1 w-10">
            <NumberField.Input class="w-10" />
            <div class="flex flex-col items-center justify-center w-auto">
              <NumberField.IncrementTrigger
                aria-label="Increment"
                class="number-field__increment"
              >
                <div class="i-lucide:chevron-up" />
              </NumberField.IncrementTrigger>
              <NumberField.DecrementTrigger
                aria-label="Decrement"
                class="number-field__decrement"
              >
                <div class="i-lucide:chevron-down" />
              </NumberField.DecrementTrigger>
            </div>
          </div>
        </NumberField>
        <div class="flex-1" />
        <Show
          when={isStyleIdValid()}
          fallback={<p>Please Choose a Style from Left Panel</p>}
        >
          <p>{speakerName()}</p>
        </Show>
      </div>
      <details>
        <summary>Query</summary>
        <pre>{JSON.stringify(data().query, null, 2)}</pre>
      </details>
    </div>
  );
}

export default TextBlock;
