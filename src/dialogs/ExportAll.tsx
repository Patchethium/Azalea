import { AppDialogContent } from "@dialogs/AppContent";
import { Button } from "@kobalte/core/button";
import { Dialog } from "@kobalte/core/dialog";
import { For, Show } from "solid-js";
import { usei18n } from "@contexts/i18n";

export interface ExportAllFailure {
  blockId: string;
  index: number;
  text: string;
  error: string;
}

interface ExportAllDialogProps {
  open: boolean;
  running: boolean;
  cancelling: boolean;
  finished: number;
  total: number;
  cancelled: boolean;
  failures: ExportAllFailure[];
  outputDir: string | null;
  onCancel: () => void;
  onClose: () => void;
}

const secondaryButtonClass =
  "rounded-lg bg-slate-2 px3 py2 text-sm font-medium outline-none hover:bg-slate-3 focus-visible:(ring-2 ring-primary-2) disabled:opacity-60 dark:bg-slate-7 dark:hover:bg-slate-6";

export function ExportAllDialog(props: ExportAllDialogProps) {
  const { t1, t2 } = usei18n()!;
  const exportedCount = () => props.finished - props.failures.length;
  const progressPercent = () =>
    props.total === 0 ? 0 : Math.round((props.finished / props.total) * 100);

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (open) return;
        if (props.running) props.onCancel();
        else props.onClose();
      }}
    >
      <AppDialogContent
        title={t1("export_all.title")}
        closeLabel={t1("export_all.close_label")}
        class="w-[min(90vw,32rem)]"
      >
        <div class="flex flex-col gap4 px5 py5">
          <Show when={props.running}>
            <p class="text-sm text-slate-7 dark:text-slate-3" role="status">
              {props.cancelling
                ? t1("export_all.cancelling")
                : t2("export_all.progress", {
                    finished: props.finished,
                    total: props.total,
                  })}
            </p>
            <div
              role="progressbar"
              aria-label={t1("export_all.progress_label")}
              aria-valuemin={0}
              aria-valuemax={props.total}
              aria-valuenow={props.finished}
              class="h-2 w-full overflow-hidden rounded-full bg-slate-2 dark:bg-slate-7"
            >
              <div
                class="h-full bg-primary-5 transition-all"
                style={{ width: `${progressPercent()}%` }}
              />
            </div>
            <div class="flex justify-end">
              <Button
                class={secondaryButtonClass}
                disabled={props.cancelling}
                onClick={props.onCancel}
              >
                {t1("export_all.cancel")}
              </Button>
            </div>
          </Show>
          <Show when={!props.running}>
            <Show
              when={props.total > 0}
              fallback={
                <p class="text-sm text-slate-7 dark:text-slate-3">
                  {t1("export_all.empty")}
                </p>
              }
            >
              <p class="text-sm font-medium" role="status">
                {t2("export_all.summary", {
                  exported: exportedCount(),
                  total: props.total,
                })}
              </p>
              <Show when={props.cancelled}>
                <p class="text-sm text-slate-7 dark:text-slate-3">
                  {t1("export_all.cancelled")}
                </p>
              </Show>
              <Show when={props.outputDir !== null}>
                <div class="flex flex-col gap-1">
                  <div class="text-xs font-medium text-slate-5 dark:text-slate-4">
                    {t1("export_all.output_dir")}
                  </div>
                  <div class="break-all text-sm">{props.outputDir}</div>
                </div>
              </Show>
              <Show when={props.failures.length > 0}>
                <div class="flex min-h-0 flex-col gap-1">
                  <div class="text-xs font-medium text-slate-5 dark:text-slate-4">
                    {t1("export_all.failures")}
                  </div>
                  <ul class="m0 flex max-h-48 list-none flex-col gap-2 overflow-y-auto p0">
                    <For each={props.failures}>
                      {(failure) => (
                        <li class="rounded-md bg-slate-1 p2 dark:bg-slate-7">
                          <div class="flex items-baseline gap-2 text-sm">
                            <span class="shrink-0 font-medium">
                              #{failure.index + 1}
                            </span>
                            <span class="truncate">{failure.text}</span>
                          </div>
                          <div class="mt-1 break-all text-xs text-red-6 dark:text-red-4">
                            {failure.error}
                          </div>
                        </li>
                      )}
                    </For>
                  </ul>
                </div>
              </Show>
            </Show>
            <div class="flex justify-end">
              <Button class={secondaryButtonClass} onClick={props.onClose}>
                {t1("export_all.close")}
              </Button>
            </div>
          </Show>
        </div>
      </AppDialogContent>
    </Dialog>
  );
}
