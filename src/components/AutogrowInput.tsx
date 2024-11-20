import { JSX, onMount } from "solid-js";

interface ComponentProps extends JSX.HTMLAttributes<HTMLDivElement> {
  text: string;
  setText: (text: string) => void;
}

function AutogrowInput(props: ComponentProps) {
  let inputRef: HTMLDivElement | undefined;

  onMount(() => {
    if (inputRef!==undefined) {
      inputRef.innerText = props.text;
    }
  })
  return (
    <div
      contentEditable="plaintext-only"
      class="w-full outline-none"
      {...props}
      ref={inputRef}
    />
  );
}

export default AutogrowInput;
