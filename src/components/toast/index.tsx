import * as Toast from "@kobalte/core/toast";
import { Show } from "solid-js";
import { AppButton } from "@components/button";
import { usei18n } from "@contexts/i18n";

export function AppToastRegion() {
  const { t1 } = usei18n()!;

  return (
    <Toast.Region
      aria-label={t1("toast.notifications")}
      duration={5000}
      class="fixed bottom-4 right-4 z-70 w-80 max-w-[calc(100vw-2rem)] outline-none"
    >
      <Toast.List class="m0 flex list-none flex-col gap2 p0 outline-none" />
    </Toast.Region>
  );
}

type ToastTone = "success" | "warning" | "error";

const toneStyles: Record<
  ToastTone,
  { border: string; icon: string | null; track: string; fill: string }
> = {
  success: {
    border: "",
    icon: null,
    track: "bg-primary-2 dark:bg-primary-9",
    fill: "bg-primary-5",
  },
  warning: {
    border: "border border-amber-3 dark:border-amber-7",
    icon: "i-lucide:triangle-alert text-amber-5",
    track: "bg-amber-2 dark:bg-amber-9",
    fill: "bg-amber-5",
  },
  error: {
    border: "border border-red-3 dark:border-red-7",
    icon: "i-lucide:circle-x text-red-5",
    track: "bg-red-2 dark:bg-red-9",
    fill: "bg-red-5",
  },
};

/** A button shown below the toast message; clicking it also dismisses the toast. */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

/** Toast IDs by message, so a repeated failure replaces its earlier toast. */
const visibleToasts = new Map<string, number>();

/** Renders an unknown thrown value or command error as readable text. */
export function errorDetail(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

function showToast(
  tone: ToastTone,
  message: string,
  closeLabel: string,
  detail?: string,
  action?: ToastAction,
) {
  const styles = toneStyles[tone];
  const previous = visibleToasts.get(message);
  if (previous !== undefined) Toast.toaster.dismiss(previous);
  const id = Toast.toaster.show((props) => (
    <Toast.Root
      toastId={props.toastId}
      priority="high"
      class={`relative flex items-center gap3 overflow-hidden rounded-lg bg-white p3 pr2 shadow-lg outline-none dark:bg-slate-8 ${styles.border}`}
    >
      {styles.icon && (
        <div
          aria-hidden="true"
          class={`size-5 shrink-0 self-start ${styles.icon}`}
        />
      )}
      <div class="min-w-0 flex flex-1 flex-col gap1">
        <Toast.Title class="text-sm font-medium">{message}</Toast.Title>
        <Show when={detail}>
          <Toast.Description class="line-clamp-3 select-text break-words text-xs text-slate-6 dark:text-slate-3">
            {detail}
          </Toast.Description>
        </Show>
        <Show when={action}>
          {(action) => (
            <AppButton
              size="sm"
              class="mt1 self-start"
              onClick={() => {
                Toast.toaster.dismiss(props.toastId);
                action().onClick();
              }}
            >
              {action().label}
            </AppButton>
          )}
        </Show>
      </div>
      <Toast.CloseButton
        aria-label={closeLabel}
        class="size-8 flex shrink-0 items-center justify-center self-start rounded-md bg-transparent outline-none hover:bg-slate-1 focus-visible:(ring-2 ring-primary-2) dark:hover:bg-slate-7"
      >
        <div aria-hidden="true" class="i-lucide:x size-4" />
      </Toast.CloseButton>
      <Toast.ProgressTrack
        class={`absolute bottom-0 left-0 h-0.5 w-full ${styles.track}`}
      >
        <Toast.ProgressFill
          class={`h-full ${styles.fill}`}
          style={{ width: "var(--kb-toast-progress-fill-width)" }}
        />
      </Toast.ProgressTrack>
    </Toast.Root>
  ));
  visibleToasts.set(message, id);
  return id;
}

export function showSuccessToast(
  message: string,
  closeLabel: string,
  action?: ToastAction,
) {
  return showToast("success", message, closeLabel, undefined, action);
}

export function showWarningToast(
  message: string,
  closeLabel: string,
  detail?: string,
) {
  return showToast("warning", message, closeLabel, detail);
}

export function showErrorToast(
  message: string,
  closeLabel: string,
  detail?: string,
) {
  return showToast("error", message, closeLabel, detail);
}

/** Toast helpers with the localized close label already applied. */
export function useToasts() {
  const { t1 } = usei18n()!;
  return {
    success: (message: string, action?: ToastAction) =>
      showSuccessToast(message, t1("toast.close"), action),
    warning: (message: string, detail?: unknown) =>
      showWarningToast(
        message,
        t1("toast.close"),
        detail === undefined ? undefined : errorDetail(detail),
      ),
    error: (message: string, detail?: unknown) =>
      showErrorToast(
        message,
        t1("toast.close"),
        detail === undefined ? undefined : errorDetail(detail),
      ),
  };
}
