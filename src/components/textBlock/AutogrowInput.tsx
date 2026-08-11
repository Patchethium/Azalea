import { createEffect, JSX, on, Show, splitProps } from "solid-js";

interface AutogrowInputProps extends JSX.HTMLAttributes<HTMLDivElement> {
  text: string;
  setText: (text: string) => void;
  focused: boolean;
  placeholder: string;
}

export function AutogrowInput(props: AutogrowInputProps) {
  const [local, inputProps] = splitProps(props, [
    "text",
    "setText",
    "focused",
    "placeholder",
  ]);
  let inputRef: HTMLDivElement | undefined;

  createEffect(
    on([() => local.text], () => {
      if (inputRef !== undefined && local.text !== inputRef.innerText) {
        inputRef.innerText = local.text;
      }
    }),
  );

  createEffect(() => {
    if (
      local.focused &&
      inputRef !== undefined &&
      inputRef.ownerDocument.activeElement !== inputRef
    ) {
      inputRef.focus();
      const selection = inputRef.ownerDocument.getSelection();
      if (selection !== null) {
        const range = inputRef.ownerDocument.createRange();
        range.selectNodeContents(inputRef);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
  });

  const handleInput = () => {
    if (inputRef !== undefined) {
      local.setText(inputRef.innerText === "\n" ? "" : inputRef.innerText);
    }
  };

  return (
    <div class="relative w-full">
      <Show when={local.text === ""}>
        <span
          aria-hidden="true"
          class="pointer-events-none absolute inset-0 text-slate-4 dark:text-slate-5"
        >
          {local.placeholder}
        </span>
      </Show>
      <div
        contentEditable="plaintext-only"
        class="relative min-h-6 w-full outline-none"
        {...inputProps}
        ref={inputRef}
        onInput={handleInput}
      />
    </div>
  );
}
