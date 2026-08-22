import { type AccentPhrase, type Mora } from "$binding";
import { Slider } from "@kobalte/core/slider";
import { TextField } from "@kobalte/core/text-field";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  Show,
} from "solid-js";
import { Portal } from "solid-js/web";
import { useSideEffect } from "$utils";

type AccentPhraseItemProps = {
  phrase: AccentPhrase;
  setPhrase: (phrase: AccentPhrase) => void;
  label?: string;
} & (
  | {
      mode?: "full";
      refreshMoraData: () => void;
      onSplit: (index: number) => void;
      onCombine: () => void;
      onEdit: (text: string) => void;
    }
  | { mode: "accent" }
);

export function AccentPhraseItem(props: AccentPhraseItemProps) {
  const [hovered, setHovered] = createSignal(-1);
  const [phonemeHovered, setPhonemeHovered] = createSignal(false);
  const [pauseMoraHovered, setPauseMoraHovered] = createSignal(false);
  const [editMode, setEditMode] = createSignal(false);
  const setAccent = (accent: number) => {
    props.setPhrase({ ...props.phrase, accent });
  };
  const togglePauseMora = useSideEffect(
    () => {
      if (props.mode === "accent") return;
      props.setPhrase({
        ...props.phrase,
        pause_mora:
          props.phrase.pause_mora == null
            ? ({
                text: "、",
                consonant: null,
                consonant_length: null,
                vowel: "pau",
                pitch: 0,
                vowel_length: 0.3,
              } as Mora)
            : null,
      });
    },
    () => {
      if (props.mode !== "accent") props.refreshMoraData();
    },
  );

  const phraseText = createMemo(() =>
    props.phrase.moras.map((mora) => mora.text).join(""),
  );
  const [draftText, setDraftText] = createSignal(phraseText());
  let inputRef: HTMLInputElement | undefined;

  createEffect(
    on(phraseText, (text) => {
      if (!editMode()) setDraftText(text);
    }),
  );
  createEffect(
    on(editMode, (editing) => {
      if (editing) {
        queueMicrotask(() => {
          if (!editMode()) return;
          inputRef?.focus();
          inputRef?.select();
        });
        return;
      }
      if (draftText() !== phraseText() && props.mode !== "accent") {
        props.onEdit(draftText());
      }
    }),
  );

  return (
    <div class="flex flex-col h-full items-center justify-center">
      <Slider
        class="relative flex flex-col w-full select-none items-center py1"
        classList={{ pr12: props.mode !== "accent" }}
        minValue={1}
        maxValue={props.phrase.moras.length}
        step={1}
        value={[props.phrase.accent]}
        onChange={(value) => setAccent(value[0])}
        onChangeEnd={() => {
          if (props.mode !== "accent") props.refreshMoraData();
        }}
      >
        <Show when={props.label}>
          <Slider.Label class="sr-only">{props.label}</Slider.Label>
        </Show>
        <div class="w-full flex p1">
          <Slider.Track class="w-full h-2 bg-slate-2 dark:bg-slate-6 rounded-full relative ui-disabled:cursor-not-allowed">
            <Slider.Fill class="absolute bg-primary-5 rounded-full h-full ui-disabled:bg-primary-2" />
            <Slider.Thumb class="block w-2 h-4 bg-primary-5 ui-disabled:bg-primary-2 rounded-sm -top-1 outline-none">
              <Slider.Input />
            </Slider.Thumb>
          </Slider.Track>
        </div>
      </Slider>
      <div class="relative flex flex-row h-24">
        <For each={props.phrase.moras}>
          {(mora, index) => {
            const isHigh = (moraIndex: number) =>
              props.phrase.accent === 1
                ? moraIndex === 0
                : moraIndex >= 1 && moraIndex < props.phrase.accent;
            const high = () => isHigh(index());
            const nextHigh = () => isHigh(index() + 1);
            const lastMora = () => index() === props.phrase.moras.length - 1;
            const strokeDashArray = () => (hovered() === index() ? "4 2" : "0");

            return (
              <div class="flex justify-center items-center flex-row rounded-md">
                <div
                  class="size-8 bg-primary-1 dark:bg-primary-9 items-center justify-center flex rounded-md text-sm select-none"
                  classList={{
                    "mt-10": !high(),
                    "mb-10": high(),
                    "b b-primary-3":
                      props.mode !== "accent" && phonemeHovered(),
                    "cursor-pointer": props.mode !== "accent",
                    "cursor-default": props.mode === "accent",
                  }}
                  onMouseEnter={() => {
                    if (props.mode !== "accent") setPhonemeHovered(true);
                  }}
                  onMouseLeave={() => {
                    if (props.mode !== "accent") setPhonemeHovered(false);
                  }}
                  onClick={() => {
                    if (props.mode === "accent") return;
                    setDraftText(phraseText());
                    setEditMode(true);
                  }}
                >
                  {mora.text}
                </div>
                <Show
                  when={!lastMora()}
                  fallback={
                    <Show when={props.mode !== "accent"}>
                      <div
                        class="m-2 w-8 h-full rounded-md flex items-center justify-center hover:(bg-primary-50 dark:bg-primary-9) cursor-pointer"
                        classList={{ "!bg-transparent": pauseMoraHovered() }}
                        onClick={() => {
                          if (!pauseMoraHovered() && props.mode !== "accent") {
                            props.onCombine();
                          }
                        }}
                      >
                        <div
                          class="size-8 items-center justify-center flex rounded-md text-sm"
                          classList={{
                            "bg-transparent text-transparent b-dashed":
                              props.phrase.pause_mora == null,
                            "bg-primary-1 dark:bg-primary-9 hover:(b b-primary-3)":
                              props.phrase.pause_mora != null,
                            "text-black dark:text-white b b-primary-3":
                              pauseMoraHovered(),
                          }}
                          onMouseEnter={() => setPauseMoraHovered(true)}
                          onMouseLeave={() => setPauseMoraHovered(false)}
                          onClick={togglePauseMora}
                        >
                          {props.phrase.pause_mora?.text}
                        </div>
                      </div>
                    </Show>
                  }
                >
                  <div
                    class="bg-transparent w-4 flex items-center justify-center flex rounded-md h-24"
                    classList={{
                      "hover:bg-primary-50 dark:hover:bg-primary-9 cursor-pointer":
                        props.mode !== "accent",
                    }}
                    onMouseEnter={() => {
                      if (props.mode !== "accent") setHovered(index());
                    }}
                    onMouseLeave={() => {
                      if (props.mode !== "accent") setHovered(-1);
                    }}
                    onClick={() => {
                      if (props.mode !== "accent") props.onSplit(index() + 1);
                    }}
                  >
                    <svg
                      aria-label="Accent connection line"
                      class="top-0 text-primary-3"
                    >
                      <line
                        x1="0"
                        y1={high() ? "56" : "96"}
                        x2="16"
                        y2={nextHigh() ? "56" : "96"}
                        stroke="currentColor"
                        stroke-dasharray={strokeDashArray()}
                        stroke-width="2"
                      />
                    </svg>
                  </div>
                </Show>
              </div>
            );
          }}
        </For>
        <Show when={props.mode !== "accent" && editMode()}>
          <div
            class="absolute top-0 left-0 size-full z-20 flex items-center justify-center rounded-lg backdrop-blur-sm px2"
            onClick={() => setEditMode(false)}
          >
            <TextField
              class="w-full"
              value={draftText()}
              onChange={setDraftText}
              onKeyDown={(event) => {
                if (event.key === "Enter") setEditMode(false);
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <TextField.Input
                ref={(element) => {
                  inputRef = element;
                }}
                class="p1 px2 w-full b b-slate-2 dark:(b-slate-6 bg-slate-7) rounded-md outline-none focus:b-primary-5"
              />
            </TextField>
          </div>
        </Show>
        <Show when={props.mode !== "accent"}>
          <Portal mount={document.querySelector("main")!}>
            <Show when={editMode()}>
              <div
                class="fixed top-0 left-0 size-full bg-transparent z-10"
                onClick={() => setEditMode(false)}
              />
            </Show>
          </Portal>
        </Show>
      </div>
    </div>
  );
}
