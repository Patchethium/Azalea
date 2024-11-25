import { JSX } from "solid-js";

interface ComponentProps extends JSX.HTMLAttributes<HTMLDivElement> {
  name: string;
  style: string;
}

function CharacterCard(props: ComponentProps) {
  return (
    <div
      class="rounded-md p1 hover:(shadow-md bg-white) cursor-default select-none w-full"
      {...props}
    >
      <div class="text-sm">{props.name}</div>
      <div class="text-xs">{props.style}</div>
    </div>
  );
}

export default CharacterCard;
