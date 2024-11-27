import { createMemo, JSX } from "solid-js";
import { useTextStore } from "../store/text";
import { useUIStore } from "../store/ui";
interface ComponentProps extends JSX.HTMLAttributes<HTMLDivElement> {
  name: string;
  style: string;
  speaker_id: number;
}

function CharacterCard(props: ComponentProps) {
  const { uiStore } = useUIStore()!;
  const { textStore } = useTextStore()!;
  const selected = createMemo(
    () => textStore[uiStore.selectedTextBlockIndex].styleId === props.speaker_id
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

export default CharacterCard;
