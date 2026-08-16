import type { Preset, SynthesisJobState } from "$binding";
import { IconButton } from "@components/iconButton";
import { AutogrowInput } from "@components/textBlock/AutogrowInput";
import { createSignal, Show } from "solid-js";
import { useConfigStore } from "@contexts/config";
import { usei18n } from "@contexts/i18n";
import type { TextBlockProps } from "@contexts/text";

export function TextBlockView(props: {
  index: number;
  blockCount: number;
  currentText: TextBlockProps;
  currentPreset: Preset | null;
  presetAvailable: boolean;
  selected: boolean;
  saveable: boolean;
  setText: (text: string) => void;
  setSelected: () => void;
  addTextBelow: () => void;
  saveAudio: () => void;
  moveUp: () => void;
  moveDown: () => void;
  remove: () => void;
  synthState: SynthesisJobState | "Idle";
  synthStateText: () => string;
  synthStateIcon: () => string;
}) {
  const { config } = useConfigStore()!;
  const { t1 } = usei18n()!;
  const [hovered, setHovered] = createSignal(false);
  const [toolbarHovered, setToolbarHovered] = createSignal(false);

  return (
    <div class="py-1.5">
      <div
        class="flex flex-col relative px3 pb1 b-l-2 b-slate-2 dark:b-slate-6 bg-white dark:bg-slate-8"
        classList={{ " !border-primary-5 shadow-md": props.selected }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div
          class="sticky flex h-0 top-5 bg-transparent pointer-events-none z-10"
          onMouseEnter={() => setToolbarHovered(true)}
          onMouseLeave={() => setToolbarHovered(false)}
        >
          <Show when={props.selected || hovered() || toolbarHovered()}>
            <div
              class="absolute right-0 flex p1 rounded-lg bg-white dark:bg-slate-7 shadow-md -top-5 pointer-events-auto z-10"
              classList={{
                "opacity-50": hovered() && !props.selected && !toolbarHovered(),
              }}
            >
              <IconButton
                icon="i-lucide:plus"
                label={t1("text_block.controls.add_below")}
                onClick={props.addTextBelow}
              />
              <IconButton
                icon="i-lucide:save"
                label={t1("text_block.controls.save_audio")}
                disabled={!props.saveable}
                onClick={props.saveAudio}
              />
              <IconButton
                icon="i-lucide:chevron-up"
                label={t1("text_block.controls.move_up")}
                disabled={props.index === 0}
                onClick={props.moveUp}
              />
              <IconButton
                icon="i-lucide:chevron-down"
                label={t1("text_block.controls.move_down")}
                disabled={props.index === props.blockCount - 1}
                onClick={props.moveDown}
              />
              <IconButton
                icon="i-lucide:trash2"
                label={t1("text_block.controls.delete")}
                tone="danger"
                onClick={props.remove}
              />
            </div>
          </Show>
        </div>
        <div
          class="flex flex-row items-start justify-center pt-sm"
          onFocus={props.setSelected}
        >
          <AutogrowInput
            text={props.currentText.text}
            setText={props.setText}
            focused={props.selected}
            placeholder={t1("text_block.input_label")}
            aria-label={t1("text_block.input_label")}
            onFocus={props.setSelected}
          />
        </div>
        <div class="flex flex-row flex-1 w-full" onClick={props.setSelected}>
          <div class="flex-1 pointer-events-none" />
          <div class="text-sm text-slate-8 dark:text-slate-2 select-none pointer-events-none">
            <Show
              when={props.presetAvailable && props.currentPreset}
              fallback={
                <p class="text-yellow-7">{t1("preset.no_preset_selected")}</p>
              }
            >
              <p>
                {props.currentPreset?.name || t1("preset.placeholder_name")}
              </p>
            </Show>
          </div>
          <Show when={config.ui_config.buffer_render}>
            <output
              aria-label={props.synthStateText()}
              class="ml-2 flex size-5 items-center justify-center rounded-full border border-slate-2 bg-slate-1/80 text-slate-5 shadow-sm dark:(border-slate-6 bg-slate-8/80 text-slate-4)"
              classList={{
                "opacity-60": !props.selected,
                "!border-amber-2 !bg-amber-1/70 !text-amber-7 dark:(!border-amber-8/60 !bg-amber-9/20 !text-amber-4)":
                  props.selected && props.synthState === "Queued",
                "!border-sky-2 !bg-sky-1/70 !text-sky-7 dark:(!border-sky-8/60 !bg-sky-9/20 !text-sky-4)":
                  props.selected && props.synthState === "Running",
                "!border-emerald-2 !bg-emerald-1/70 !text-emerald-7 dark:(!border-emerald-8/60 !bg-emerald-9/20 !text-emerald-4)":
                  props.selected && props.synthState === "Completed",
                "!border-rose-2 !bg-rose-1/70 !text-rose-7 dark:(!border-rose-8/60 !bg-rose-9/20 !text-rose-4)":
                  props.selected && props.synthState === "Failed",
              }}
              title={props.synthStateText()}
            >
              <span
                aria-hidden="true"
                class={`size-3 ${props.synthStateIcon()}`}
                classList={{
                  "animate-spin": props.synthState === "Running",
                }}
              />
            </output>
          </Show>
        </div>
      </div>
    </div>
  );
}
