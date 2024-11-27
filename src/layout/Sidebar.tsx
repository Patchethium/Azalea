import { ToggleGroup } from "@kobalte/core/toggle-group";
import { For, Show } from "solid-js";
import { produce } from "solid-js/store";
import { StyleId } from "../binding";
import CharacterCard from "../components/CharacterCard";
import { usei18n } from "../store/i18n";
import { useMetaStore } from "../store/meta";
import { useTextStore } from "../store/text";
import { PageType, useUIStore } from "../store/ui";

function Sidebar() {
  const { metas, availableSpeakerIds } = useMetaStore()!;
  const { uiStore, setUIStore } = useUIStore()!;
  const { setTextStore } = useTextStore()!;
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

  return (
    <div class="size-full bg-transparent overflow-y-hidden gap-1 flex flex-col p1 pr-0">
      <div class="flex-1 overflow-y-auto py-2">
        <Show
          when={uiStore.page == null}
          fallback={
            <div class="size-full flex flex-col items-start justify-start p-3">
              <div class="text-lg font-bold">{t1("config.title")}</div>
              <div class="text-sm">{t1("config.sidebar_desp")}</div>
            </div>
          }
        >
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
        </Show>
      </div>
      <ToggleGroup
        class="h-10 p1 flex items-center justify-start"
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
