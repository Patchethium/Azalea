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
      class="fixed bottom-4 right-4 z-toast w-80 max-w-[calc(100vw-2rem)] outline-none"
    >
      <Toast.List class="m0 flex list-none flex-col gap2 p0 outline-none" />
    </Toast.Region>
  );
}

type ToastTone = "success" | "warning" | "error" | "progress";

const toneStyles: Record<
  ToastTone,
  { border: string; icon: string | null; track: string; fill: string }
> = {
  success: {
    border: "",
    icon: null,
    track: "bg-accent-soft",
    fill: "bg-accent",
  },
  warning: {
    border: "border border-warning-border",
    icon: "i-lucide:triangle-alert text-warning",
    track: "bg-warning-soft",
    fill: "bg-warning",
  },
  error: {
    border: "border border-danger-border",
    icon: "i-lucide:circle-x text-danger",
    track: "bg-danger-soft",
    fill: "bg-danger",
  },
  progress: {
    border: "",
    icon: "i-lucide:loader-circle animate-spin text-accent",
    track: "bg-accent-soft",
    fill: "bg-accent",
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
      priority={tone === "progress" ? "low" : "high"}
      persistent={tone === "progress"}
      class={`relative flex items-center gap3 overflow-hidden rounded-lg bg-surface p3 pr2 shadow-lg outline-none ${styles.border}`}
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
          <Toast.Description class="line-clamp-3 select-text break-words text-xs text-ink-muted">
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
        class="size-8 flex shrink-0 items-center justify-center self-start rounded-md bg-transparent outline-none hover:bg-hover focus-visible:(ring-2 ring-focus-ring-soft)"
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

/**
 * Shows a toast that stays open until dismissed, for long-running work.
 * Returns a function that dismisses it.
 */
export function showProgressToast(message: string, closeLabel: string) {
  const id = showToast("progress", message, closeLabel);
  return () => {
    Toast.toaster.dismiss(id);
    if (visibleToasts.get(message) === id) visibleToasts.delete(message);
  };
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
    progress: (message: string) =>
      showProgressToast(message, t1("toast.close")),
    error: (message: string, detail?: unknown) =>
      showErrorToast(
        message,
        t1("toast.close"),
        detail === undefined ? undefined : errorDetail(detail),
      ),
  };
}
