import { Dialog } from "@kobalte/core/dialog";
import { ParentProps } from "solid-js";

interface AppDialogContentProps extends ParentProps {
  title: string;
  closeLabel: string;
  class?: string;
}

export function AppDialogContent(props: AppDialogContentProps) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay class="fixed inset-0 z-50 bg-black/50" />
      <div class="fixed inset-0 z-50 flex items-center justify-center p2">
        <Dialog.Content
          class={`flex flex-col bg-white dark:bg-slate-8 rounded-lg shadow-lg b b-slate-2 dark:b-slate-6 overflow-hidden outline-none ${props.class ?? ""}`}
        >
          <div class="flex items-center px4 py3 b-b b-slate-2 dark:b-slate-6">
            <Dialog.Title class="text-lg font-bold select-none cursor-default">
              {props.title}
            </Dialog.Title>
            <div class="flex-1" />
            <Dialog.CloseButton
              class="p1 rounded bg-transparent hover:bg-slate-1 dark:hover:bg-slate-7"
              aria-label={props.closeLabel}
            >
              <div class="i-lucide:x size-5" />
            </Dialog.CloseButton>
          </div>
          {props.children}
        </Dialog.Content>
      </div>
    </Dialog.Portal>
  );
}
