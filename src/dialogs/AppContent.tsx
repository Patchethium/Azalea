import { Dialog } from "@kobalte/core/dialog";
import type { ParentProps } from "solid-js";

interface AppContentProps extends ParentProps {
  title: string;
  closeLabel: string;
  class?: string;
}

export function AppDialogContent(props: AppContentProps) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay class="fixed inset-0 z-overlay bg-overlay" />
      <div class="fixed inset-0 z-overlay flex items-center justify-center p2">
        <Dialog.Content
          class={`flex flex-col max-h-[80vh] bg-surface rounded-lg shadow-lg b b-border overflow-hidden outline-none ${props.class ?? ""}`}
        >
          <div class="flex items-center px4 py3 b-b b-border">
            <Dialog.Title class="text-lg font-bold select-none cursor-default">
              {props.title}
            </Dialog.Title>
            <div class="flex-1" />
            <Dialog.CloseButton
              class="p1 rounded-md bg-transparent outline-none hover:bg-hover focus-visible:(ring-2 ring-focus-ring)"
              aria-label={props.closeLabel}
            >
              <div aria-hidden="true" class="i-lucide:x size-5" />
            </Dialog.CloseButton>
          </div>
          {props.children}
        </Dialog.Content>
      </div>
    </Dialog.Portal>
  );
}
