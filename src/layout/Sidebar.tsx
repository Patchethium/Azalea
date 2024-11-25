import { For } from "solid-js";
import { produce } from "solid-js/store";
import { StyleId } from "../binding";
import CharacterCard from "../components/CharacterCard";
import { useMetaStore } from "../store/meta";
import { useTextStore } from "../store/text";
import { useUIStore } from "../store/ui";

function Sidebar() {
  const { metas, availableSpeakerIds } = useMetaStore()!;
  const { uiStore } = useUIStore()!;
  const { setTextStore } = useTextStore()!;

  const setStyleId = (styleId: StyleId) => {
    console.log("setStyleId", styleId);
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
    <div class="size-full bg-transparent overflow-y-auto gap-1 flex flex-col p1">
      <For each={metas}>
        {(meta) => (
          <For each={meta.styles}>
            {(style) => (
              <CharacterCard
                name={meta.name}
                style={style.name}
                onClick={() => {
                  setStyleId(style.id);
                }}
              />
            )}
          </For>
        )}
      </For>
    </div>
  );
}

export default Sidebar;
