import { Accordion } from "@kobalte/core/accordion";
import { Select } from "@kobalte/core/select";
import { ToggleGroup } from "@kobalte/core/toggle-group";
import _ from "lodash";
import { For, JSX, Show, createMemo, createSignal } from "solid-js";
import { produce } from "solid-js/store";
import { StyleId } from "../binding";
import { usei18n } from "../contexts/i18n";
import { useMetaStore } from "../contexts/meta";
import { useTextStore } from "../contexts/text";
import { PageType, useUIStore } from "../contexts/ui";
import style from "./sidebar.module.css";

interface CharacterCardProps extends JSX.HTMLAttributes<HTMLDivElement> {
  name: string;
  style: string;
  speaker_id: number;
}

function CharacterCard(props: CharacterCardProps) {
  const { uiStore } = useUIStore()!;
  const { textStore } = useTextStore()!;
  const selected = createMemo(
    () =>
      textStore[uiStore.selectedTextBlockIndex].styleId === props.speaker_id,
  );
  return (
    <div class="flex p-1 group" {...props}>
      <div
        class="rounded-lg px2 p1 group-hover:bg-slate-2 overflow-hidden bg-slate-1 group-active:(bg-white scale-97) cursor-default select-none w-full"
        classList={{ "!bg-white shadow-md": selected() }}
      >
        <div class="text-sm">{props.name}</div>
        <div class="text-xs">{props.style}</div>
      </div>
    </div>
  );
}

function Sidebar() {
  const { metas, availableSpeakerIds } = useMetaStore()!;
  const { uiStore, setUIStore } = useUIStore()!;
  const { textStore, setTextStore } = useTextStore()!;
  const { t1 } = usei18n()!;

  const setStyleId = (styleId: StyleId) => {
    if (styleId in availableSpeakerIds()) {
      setTextStore(
        uiStore.selectedTextBlockIndex,
        produce((draft) => {
          draft.styleId = styleId;
        }),
      );
    }
  };

  const [expanded, setExpanded] = createSignal(["preset"]);
  const curText = () => textStore[uiStore.selectedTextBlockIndex];
  const curMeta = () =>
    metas.find((meta) =>
      meta.styles.find((style) => style.id === curText().styleId),
    );
  const curStyle = () =>
    curMeta()?.styles.find((style) => style.id === curText().styleId);
  const availableStyleNames = () =>
    _.flatMap(curMeta()?.styles.map((s) => s.name)) ?? [];
  const setStyleByName = (name: string) => {
    const style = curMeta()?.styles.find((s) => s.name === name);
    if (style) setStyleId(style.id);
  };

  return (
    <div class="size-full bg-transparent overflow-y-hidden flex flex-col pl2 pr0">
      <Show
        when={uiStore.page == null}
        fallback={
          <div class="size-full flex flex-col items-start justify-start p-3">
            <div class="text-lg font-bold">{t1("config.title")}</div>
            <div class="text-sm">{t1("config.sidebar_desp")}</div>
          </div>
        }
      >
        <div class="flex-1 overflow-y-auto py2">
          <For each={metas}>
            {(meta) => (
              <For each={meta.styles}>
                {(style) => (
                  <CharacterCard
                    name={meta.name}
                    style={style.name}
                    speaker_id={style.id}
                    onClick={() => {
                      setStyleId(style.id);
                    }}
                  />
                )}
              </For>
            )}
          </For>
        </div>
        <Accordion
          collapsible
          multiple
          defaultValue={["preset"]}
          value={expanded()}
          onChange={setExpanded}
        >
          <Accordion.Item
            value="preset"
            class="transition-all rounded-md p-1 ui-expanded:(shadow-md bg-white) bg-transparent"
          >
            <Accordion.Header>
              <Accordion.Trigger
                class={`w-full flex justify-between bg-transparent items-center hover:bg-white px-1 rounded-md ${style.trigger}`}
              >
                Preset
                <div class={`i-lucide:chevron-down size-4 ${style.icon}`} />
              </Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Content class={style.accordion_content}>
              {/* TODO: Don't repeat yourself */}
              <Select
                options={availableStyleNames()}
                class="py1"
                value={curStyle()?.name}
                onChange={(v) => {
                  if (v !== null) setStyleByName(v);
                }}
                itemComponent={(props) => (
                  <Select.Item
                    item={props.item}
                    class="p1 flex flex-row items-center justify-between rounded-md ui-highlighted:(bg-blue-5 text-white) cursor-pointer"
                  >
                    <Select.ItemLabel>{props.item.rawValue}</Select.ItemLabel>
                    <Select.ItemIndicator class="size-6 flex items-center justify-center">
                      <div class="i-lucide:check" />
                    </Select.ItemIndicator>
                  </Select.Item>
                )}
              >
                <Select.Label class="px1">Style</Select.Label>
                <Select.Trigger
                  class="flex flex-row items-center justify-between px2 w-full bg-white
                        h-8 bg-transparent border border-slate-2 rounded-md
                        hover:(bg-slate-1)"
                >
                  <Select.Value<string>>
                    {(state) => state.selectedOption()}
                  </Select.Value>
                  <Select.Icon>
                    <div class="size-4 i-lucide:chevrons-up-down" />
                  </Select.Icon>
                </Select.Trigger>
                <Select.Portal>
                  <Select.Content class="bg-white w-full rounded-lg border border-slate-2">
                    <Select.Listbox class="flex flex-col p1" />
                  </Select.Content>
                </Select.Portal>
              </Select>
            </Accordion.Content>
          </Accordion.Item>
        </Accordion>
      </Show>

      <ToggleGroup
        class="h-10 flex items-center justify-start"
        value={uiStore.page}
        onChange={(v) => {
          setUIStore("page", v as PageType);
        }}
      >
        <ToggleGroup.Item
          value="config"
          class="group size-8 p1 rounded-lg bg-white shadow-sm hover:bg-blue-5 ui-pressed:bg-blue-5 transition-transform active:scale-95"
        >
          <div class="i-lucide:cog bg-slate-8 size-full group-hover:bg-white ui-pressed:!bg-white" />
        </ToggleGroup.Item>
      </ToggleGroup>
    </div>
  );
}

export default Sidebar;
