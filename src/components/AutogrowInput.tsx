import { JSX, createEffect, on } from "solid-js";

interface ComponentProps extends JSX.HTMLAttributes<HTMLDivElement> {
  text: string;
  setText: (text: string) => void;
}

function AutogrowInput(props: ComponentProps) {
  let inputRef: HTMLDivElement | undefined;

  createEffect(
    on([() => props.text], () => {
      if (inputRef !== undefined) {
        if (props.text !== inputRef.innerText) {
          inputRef.innerText = props.text;
        }
      }
    }),
  );

  const handleInput = () => {
    if (inputRef !== undefined) {
      const text = inputRef.innerText === "\n" ? "" : inputRef.innerText;
      props.setText(text);
    }
  };

  return (
    <div
      contentEditable="plaintext-only"
      class="w-full outline-none"
      {...props}
      ref={inputRef}
      onInput={handleInput}
    />
  );
}

export default AutogrowInput;
