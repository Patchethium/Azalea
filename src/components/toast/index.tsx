import * as Toast from "@kobalte/core/toast";
import { usei18n } from "@contexts/i18n";

export function AppToastRegion() {
  const { t1 } = usei18n()!;

  return (
    <Toast.Region
      aria-label={t1("toast.notifications")}
      class="fixed bottom-4 right-4 z-70 w-80 max-w-[calc(100vw-2rem)] outline-none"
    >
      <Toast.List class="m0 flex list-none flex-col gap2 p0 outline-none" />
    </Toast.Region>
  );
}

type ToastTone = "success" | "warning";

function showToast(tone: ToastTone, message: string, closeLabel: string) {
  const warning = tone === "warning";
  return Toast.toaster.show((props) => (
    <Toast.Root
      toastId={props.toastId}
      priority="high"
      class={`relative flex items-center gap3 overflow-hidden rounded-lg border bg-white p3 pr2 shadow-lg outline-none dark:bg-slate-8 ${warning ? "border-amber-3 dark:border-amber-7" : "border-slate-2"}`}
    >
      {warning && (
        <div
          aria-hidden="true"
          class="i-lucide:triangle-alert size-5 shrink-0 text-amber-5"
        />
      )}
      <Toast.Title class="min-w-0 flex-1 text-sm font-medium">
        {message}
      </Toast.Title>
      <Toast.CloseButton
        aria-label={closeLabel}
        class="size-8 flex shrink-0 items-center justify-center rounded-md bg-transparent outline-none hover:bg-slate-1 focus-visible:(ring-2 ring-primary-2) dark:hover:bg-slate-7"
      >
        <div aria-hidden="true" class="i-lucide:x size-4" />
      </Toast.CloseButton>
      <Toast.ProgressTrack
        class={`absolute bottom-0 left-0 h-0.5 w-full ${warning ? "bg-amber-2 dark:bg-amber-9" : "bg-primary-2 dark:bg-primary-9"}`}
      >
        <Toast.ProgressFill
          class={`h-full ${warning ? "bg-amber-5" : "bg-primary-5"}`}
          style={{ width: "var(--kb-toast-progress-fill-width)" }}
        />
      </Toast.ProgressTrack>
    </Toast.Root>
  ));
}

export function showSuccessToast(message: string, closeLabel: string) {
  return showToast("success", message, closeLabel);
}

export function showWarningToast(message: string, closeLabel: string) {
  return showToast("warning", message, closeLabel);
}
